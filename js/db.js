import { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, PUBLIC_SERVER_DOMAIN, PUBLIC_SERVER_IP, PUBLIC_SERVER_PORT, CLOUD_BACKUP_ENDPOINT, DB_ID, COL } from './config.js';

// =============================================
// 민성이의 가계부 - Appwrite DB 레이어 (복구 및 호환성 버전)
// =============================================

class AppwriteDB {
  constructor() {
    this.errorLog = [];
    this.activeEndpoint = APPWRITE_ENDPOINT;
    try {
      if (!window.Appwrite) {
        this.logError('Appwrite SDK 로드 실패: window.Appwrite가 존재하지 않습니다.');
        this.online = false;
        this.ready = Promise.resolve();
        return;
      }
      this.client = new window.Appwrite.Client();
      this.client.setEndpoint(this.activeEndpoint).setProject(APPWRITE_PROJECT_ID);
      this.applyPinTokenHeader();
      console.log(`📡 DB 초기화: ${this.activeEndpoint} (Project: ${APPWRITE_PROJECT_ID})`);
      this.account = new window.Appwrite.Account(this.client);
      this.databases = new window.Appwrite.Databases(this.client);
      this.online = true;
      this.ready = this.ensureSession();
    } catch (e) {
      this.logError('DB 초기화 치명적 에러: ' + e.message);
      this.online = false;
      this.ready = Promise.resolve();
    }

    this.local = {
      get: (key) => JSON.parse(localStorage.getItem(`ledger_${key}`) || '[]'),
      set: (key, val) => localStorage.setItem(`ledger_${key}`, JSON.stringify(val)),
      create: (key, data, docId = null) => {
        const list = this.local.get(key);
        const newItem = { ...data, $id: docId || Date.now().toString(), $createdAt: new Date().toISOString() };
        list.push(newItem);
        this.local.set(key, list);
        return newItem;
      },
      update: (key, id, data) => {
        const list = this.local.get(key);
        const idx = list.findIndex(i => i.$id === id);
        if (idx >= 0) {
          list[idx] = { ...list[idx], ...data, $updatedAt: new Date().toISOString() };
          this.local.set(key, list);
          return list[idx];
        }
        return null;
      },
      delete: (key, id) => {
        const list = this.local.get(key);
        this.local.set(key, list.filter(i => i.$id !== id));
      }
    };
  }

  applyPinTokenHeader() {
    try {
      const token = localStorage.getItem('LEDGER_PIN_TOKEN') || sessionStorage.getItem('LEDGER_PIN_TOKEN') || '';
      if (this.client && this.client.headers) {
        if (token) this.client.headers['X-Ledger-Pin-Token'] = token;
        else delete this.client.headers['X-Ledger-Pin-Token'];
      }
    } catch (e) {}
  }

  logError(msg) {
    const time = new Date().toLocaleTimeString();
    console.warn(`[DB-ERROR ${time}] ${msg}`);
    this.errorLog.push(`[${time}] ${msg}`);
    if (this.errorLog.length > 20) this.errorLog.shift();
    if (window.renderDiagnostics) window.renderDiagnostics();
  }

  async testEndpointHealth(endpointUrl, timeoutMs = 2200) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${endpointUrl}/health`, {
        method: 'GET',
        headers: { 'X-Appwrite-Project': APPWRITE_PROJECT_ID },
        signal: ctrl.signal
      });
      clearTimeout(timer);
      return res.ok || res.status === 401 || res.status === 403;
    } catch (e) {
      clearTimeout(timer);
      return false;
    }
  }

  async ensureSession() {
    if (!window.Appwrite) return;

    // 후보 엔드포인트 목록 (1순위: 설정된 공인 IP / 현재 접속 서버 -> 2순위: 내부망 -> 3순위: 클라우드 백업)
    const isHttpsPage = typeof window !== 'undefined' && window.location && window.location.protocol === 'https:';
    const candidates = [];

    if (!isHttpsPage) {
      if (typeof window !== 'undefined' && window.location && window.location.protocol === 'http:' && window.location.host && !window.location.host.includes('github.io')) {
        candidates.push(`${window.location.origin}/v1`);
      }
      candidates.push(`http://${PUBLIC_SERVER_DOMAIN}/v1`);
      candidates.push(`http://${PUBLIC_SERVER_DOMAIN}:${PUBLIC_SERVER_PORT}/v1`);
      candidates.push(`http://${PUBLIC_SERVER_IP}:${PUBLIC_SERVER_PORT}/v1`);
      candidates.push(`http://${PUBLIC_SERVER_IP}/v1`);
      candidates.push('http://192.168.150.240:8080/v1');
    }
    if (this.activeEndpoint && !candidates.includes(this.activeEndpoint) && (!isHttpsPage || this.activeEndpoint.startsWith('https:'))) {
      candidates.unshift(this.activeEndpoint);
    }
    if (CLOUD_BACKUP_ENDPOINT && !candidates.includes(CLOUD_BACKUP_ENDPOINT)) {
      candidates.push(CLOUD_BACKUP_ENDPOINT);
    }

    for (const ep of candidates) {
      const reachable = await this.testEndpointHealth(ep);
      if (!reachable) continue;

      this.activeEndpoint = ep;
      this.client.setEndpoint(ep).setProject(APPWRITE_PROJECT_ID);
      this.applyPinTokenHeader();
      try {
        await this.account.get();
        console.log(`✅ DB 서버 연결 성공 (${ep})`);
        this.online = true;
        return;
      } catch (e) {
        try {
          await this.account.createAnonymousSession();
          console.log(`✅ DB 서버 익명 세션 생성 성공 (${ep})`);
          this.online = true;
          return;
        } catch (err) {
          console.warn(`세션 시도 실패 (${ep}):`, err.message);
        }
      }
    }

    console.warn('모든 서버 엔드포인트 연결 지연 (오프라인 모드 유지)');
    this.online = false;
  }

  async reconnect() {
    this.online = true;
    await this.ensureSession();
    if (window.checkDbStatus) window.checkDbStatus();
  }

  async listDocs(colId, queries = []) {
    if (this.online) {
      try {
        const finalQueries = [...queries, window.Appwrite.Query.limit(5000)];
        return await this.databases.listDocuments(DB_ID, colId, finalQueries);
      } catch (e) {
        console.warn(`${colId} 로드 지연/실패:`, e.message);
      }
    }
    return { documents: this.local.get(colId) };
  }

  // 🚀 데이터 건수 무제한 자동 연속 조회 (2년/4년 전 과거 데이터 영구 보장)
  async listAllDocs(colId, baseQueries = []) {
    if (this.online) {
      try {
        let allDocs = [];
        let cursor = null;
        const PAGE_SIZE = 5000;
        while (true) {
          const currentQueries = [
            ...baseQueries,
            window.Appwrite.Query.limit(PAGE_SIZE)
          ];
          if (cursor) {
            currentQueries.push(window.Appwrite.Query.cursorAfter(cursor));
          }
          const res = await this.databases.listDocuments(DB_ID, colId, currentQueries);
          if (!res || !res.documents || res.documents.length === 0) break;
          allDocs = allDocs.concat(res.documents);
          if (res.documents.length < PAGE_SIZE) break;
          cursor = res.documents[res.documents.length - 1].$id;
        }
        return { documents: allDocs, total: allDocs.length };
      } catch (e) {
        console.warn(`${colId} 전량 로드 지연/실패:`, e.message);
      }
    }
    return { documents: this.local.get(colId) };
  }

  async createDoc(colId, data, docId = null) {
    await this.ready;
    const { $id, $createdAt, $updatedAt, $permissions, $databaseId, $collectionId, ...cleanData } = data;
    
    if (this.online) {
      try {
        // 🚀 익명 세션 ID 변경 시에도 수정할 수 있도록 모든 방문자에게 읽기/쓰기 권한 부여 (유실 방지)
        const perms = [
          window.Appwrite.Permission.read(window.Appwrite.Role.any()),
          window.Appwrite.Permission.write(window.Appwrite.Role.any()),
        ];
        return await this.databases.createDocument(DB_ID, colId, docId || window.Appwrite.ID.unique(), cleanData, perms);
      } catch (e) { 
        console.error('온라인 생성 실패:', e.message);
        throw e; // 🚀 에러를 던져야 상위에서 감지 가능
      }
    }
    return this.local.create(colId, cleanData, docId);
  }

  async updateDoc(colId, docId, data) {
    await this.ready;
    const { $id, $createdAt, $updatedAt, $permissions, $databaseId, $collectionId, ...cleanData } = data;
    if (this.online) {
      try {
        return await this.databases.updateDocument(DB_ID, colId, docId, cleanData);
      } catch (e) { 
        console.error('온라인 업데이트 실패:', e.message);
        throw e;
      }
    }
    return this.local.update(colId, docId, cleanData);
  }

  async deleteDoc(colId, docId) {
    await this.ready;
    if (this.online) {
      try { await this.databases.deleteDocument(DB_ID, colId, docId); }
      catch (e) { 
        console.error('온라인 삭제 실패:', e.message);
        throw e;
      }
    }
    this.local.delete(colId, docId);
  }

  // 🚀 utils.js 호환을 위한 레거시 명칭 API 복구
  async listAccounts() { return this.getAccounts(); }
  async listTransactions() { return this.getTransactions(); }
  async listBudgets() { return this.getBudgets(); }

  // 최신 도메인 메서드
  async getAccounts() {
    const res = await this.listDocs(COL.ACCOUNTS);
    return res.documents || [];
  }

  async getTransactions() {
    const res = await this.listAllDocs(COL.TRANSACTIONS, [
      window.Appwrite.Query.orderDesc("date")
    ]);
    return res.documents || [];
  }

  async getBudgets() {
    const res = await this.listDocs(COL.BUDGETS);
    return res.documents || [];
  }

  async getSettings() {
    const res = await this.listDocs(COL.SETTINGS);
    return (res.documents && res.documents[0]) || null;
  }

  // 예산 Upsert (저장/수정) - 최적화 버전
  async saveBudget(data, existingList = null) {
    const ym = (data.yearMonth || '').replace(/\./g, '-');
    const cleanData = { ...data, yearMonth: ym };

    if (this.online) {
      try {
        const list = existingList || (await this.getBudgets());
        const existing = list.find(b => 
          (b.yearMonth || '').replace(/\./g, '-') === ym && 
          b.category === data.category && 
          b.subCategory === data.subCategory
        );

        if (existing) {
          if (Number(existing.amount) === Number(data.amount)) return existing;
          return await this.updateDoc(COL.BUDGETS, existing.$id, cleanData);
        } else {
          if (Number(data.amount) === 0) return { ...cleanData, $id: 'temp-0' };
          return await this.createDoc(COL.BUDGETS, cleanData);
        }
      } catch (e) {
        console.error('예산 서버 저장 중 치명적 오류:', e.message);
        throw e; // 🚀 확실하게 에러를 던짐
      }
    }
    const list = this.local.get(COL.BUDGETS);
    const idx = list.findIndex(b => (b.yearMonth || '').replace(/\./g, '-') === ym && b.category === data.category && b.subCategory === data.subCategory);
    if (idx >= 0) return this.local.update(COL.BUDGETS, list[idx].$id, cleanData);
    else return this.local.create(COL.BUDGETS, cleanData);
  }

  async saveSettings(data) {
    const existing = await this.getSettings();
    if (existing) return await this.updateDoc(COL.SETTINGS, existing.$id, data);
    return await this.createDoc(COL.SETTINGS, data, 'global-settings');
  }

  // 계좌 관련 호환성
  async createAccount(d) { await this.ready; return this.createDoc(COL.ACCOUNTS, d); }
  async updateAccount(id, d) { await this.ready; return this.updateDoc(COL.ACCOUNTS, id, d); }
  async deleteAccount(id) { await this.ready; return this.deleteDoc(COL.ACCOUNTS, id); }

  // 트랜잭션 관련 호환성
  async createTransaction(d) { await this.ready; return this.createDoc(COL.TRANSACTIONS, d); }
  async updateTransaction(id, d) { await this.ready; return this.updateDoc(COL.TRANSACTIONS, id, d); }
  async deleteTransaction(id) { await this.ready; return this.deleteDoc(COL.TRANSACTIONS, id); }
}

export const db = new AppwriteDB();

import { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, DB_ID, COL } from './config.js';

// =============================================
// 민성이의 가계부 - Appwrite DB 레이어 (복구 및 호환성 버전)
// =============================================

class AppwriteDB {
  constructor() {
    this.client = new window.Appwrite.Client();
    this.client.setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID);
    this.account = new window.Appwrite.Account(this.client);
    this.databases = new window.Appwrite.Databases(this.client);
    this.online = true;

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

    // 🚀 ready 프로미스 복구 (utils.js 호환)
    this.ready = this.ensureSession();
  }

  async ensureSession() {
    if (!this.online) return;
    try {
      await this.account.get();
    } catch {
      try {
        await this.account.createAnonymousSession();
      } catch (e) {
        console.warn('세션 생성 실패:', e.message);
        this.online = false;
      }
    }
  }

  async listDocs(colId, queries = []) {
    await this.ready; // 🚀 세션 준비 완료까지 강제 대기 (레이스 컨디션 방지)
    if (this.online) {
      try {
        // 🚀 데이터 누락 방지를 위해 기본 limit 상향
        const finalQueries = [...queries, window.Appwrite.Query.limit(5000)];
        return await this.databases.listDocuments(DB_ID, colId, finalQueries);
      } catch (e) {
        console.warn(`${colId} 로드 실패:`, e.message);
        this.online = false;
        if(window.toast) window.toast('⚠️ 클라우드 연결 실패! 오프라인 모드로 앱을 시작합니다.', 'error');
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
    const res = await this.listDocs(COL.TRANSACTIONS, [
      window.Appwrite.Query.orderDesc("date"),
      window.Appwrite.Query.limit(1000)
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

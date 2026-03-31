// =============================================
// 민성이의 가계부 - Appwrite DB 레이어
// =============================================

class AppwriteDB {
  constructor() {
    this.endpoint = APPWRITE_ENDPOINT;
    this.projectId = APPWRITE_PROJECT_ID;
    this.apiKey = null; // 클라이언트 사이드 - 익명 세션 사용
  }

  async headers(extra = {}) {
    return {
      'Content-Type': 'application/json',
      'X-Appwrite-Project': this.projectId,
      'X-Appwrite-Key': 'standard_fa6edc6cc9bedfb43dfc66765bd9dba98211f1d96ca6f1320e679d7f345941bafe904d52c172586aa41590db7a00ce4c8d94010546d142a0179f9995390f381daac3fc4a3012e53b1fcb4c5074b8728796483f1903026d202df60fa0c931b749480325bc10ff6c44e553f1a3d7d667eb99c3ec8e05fb169ab9bb2626a126a030',
      ...extra,
    };
  }

  async req(method, path, body = null) {
    const opts = {
      method,
      headers: await this.headers(),
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(this.endpoint + path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || 'Appwrite error');
    }
    return res.json();
  }

  // ── 연결 확인 (API Key 방식) ──────────────
  async ensureSession() {
    // /databases 로 연결 테스트 (CORS 안전)
    try {
      await this.req('GET', `/databases/${DB_ID}`);
      return true;
    } catch(e) {
      console.warn('Appwrite 연결 실패:', e.message);
      throw e;
    }
  }

  // ── Documents CRUD ──────────────────────────
  async listDocs(colId, queries = []) {
    let qs = queries.map(q => `queries[]=${encodeURIComponent(q)}`).join('&');
    return this.req('GET', `/databases/${DB_ID}/collections/${colId}/documents${qs ? '?' + qs : ''}`);
  }

  async getDoc(colId, docId) {
    return this.req('GET', `/databases/${DB_ID}/collections/${colId}/documents/${docId}`);
  }

  async createDoc(colId, data, docId = null) {
    const id = docId || this.generateId();
    return this.req('POST', `/databases/${DB_ID}/collections/${colId}/documents`, {
      documentId: id,
      data,
    });
  }

  async updateDoc(colId, docId, data) {
    return this.req('PATCH', `/databases/${DB_ID}/collections/${colId}/documents/${docId}`, { data });
  }

  async deleteDoc(colId, docId) {
    return this.req('DELETE', `/databases/${DB_ID}/collections/${colId}/documents/${docId}`);
  }

  generateId() {
    return 'id' + Date.now() + Math.random().toString(36).substr(2, 9);
  }
}

// =============================================
// LocalStorage 기반 로컬 DB (오프라인 fallback)
// =============================================
class LocalDB {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); }
    catch { return []; }
  }
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
  getOne(key, id) { return this.get(key).find(d => d.$id === id) || null; }

  list(col) { return { documents: this.get(col), total: this.get(col).length }; }

  create(col, data, id = null) {
    const arr = this.get(col);
    const doc = { $id: id || ('l' + Date.now()), $createdAt: new Date().toISOString(), ...data };
    arr.push(doc);
    this.set(col, arr);
    return doc;
  }

  update(col, id, data) {
    const arr = this.get(col).map(d => d.$id === id ? { ...d, ...data } : d);
    this.set(col, arr);
    return arr.find(d => d.$id === id);
  }

  delete(col, id) {
    const arr = this.get(col).filter(d => d.$id !== id);
    this.set(col, arr);
  }
}

// =============================================
// 통합 DB 레이어 (Appwrite 우선, 실패시 로컬)
// =============================================
class DB {
  constructor() {
    this.aw = new AppwriteDB();
    this.local = new LocalDB();
    this.online = false;
    this.init();
  }

  async init() {
    try {
      await this.aw.ensureSession();
      this.online = true;
      console.log('✅ Appwrite 연결 성공');
    } catch (e) {
      console.warn('⚠️ 오프라인 모드:', e.message);
      this.online = false;
    }
  }

  async syncLocalToRemote() {
    // 로컬 데이터를 원격으로 동기화 (향후 구현)
  }

  async listTransactions(queries = []) {
    if (this.online) {
      try {
        const res = await this.aw.listDocs(COL.TRANSACTIONS, [
          'Query.orderDesc("date")',
          'Query.limit(500)',
          ...queries
        ]);
        return res.documents || [];
      } catch(e) {
        console.warn('거래내역 조회 실패:', e.message);
        // online 상태 유지 (연결은 됐지만 데이터만 없는 경우)
      }
    }
    return this.local.get(COL.TRANSACTIONS).sort((a,b) => b.date?.localeCompare(a.date));
  }

  async createTransaction(data) {
    if (this.online) {
      try {
        return await this.aw.createDoc(COL.TRANSACTIONS, data);
      } catch { this.online = false; }
    }
    return this.local.create(COL.TRANSACTIONS, data);
  }

  async updateTransaction(id, data) {
    if (this.online) {
      try { return await this.aw.updateDoc(COL.TRANSACTIONS, id, data); }
      catch { this.online = false; }
    }
    return this.local.update(COL.TRANSACTIONS, id, data);
  }

  async deleteTransaction(id) {
    if (this.online) {
      try { return await this.aw.deleteDoc(COL.TRANSACTIONS, id); }
      catch { this.online = false; }
    }
    this.local.delete(COL.TRANSACTIONS, id);
  }

  async listAccounts() {
    if (this.online) {
      try {
        const res = await this.aw.listDocs(COL.ACCOUNTS);
        return res.documents || [];
      } catch(e) {
        console.warn('계좌 조회 실패:', e.message);
      }
    }
    return this.local.get(COL.ACCOUNTS);
  }

  async createAccount(data) {
    if (this.online) {
      try { return await this.aw.createDoc(COL.ACCOUNTS, data); }
      catch { this.online = false; }
    }
    return this.local.create(COL.ACCOUNTS, data);
  }

  async updateAccount(id, data) {
    if (this.online) {
      try { return await this.aw.updateDoc(COL.ACCOUNTS, id, data); }
      catch { this.online = false; }
    }
    return this.local.update(COL.ACCOUNTS, id, data);
  }

  async deleteAccount(id) {
    if (this.online) {
      try { return await this.aw.deleteDoc(COL.ACCOUNTS, id); }
      catch { this.online = false; }
    }
    this.local.delete(COL.ACCOUNTS, id);
  }

  async listBudgets() {
    if (this.online) {
      try {
        const res = await this.aw.listDocs(COL.BUDGETS);
        return res.documents || [];
      } catch(e) {
        console.warn('예산 조회 실패:', e.message);
      }
    }
    return this.local.get(COL.BUDGETS);
  }

  async saveBudget(data) {
    const existing = (await this.listBudgets()).find(
      b => b.category === data.category && b.yearMonth === data.yearMonth
    );
    if (existing) return this.updateBudget(existing.$id, data);

    if (this.online) {
      try { return await this.aw.createDoc(COL.BUDGETS, data); }
      catch { this.online = false; }
    }
    return this.local.create(COL.BUDGETS, data);
  }

  async updateBudget(id, data) {
    if (this.online) {
      try { return await this.aw.updateDoc(COL.BUDGETS, id, data); }
      catch { this.online = false; }
    }
    return this.local.update(COL.BUDGETS, id, data);
  }

  async getSettings() {
    if (this.online) {
      try {
        const res = await this.aw.listDocs(COL.SETTINGS);
        return res.documents?.[0] || null;
      } catch { this.online = false; }
    }
    const arr = this.local.get(COL.SETTINGS);
    return arr[0] || null;
  }

  async saveSettings(data) {
    const existing = await this.getSettings();
    if (existing) {
      if (this.online) {
        try { return await this.aw.updateDoc(COL.SETTINGS, existing.$id, data); }
        catch {}
      }
      return this.local.update(COL.SETTINGS, existing.$id, data);
    }
    if (this.online) {
      try { return await this.aw.createDoc(COL.SETTINGS, data, 'global-settings'); }
      catch {}
    }
    return this.local.create(COL.SETTINGS, data, 'global-settings');
  }
}

const db = new DB();

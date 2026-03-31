import { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, DB_ID, COL } from './config.js';

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

  // ── 세션 (익명 로그인) ──────────────────────
  async ensureSession() {
    try {
      await this.req('GET', '/account');
    } catch {
      try {
        await this.req('POST', '/account/sessions/anonymous');
      } catch (e) {
        console.warn('세션 생성 실패:', e.message);
      }
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
      await this.syncLocalToRemote();
    } catch (e) {
      console.warn('⚠️ 오프라인 모드:', e.message);
      this.online = false;
    }
  }

  async syncLocalToRemote() {
    if (!this.online) return;
    try {
      // 로컬에만 있는 데이터 파악 (아이디가 l로 시작하거나 Appwrite에 없는 것들)
      const collections = [COL.TRANSACTIONS, COL.ACCOUNTS, COL.BUDGETS];
      for (const col of collections) {
        const localItems = this.local.get(col);
        if (localItems && localItems.length > 0) {
          // 중복 방지: 서버 데이터를 받아서 체크 (여기서는 단순하게 전부 push, 차후 최적화 고려)
          const serverItemsRes = await this.aw.listDocs(col);
          const serverIds = (serverItemsRes.documents || []).map(d => d.$id);
          
          for (const item of localItems) {
            if (!serverIds.includes(item.$id)) {
              // _id 혹은 $가 붙은 Appwrite 시스템 필드는 제거 후 업로드
              const { $id, $createdAt, $updatedAt, $permissions, $databaseId, $collectionId, ...uploadData } = item;
              await this.aw.createDoc(col, uploadData, $id);
            }
          }
        }
      }
    } catch (error) {
       console.error('동기화 중 오류 발생:', error);
    }
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
      } catch { this.online = false; }
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
      } catch { this.online = false; }
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
      } catch { this.online = false; }
    }
    return this.local.get(COL.BUDGETS);
  }

  async saveBudget(data) {
    const existing = (await this.listBudgets()).find(
      b => b.category === data.category && b.yearMonth === data.yearMonth && b.subCategory === data.subCategory
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

export const db = new DB();

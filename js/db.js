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
    if (this.online) {
      try {
        return await this.databases.listDocuments(DB_ID, colId, queries);
      } catch (e) {
        console.warn(`${colId} 로드 실패:`, e.message);
        this.online = false;
      }
    }
    return { documents: this.local.get(colId) };
  }

  async createDoc(colId, data, docId = null) {
    const { $id, $createdAt, $updatedAt, $permissions, $databaseId, $collectionId, ...cleanData } = data;
    if (this.online) {
      try {
        return await this.databases.createDocument(DB_ID, colId, docId || window.Appwrite.ID.unique(), cleanData);
      } catch (e) { console.warn('온라인 생성 실패:', e.message); }
    }
    return this.local.create(colId, cleanData, docId);
  }

  async updateDoc(colId, docId, data) {
    const { $id, $createdAt, $updatedAt, $permissions, $databaseId, $collectionId, ...cleanData } = data;
    if (this.online) {
      try {
        return await this.databases.updateDocument(DB_ID, colId, docId, cleanData);
      } catch (e) { console.warn('온라인 업데이트 실패:', e.message); }
    }
    return this.local.update(colId, docId, cleanData);
  }

  async deleteDoc(colId, docId) {
    if (this.online) {
      try { await this.databases.deleteDocument(DB_ID, colId, docId); }
      catch (e) { console.warn('온라인 삭제 실패:', e.message); }
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

  // 예산 Upsert (저장/수정)
  async saveBudget(data) {
    const ym = (data.yearMonth || '').replace(/\./g, '-');
    const cleanData = { ...data, yearMonth: ym };
    if (this.online) {
      try {
        const q = [window.Appwrite.Query.equal("yearMonth", ym), window.Appwrite.Query.equal("category", data.category)];
        if (data.subCategory) q.push(window.Appwrite.Query.equal("subCategory", data.subCategory));
        else q.push(window.Appwrite.Query.isNull("subCategory"));

        const existing = await this.listDocs(COL.BUDGETS, q);
        if (existing.documents && existing.documents.length > 0) {
          return await this.updateDoc(COL.BUDGETS, existing.documents[0].$id, cleanData);
        } else {
          return await this.createDoc(COL.BUDGETS, cleanData);
        }
      } catch (e) { console.warn('예산 온라인 저장 실패:', e.message); }
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

  // 거래 관련 호환성
  async createTransaction(d) { return this.createDoc(COL.TRANSACTIONS, d); }
  async updateTransaction(id, d) { return this.updateDoc(COL.TRANSACTIONS, id, d); }
  async deleteTransaction(id) { return this.deleteDoc(COL.TRANSACTIONS, id); }
  
  // 계좌 관련 호환성
  async createAccount(d) { return this.createDoc(COL.ACCOUNTS, d); }
  async updateAccount(id, d) { return this.updateDoc(COL.ACCOUNTS, id, d); }
  async deleteAccount(id) { return this.deleteDoc(COL.ACCOUNTS, id); }
}

export const db = new AppwriteDB();

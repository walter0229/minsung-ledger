import { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, DB_ID, COL } from './config.js';

// =============================================
// 민성이의 가계부 - Appwrite DB 레이어
// =============================================

class AppwriteDB {
  constructor() {
    this.client = new window.Appwrite.Client();
    this.client.setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID);
    this.account = new window.Appwrite.Account(this.client);
    this.databases = new window.Appwrite.Databases(this.client);
    this.online = true;

    // 로컬 스토리지 데이터 초기화 (백업용)
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
        const newList = list.filter(i => i.$id !== id);
        this.local.set(key, newList);
      }
    };
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

  // ── 공통 CRUD ──────────────────────────────
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
      } catch (e) { 
        console.warn('온라인 생성 실패:', e.message);
      }
    }
    return this.local.create(colId, cleanData, docId);
  }

  async updateDoc(colId, docId, data) {
    const { $id, $createdAt, $updatedAt, $permissions, $databaseId, $collectionId, ...cleanData } = data;
    if (this.online) {
      try {
        return await this.databases.updateDocument(DB_ID, colId, docId, cleanData);
      } catch (e) {
        console.warn('온라인 업데이트 실패:', e.message);
      }
    }
    return this.local.update(colId, docId, cleanData);
  }

  async deleteDoc(colId, docId) {
    if (this.online) {
      try {
        await this.databases.deleteDocument(DB_ID, colId, docId);
      } catch (e) {
        console.warn('온라인 삭제 실패:', e.message);
      }
    }
    this.local.delete(colId, docId);
  }

  // ── 도메인 전용 메서드 ────────────────────────
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

  async saveBudget(data) {
    const ym = (data.yearMonth || '').replace(/\./g, '-');
    const cleanData = { ...data, yearMonth: ym };

    if (this.online) {
      try {
        const q = [
          window.Appwrite.Query.equal("yearMonth", ym),
          window.Appwrite.Query.equal("category", data.category)
        ];
        if (data.subCategory) q.push(window.Appwrite.Query.equal("subCategory", data.subCategory));
        else q.push(window.Appwrite.Query.isNull("subCategory"));

        const existing = await this.listDocs(COL.BUDGETS, q);
        if (existing.documents && existing.documents.length > 0) {
          return await this.updateDoc(COL.BUDGETS, existing.documents[0].$id, cleanData);
        } else {
          return await this.createDoc(COL.BUDGETS, cleanData);
        }
      } catch (e) {
        console.warn('예산 온라인 저장 실패:', e.message);
      }
    }

    // 로컬 Upsert
    const list = this.local.get(COL.BUDGETS);
    const idx = list.findIndex(b => 
      (b.yearMonth || '').replace(/\./g, '-') === ym && 
      b.category === data.category && 
      b.subCategory === data.subCategory
    );
    if (idx >= 0) {
      return this.local.update(COL.BUDGETS, list[idx].$id, cleanData);
    } else {
      return this.local.create(COL.BUDGETS, cleanData);
    }
  }

  async saveSettings(data) {
    const existing = await this.getSettings();
    if (existing) return await this.updateDoc(COL.SETTINGS, existing.$id, data);
    return await this.createDoc(COL.SETTINGS, data, 'global-settings');
  }
}

export const db = new AppwriteDB();

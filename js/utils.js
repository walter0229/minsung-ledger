import { CURRENCIES, CATEGORIES, GEMINI_MODEL, ICONS } from './config.js';
import { db } from './db.js';

// =============================================
// 민성이의 가계부 - 상태 관리 & 유틸 (모듈 버전)
// =============================================

// 앱 버전
export const APP_VERSION = '1.048';

export const state = {
  transactions: [],
  accounts: [],
  budgets: [],
  settings: {
    geminiApiKey: '',
    theme: 'dark',
    reminderEnabled: false,
    reminderTime: '09:00',
  },
  currentTab: 'home',
  currentMonth: new Date().toISOString().slice(0, 7),
  calendarDate: new Date(),
};

// ── 날짜 유틸 ──────────────────────────────
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function monthStr(d = new Date()) { return d.toISOString().slice(0, 7); }
export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}
export function fmtMoney(amount, currency = 'VND') {
  const cur = CURRENCIES.find(c => c.code === currency) || CURRENCIES[0];
  const n = Math.round(Number(amount) || 0);
  const isNeg = n < 0;
  const absN = Math.abs(n);
  const symbol = `<span class="money-symbol">${cur.symbol}${isNeg ? '-' : ''}</span>`;
  
  let formatted = '';
  if (currency === 'VND') formatted = absN.toLocaleString('vi-VN');
  else if (currency === 'KRW') formatted = absN.toLocaleString('ko-KR');
  else formatted = absN.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  
  return symbol + formatted;
}
export function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}
export function getWeekNumber(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

// ── 데이터 로딩 ────────────────────────────
export async function loadAll() {
  showLoading(true);
  try {
    await db.ready; // DB 초기화 완료까지 대기
    const [txs, accs, buds] = await Promise.all([
      db.listTransactions(),
      db.listAccounts(),
      db.listBudgets(),
    ]);
    // 데이터 중복 제거 (ID 기준)
    const unique = (arr) => {
      const seen = new Set();
      return arr.filter(item => {
        if (!item.$id) return true; // ID 없는 경우(드문 경우) 유지
        if (seen.has(item.$id)) return false;
        seen.add(item.$id);
        return true;
      });
    };

    state.accounts = unique(accs);
    state.transactions = unique(txs).sort((a,b) => new Date(b.date) - new Date(a.date));
    
    // 예산 데이터 중복 제거 (ID가 다르더라도 내용 - 년월, 대분류, 소분류 - 이 같으면 중복으로 간주)
    const budgetMap = {};
    unique(buds).forEach(b => {
      const ym = (b.yearMonth||'').replace(/\./g,'-');
      const cat = b.category || '기타';
      const sub = b.subCategory || '';
      const key = `${ym}_${cat}_${sub}`;
      // 이미 같은 키의 예산이 있다면, 나중 것(Appwrite 특성상 더 최신일 가능성)으로 덮어씀
      budgetMap[key] = b;
    });
    state.budgets = Object.values(budgetMap);

    
    const s = await db.getSettings();
    if (s) Object.assign(state.settings, s);
    applyTheme(state.settings.theme || 'dark');
  } catch(e) {
    console.error('데이터 로딩 오류:', e);
  }
  showLoading(false);
}

// ── 계좌 잔액 계산 ─────────────────────────
export function calcBalance(accountId) {
  let bal = 0;
  for (const t of state.transactions) {
    if (t.type === 'income' && t.accountId === accountId) bal += Number(t.amount);
    if (t.type === 'expense' && t.accountId === accountId) bal -= Number(t.amount);
    if (t.type === 'transfer') {
      if (t.fromAccountId === accountId) bal -= Number(t.amount);
      if (t.toAccountId === accountId) bal += Number(t.amount);
    }
  }
  return bal;
}

// ── 월별 집계 ──────────────────────────────
export function getMonthSummary(yearMonth) {
  const txs = state.transactions.filter(t => t.date?.startsWith(yearMonth));
  const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  return { income, expense, balance: income - expense, txs };
}

// ── 예산 대비 사용 ─────────────────────────
export function getBudgetStatus(yearMonth) {
  const month = (yearMonth || '').replace(/\./g, '-');
  const budgets = state.budgets.filter(b => (b.yearMonth || '').replace(/\./g, '-') === month);
  const txs = state.transactions.filter(t => t.date?.startsWith(month) && t.type === 'expense');
  
  return budgets.map(b => {
    let usedInVnd = 0;
    const isSub = b.subCategory && b.subCategory !== "";
    
    txs.forEach(t => {
      const matchCat = t.mainCategory === b.category;
      // 소분류가 있는 예산이면 소분류까지 일치해야 하고, 대분류 예산이면 해당 카테고리 전체를 포함
      if (matchCat) {
        if (!isSub || (t.subCategory === b.subCategory)) {
          usedInVnd += (t.vndAmt || Number(t.amount));
        }
      }
    });

    return { 
      ...b, 
      used: usedInVnd, 
      percent: b.amount > 0 ? (usedInVnd / b.amount * 100).toFixed(1) : 0 
    };
  });
}


// ── 카테고리별 지출 통계 ────────────────────
export function getCategoryStats(txs) {
  const map = {};
  for (const t of txs.filter(t => t.type === 'expense')) {
    const k = t.mainCategory || '기타';
    map[k] = (map[k] || 0) + Number(t.amount);
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

// ── 시간 경과율 ────────────────────────────
export function getTimeProgress(period, refDate = new Date()) {
  if (period === 'yearly') {
    const start = new Date(refDate.getFullYear(), 0, 1);
    const end = new Date(refDate.getFullYear(), 11, 31);
    return (refDate - start) / (end - start) * 100;
  }
  if (period === 'monthly') {
    const days = getDaysInMonth(refDate.getFullYear(), refDate.getMonth());
    return (refDate.getDate() - 1) / days * 100;
  }
  // weekly
  const dow = refDate.getDay() || 7;
  return (dow - 1) / 6 * 100;
}

// ── 테마 적용 ──────────────────────────────
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.settings.theme = theme;
}

// ── 로딩 스피너 ────────────────────────────
export function showLoading(show) {
  const el = document.getElementById('loadingOverlay');
  if (el) el.style.display = show ? 'flex' : 'none';
}

// ── Toast 알림 ─────────────────────────────
export function toast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
}

// ── 숫자 포맷 입력 ─────────────────────────
export function formatNumberInput(input) {
  const v = input.value.replace(/[^0-9]/g, '');
  input.value = v ? Number(v).toLocaleString() : '';
  input.dataset.raw = v;
}

// ── Gemini AI 호출 ─────────────────────────
export async function callGemini(prompt, imageBase64 = null) {
  const apiKey = state.settings.geminiApiKey;
  if (!apiKey) throw new Error('Gemini API Key가 설정되지 않았습니다.');
  
  // 사용자 지침에 따라 1.5 / 2 버전은 절대 사용하지 않음
  // 첫 번째 시도: gemini-3.1-pro
  let model = GEMINI_MODEL; 
  let url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const parts = [{ text: prompt }];
  if (imageBase64) {
    parts.unshift({ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } });
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    });
    
    if (!res.ok) {
       // 3.1-pro-preview 실패 시 3-flash-preview로 재시도
       if (model === 'gemini-3.1-pro-preview') {
         console.warn('⚠️ gemini-3.1-pro-preview 호출 실패, gemini-3-flash-preview로 재시도합니다.');
         model = 'gemini-3-flash-preview';
         url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
         const resRetry = await fetch(url, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ contents: [{ parts }] }),
         });
         if (!resRetry.ok) throw new Error(`Gemini API 오류 (${model}): ` + resRetry.statusText);
         const dataRetry = await resRetry.json();
         return dataRetry.candidates?.[0]?.content?.parts?.[0]?.text || '';
       }
       throw new Error(`Gemini API 오류 (${model}): ` + res.statusText);
    }
    
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (e) {
    throw e;
  }
}

// ── 영수증 OCR 파싱 ────────────────────────
export async function parseReceipt(imageBase64) {
  const prompt = `이 영수증 이미지를 분석해서 아래 JSON 형식으로만 응답해줘. 다른 텍스트 없이 JSON만:
{
  "date": "YYYY-MM-DD",
  "amount": 숫자,
  "currency": "VND 또는 KRW 등",
  "merchant": "가게명",
  "category": "식비 또는 쇼핑 등",
  "items": ["항목1", "항목2"]
}`;
  const text = await callGemini(prompt, imageBase64);
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

// ── 아이콘 img 태그 생성 ────────────────────
export function iconImg(key, size = 32, cls = '') {
  const src = ICONS[key] || ICONS.etc;
  return `<img src="${src}" width="${size}" height="${size}" class="icon-img ${cls}" alt="${key}" onerror="this.style.display='none'">`;
}

// ── 계좌 찾기 ──────────────────────────────
export function findAccount(id) { return state.accounts.find(a => a.$id === id); }
export function getCurrencySymbol(code) {
  return CURRENCIES.find(c => c.code === code)?.symbol || code;
}

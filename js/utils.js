import { CURRENCIES, CATEGORIES, GEMINI_MODEL, ICONS } from './config.js';
import { db } from './db.js';

// =============================================
// 민성이의 가계부 - 상태 관리 & 유틸 (모듈 버전)
// =============================================

export const state = {
  transactions: [],
  accounts: [],
  budgets: [],
  settings: {
    geminiApiKey: '',
    appwriteApiKey: '',
    theme: 'dark',
    reminderEnabled: false,
    reminderTime: '09:00',
    pageThemes: {},
  },
  currentTab: 'home',
  currentMonth: new Date().toISOString().slice(0, 7),
  calendarDate: new Date(),
};

// ── 날짜 유틸 ──────────────────────────────
export function todayStr() { return new Date().toISOString().slice(0, 10); }
export function monthStr(d = new Date()) { return d.toISOString().slice(0, 7); }
export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}
export function fmtMoney(amount, currency = 'VND') {
  const cur = CURRENCIES.find(c => c.code === currency) || CURRENCIES[0];
  const n = Math.round(Number(amount) || 0);
  if (currency === 'VND') return cur.symbol + n.toLocaleString('vi-VN');
  if (currency === 'KRW') return cur.symbol + n.toLocaleString('ko-KR');
  return cur.symbol + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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
    state.transactions = txs;
    state.accounts = accs;
    state.budgets = buds;
    
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
  const budgets = state.budgets.filter(b => b.yearMonth === yearMonth);
  const txs = state.transactions.filter(t => t.date?.startsWith(yearMonth) && t.type === 'expense');
  return budgets.map(b => {
    // 소분류 설정 지원에 맞춰, b.subCategory가 있으면 해당 서브카테고리 사용액, 없으면 main카테고리 사용액 산출
    let used = 0;
    if (b.subCategory) {
      used = txs.filter(t => t.mainCategory === b.category && t.subCategory === b.subCategory).reduce((s, t) => s + Number(t.amount), 0);
    } else {
      used = txs.filter(t => t.mainCategory === b.category).reduce((s, t) => s + Number(t.amount), 0);
    }
    return { ...b, used, percent: b.amount > 0 ? (used / b.amount * 100).toFixed(1) : 0 };
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const parts = [{ text: prompt }];
  if (imageBase64) {
    parts.unshift({ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } });
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  if (!res.ok) throw new Error('Gemini API 오류: ' + res.statusText);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
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

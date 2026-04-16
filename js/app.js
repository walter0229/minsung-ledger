


// =============================================
// 민성이의 가계부 - 상태 관리 & 유틸 (모듈 버전)
// =============================================

// 앱 버전 (호환성 유지)
const APP_VERSION = '1.406';

// 앱 상태 관리
const state = {
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
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function monthStr(d = new Date()) { return d.toISOString().slice(0, 7); }
function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}
function fmtMoney(amount, currency = 'VND') {
  const cur = CURRENCIES.find(c => c.code === currency) || CURRENCIES[0];
  const n = Math.round(Number(amount) || 0);
  const isNeg = n < 0;
  const absN = Math.abs(n);
  const symbol = `<span class="money-symbol">${cur.symbol}${isNeg ? '-' : ''}</span>`;
  
  let formatted = '';
  if (currency === 'VND' || currency === 'KRW') formatted = absN.toLocaleString('ko-KR');
  else formatted = absN.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  
  return symbol + formatted;
}
function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}
function getWeekNumber(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

// ── 데이터 로딩 ────────────────────────────
async function loadAll() {
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
function calcBalance(accountId) {
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
function getMonthSummary(yearMonth) {
  const txs = state.transactions.filter(t => t.date?.startsWith(yearMonth));
  const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  return { income, expense, balance: income - expense, txs };
}

// ── 예산 대비 사용 ─────────────────────────
function getBudgetStatus(yearMonth, period = 'monthly') {
  const month = (yearMonth || '').replace(/\./g, '-');
  const [y, m] = month.split('-').map(Number);
  const budgets = state.budgets.filter(b => (b.yearMonth || '').replace(/\./g, '-') === month);
  
  let txs = [];
  let multiplier = 1;
  const now = new Date();

  if (period === 'weekly') {
    multiplier = 0.25;
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - (now.getDay() || 7) + 1);
    startOfWeek.setHours(0,0,0,0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23,59,59,999);
    txs = state.transactions.filter(t => {
      const d = (t.date || '').replace(/\./g, '-');
      const dObj = new Date(d);
      return dObj >= startOfWeek && dObj <= endOfWeek && t.type === 'expense';
    });
  } else if (period === 'yearly') {
    multiplier = 12;
    txs = state.transactions.filter(t => (t.date || '').replace(/\./g, '-').startsWith(String(y)) && t.type === 'expense');
  } else {
    txs = state.transactions.filter(t => (t.date || '').replace(/\./g, '-').startsWith(month) && t.type === 'expense');
  }
  
  return budgets.map(b => {
    let usedInVnd = 0;
    const isSub = b.subCategory && b.subCategory !== "";
    const monthlyBudget = Number(b.amount || 0);
    
    txs.forEach(t => {
      const matchCat = t.mainCategory === b.category;
      if (matchCat && (!isSub || (t.subCategory === b.subCategory))) {
        if (period === 'yearly') {
          const tMonth = Number((t.date || '').replace(/\./g, '-').slice(5, 7));
          if (tMonth > 3) {
            usedInVnd += (t.vndAmt || Number(t.amount));
          }
        } else {
          usedInVnd += (t.vndAmt || Number(t.amount));
        }
      }
    });

    if (period === 'yearly') {
      // 1,2,3월 지출 보정: 원본 월 예산 * 3 합산
      usedInVnd += (monthlyBudget * 3);
    }

    const periodBudget = monthlyBudget * multiplier;

    return { 
      ...b, 
      monthlyAmount: monthlyBudget, // 명시적 보존
      amount: periodBudget,         // 기간별 전체 예산
      used: usedInVnd, 
      percent: periodBudget > 0 ? (usedInVnd / periodBudget * 100).toFixed(1) : 0 
    };
  });
}


// ── 카테고리별 지출 통계 ────────────────────
function getCategoryStats(txs) {
  const map = {};
  for (const t of txs.filter(t => t.type === 'expense')) {
    const k = t.mainCategory || '기타';
    map[k] = (map[k] || 0) + Number(t.amount);
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

// ── 시간 경과율 ────────────────────────────
function getTimeProgress(period, refDate = new Date()) {
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
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.settings.theme = theme;
}

// ── 로딩 스피너 ────────────────────────────
function showLoading(show) {
  const el = document.getElementById('loadingOverlay');
  if (el) el.style.display = show ? 'flex' : 'none';
}

// ── Toast 알림 ─────────────────────────────
function toast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
}

// ── 숫자 포맷 입력 ─────────────────────────
function formatNumberInput(input) {
  const v = input.value.replace(/[^0-9]/g, '');
  input.value = v ? Number(v).toLocaleString() : '';
  input.dataset.raw = v;
}

// ── Gemini AI 호출 ─────────────────────────
async function callGemini(prompt, imageBase64 = null) {
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
async function parseReceipt(imageBase64) {
  const prompt = `이 영수증 이미지를 분석해서 아래 JSON 형식으로만 응답해줘. 다른 텍스트 없이 JSON만:
{
  "date": "YYYY-MM-DD",
  "items": [
    {
      "name": "원래 품목명(영수증에 적힌 베트남어 등)",
      "translatedName": "한국어 번역명(예: Bia -> 맥주)",
      "count": 수량(숫자, 없으면 null),
      "amount": 금액(숫자),
      "mainCategory": "대분류",
      "subCategory": "소분류"
    }
  ]
}

주의사항:
1. "합계", "총액", "TOTAL", "Grand Total", "Total Amount", "Subtotal" 등 결제 총액이나 중간 합계는 **절대 포함하지 마세요**.
2. "세금", "봉사료", "VAT", "Tax", "Service Charge" 등 부가 금액도 **절대 포함하지 마세요**.
3. 오직 영수증에 적힌 **개별 상품(품목)의 이름과 금액**들만 리스트로 만들어주세요.
4. 원래 품목명이 베트남어인 경우, 'translatedName' 필드에 한국어로 번역한 이름을 반드시 넣어주세요.
5. 카테고리는 반드시 아래 목록 중에서 가장 적절한 것을 선택해줘:
- 식비: [식사, 장보기, 음료/카페, 간식, 술]
- 주거/생활: [아파트, 월세, 전기, 수도, 통신, 청소, 구독]
- 사회생활/여가: [여가, 골프, 당구, 여행, 데이트, 선물, 헌금/기부, 팁(베트남), 수수료]
- 자기개발/건강: [건강, 미용, 마사지, 반려동물, 담배, 로또]
- 기타: [교통, 쇼핑, 대출, 신용카드, 임대료(달러), 데이터수정, 기타]
- 한국: [가족용돈, 전화비, 월세, 관리비, 보험료, 경조사비, 기타]`;
  const text = await callGemini(prompt, imageBase64);
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

// ── 아이콘 img 태그 생성 ────────────────────
function iconImg(key, size = 32, cls = '') {
  const src = ICONS[key] || ICONS.etc;
  return `<img src="${src}" width="${size}" height="${size}" class="icon-img ${cls}" alt="${key}" onerror="this.style.display='none'">`;
}

// ── 계좌 찾기 ──────────────────────────────
function findAccount(id) { return state.accounts.find(a => a.$id === id); }
function getCurrencySymbol(code) {
  return CURRENCIES.find(c => c.code === code)?.symbol || code;
}
// =============================================
// 민성이의 가계부 - 설정 파일
// =============================================

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '69ca6dd30013a519ec48';
const DB_ID = 'ledger-db';

// 컬렉션 ID
const COL = {
  ACCOUNTS: 'accounts',
  TRANSACTIONS: 'transactions',
  BUDGETS: 'budgets',
  SETTINGS: 'app-settings',
};

// 아이콘 경로 매핑
const ICONS = {
  // 거래 유형
  expense: 'icons/icon_3d_expense_1768214840824.png',
  income: 'icons/icon_3d_income_1768214857274.png',
  transfer: 'icons/icon_3d_transfer_1768214873345.png',
  transfer_custom: 'icons/icon_3d_transfer_custom.png',

  // 지출 카테고리
  food: 'icons/cat_3d_food_1768215125083.png',
  grocery: 'icons/cat_3d_grocery_1768215140979.png',
  drink: 'icons/cat_3d_drink_1768215155607.png',
  snack: 'icons/cat_3d_snack.png',
  shopping: 'icons/cat_3d_shopping_1768215179751.png',
  leisure: 'icons/cat_3d_leisure_1768215196899.png',
  health: 'icons/cat_3d_health_1768215216535.png',
  etc: 'icons/cat_3d_etc_1768215232314.png',
  transport: 'icons/cat_3d_transport_1768215109851.png',
  housing: 'icons/cat_3d_housing_1768215743905.png',
  electricity: 'icons/cat_3d_electricity_1768215762869.png',
  water: 'icons/cat_3d_water_1768215781180.png',
  phone: 'icons/cat_3d_phone_1768215798305.png',
  cleaning: 'icons/cat_3d_cleaning_1768215860310.png',
  beauty: 'icons/cat_3d_beauty_1768215877460.png',
  massage: 'icons/cat_3d_massage_1768215841276.png',
  hospital: 'icons/cat_3d_hospital.png',
  pharmacy: 'icons/cat_3d_pharmacy.png',
  golf: 'icons/cat_3d_golf_1768215479094.png',
  billiards: 'icons/cat_3d_billiards_1768215493988.png',
  travel: 'icons/cat_3d_travel.png',
  insurance: 'icons/cat_3d_insurance.png',
  loan: 'icons/cat_3d_loan.png',
  subscription: 'icons/cat_3d_subscription_play.png',
  tip_vn: 'icons/cat_3d_tip_vn.png',
  cigarette: 'icons/cat_3d_cigarette.png',
  alcohol: 'icons/cat_3d_alcohol_1768215823076.png',
  lotto: 'icons/cat_3d_lotto.png',
  pet_cat: 'icons/cat_3d_pet_cat.png',
  gift_box: 'icons/cat_3d_gift_box.png',
  donation: 'icons/cat_3d_donation.png',
  commission: 'icons/cat_3d_commission.png',
  family_kr: 'icons/cat_3d_family_kr.png',
  apartment: 'icons/cat_3d_apartment.png',
  apartment_rent: 'icons/cat_3d_apartment_rent.png',
  rent_dollar: 'icons/cat_3d_rent_dollar.png',
  date_rose: 'icons/cat_3d_date_rose.png',
  credit_card: 'icons/cat_3d_credit_card.png',
  data_correction: 'icons/cat_3d_data_correction.png',

  // 통화
  vnd: 'icons/money_vnd.png',
  krw: 'icons/money_krw.png',
  usd: 'icons/money_usd.png',
  cny: 'icons/money_cny.png',
  cad: 'icons/money_cad.png',
  php: 'icons/money_php.png',
  thb: 'icons/money_thb.png',
  mvr: 'icons/money_mvr.png',

  // 은행
  hana: 'icons/hana_logo.png',
  mg: 'icons/mg_logo.png',
  nh: 'icons/nh_logo.png',
  shinhan: 'icons/shinhan_logo.png',
  woori: 'icons/woori_logo.png',
};

// 카테고리 정의
const CATEGORIES = {
  한국: [
    { id: 'family_kr', name: '가족용돈', icon: 'family_kr' },
    { id: 'phone', name: '전화비', icon: 'phone' },
    { id: 'apartment_rent', name: '월세', icon: 'apartment_rent' },
    { id: 'apartment', name: '관리비', icon: 'apartment' },
    { id: 'insurance', name: '보험료', icon: 'insurance' },
    { id: 'gift_box', name: '경조사비', icon: 'gift_box' },
    { id: 'etc', name: '기타', icon: 'etc' },
  ],
  식비: [
    { id: 'food', name: '식사', icon: 'food' },
    { id: 'grocery', name: '장보기', icon: 'grocery' },
    { id: 'drink', name: '음료/카페', icon: 'drink' },
    { id: 'snack', name: '간식', icon: 'snack' },
    { id: 'alcohol', name: '술', icon: 'alcohol' },
  ],
  '주거/생활': [
    { id: 'apartment_rent', name: '월세', icon: 'apartment_rent' },
    { id: 'electricity', name: '전기', icon: 'electricity' },
    { id: 'water', name: '수도', icon: 'water' },
    { id: 'phone', name: '통신', icon: 'phone' },
    { id: 'cleaning', name: '청소', icon: 'cleaning' },
    { id: 'subscription', name: '구독', icon: 'subscription' },
  ],
  '사회생활/여가': [
    { id: 'golf', name: '골프', icon: 'golf' },
    { id: 'billiards', name: '당구', icon: 'billiards' },
    { id: 'travel', name: '여행', icon: 'travel' },
    { id: 'date_rose', name: '데이트', icon: 'date_rose' },
    { id: 'gift_box', name: '선물', icon: 'gift_box' },
    { id: 'donation', name: '헌금/기부', icon: 'donation' },
    { id: 'tip_vn', name: '팁(베트남)', icon: 'tip_vn' },
    { id: 'commission', name: '수수료', icon: 'commission' },
  ],
  '자기개발/건강': [
    { id: 'hospital', name: '병원', icon: 'hospital' },
    { id: 'pharmacy', name: '약', icon: 'pharmacy' },
    { id: 'beauty', name: '미용', icon: 'beauty' },
    { id: 'massage', name: '마사지', icon: 'massage' },
    { id: 'pet_cat', name: '반려동물', icon: 'pet_cat' },
    { id: 'cigarette', name: '담배', icon: 'cigarette' },
  ],
  기타: [
    { id: 'transport', name: '교통', icon: 'transport' },
    { id: 'shopping', name: '쇼핑', icon: 'shopping' },
    { id: 'loan', name: '대출', icon: 'loan' },
    { id: 'credit_card', name: '신용카드', icon: 'credit_card' },
    { id: 'lotto', name: '로또', icon: 'lotto' },
    { id: 'data_correction', name: '데이터수정', icon: 'data_correction' },
    { id: 'etc', name: '기타', icon: 'etc' },
  ],
};

// 대분류별 대표 아이콘 매핑
const MAIN_CAT_ICONS = {
  '한국': 'family_kr',
  '식비': 'food',
  '주거/생활': 'housing',
  '사회생활/여가': 'leisure',
  '자기개발/건강': 'health',
  '기타': 'etc'
};

// 통화 정보
const CURRENCIES = [
  { code: 'VND', symbol: '₫', name: '베트남 동', icon: 'vnd' },
  { code: 'KRW', symbol: '₩', name: '한국 원', icon: 'krw' },
  { code: 'USD', symbol: '$', name: '미국 달러', icon: 'usd' },
  { code: 'CNY', symbol: '¥', name: '중국 위안', icon: 'cny' },
  { code: 'CAD', symbol: 'C$', name: '캐나다 달러', icon: 'cad' },
  { code: 'PHP', symbol: '₱', name: '필리핀 페소', icon: 'php' },
  { code: 'THB', symbol: '฿', name: '태국 바트', icon: 'thb' },
  { code: 'MVR', symbol: 'ރ.', name: '몰디브 루피야', icon: 'mvr' },
];

// 계좌 유형
const ACCOUNT_TYPES = [
  { id: 'bank', name: '은행', emoji: '🏦' },
  { id: 'cash', name: '현금', emoji: '💵' },
  { id: 'loan', name: '대출', emoji: '📋' },
  { id: 'savings', name: '적금', emoji: '🐷' },
];

// Gemini 모델
const GEMINI_MODEL = 'gemini-3.1-pro-preview';

// Duplicate removed: const APP_VERSION = '1.320';


// =============================================
// 민성이의 가계부 - Appwrite DB 레이어 (복구 및 호환성 버전)
// =============================================

class AppwriteDB {
  constructor() {
    this.errorLog = [];
    try {
      if (!window.Appwrite) {
        this.logError('Appwrite SDK 로드 실패: window.Appwrite가 존재하지 않습니다.');
        this.online = false;
        this.ready = Promise.resolve();
        return;
      }
      this.client = new window.Appwrite.Client();
      this.client.setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID);
      this.account = new window.Appwrite.Account(this.client);
      this.databases = new window.Appwrite.Databases(this.client);
      this.online = true;
      this.ready = this.ensureSession();
    } catch (e) {
      this.logError('DB 초기화 에러: ' + e.message);
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

  logError(msg) {
    const time = new Date().toLocaleTimeString();
    console.warn(`[DB-ERROR ${time}] ${msg}`);
    this.errorLog.push(`[${time}] ${msg}`);
    if (this.errorLog.length > 20) this.errorLog.shift();
    if (window.renderDiagnostics) window.renderDiagnostics();
  }

  async ensureSession() {
    if (!this.online) return;
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('세션 확인 타임아웃(10초)')), 10000));
    
    try {
      await Promise.race([this.account.get(), timeout]);
      console.log('✅ 세션 연결 성공');
    } catch (e) {
      this.logError('기존 세션 확인 실패: ' + e.message);
      try {
        await Promise.race([this.account.createAnonymousSession(), timeout]);
        console.log('✅ 익명 세션 생성 성공');
      } catch (err) {
        this.logError('익명 세션 생성 실패: ' + err.message);
        this.online = false;
      }
    }
  }

  async reconnect() {
    this.logError('💡 서버 재연결 시도 중...');
    this.online = true;
    await this.ensureSession();
    if (window.checkDbStatus) window.checkDbStatus();
    if (this.online) {
      if (window.loadAll) await window.loadAll();
      if (window.renderHome) window.renderHome();
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

const db = new AppwriteDB();
// =============================================
// 민성이의 가계부 - 전역 상태 로컬 보관소
// =============================================

const store = {
  currentTxType: 'expense',
  selectedTxAccountId: null,
  selectedTxIcon: null,
  selectedTransferFrom: null,
  selectedTransferTo: null,
  selectedCurrencyIcon: null,
  selectedBankIcon: null,
  editingTxId: null,
  statsPeriod: 'monthly',
  statsType: 'expense',
  reportPeriod: 'monthly',
  donutChart: null,
  usageChart: null,
  progressChart: null,
  assetChart: null,
  balanceTrendChart: null,
};





// =============================================
// 민성이의 가계부 - 공통 UI 제어
// =============================================

// 브릿지 연결
window.__showPage = showPage;
window.__openModal = openModal;
window.__closeModal = closeModal;

function initUI() {
  const elTxDate = document.getElementById('txDate');
  if(elTxDate) elTxDate.value = state.currentMonth + '-01';
  const elBudgetMonth = document.getElementById('budgetMonth');
  if(elBudgetMonth) elBudgetMonth.value = state.currentMonth;

  // 설정 값 불러오기
  const elGemini = document.getElementById('geminiKeyInput');
  if (elGemini && state.settings.geminiApiKey) elGemini.value = state.settings.geminiApiKey;
  
  const elDark = document.getElementById('darkModeToggle');
  if(elDark) elDark.checked = state.settings.theme === 'dark';
  
  const elReminder = document.getElementById('reminderToggle');
  if (elReminder && state.settings.reminderEnabled) elReminder.checked = true;
  
  const elRemTime = document.getElementById('reminderTime');
  if (elRemTime && state.settings.reminderTime) elRemTime.value = state.settings.reminderTime;
  
  const elVer = document.getElementById('appVersionDisplay');
  if (elVer) elVer.textContent = 'v' + APP_VERSION;

  // 카메라 FAB 표시
  const fabCam = document.getElementById('fabCamera');
  if (fabCam) fabCam.classList.add('visible');

  // 입력 FAB 초기화
  initFabDrag();
}

function initFabDrag() {
  const fab = document.getElementById('fabBtn');
  if (!fab) return;
  let isDragging = false, startX, startY, initX, initY;
  window.__fabMoved = false;

  const onStart = (e) => {
    isDragging = true; window.__fabMoved = false;
    const touch = e.touches ? e.touches[0] : e;
    startX = touch.clientX; startY = touch.clientY;
    const rect = fab.getBoundingClientRect();
    initX = rect.left; initY = rect.top;
    fab.style.transition = 'none';
  };
  const onMove = (e) => {
    if (!isDragging) return;
    const touch = e.touches ? e.touches[0] : e;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) window.__fabMoved = true;
    if (window.__fabMoved && e.cancelable) e.preventDefault();
    const newLeft = Math.max(10, Math.min(window.innerWidth - 66, initX + dx));
    const newTop = Math.max(10, Math.min(window.innerHeight - 126, initY + dy));
    fab.style.left = newLeft + 'px';
    fab.style.top = newTop + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
  };
  const onEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    fab.style.transition = 'box-shadow 0.2s, transform 0.2s';
    // 클릭 이벤트에서 처리하도록 위임. 드래그 직후 클릭이 발생하지 않도록 약간 딜레이 후 초기화
    setTimeout(() => { window.__fabMoved = false; }, 100);
  };

  fab.addEventListener('mousedown', onStart);
  fab.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchend', onEnd);
}

function checkDbStatus() {
  const el = document.getElementById('diagnosticBoard');
  if (el) {
    const statusText = db.online ? '✅ 서버 연결됨' : '❌ 오프라인 모드';
    const logText = db.errorLog.length > 0 ? db.errorLog.join('<br>') : '기록된 에러가 없습니다.';
    el.innerHTML = `<div style="color:${db.online ? '#4ade80' : '#f87171'}; font-weight:700; margin-bottom:8px;">상태: ${statusText}</div>${logText}`;
  }
}

function renderDiagnostics() {
  checkDbStatus();
}

// ─────────────────────────────────────────────
// 페이지 네비게이션
// ─────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name)?.classList.add('active');
  document.getElementById('tab-' + name)?.classList.add('active');
  state.currentTab = name;

  if (name === 'home' && window.renderHome) window.renderHome();
  if (name === 'calendar' && window.renderCalendar) window.renderCalendar();
  if (name === 'stats' && window.renderStats) window.renderStats();
  if (name === 'report' && window.renderReport) window.renderReport();
  if (name === 'accounts' && window.renderAccountsList) window.renderAccountsList();
  if (name === 'settings' && window.renderSettings) window.renderSettings();
}

// ─────────────────────────────────────────────
// 카메라 / 영수증 OCR
// ─────────────────────────────────────────────
function openCamera() {
  document.getElementById('cameraInput').click();
}

async function handleCameraInput(input) {
  if (!input.files[0]) return;
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result.split(',')[1];
    toast('🔍 영수증 분석 중...', 'info');
    try {
      const data = await parseReceipt(base64);
      if (data && data.items && data.items.length > 0) {
        showLoading(true);
        // 신한은행 계좌 찾기 (없으면 첫 번째 계좌)
        const targetBank = state.accounts.find(a => a.name.includes('신한')) || state.accounts[0];
        if (!targetBank) throw new Error('등록된 계좌가 없습니다.');

        let totalSum = 0;
        let successCount = 0;

        for (const item of data.items) {
          const mainCat = item.mainCategory || '기타';
          const subCat = item.subCategory || '기타';
          
          // 아이콘 자동 매핑: 대분류 아이콘 우선, 소분류에 따른 아이콘 검색
          let iconKey = MAIN_CAT_ICONS[mainCat] || 'etc';
          if (CATEGORIES[mainCat]) {
             const foundSub = CATEGORIES[mainCat].find(c => c.name === subCat);
             if (foundSub) iconKey = foundSub.icon;
          }

          const itemName = (item.name || '').toLowerCase();
          const skipKeywords = ['total', 'amount', 'tax', 'vat', 'service charge', '합계', '총액', '소계', '수수료', '봉사료'];
          if (skipKeywords.some(k => itemName.includes(k))) continue;

          let memo = item.name || '';
          if (item.translatedName) memo += ` (${item.translatedName})`;
          if (item.count) memo += ` (${item.count}개)`;

          const txData = {
            date: data.date || new Date().toISOString().slice(0, 10),
            type: 'expense',
            accountId: targetBank.$id,
            amount: Math.round(Number(item.amount) || 0),
            memo: memo.trim(),
            mainCategory: mainCat,
            subCategory: subCat,
            iconKey: iconKey
          };

          try {
            const saved = await db.createTransaction(txData);
            state.transactions.unshift(saved);
            totalSum += Number(item.amount);
            successCount++;
          } catch (e) {
            console.error('개별 품목 저장 오류:', e, txData);
          }
        }
        
        showLoading(false);

        if (successCount > 0) {
          const totalAmountStr = Math.round(totalSum).toLocaleString();
          const currencyStr = targetBank.currency || 'VND';
          alert(`✅ ${successCount}개 입력되고, 총합계금액이 ${totalAmountStr} ${currencyStr} 입니다.`);
        } else {
          toast('⚠️ 저장된 항목이 없습니다.', 'error');
        }
        
        if (window.renderHome) window.renderHome();
      } else {
        toast('⚠️ 영수증 인식 실패. 다시 시도해주세요.', 'error');
      }
    } catch(err) {
      showLoading(false);
      toast('❌ ' + err.message, 'error');
    }
  };
  reader.readAsDataURL(file);
  input.value = '';
}

// ─────────────────────────────────────────────
// 테마 고도화
// ─────────────────────────────────────────────
function renderThemeGrid() {
  const themes = [
    { name: 'dark', label: '야간', bg: '#0f0f14', accent: '#7c6af7' },
    { name: 'light', label: '주간', bg: '#f5f5fa', accent: '#7c6af7' },
    { name: 'ocean', label: '오션', bg: '#0a1628', accent: '#38bdf8' },
    { name: 'forest', label: '포레스트', bg: '#0a1a0f', accent: '#34d399' },
    { name: 'sunset', label: '선셋', bg: '#1a0a0a', accent: '#fb923c' },
    { name: 'pink', label: '핑크', bg: '#1a0a14', accent: '#f472b6' },
  ];
  document.getElementById('themeGrid').innerHTML = themes.map(t => `
    <div class="theme-item ${state.settings.theme === t.name ? 'selected' : ''}" onclick="window.applyThemePreset('${t.name}')" style="background:${t.bg};">
      <div style="height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;">
        <div style="width:20px;height:4px;border-radius:2px;background:${t.accent};"></div>
        <div style="font-size:9px;color:${t.accent};font-weight:700;">${t.label}</div>
      </div>
    </div>`).join('');
}

function applyThemePreset(name) {
  const themes = {
    dark: { '--bg': '#0f0f14', '--bg2': '#1a1a24', '--bg3': '#22222f', '--card': 'rgba(30,30,42,0.7)', '--glass': 'rgba(30,30,42,0.45)', '--accent': '#7c6af7', '--accent2': '#a78bfa' },
    light: { '--bg': '#f5f5fa', '--bg2': '#ebebf5', '--bg3': '#e0e0ee', '--card': 'rgba(255,255,255,0.7)', '--glass': 'rgba(255,255,255,0.45)', '--accent': '#7c6af7', '--accent2': '#6366f1' },
    ocean: { '--bg': '#0a1628', '--bg2': '#0f1f3d', '--bg3': '#162647', '--card': 'rgba(17,32,52,0.7)', '--glass': 'rgba(17,32,52,0.45)', '--accent': '#38bdf8', '--accent2': '#7dd3fc' },
    forest: { '--bg': '#0a1a0f', '--bg2': '#0f2517', '--bg3': '#16301e', '--card': 'rgba(17,32,20,0.7)', '--glass': 'rgba(17,32,20,0.45)', '--accent': '#34d399', '--accent2': '#6ee7b7' },
    sunset: { '--bg': '#1a0a0a', '--bg2': '#2a1010', '--bg3': '#361616', '--card': 'rgba(36,16,16,0.7)', '--glass': 'rgba(36,16,16,0.45)', '--accent': '#fb923c', '--accent2': '#fdba74' },
    pink: { '--bg': '#1a0a14', '--bg2': '#2a1020', '--bg3': '#361628', '--card': 'rgba(36,16,24,0.7)', '--glass': 'rgba(36,16,24,0.45)', '--accent': '#f472b6', '--accent2': '#f9a8d4' },
  };
  const vars = themes[name] || themes.dark;
  Object.entries(vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
  state.settings.theme = name;
  window.saveApiSettings();
  renderThemeGrid();
}

// ─────────────────────────────────────────────
// 공통 모달
// ─────────────────────────────────────────────
function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
function closeModalOnBg(e, id) { if (e.target === e.currentTarget) closeModal(id); }

function toggleDarkMode() {
  const dark = document.getElementById('darkModeToggle').checked;
  window.applyThemePreset(dark ? 'dark' : 'light');
}

function toggleReminder() {
  const enabled = document.getElementById('reminderToggle').checked;
  state.settings.reminderEnabled = enabled;
  window.saveApiSettings();
}

function saveReminderTime() {
  const t = document.getElementById('reminderTime').value;
  state.settings.reminderTime = t;
  window.saveApiSettings();
}

// 전역 함수 자가 등록
window.initUI = initUI;
window.showPage = showPage;
window.checkDbStatus = checkDbStatus;
window.renderDiagnostics = renderDiagnostics;
window.openCamera = openCamera;
window.handleCameraInput = handleCameraInput;
window.applyThemePreset = applyThemePreset;
window.toggleDarkMode = toggleDarkMode;
window.toggleReminder = toggleReminder;
window.saveReminderTime = saveReminderTime;
window.renderThemeGrid = renderThemeGrid;
window.openModal = openModal;
window.closeModal = closeModal;
window.closeModalOnBg = closeModalOnBg;






// renderHome은 main.js에서 순환 참조를 피하기 위해 window.renderHome을 사용합니다.

// 브릿지 연결
window.__openAddModal = openAddModal;

// =============================================
// 민성이의 가계부 - 거래 및 모달 관리
// =============================================

function renderTxItem(t) {
  let defaultIcon = 'etc';
  if (t.type === 'income') defaultIcon = 'income';
  else if (t.type === 'transfer') defaultIcon = 'transfer';
  else if (t.mainCategory && MAIN_CAT_ICONS[t.mainCategory]) defaultIcon = MAIN_CAT_ICONS[t.mainCategory];

  const iconKey = t.iconKey && t.iconKey !== 'etc' ? t.iconKey : defaultIcon;
  const acc = findAccount(t.accountId || t.fromAccountId);
  const cur = acc?.currency || 'VND';
  const sign = t.type === 'income' ? '<span class="money-symbol">+</span>' : t.type === 'transfer' ? '<span class="money-symbol">↔</span>' : '';
  const cls = t.type;
  let txDisplayName = t.memo || t.subCategory || t.mainCategory;
  if (!txDisplayName) {
    if (t.type === 'transfer') {
      const fromAcc = findAccount(t.fromAccountId);
      const toAcc = findAccount(t.toAccountId);
      txDisplayName = `${fromAcc?.name || '?'} → ${toAcc?.name || '?'}`;
    } else {
      txDisplayName = '내역 없음';
    }
  }

  return `<div class="tx-item" onclick="window.showTxDetail('${t.$id}')">
    <div class="tx-icon">${iconImg(iconKey, 28)}</div>
    <div class="tx-info">
      <div class="tx-name">${txDisplayName}</div>
      <div class="tx-cat">${t.mainCategory || ''} ${t.subCategory ? '> ' + t.subCategory : ''}</div>
    </div>
    <div class="tx-amount ${cls}">${sign}${fmtMoney(t.type === 'expense' ? -Math.abs(t.amount) : t.amount, cur)}</div>
  </div>`;
}

// ─────────────────────────────────────────────
// 거래 입력 모달
// ─────────────────────────────────────────────
function openAddModal(txId = null) {
  store.editingTxId = txId;
  store.selectedTxAccountId = null;
  store.selectedTxIcon = null;
  store.selectedTransferFrom = null;
  store.selectedTransferTo = null;

  document.getElementById('addModalTitle').textContent = txId ? '거래 수정' : '거래 입력';
  document.getElementById('txDate').value = state.currentMonth ? (state.currentMonth + '-01') : ''; // fallback
  document.getElementById('txAmount').value = '';
  document.getElementById('txMemo').value = '';
  
  renderMainCategories(); // 대분류 목록 채우기
  document.getElementById('mainCatSelect').value = '';
  document.getElementById('subCatSelect').innerHTML = '<option value="">소분류 선택</option>';

  if (txId) {
    const t = state.transactions.find(tx => tx.$id === txId);
    if (t) {
      window.setTxType(t.type, document.querySelector(`.type-tab[data-type="${t.type}"]`));
      document.getElementById('txDate').value = t.date?.slice(0, 10) || '';
      document.getElementById('txAmount').value = Number(t.amount).toLocaleString();
      document.getElementById('txAmount').dataset.raw = String(t.amount);
      document.getElementById('txMemo').value = t.memo || '';
      if (t.mainCategory) {
        document.getElementById('mainCatSelect').value = t.mainCategory;
        window.onMainCatChange();
        setTimeout(() => { document.getElementById('subCatSelect').value = t.subCategory || ''; }, 50);
      }
      store.selectedTxAccountId = t.accountId || t.fromAccountId;
      store.selectedTxIcon = t.iconKey;
      store.selectedTransferFrom = t.fromAccountId;
      store.selectedTransferTo = t.toAccountId;
    }
  } else {
    document.getElementById('txDate').value = new Date().toISOString().slice(0, 10);
  }

  renderTxAccountChips();
  renderTransferChips();
  highlightSelectedIcon();
  openModal('addModal');
}

function setTxType(type, btn) {
  store.currentTxType = type;
  document.querySelectorAll('.type-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else document.querySelector(`.type-tab[data-type="${type}"]`)?.classList.add('active');

  const isTransfer = type === 'transfer';
  document.getElementById('expenseIncomeForm').style.display = isTransfer ? 'none' : 'block';
  document.getElementById('transferForm').style.display = isTransfer ? 'block' : 'none';
  document.getElementById('categorySection').style.display = type === 'expense' ? 'block' : 'none';

  updateAmountSymbol();
}

function updateAmountSymbol() {
  const acc = findAccount(store.selectedTxAccountId);
  const sym = getCurrencySymbol(acc?.currency || 'VND');
  document.getElementById('amountSymbol').textContent = sym;
  document.getElementById('transferSymbol').textContent = sym;
}

function onMainCatChange() {
  const main = document.getElementById('mainCatSelect').value;
  const sub = document.getElementById('subCatSelect');
  sub.innerHTML = '<option value="">소분류 선택</option>';
  if (main && CATEGORIES[main]) {
    CATEGORIES[main].forEach(c => {
      const o = document.createElement('option');
      o.value = c.name; o.textContent = c.name;
      sub.appendChild(o);
    });
  }
}

function renderMainCategories() {
  const el = document.getElementById('mainCatSelect');
  if(!el) return;
  const cats = Object.keys(CATEGORIES);
  el.innerHTML = '<option value="">대분류 선택</option>' + 
    cats.map(c => `<option value="${c}">${c}</option>`).join('');
}

function renderTxAccountChips() {
  const el = document.getElementById('txAccountChips');
  if (!state.accounts.length) {
    el.innerHTML = '<span style="color:var(--text3);font-size:13px;">계좌를 먼저 추가해주세요</span>';
    return;
  }
  el.innerHTML = state.accounts.map(a => {
    const bankIcon = a.bankIcon ? `<img src="${ICONS[a.bankIcon]||''}" width="18" height="18" style="object-fit:contain;border-radius:3px;">` : '';
    const sel = store.selectedTxAccountId === a.$id ? 'selected' : '';
    return `<div class="account-chip ${sel}" onclick="window.selectTxAccount('${a.$id}')">
      ${bankIcon}<span>${a.name}</span>
    </div>`;
  }).join('');
}

function selectTxAccount(id) {
  store.selectedTxAccountId = id;
  renderTxAccountChips();
  updateAmountSymbol();
}

function renderTransferChips() {
  const makeChips = (elId, selectedId, clickFn) => {
    const el = document.getElementById(elId);
    if (!state.accounts.length) { el.innerHTML = '<span style="color:var(--text3);font-size:13px;">계좌를 추가하세요</span>'; return; }
    el.innerHTML = state.accounts.map(a => {
      const bankIcon = a.bankIcon ? `<img src="${ICONS[a.bankIcon]||''}" width="18" height="18" style="object-fit:contain;">` : '';
      const sel = selectedId === a.$id ? 'selected' : '';
      return `<div class="account-chip ${sel}" onclick="window.${clickFn}('${a.$id}')">${bankIcon}<span>${a.name}</span></div>`;
    }).join('');
  };
  makeChips('transferFromChips', store.selectedTransferFrom, 'selectTransferFrom');
  makeChips('transferToChips', store.selectedTransferTo, 'selectTransferTo');
}

function selectTransferFrom(id) { store.selectedTransferFrom = id; renderTransferChips(); }
function selectTransferTo(id) { store.selectedTransferTo = id; renderTransferChips(); }

function selectTxIcon(key) {
  store.selectedTxIcon = key;
  document.querySelectorAll('#txIconGrid .icon-item').forEach(el => el.classList.remove('selected'));
  document.getElementById('icon-item-' + key)?.classList.add('selected');
}

function highlightSelectedIcon() {
  if (!store.selectedTxIcon) return;
  setTimeout(() => {
    document.querySelectorAll('#txIconGrid .icon-item').forEach(el => el.classList.remove('selected'));
    document.getElementById('icon-item-' + store.selectedTxIcon)?.classList.add('selected');
  }, 50);
}

async function saveTx() {
  const date = document.getElementById('txDate').value;
  if (!date) { toast('날짜를 선택해주세요', 'error'); return; }

  let data = { date, type: store.currentTxType };

  if (store.currentTxType === 'transfer') {
    if (!store.selectedTransferFrom || !store.selectedTransferTo) { toast('출/입금 계좌 선택요망', 'error'); return; }
    const rawAmt = document.getElementById('transferAmount').dataset.raw || document.getElementById('transferAmount').value.replace(/,/g, '');
    if (!rawAmt) { toast('금액을 입력해주세요', 'error'); return; }
    data = { ...data, fromAccountId: store.selectedTransferFrom, toAccountId: store.selectedTransferTo, amount: Number(rawAmt), memo: document.getElementById('transferMemo').value, iconKey: 'transfer' };
  } else {
    if (!store.selectedTxAccountId) { toast('계좌를 선택해주세요', 'error'); return; }
    const rawAmt = document.getElementById('txAmount').dataset.raw || document.getElementById('txAmount').value.replace(/,/g, '');
    if (!rawAmt) { toast('금액을 입력해주세요', 'error'); return; }
    data = {
      ...data,
      accountId: store.selectedTxAccountId,
      amount: Number(rawAmt),
      memo: document.getElementById('txMemo').value,
      mainCategory: document.getElementById('mainCatSelect').value,
      subCategory: document.getElementById('subCatSelect').value,
      iconKey: store.selectedTxIcon || MAIN_CAT_ICONS[document.getElementById('mainCatSelect').value] || (store.currentTxType === 'income' ? 'income' : 'etc'),
    };
  }

  showLoading(true);
  try {
    if (store.editingTxId) {
      await db.updateTransaction(store.editingTxId, data);
      const idx = state.transactions.findIndex(t => t.$id === store.editingTxId);
      if (idx >= 0) state.transactions[idx] = { ...state.transactions[idx], ...data };
      toast('✅ 수정됐어요!');
    } else {
      const saved = await db.createTransaction(data);
      state.transactions.unshift(saved);
      toast('✅ 저장됐어요!');
    }
    closeModal('addModal');
    if (window.renderHome) window.renderHome();
  } catch(e) {
    toast('❌ ' + e.message, 'error');
  }
  showLoading(false);
}

// ─────────────────────────────────────────────
// 거래 상세 모달
// ─────────────────────────────────────────────
function showTxDetail(txId) {
  const t = state.transactions.find(tx => tx.$id === txId);
  if (!t) return;
  const acc = findAccount(t.accountId || t.fromAccountId);
  const cur = acc?.currency || 'VND';
  const toAcc = t.toAccountId ? findAccount(t.toAccountId) : null;

  const body = document.getElementById('txDetailBody');
  body.innerHTML = `
    <div style="text-align:center;padding:16px 0;">
      <div style="width:64px;height:64px;margin:0 auto 12px;background:var(--bg3);border-radius:50%;display:flex;align-items:center;justify-content:center;">
        ${iconImg(t.iconKey || 'etc', 36)}
      </div>
      <div style="font-size:24px;font-weight:900;color:${t.type==='income'?'var(--income)':t.type==='transfer'?'var(--transfer)':'var(--expense)'}">
        ${t.type==='income'?'<span class="money-symbol">+</span>':t.type==='transfer'?'<span class="money-symbol">↔</span>':''}${fmtMoney(t.type === 'expense' ? -Math.abs(t.amount) : t.amount, cur)}
      </div>
      <div style="font-size:14px;color:var(--text2);margin-top:4px;">${t.memo || '-'}</div>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text2)">날짜</span><span>${fmtDate(t.date?.slice(0,10))}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text2)">유형</span><span>${t.type==='expense'?'지출':t.type==='income'?'수입':'이체'}</span></div>
      ${t.mainCategory?`<div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text2)">분류</span><span>${t.mainCategory}${t.subCategory?' > '+t.subCategory:''}</span></div>`:''}
      ${acc?`<div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text2)">계좌</span><span>${acc.name}</span></div>`:''}
      ${toAcc?`<div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text2)">입금계좌</span><span>${toAcc.name}</span></div>`:''}
    </div>
    <div style="display:flex;gap:8px;margin-top:14px;">
      <button class="btn-secondary btn-sm" style="flex:1;" onclick="window.closeModal('txDetailModal');window.openAddModal('${txId}')">✏️ 수정</button>
      <button class="btn-secondary btn-sm btn-danger" style="flex:1;" onclick="window.deleteTx('${txId}')">🗑️ 삭제</button>
    </div>`;
  openModal('txDetailModal');
}

async function deleteTx(txId) {
  if (!confirm('삭제할까요?')) return;
  showLoading(true);
  try {
    await db.deleteTransaction(txId);
    state.transactions = state.transactions.filter(t => t.$id !== txId);
    closeModal('txDetailModal');
    toast('🗑️ 삭제됐어요');
    if (window.renderHome) window.renderHome();
  } catch(e) { toast('❌ ' + e.message, 'error'); }
  showLoading(false);
}

// ─────────────────────────────────────────────
// 검색 처리
// ─────────────────────────────────────────────
function doSearch() {
  const from = document.getElementById('searchFrom').value;
  const to = document.getElementById('searchTo').value;
  const keyword = document.getElementById('searchKeyword').value.trim().toLowerCase();
  const el = document.getElementById('searchResults');

  let results = state.transactions.filter(t => {
    const d = t.date?.slice(0, 10) || '';
    return d >= from && d <= to;
  });

  if (keyword) {
    results = results.filter(t =>
      (t.memo || '').toLowerCase().includes(keyword) ||
      (t.mainCategory || '').toLowerCase().includes(keyword) ||
      (t.subCategory || '').toLowerCase().includes(keyword)
    );
  }

  results.sort((a, b) => b.date.localeCompare(a.date));

  if (!results.length) {
    el.innerHTML = '<div class="empty-state" style="padding:24px;"><p>검색 결과가 없습니다</p></div>';
    return;
  }

  const defaultCur = state.accounts[0]?.currency || 'VND';
  const total = results.reduce((s, t) => s + (t.type === 'expense' ? -Number(t.amount) : Number(t.amount)), 0);

  el.innerHTML = `<div style="font-size:12px;color:var(--text2);margin:8px 0;padding:8px 0;border-bottom:1px solid var(--border);">
    검색 결과: ${results.length}건 / 합계: <span style="font-weight:700;color:${total>=0?'var(--income)':'var(--expense)'}">${fmtMoney(total, defaultCur)}</span>
  </div>` + results.map(t => {
    const sign = t.type === 'income' ? '<span class="money-symbol">+</span>' : t.type === 'transfer' ? '<span class="money-symbol">↔</span>' : '';
    const acc = findAccount(t.accountId || t.fromAccountId);
    const cur = acc?.currency || defaultCur;
    
    let defaultIcon = 'etc';
    if (t.type === 'income') defaultIcon = 'income';
    else if (t.type === 'transfer') defaultIcon = 'transfer';
    else if (t.mainCategory && MAIN_CAT_ICONS[t.mainCategory]) defaultIcon = MAIN_CAT_ICONS[t.mainCategory];
    const iconKey = t.iconKey && t.iconKey !== 'etc' ? t.iconKey : defaultIcon;

    let txDisplayName = t.memo || t.subCategory || t.mainCategory;
    if (!txDisplayName) {
      if (t.type === 'transfer') {
        const fromAcc = findAccount(t.fromAccountId);
        const toAcc = findAccount(t.toAccountId);
        txDisplayName = `${fromAcc?.name || '?'} → ${toAcc?.name || '?'}`;
      } else {
        txDisplayName = '-';
      }
    }

    return `<div class="report-tx-item" onclick="window.showTxDetail('${t.$id}')">
      <div class="report-tx-date">${fmtDate(t.date?.slice(0,10))}</div>
      <div style="display:flex;align-items:center;gap:8px;flex:1;">
        <div class="report-tx-icon" style="width:24px;height:24px;flex-shrink:0;">${iconImg(iconKey, 24)}</div>
        <div class="report-tx-name">${txDisplayName}</div>
      </div>
      <div class="report-tx-amount" style="color:${t.type==='income'?'var(--income)':t.type==='transfer'?'var(--transfer)':'var(--expense)'}">${sign}${fmtMoney(t.type === 'expense' ? -Math.abs(t.amount) : t.amount, cur)}</div>
    </div>`;
  }).join('');
}

// 전역 함수 자가 등록
window.openAddModal = openAddModal;
window.setTxType = setTxType;
window.onMainCatChange = onMainCatChange;
window.selectTxAccount = selectTxAccount;
window.selectTransferFrom = selectTransferFrom;
window.selectTransferTo = selectTransferTo;
window.selectTxIcon = selectTxIcon;
window.saveTx = saveTx;
window.showTxDetail = showTxDetail;
window.deleteTx = deleteTx;
window.doSearch = doSearch;
window.renderTxItem = renderTxItem;






// =============================================
// 민성이의 가계부 - 통계 및 차트 전담
// =============================================

function setStatsPeriod(p, btn) {
  store.statsPeriod = p;
  btn.closest('.period-tabs').querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  window.renderStats();
}

function setStatsType(t, btn) {
  store.statsType = t;
  document.getElementById('statsExpenseTab').classList.toggle('active', t === 'expense');
  document.getElementById('statsIncomeTab').classList.toggle('active', t === 'income');
  window.renderStats();
}

function getStatsTxs() {
  const now = new Date();
  if (store.statsPeriod === 'monthly') {
    const month = state.currentMonth; // YYYY-MM
    return state.transactions.filter(t => (t.date || '').replace(/\./g, '-').startsWith(month.replace(/\./g, '-')) && t.type === store.statsType);
  }
  // 주간 (현재 주)
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - (now.getDay() || 7) + 1);
  const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 6);
  return state.transactions.filter(t => {
    const d = new Date(t.date);
    return d >= startOfWeek && d <= endOfWeek && t.type === store.statsType;
  });
}

async function renderStatsScreen() {
  const txs = getStatsTxs();
  const baseCur = 'VND';
  
  // 모든 거래 내역에 대해 환율을 적용하여 VND 금액(vndAmt) 산출
  for (const t of txs) {
    const acc = state.accounts.find(a => a.$id === (t.accountId || t.fromAccountId));
    const cur = acc?.currency || 'VND';
    t.vndAmt = await convertCurrency(Number(t.amount), cur, baseCur);
  }

  // 지출 통계 그룹화 로직 (환산된 금액 기준)
  const statsMap = {};
  txs.filter(t => t.type === 'expense').forEach(t => {
    const k = t.mainCategory || '기타';
    statsMap[k] = (statsMap[k] || 0) + t.vndAmt;
  });
  const expenseStats = Object.entries(statsMap).sort((a,b) => b[1]-a[1]);

  // 수입 통계 그룹화 로직 (환산된 금액 기준)
  const incomeMap = {};
  txs.filter(t => t.type === 'income').forEach(t => {
    const k = t.mainCategory || '수입';
    incomeMap[k] = (incomeMap[k] || 0) + t.vndAmt;
  });
  const incomeStats = Object.entries(incomeMap).sort((a,b) => b[1]-a[1]);

  const total = txs.reduce((s, t) => s + (t.vndAmt || 0), 0);
  const displayCur = 'VND';

  document.getElementById('donutTotal').innerHTML = fmtMoney(total, displayCur);
  document.getElementById('donutLabel').textContent = store.statsType === 'expense' ? '지출 합계' : '수입 합계';

  const statData = store.statsType === 'expense' ? expenseStats : incomeStats;

  const colors = ['#7c6af7','#f87171','#34d399','#fbbf24','#60a5fa','#a78bfa','#fb923c','#4ade80','#f472b6','#38bdf8','#facc15','#818cf8'];
  const labels = statData.map(([k]) => k);
  const values = statData.map(([, v]) => v);

  if (store.donutChart) store.donutChart.destroy();
  const ctx = document.getElementById('donutChart').getContext('2d');
  
  // Chart.js가 글로벌로 있다고 가정(index.html 안에 cdn)
  if(window.Chart) {
    store.donutChart = new window.Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: colors.slice(0, values.length), borderWidth: 0, hoverOffset: 8 }]
      },
      options: {
        cutout: '70%', plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: ctx => ` ${ctx.label}: ${fmtMoney(ctx.raw, displayCur)}` }
        }},
        animation: { animateScale: true }
      }
    });
  }

  // 범례
  document.getElementById('statsLegend').innerHTML = statData.map(([cat, amt], i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${colors[i % colors.length]}"></div>
      <div class="legend-name">${cat}</div>
      <div class="legend-pct">${total > 0 ? (amt/total*100).toFixed(1) : 0}%</div>
      <div class="legend-amount">${fmtMoney(amt, displayCur)}</div>
    </div>`).join('');

  // 예산 바
  await renderBudgetBars();
}

async function renderBudgetBars() {
  const el = document.getElementById('budgetBars');
  if(!el) return;
  
  const status = getBudgetStatus(state.currentMonth, store.statsPeriod);
  
  if (!status.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:13px;text-align:center;padding:16px;">예산을 설정해주세요</div>';
    return;
  }
  
  // 🚀 전체 합계 계산 (대분류항목만 필터링하여 정확한 1배수 합계 산출)
  const topLevel = status.filter(b => !b.subCategory || b.subCategory === "");
  const totalBudgetSum = topLevel.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const totalUsedSum = topLevel.reduce((s, b) => s + (Number(b.used) || 0), 0);
  const totalPct = totalBudgetSum > 0 ? (totalUsedSum / totalBudgetSum * 100).toFixed(1) : 0;

  let summaryHtml = `
  <div class="budget-item total-summary" style="display:flex; align-items:center; gap:8px; margin-bottom:20px; padding:12px; background:rgba(124,106,247,0.1); border-radius:12px; border:1px solid rgba(124,106,247,0.3);">
    <span style="flex:0 0 130px; font-size:13px; font-weight:800; color:var(--accent2);">전체 합계</span>
    <div class="progress-bg" style="flex:1; height:12px; margin-bottom:0; background:var(--bg3); border-radius:6px; overflow:hidden; position:relative;">
      <div class="progress-bar" style="width:${Math.min(totalPct, 100)}%; height:100%; border-radius:6px; background:linear-gradient(90deg, var(--accent), var(--accent2)); transition: width 0.5s;"></div>
      <span style="position:absolute; right:6px; top:50%; transform:translateY(-50%); font-size:9px; font-weight:900; color:white; text-shadow:0 1px 2px rgba(0,0,0,0.5);">${totalPct}%</span>
    </div>
    <span style="flex:1.2; text-align:right; font-size:12px; color:var(--text); font-weight:700;">
      ${Math.round(totalUsedSum).toLocaleString()} / ${Math.round(totalBudgetSum).toLocaleString()}
    </span>
  </div>`;

  el.innerHTML = summaryHtml + status.map(b => {
    const pct = Number(b.percent);
    const title = (b.subCategory && b.subCategory !== "") ? `${b.category}(${b.subCategory})` : b.category;
    // 시각적 구분을 위해 소분류는 살짝 들여쓰기
    const paddingLeft = (b.subCategory && b.subCategory !== "") ? '16px' : '4px';
    const fontSize = (b.subCategory && b.subCategory !== "") ? '10px' : '11px';
    const color = (b.subCategory && b.subCategory !== "") ? 'var(--text3)' : 'var(--text)';

    return `
    <div class="budget-item" style="display:flex; align-items:center; gap:8px; margin-bottom:10px; padding-left:${paddingLeft};">
      <span style="flex:0 0 130px; font-size:${fontSize}; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:${color};">${title}</span>
      <div class="progress-bg" style="flex:1; height:8px; margin-bottom:0; background:var(--bg3); border-radius:4px; overflow:hidden; position:relative; margin-left:4px;">
        <div class="progress-bar" style="width:${Math.min(pct, 100)}%; height:100%; border-radius:4px; background:${pct > 90 ? 'var(--expense)' : 'var(--income)'}; transition: width 0.3s;"></div>
      </div>
      <span style="flex:0 0 35px; font-size:10px; font-weight:700; color:${pct>90?'var(--expense)':'var(--text2)'}; text-align:center; margin-left:2px;">${pct.toFixed(0)}%</span>
      <span style="flex:1.2; text-align:right; font-size:10.5px; color:var(--text2); font-family:var(--font); font-weight:500;">
        ${Math.round(b.used).toLocaleString()} / ${Math.round(Number(b.amount) || 0).toLocaleString()}
      </span>
    </div>`;
  }).join('');
}


// ─────────────────────────────────────────────
// 보고서
// ─────────────────────────────────────────────
function setReportPeriod(p, btn) {
  store.reportPeriod = p;
  btn.closest('.period-tabs').querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  window.renderReport();
}

// ─────────────────────────────────────────────
// AI 금융 비서 구현
// ─────────────────────────────────────────────
async function sendAiMsg() {
  const inputEl = document.getElementById('aiInput');
  const msgEl = document.getElementById('aiMsg');
  if (!inputEl || !msgEl) return;

  const userQuery = inputEl.value.trim();
  if (!userQuery) return;

  const apiKey = state.settings.geminiApiKey;
  if (!apiKey) {
    msgEl.innerHTML = '⚠️ 설정에서 <b>Gemini API Key</b>를 먼저 입력해주세요.<br><br><small>설정 탭 하단에서 API 키를 저장할 수 있습니다.</small>';
    return;
  }

  const accountCtx = state.accounts.map(a => `${a.name}: ${Math.round(a.initialBalance).toLocaleString()} ${a.currency || 'VND'}`).join(', ');
  const budgetStatus = getBudgetStatus(state.currentMonth);
  const budgetCtx = budgetStatus.map(b => `${b.category}: ${Math.round(b.used).toLocaleString()} / ${Math.round(b.amount).toLocaleString()}`).join(', ');
  const recentTxs = state.transactions.slice(0, 10).map(t => `${t.date} ${t.type === 'income' ? '수입' : '지출'} ${t.merchant || ''} ${Math.round(t.amount).toLocaleString()}`).join(', ');

  const prompt = `사용자의 금융 가계부 데이터를 바탕으로 질문에 친절하고 전문적으로 답변해줘.

현재 계좌 상황: ${accountCtx}
이번 달 예산 현황: ${budgetCtx}
최근 거래(10건): ${recentTxs}

사용자 질문: ${userQuery}

한국어로 답변해주고, 가능한 구체적인 수치나 분석을 포함해줘.`;

  try {
    msgEl.innerHTML = '🤖 <b>AI 비서가 데이터를 분석 중입니다...</b><br><small>잠시만 기다려주세요.</small>';
    inputEl.value = '';
    const response = await callGemini(prompt);
    const formatted = response.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    msgEl.innerHTML = formatted;
  } catch (e) {
    console.error('AI 비서 오류:', e);
    msgEl.innerHTML = `⚠️ <b>AI 분석 중 오류가 발생했습니다.</b><br><small>${e.message}</small>`;
  }
}

async function renderReportScreen() {
  await renderAnalysisCharts();
  await renderAssetChart();
  await renderBalanceTrendChart();
}

async function renderAnalysisCharts() {
  const baseCur = 'VND';
  let txs = [];
  const now = new Date();
  if (store.reportPeriod === 'yearly') {
    const year = state.currentMonth.split('-')[0];
    txs = state.transactions.filter(t => t.date?.startsWith(year));
  } else if (store.reportPeriod === 'weekly') {
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - (now.getDay() || 7) + 1);
    startOfWeek.setHours(0,0,0,0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23,59,59,999);
    txs = state.transactions.filter(t => {
      const d = new Date(t.date);
      return d >= startOfWeek && d <= endOfWeek;
    });
  } else {
    txs = state.transactions.filter(t => t.date?.startsWith(state.currentMonth));
  }

  // 환율 변환 먼저 완료 (KRW 등 타 통화 정확히 처리)
  for (const t of txs) {
    const acc = findAccount(t.accountId || t.fromAccountId);
    const cur = acc?.currency || 'VND';
    t.vndAmt = await convertCurrency(Number(t.amount), cur, baseCur);
  }

  const status = getBudgetStatus(state.currentMonth, store.reportPeriod);
  // 대분류별로 그룹화 (여러 개의 소분류 예산이 있을 경우 합산)
  const catMap = {};
  // 1단계: 대분류 예산이 있는 항목들 먼저 등록
  status.forEach(b => {
    if (!b.subCategory || b.subCategory === "") {
      catMap[b.category] = { budget: Number(b.amount || 0), used: Number(b.used || 0), mainFound: true };
    }
  });
  // 2단계: 대분류 예산이 없는 경우, 해당 카테고리에 속한 소분류 항목들을 합산
  status.forEach(b => {
    if (b.subCategory && b.subCategory !== "") {
      if (!catMap[b.category]) {
        catMap[b.category] = { budget: 0, used: 0, mainFound: false };
      }
      if (!catMap[b.category].mainFound) {
        catMap[b.category].budget += Number(b.amount || 0);
        catMap[b.category].used += Number(b.used || 0);
      }
    }
  });

  const labels = Object.keys(catMap);
  const used = labels.map(k => catMap[k].used);
  const budget = labels.map(k => catMap[k].budget);
  const timeProgress = getTimeProgress(store.reportPeriod === 'monthly' ? 'monthly' : store.reportPeriod === 'weekly' ? 'weekly' : 'yearly');
  
  // 🚀 예산 사용률 집계 강화 (대분류만 추출하여 합산)
  const topLevelStatus = status.filter(b => !b.subCategory || b.subCategory === "");
  const totalBudget = topLevelStatus.reduce((s, b) => s + Number(b.amount || 0), 0);
  const totalUsed = topLevelStatus.reduce((s, b) => s + Number(b.used || 0), 0);
  const usagePct = totalBudget > 0 ? (totalUsed / totalBudget * 100) : 0;

  console.log(`📊 [Monolith-Report:${store.reportPeriod}] Budget:${totalBudget}, Used:${totalUsed}, UsageRate:${usagePct.toFixed(1)}%, TimeProgress:${timeProgress.toFixed(1)}%`);

  if (store.usageChart) store.usageChart.destroy();
  const ctx1 = document.getElementById('usageChart').getContext('2d');
  if(window.Chart) {
    store.usageChart = new window.Chart(ctx1, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '예산', data: budget, backgroundColor: 'rgba(124,106,247,0.2)', borderColor: 'rgba(124,106,247,0.6)', borderWidth: 1 },
          { label: '지출', data: used, backgroundColor: used.map((u, i) => u > budget[i] ? 'rgba(248,113,113,0.7)' : 'rgba(52,211,153,0.7)'), borderWidth: 0 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#9090b0', font: { size: 11 } } } }, scales: { x: { ticks: { color: '#9090b0', font: { size: 10 } }, grid: { color: '#2e2e3e' } }, y: { ticks: { color: '#9090b0', font: { size: 10 } }, grid: { color: '#2e2e3e' } } } }
    });
  }

  if (store.progressChart) store.progressChart.destroy();
  const ctx2 = document.getElementById('progressChart').getContext('2d');
  if(window.Chart) {
    store.progressChart = new window.Chart(ctx2, {
      type: 'bar',
      data: {
        labels: ['시간 경과율', '예산 사용률'],
        datasets: [{
          data: [timeProgress, usagePct],
          backgroundColor: [
            'rgba(96,165,250,0.7)',
            usagePct > timeProgress ? 'rgba(248,113,113,0.7)' : 'rgba(52,211,153,0.7)'
          ],
          borderWidth: 0, borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.raw.toFixed(1)}%` } } },
        scales: { x: { max: 100, ticks: { callback: v => v + '%', color: '#9090b0', font: { size: 10 } }, grid: { color: '#2e2e3e' } }, y: { ticks: { color: '#9090b0' }, grid: { display: false } } }
      }
    });
  }
}


async function renderAssetChart() {
  // 현금 계좌 제외, 환율 VND 기준으로 환산
  const accounts = state.accounts.filter(a => a.type !== 'cash' && a.type !== 'loan');
  if (!accounts.length) return;

  const colors = ['#7c6af7','#34d399','#f87171','#fbbf24','#60a5fa','#a78bfa'];
  const labels = [];
  const data = [];
  const bgColors = [];

  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    // 초기잔액 + 거래내역 반영 실제 잔액
    const rawBal = (Number(a.initialBalance) || 0) + calcBalance(a.$id);
    // VND로 환산
    const inVND = await convertCurrency(rawBal, a.currency || 'VND', 'VND');
    const finalVal = a.type === 'loan' ? -Math.abs(inVND) : inVND;

    labels.push(`${a.name}${a.currency !== 'VND' ? ` (${a.currency})` : ''}`);
    data.push(Math.round(finalVal));
    bgColors.push(a.type === 'loan' ? 'rgba(248,113,113,0.7)' : colors[i % colors.length]);
  }

  if (store.assetChart) store.assetChart.destroy();
  const ctx = document.getElementById('assetChart').getContext('2d');

  if(window.Chart) {
    store.assetChart = new window.Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: '자산 (VND 환산)', data, backgroundColor: bgColors }]
      },
      options: {
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ${Math.round(ctx.raw).toLocaleString()} VND`
            }
          }
        },
        scales: {
          x: { ticks: { color: '#5a5a78', callback: v => (v/1000000).toFixed(1) + 'M' }, grid: { color: '#2e2e3e' } },
          y: { ticks: { color: '#9090b0' }, grid: { display: false } }
        }
      }
    });
  }
}

async function renderBalanceTrendChart() {
  const baseCur = 'VND';
  const [y, m] = state.currentMonth.split('-').map(Number);
  const today = new Date();
  // 이번 달 1일부터 오늘(또는 말일)까지 날짜 목록 생성
  const lastDay = (today.getFullYear() === y && today.getMonth() + 1 === m)
    ? today.getDate()
    : new Date(y, m, 0).getDate();

  const labels = [];
  const dataPoints = [];

  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    labels.push(`${m}/${day}`);

    // 해당 날짜 이전까지의 모든 거래 누적 잔액 계산
    let totalVND = 0;
    for (const acc of state.accounts) {
      const cur = acc.currency || 'VND';
      let bal = Number(acc.initialBalance) || 0;
      for (const t of state.transactions) {
        const tDate = (t.date || '').slice(0, 10);
        if (tDate > dateStr) continue;
        if (t.type === 'income' && t.accountId === acc.$id) bal += Number(t.amount);
        if (t.type === 'expense' && t.accountId === acc.$id) bal -= Number(t.amount);
        if (t.type === 'transfer') {
          if (t.fromAccountId === acc.$id) bal -= Number(t.amount);
          if (t.toAccountId === acc.$id) bal += Number(t.targetAmount || t.amount);
        }
      }
      const inVND = await convertCurrency(bal, cur, baseCur);
      if (acc.type === 'loan') totalVND -= Math.abs(inVND);
      else totalVND += inVND;
    }
    dataPoints.push(Math.round(totalVND));
  }

  if (store.balanceTrendChart) store.balanceTrendChart.destroy();
  const ctx = document.getElementById('balanceTrendChart');
  if (!ctx || !window.Chart) return;

  store.balanceTrendChart = new window.Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '총 잔액 (VND)',
        data: dataPoints,
        borderColor: '#7c6af7',
        backgroundColor: 'rgba(124,106,247,0.12)',
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: '#a78bfa',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${Math.round(ctx.raw).toLocaleString()} VND` } }
      },
      scales: {
        x: { ticks: { color: '#9090b0', font: { size: 9 }, maxTicksLimit: 10 }, grid: { color: '#2e2e3e' } },
        y: { ticks: { color: '#9090b0', font: { size: 9 }, callback: v => (v/1000000).toFixed(0) + 'M' }, grid: { color: '#2e2e3e' } }
      }
    }
  });
}

// ─────────────────────────────────────────────
// 달력 렌더링
// ─────────────────────────────────────────────
async function renderCalendarScreen() {
  const d = state.calendarDate;
  const year = d.getFullYear(), month = d.getMonth();
  const calTitle = document.getElementById('calTitle');
  if(!calTitle) return;
  calTitle.textContent = `${year}년 ${month + 1}월`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = getDaysInMonth(year, month);
  const today = new Date();
  const ym = `${year}-${String(month + 1).padStart(2, '0')}`;
  const baseCur = 'VND';

  const txs = state.transactions.filter(t => (t.date || '').replace(/\./g, '-').startsWith(ym));
  const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
  let html = dayLabels.map(l => `<div class="cal-day-label">${l}</div>`).join('');

  let monthlyCumulativeNet = 0;
  for (let i = 0; i < firstDay; i++) html += '<div></div>';

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${ym}-${String(day).padStart(2, '0')}`;
    const dayTxs = txs.filter(t => (t.date || '').replace(/\./g, '-').slice(0, 10) === dateStr);
    
    let dayInc = 0, dayExp = 0;
    for (const t of dayTxs) {
      const acc = state.accounts.find(a => a.$id === (t.accountId || t.fromAccountId));
      const cur = acc?.currency || 'VND';
      const conv = await convertCurrency(Number(t.amount), cur, baseCur);
      if (t.type === 'income') dayInc += conv;
      if (t.type === 'expense') dayExp += conv;
    }
    const dayNet = dayInc - dayExp;
    monthlyCumulativeNet += dayNet;
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

    const fInc = (v) => v > 0 ? Math.round(v).toLocaleString() : '';
    const fExp = (v) => v > 0 ? Math.round(v).toLocaleString() : '';
    const fNet = (v) => Math.round(v).toLocaleString();

    html += `<div class="cal-cell ${isToday ? 'today' : ''}" onclick="window.showCalDetail('${dateStr}')">
      <div class="cal-num">${day}</div>
      <div class="cal-daily-stats">
        ${dayInc > 0 ? `<div class="cal-inc-txt">${fInc(dayInc)}</div>` : ''}
        ${dayExp > 0 ? `<div class="cal-exp-txt">${fExp(dayExp)}</div>` : ''}
        <div class="cal-net-txt ${monthlyCumulativeNet > 0 ? 'pos' : monthlyCumulativeNet < 0 ? 'neg' : ''}">${fNet(monthlyCumulativeNet)}</div>
      </div>
    </div>`;
  }

  const calGrid = document.getElementById('calGrid');
  if(calGrid) calGrid.innerHTML = html;
}

function calPrevMonth() {
  const d = state.calendarDate;
  state.calendarDate = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  renderCalendarScreen();
}
function calNextMonth() {
  const d = state.calendarDate;
  state.calendarDate = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  renderCalendarScreen();
}

function showCalDetail(dateStr) {
  const detailEl = document.getElementById('calDetail');
  if(!detailEl) return;
  const txs = state.transactions.filter(t => (t.date || '').replace(/\./g, '-').slice(0, 10) === dateStr);
  detailEl.style.display = 'block';
  if (!txs.length) {
    detailEl.innerHTML = `<div class="cal-detail-date">${fmtDate(dateStr)}</div><div class="cal-detail-empty">이날 거래 내역이 없습니다</div>`;
    return;
  }
  const items = txs.map(t => renderTxItem(t)).join('');
  detailEl.innerHTML = `<div class="cal-detail-date">${fmtDate(dateStr)}</div>${items}`;
}

// 윈도우 전역 함수 등록
window.sendAiMsg = sendAiMsg;
window.renderStats = renderStatsScreen;
window.renderReport = renderReportScreen;
window.calPrevMonth = calPrevMonth;
window.calNextMonth = calNextMonth;
window.showCalDetail = showCalDetail;
window.setStatsPeriod = setStatsPeriod;
window.setStatsType = setStatsType;
window.setReportPeriod = setReportPeriod;
window.renderCalendarScreen = renderCalendarScreen;






// =============================================
// 민성이의 가계부 - 예산 설정 (소분류 지원)
// =============================================

function openBudgetModal() {
  document.getElementById('budgetMonth').value = state.currentMonth;
  renderBudgetInputList();
  openModal('budgetModal');
}

function renderBudgetInputList() {
  const el = document.getElementById('budgetInputList');
  const rawYm = document.getElementById('budgetMonth').value || state.currentMonth;
  const ym = (rawYm || '').replace(/\./g, '-'); // 🚀 날짜 포맷 강제 표준화
  const existing = state.budgets.filter(b => (b.yearMonth || '').replace(/\./g, '-') === ym);
  const defaultCur = state.accounts[0]?.currency || 'VND';
  const sym = getCurrencySymbol(defaultCur);

  let html = '';
  for (const [mainCat, subCats] of Object.entries(CATEGORIES)) {
    // 소분류 합계 계산
    const subs = existing.filter(e => e.category === mainCat && e.subCategory);
    const subTotal = subs.reduce((s, b) => s + Number(b.amount), 0);
    
    // 대분류 예산 (직접 입력한 값이 있으면 우선, 없으면 소분류 합계 프리뷰)
    const mainRecord = existing.find(e => e.category === mainCat && !e.subCategory);
    const mainVal = mainRecord ? Number(mainRecord.amount).toLocaleString() : subTotal > 0 ? subTotal.toLocaleString() : '';

    html += `<div class="budget-main-group" data-category="${mainCat}" style="margin-bottom:12px; border:1px solid var(--border); border-radius: var(--radius-sm); overflow:hidden;">`;
    html += `  <div style="background:var(--bg3); padding:8px 12px; font-weight:bold; color:var(--text); display:flex; justify-content:space-between; align-items:center;">
                 <span style="font-size:14px;">${mainCat} <small style="font-weight:normal; color:var(--text2); font-size:11px;">(계산된 합계)</small></span> 
                 <div class="amount-input-wrap" style="width: 130px;">
                    <span class="amount-symbol" style="font-size:11px;">${sym}</span>
                    <input type="text" inputmode="numeric" class="form-input" id="budget-${mainCat}-main" value="${mainVal}" placeholder="직접 입력 시 우선" oninput="window.formatNumberInput(this)" style="padding-left:24px; height:28px; font-size:13px; text-align:right;">
                 </div>
               </div>`;
    html += `  <div style="padding:8px 12px; background:var(--card); display:flex; flex-direction:column; gap:6px;">`;

    for (const sub of subCats) {
      const b = existing.find(e => e.category === mainCat && e.subCategory === sub.name);
      const val = b ? Number(b.amount).toLocaleString() : '';
      html += `    <div class="form-group" style="margin-bottom:0; display:flex; align-items:center; gap:8px;">
                     <label class="form-label" style="margin-bottom:0; width:80px; font-size:12px; color:var(--text2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">↳ ${sub.name}</label>
                     <div class="amount-input-wrap" style="flex:1;">
                       <span class="amount-symbol" style="font-size:11px;">${sym}</span>
                       <input type="text" inputmode="numeric" class="form-input sub-budget-input" 
                         id="budget-${mainCat}-sub-${sub.id}" value="${val}" placeholder="0" 
                         data-main="${mainCat}" 
                         oninput="window.formatNumberInput(this); window.updateCategoryTotal('${mainCat}')" 
                         style="padding-left:24px; height:30px; font-size:13px; text-align:right;">
                     </div>
                   </div>`;
    }
    html += `  </div>`;
    html += `</div>`;
  }
  el.innerHTML = html;
}

// 소분류 입력 시 실시간으로 대분류 합계 칸 업데이트
function updateCategoryTotal(mainCat) {
  const group = document.querySelector(`.budget-main-group[data-category="${mainCat}"]`);
  if (!group) return;
  const subInputs = group.querySelectorAll('.sub-budget-input');
  let total = 0;
  subInputs.forEach(inp => {
    const v = (inp.dataset.raw || inp.value).replace(/,/g, '');
    if (v) total += Number(v);
  });
  const mainInp = document.getElementById(`budget-${mainCat}-main`);
  if (mainInp) {
    mainInp.value = total > 0 ? total.toLocaleString() : '';
    mainInp.dataset.raw = total;
  }
}

async function saveBudgets() {
  const rawYm = document.getElementById('budgetMonth').value || state.currentMonth;
  const ym = (rawYm || '').replace(/\./g, '-');
  
  showLoading(true, '예산 저장 중...');
  try {
    // 🚀 전체 목록을 먼저 딱 한 번만 가져옴
    const existingList = await db.getBudgets();
    
    for (const [mainCat, subCats] of Object.entries(CATEGORIES)) {
      // 대분류 전체 예산 저장
      const mainInp = document.getElementById(`budget-${mainCat}-main`);
      if (mainInp) {
        const raw = (mainInp.dataset.raw || mainInp.value || '0').replace(/,/g, '');
        const saved = await db.saveBudget({ category: mainCat, amount: Number(raw)||0, yearMonth: ym, subCategory: null }, existingList);
        updateLocalBudgetStore(saved);
      }

      // 소분류 개별 예산 저장
      for (const sub of subCats) {
        const inp = document.getElementById(`budget-${mainCat}-sub-${sub.id}`);
        if (!inp) continue;
        const raw = (inp.dataset.raw || inp.value || '0').replace(/,/g, '');
        const saved = await db.saveBudget({ category: mainCat, amount: Number(raw)||0, yearMonth: ym, subCategory: sub.name }, existingList);
        updateLocalBudgetStore(saved);
      }
    }
    
    toast('✅ 모든 예산이 안전하게 저장됐어요!');
    if(window.closeModal) window.closeModal('budgetModal');
    if(typeof window.renderStats === 'function') window.renderStats();
  } catch(e) { 
    console.error('예산 저장 최종 실패:', e);
    toast('❌ 저장 실패: ' + (e.message || '알 수 없는 오류'), 'error'); 
    alert('⚠️ 예산 저장 중 오류가 발생했습니다.\n\n사유: ' + (e.message || '서버 연결 불안정 또는 권한 문제') + '\n\n페이지를 새로고침한 후 다시 시도해 주세요.');
  }
  showLoading(false);
}

function updateLocalBudgetStore(saved) {
  const idx = state.budgets.findIndex(b => b.category === saved.category && b.yearMonth === saved.yearMonth && b.subCategory === saved.subCategory);
  if (idx >= 0) state.budgets[idx] = saved;
  else state.budgets.push(saved);
}

// 전역 함수 자가 등록
window.openBudgetModal = openBudgetModal;
window.saveBudgets = saveBudgets;
window.updateCategoryTotal = updateCategoryTotal;
window.renderBudgetInputList = renderBudgetInputList;


// =============================================
// 민성이의 가계부 - 외부 환율 API 동기화 연동
// =============================================

// 무료 공개 환율 API 예시 (캐싱을 위해 localStorage 활용)
const ExchangeRateURL = 'https://open.er-api.com/v6/latest/';

// 기준 통화 (예: 'KRW' 혹은 'VND')에 따른 환율 객체 반환
async function fetchExchangeRates(baseCode = 'VND') {
  const cacheKey = `exchange_rates_${baseCode}`;
  const cachedStr = localStorage.getItem(cacheKey);
  
  if (cachedStr) {
    const cached = JSON.parse(cachedStr);
    // 24시간 이내 데이터면 캐시 사용
    if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
      return cached.rates;
    }
  }

  try {
    const res = await fetch(`${ExchangeRateURL}${baseCode}`);
    if (!res.ok) throw new Error('환율 정보를 가져올 수 없습니다.');
    const data = await res.json();
    
    if (data.result === 'success') {
      localStorage.setItem(cacheKey, JSON.stringify({
        timestamp: Date.now(),
        rates: data.rates
      }));
      return data.rates;
    } else {
      throw new Error('API 응답 이상');
    }
  } catch (error) {
    console.error('환율 API 실패:', error);
    toast('⚠️ 실시간 환율을 가져오지 못해 기본 비율로 계산됩니다.', 'error');
    // 통신 실패 시 기본 하드코딩된 대략적 비율 반환 (VND 기준)
    return {
      VND: 1,
      KRW: 0.054, // 1VND = 0.054KRW 
      USD: 0.000039,
      CNY: 0.00028
    };
  }
}

// from 통화에서 to 통화로 금액 변환
async function convertCurrency(amount, fromCur, toCur) {
  if (fromCur === toCur) return amount;
  const rates = await fetchExchangeRates(fromCur);
  const rate = rates[toCur] || 1;
  return amount * rate;
}

// 각기 다른 통화의 계좌 잔액을 하나의 기준 통화(baseCur)로 합산
async function getTotalBalanceInBase(accounts, transactions, baseCur = 'VND') {
  let totalInBase = 0;

  for (const acc of accounts) {
    const cur = acc.currency || 'VND';
    let rawBal = Number(acc.initialBalance || 0);
    
    // 이 계좌에 해당하는 트랜잭션 필터링 및 잔액 누적 (utils.js의 calcBalance 방식과 동일하지만 비동기 처리가 필요없음)
    for (const t of transactions) {
      if (t.type === 'income' && t.accountId === acc.$id) rawBal += Number(t.amount);
      if (t.type === 'expense' && t.accountId === acc.$id) rawBal -= Number(t.amount);
      if (t.type === 'transfer') {
        if (t.fromAccountId === acc.$id) rawBal -= Number(t.amount);
        if (t.toAccountId === acc.$id) rawBal += Number(t.amount);
      }
    }

    if (cur === baseCur) {
      if (acc.type === 'loan') totalInBase -= rawBal;
      else totalInBase += rawBal;
    } else {
      const conv = await convertCurrency(rawBal, cur, baseCur);
      if (acc.type === 'loan') totalInBase -= conv;
      else totalInBase += conv;
    }
  }
  return totalInBase;
}

// 특정 날짜(toDate: 'YYYY-MM-DD') 이전까지의 합산 잔액을 VND로 계산
async function getBalanceAtDate(toDateStr, baseCur = 'VND') {
  const toDate = new Date(toDateStr);
  let totalInBase = 0;
  for (const acc of state.accounts) {
    const cur = acc.currency || 'VND';
    let rawBal = Number(acc.initialBalance || 0);
    for (const t of state.transactions) {
      if (!t.date) continue;
      const tDate = new Date(t.date);
      if (tDate >= toDate) continue;
      if (t.type === 'income' && t.accountId === acc.$id) rawBal += Number(t.amount);
      if (t.type === 'expense' && t.accountId === acc.$id) rawBal -= Number(t.amount);
      if (t.type === 'transfer') {
        if (t.fromAccountId === acc.$id) rawBal -= Number(t.amount);
        if (t.toAccountId === acc.$id) rawBal += Number(t.amount);
      }
    }
    const conv = await convertCurrency(rawBal, cur, baseCur);
    if (acc.type === 'loan') totalInBase -= conv;
    else totalInBase += conv;
  }
  return totalInBase;
}




// =============================================
// 민성이의 가계부 - v1.060 메인 컨트롤러 (구조 개선)
// =============================================

// 핵심 기능 전역 바인딩 (순환 참조 방지 및 HTML 호출용)
window.db = db;
window.loadAll = loadAll;
window.renderHome = renderHome;
window.prevMonth = prevMonth;
window.nextMonth = nextMonth;
window.forceUpdateApp = forceUpdateApp;

// 초기화 로직
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 버전을 localStorage에 기록 (리다이렉트 없음)
    localStorage.setItem('app-ver', '1.406');

    // 초기화 루틴 실행 브릿지 활성화
    window.__prevMonth = prevMonth;
    window.__nextMonth = nextMonth;
    window.__renderHome = renderHome;

    // 1. UI 및 진단 도구 초기화 (각 모달 자가등록 대기)
    if (window.initUI) window.initUI();
    if (window.renderDiagnostics) window.renderDiagnostics();

    // 2. 데이터 베이스 로드
    await loadAll();
    
    // 3. 화면 초기 렌더링
    renderHome();
    if (window.renderCalendarScreen) window.renderCalendarScreen();
    
    // 4. 검색 날짜 초기화
    initSearchDates();
    
    // 5. DB 상태 체크
    setTimeout(() => { if (window.checkDbStatus) window.checkDbStatus(); }, 1500);

  } catch (err) {
    console.error('앱 초기화 오류:', err);
    if (window.showLoading) window.showLoading(false);
    if (db && db.logError) db.logError('초기화 치명적 에러: ' + err.message);
    alert('❌ 데이터를 불러오는 중 오류가 발생했습니다. 설정 페이지의 [DB 접속 진단]을 확인해주세요.');
  }
});

/**
 * 홈 화면 렌더링 (잔액, 계좌목록, 최근거래)
 */
async function renderHome() {
  if (!document.getElementById('page-home')) return;

  const [y, m] = state.currentMonth.split('-').map(Number);
  const label = `${y}년 ${m}월`;
  document.getElementById('homeMonthLabel').textContent = label;

  await renderMonthSummary(); 
  await renderAccountsList();
  renderTxList();
  renderBudgetAlerts();
}

async function renderMonthSummary() {
  const baseCur = 'VND';
  const txs = state.transactions.filter(t => t.date?.startsWith(state.currentMonth));
  
  let incomeInVND = 0;
  let expenseInVND = 0;

  for (const t of txs) {
    const acc = findAccount(t.accountId || t.fromAccountId);
    const cur = acc?.currency || 'VND';
    const amt = Number(t.amount) || 0;
    
    const inVND = await convertCurrency(amt, cur, baseCur);
    t.vndAmt = inVND; 
    if (t.type === 'income') incomeInVND += inVND;
    else if (t.type === 'expense') expenseInVND += inVND;
  }
  
  const monthlyNet = incomeInVND - expenseInVND;
  const balEl = document.getElementById('homeTotalBalance');
  if (balEl) {
    balEl.innerHTML = fmtMoney(monthlyNet, baseCur);
    balEl.className = 'balance ' + (monthlyNet >= 0 ? 'positive' : 'negative');
  }
  
  if (document.getElementById('homeIncome')) document.getElementById('homeIncome').innerHTML = fmtMoney(incomeInVND, baseCur);
  if (document.getElementById('homeExpense')) document.getElementById('homeExpense').innerHTML = fmtMoney(expenseInVND, baseCur);
}

async function renderAccountsList() {
  const el = document.getElementById('accountsPageList');
  if(!el) return;
  
  state.accounts.sort((a,b) => (Number(a.order)||0) - (Number(b.order)||0));
  
  let totalInVND = 0;
  for (const a of state.accounts) {
    const bal = calcBalance(a.$id) + (Number(a.initialBalance) || 0);
    const inVND = await convertCurrency(bal, a.currency || 'VND', 'VND');
    if (a.type === 'loan') totalInVND -= inVND;
    else totalInVND += inVND;
  }
  
  const totalEl = document.getElementById('accountsTotalSum');
  if(totalEl) {
    totalEl.innerHTML = `(순자산 ${fmtMoney(totalInVND, 'VND')})`;
  }

  if (!state.accounts.length) {
    el.innerHTML = '<div style="padding:16px;color:var(--text3);font-size:13px;">계좌를 추가해주세요</div>';
    return;
  }

  el.innerHTML = state.accounts.map(a => {
    let bal = calcBalance(a.$id) + (Number(a.initialBalance) || 0);
    const isLoan = a.type === 'loan';
    if(isLoan) bal = -Math.abs(bal);

    const cur = a.currency || 'VND';
    const iconKey = a.bankIcon || a.currencyIcon || cur.toLowerCase();
    
    return `<div class="account-card" onclick="window.openAccountModal('${a.$id}')">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <img src="${ICONS[iconKey]||''}" width="20" height="20" style="border-radius:4px;object-fit:contain;">
        <span class="name">${a.name} ${isLoan ? '<small style="color:var(--text3); font-size:10px;">(대출)</small>' : ''}</span>
      </div>
      <div class="bal ${bal >= 0 ? 'positive' : 'negative'}">${fmtMoney(bal, cur)}</div>
    </div>`;
  }).join('');
}

function renderTxList() {
  const el = document.getElementById('txList');
  if(!el) return;
  const txs = state.transactions.filter(t => t.date?.startsWith(state.currentMonth))
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!txs.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">💸</div><p>이번달 거래 내역이 없습니다</p></div>';
    return;
  }

  const groups = {};
  txs.forEach(t => {
    const d = t.date?.slice(0, 10) || '';
    if (!groups[d]) groups[d] = [];
    groups[d].push(t);
  });

  el.innerHTML = Object.entries(groups).map(([date, list]) => `
    <div class="tx-date-group">
      <div class="tx-date-label">${fmtDate(date)}</div>
      ${list.map(t => window.renderTxItem ? window.renderTxItem(t) : '').join('')}
    </div>
  `).join('');
}

function renderBudgetAlerts() {
  const el = document.getElementById('budgetAlerts');
  if(!el) return;
  const status = window.getBudgetStatus ? window.getBudgetStatus(state.currentMonth) : [];
  const over = status.filter(b => Number(b.percent) > 100);
  if (!over.length) { el.innerHTML = ''; return; }
  
  el.innerHTML = over.map(b => {
    const title = b.subCategory ? `${b.category}(${b.subCategory})` : b.category;
    return `<div class="budget-alert">⚠️ <strong>${title}</strong> 예산 초과! (${b.percent}% 사용)</div>`;
  }).join('');
}

function prevMonth() {
  const [y, m] = state.currentMonth.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  state.currentMonth = d.toISOString().slice(0, 7);
  renderHome();
}

function nextMonth() {
  const [y, m] = state.currentMonth.split('-').map(Number);
  const d = new Date(y, m, 1);
  state.currentMonth = d.toISOString().slice(0, 7);
  renderHome();
}

function initSearchDates() {
  const elFrom = document.getElementById('searchFrom');
  const elTo = document.getElementById('searchTo');
  if (elFrom) {
     const today = new Date();
     const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
     elFrom.value = firstDay.toISOString().split('T')[0];
     if(elTo) elTo.value = today.toISOString().split('T')[0];
  }
}

async function forceUpdateApp() {
  if (navigator.serviceWorker) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (let reg of regs) await reg.unregister();
    } catch(e) {}
  }
  localStorage.removeItem('app-ver');
  toast('🔄 새 버전으로 갱신 중...', 'info');
  setTimeout(() => window.location.reload(true), 1000);
}

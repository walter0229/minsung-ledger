// =============================================
// 민성이의 가계부 - 설정 파일
// =============================================

export const APPWRITE_ENDPOINT = 'https://cloud.appwrite.io/v1';
export const APPWRITE_PROJECT_ID = '69ca6dd30013a519ec48';
export const DB_ID = 'ledger-db';

// 컬렉션 ID
export const COL = {
  ACCOUNTS: 'accounts',
  TRANSACTIONS: 'transactions',
  BUDGETS: 'budgets',
  SETTINGS: 'app-settings',
};

// 아이콘 경로 매핑
export const ICONS = {
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

  // 은행
  hana: 'icons/hana_logo.png',
  mg: 'icons/mg_logo.png',
  nh: 'icons/nh_logo.png',
  shinhan: 'icons/shinhan_logo.png',
  woori: 'icons/woori_logo.png',
};

// 카테고리 정의
export const CATEGORIES = {
  한국: [
    { id: 'family_kr', name: '가족', icon: 'family_kr' },
    { id: 'transport', name: '교통', icon: 'transport' },
    { id: 'health', name: '의료/건강', icon: 'health' },
    { id: 'insurance', name: '보험', icon: 'insurance' },
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
    { id: 'apartment', name: '아파트', icon: 'apartment' },
    { id: 'apartment_rent', name: '월세', icon: 'apartment_rent' },
    { id: 'electricity', name: '전기', icon: 'electricity' },
    { id: 'water', name: '수도', icon: 'water' },
    { id: 'phone', name: '통신', icon: 'phone' },
    { id: 'cleaning', name: '청소', icon: 'cleaning' },
    { id: 'subscription', name: '구독', icon: 'subscription' },
  ],
  '사회생활/여가': [
    { id: 'leisure', name: '여가', icon: 'leisure' },
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
    { id: 'health', name: '건강', icon: 'health' },
    { id: 'beauty', name: '미용', icon: 'beauty' },
    { id: 'massage', name: '마사지', icon: 'massage' },
    { id: 'pet_cat', name: '반려동물', icon: 'pet_cat' },
    { id: 'cigarette', name: '담배', icon: 'cigarette' },
    { id: 'lotto', name: '로또', icon: 'lotto' },
  ],
  기타: [
    { id: 'shopping', name: '쇼핑', icon: 'shopping' },
    { id: 'loan', name: '대출', icon: 'loan' },
    { id: 'credit_card', name: '신용카드', icon: 'credit_card' },
    { id: 'rent_dollar', name: '임대료(달러)', icon: 'rent_dollar' },
    { id: 'data_correction', name: '데이터수정', icon: 'data_correction' },
    { id: 'etc', name: '기타', icon: 'etc' },
  ],
};

// 통화 정보
export const CURRENCIES = [
  { code: 'VND', symbol: '₫', name: '베트남 동', icon: 'vnd' },
  { code: 'KRW', symbol: '₩', name: '한국 원', icon: 'krw' },
  { code: 'USD', symbol: '$', name: '미국 달러', icon: 'usd' },
  { code: 'CNY', symbol: '¥', name: '중국 위안', icon: 'cny' },
  { code: 'CAD', symbol: 'C$', name: '캐나다 달러', icon: 'cad' },
  { code: 'PHP', symbol: '₱', name: '필리핀 페소', icon: 'php' },
];

// 계좌 유형
export const ACCOUNT_TYPES = [
  { id: 'bank', name: '은행', emoji: '🏦' },
  { id: 'cash', name: '현금', emoji: '💵' },
  { id: 'loan', name: '대출', emoji: '📋' },
  { id: 'savings', name: '적금', emoji: '🐷' },
];

// Gemini 모델
export const GEMINI_MODEL = 'gemini-3.0-flash';

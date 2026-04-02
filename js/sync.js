import { state, toast } from './utils.js';

// =============================================
// 민성이의 가계부 - 외부 환율 API 동기화 연동
// =============================================

// 무료 공개 환율 API 예시 (캐싱을 위해 localStorage 활용)
const ExchangeRateURL = 'https://open.er-api.com/v6/latest/';

// 기준 통화 (예: 'KRW' 혹은 'VND')에 따른 환율 객체 반환
export async function fetchExchangeRates(baseCode = 'VND') {
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
export async function convertCurrency(amount, fromCur, toCur) {
  if (fromCur === toCur) return amount;
  const rates = await fetchExchangeRates(fromCur);
  const rate = rates[toCur] || 1;
  return amount * rate;
}

// 각기 다른 통화의 계좌 잔액을 하나의 기준 통화(baseCur)로 합산
export async function getTotalBalanceInBase(accounts, transactions, baseCur = 'VND') {
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
export async function getBalanceAtDate(toDateStr, baseCur = 'VND') {
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

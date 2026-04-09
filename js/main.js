import { loadAll, state, fmtMoney, toast, showLoading, fmtDate, calcBalance, findAccount, convertCurrency, iconImg } from './utils.js';
import { db } from './db.js';
import { ICONS } from './config.js';

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
    localStorage.setItem('app-ver', '1.405');

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
export async function renderHome() {
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

export function prevMonth() {
  const [y, m] = state.currentMonth.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  state.currentMonth = d.toISOString().slice(0, 7);
  renderHome();
}

export function nextMonth() {
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

export async function forceUpdateApp() {
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

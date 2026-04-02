import { loadAll, state, fmtMoney, getCategoryStats, todayStr, getTimeProgress, toast, formatNumberInput, applyTheme, getBudgetStatus, iconImg, calcBalance, findAccount, getCurrencySymbol, showLoading, fmtDate } from './utils.js';
import { db } from './db.js';
import { ICONS, CATEGORIES, APP_VERSION } from './config.js';
import { store } from './store.js';
import { initUI, showPage, checkDbStatus, openCamera, handleCameraInput, applyThemePreset, toggleDarkMode, toggleReminder, saveReminderTime, renderThemeGrid, openModal, closeModal, closeModalOnBg } from './ui.js';
import { renderCalendarScreen, setStatsPeriod, setStatsType, renderStatsScreen, setReportPeriod, renderReportScreen, calPrevMonth, calNextMonth, showCalDetail } from './stats.js';
import { openAddModal, setTxType, onMainCatChange, selectTxAccount, selectTransferFrom, selectTransferTo, selectTxIcon, saveTx, showTxDetail, deleteTx, doSearch, renderTxItem } from './transactions.js';
import { openBudgetModal, renderBudgetInputList, updateCategoryTotal, saveBudgets } from './budget.js';
import { getTotalBalanceInBase, convertCurrency } from './sync.js';

// =============================================
// 민성이의 가계부 - 진입점 & 전역 이벤트 바인딩
// =============================================

document.addEventListener('DOMContentLoaded', async () => {
  if (localStorage.getItem('app-ver') !== APP_VERSION) {
    localStorage.setItem('app-ver', APP_VERSION);
    location.reload();
    return;
  }
  await loadAll();
  initUI();
  renderHome();
  renderCalendarScreen();
  setSearchDates();
  setTimeout(checkDbStatus, 1500);
});

export function renderHome() {
  const [y, m] = state.currentMonth.split('-').map(Number);
  const label = `${y}년 ${m}월`;
  document.getElementById('homeMonthLabel').textContent = label;

  renderMonthSummary();
  renderAccountsList();
  renderTxList();
  renderBudgetAlerts();
}

async function renderMonthSummary() {
  // 이번 달 전체 통합 계산 (VND 기준)
  const baseCur = 'VND';
  const txs = state.transactions.filter(t => t.date?.startsWith(state.currentMonth));
  
  let incomeInVND = 0;
  let expenseInVND = 0;

  for (const t of txs) {
    const acc = findAccount(t.accountId || t.fromAccountId);
    const cur = acc?.currency || 'VND';
    const amt = Number(t.amount) || 0;
    
    // 환율 변환 후 합산
    const inVND = await convertCurrency(amt, cur, baseCur);
    if (t.type === 'income') incomeInVND += inVND;
    else if (t.type === 'expense') expenseInVND += inVND;
  }
  
  const monthlyNet = incomeInVND - expenseInVND;
  const balEl = document.getElementById('homeTotalBalance');
  balEl.innerHTML = fmtMoney(monthlyNet, baseCur);
  balEl.className = 'balance ' + (monthlyNet >= 0 ? 'positive' : 'negative');
  
  document.getElementById('homeIncome').innerHTML = fmtMoney(incomeInVND, baseCur);
  document.getElementById('homeExpense').innerHTML = fmtMoney(expenseInVND, baseCur);
}

async function renderAccountsList() {
  const el = document.getElementById('accountsPageList');
  if(!el) return;
  
  // 정렬 순서 반영
  state.accounts.sort((a,b) => (Number(a.order)||0) - (Number(b.order)||0));
  
  // 전체 합계 계산 (VND 기준) - 자산에서 대출 차감
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
    totalEl.style.color = 'var(--yellow)';
  }

  if (!state.accounts.length) {
    el.innerHTML = '<div style="padding:16px;color:var(--text3);font-size:13px;">계좌를 추가해주세요</div>';
    return;
  }
  el.innerHTML = state.accounts.map(a => {
    let bal = calcBalance(a.$id) + (Number(a.initialBalance) || 0);
    const isLoan = a.type === 'loan';
    if(isLoan) bal = -Math.abs(bal); // 대출은 음수로 강제

    const cur = a.currency || 'VND';
    const iconKey = a.bankIcon || a.currencyIcon || cur.toLowerCase();
    const displayIcon = `<img src="${ICONS[iconKey]||''}" width="20" height="20" style="border-radius:4px;object-fit:contain;">`;
    
    return `<div class="account-card" onclick="window.openAccountModal('${a.$id}')">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        ${displayIcon}
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
      ${list.map(t => renderTxItem(t)).join('')}
    </div>
  `).join('');
}

function renderBudgetAlerts() {
  const el = document.getElementById('budgetAlerts');
  if(!el) return;
  const status = getBudgetStatus(state.currentMonth);
  const over = status.filter(b => Number(b.percent) > 100);
  if (!over.length) { el.innerHTML = ''; return; }
  
  el.innerHTML = over.map(b => {
    const title = b.subCategory ? `${b.category}(${b.subCategory})` : b.category;
    return `
    <div class="budget-alert">
      ⚠️ <strong>${title}</strong> 예산 초과! (${b.percent}% 사용)
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
// 스크린 전환 Helper
// ─────────────────────────────────────────────
export function renderCalendar() { renderCalendarScreen(); }
export function renderStats() { renderStatsScreen(); }
export function renderReport() { renderReportScreen(); }

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

function setSearchDates() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const elFrom = document.getElementById('searchFrom');
  const elTo = document.getElementById('searchTo');
  if(elFrom) elFrom.value = firstDay;
  if(elTo) elTo.value = todayStr();
}

// ─────────────────────────────────────────────
// 설정 렌더링 (모듈화 편의상 main 위치)
// ─────────────────────────────────────────────
export function renderSettings() {
  const el = document.getElementById('accountManageList');
  if(el) {
    if (!state.accounts.length) {
      el.innerHTML = '<div style="color:var(--text3);font-size:13px;">계좌가 없습니다</div>';
    } else {
      el.innerHTML = state.accounts.map(a => `
        <div class="account-manage-item">
          <div style="width:36px;height:36px;background:var(--bg3);border-radius:50%;display:flex;align-items:center;justify-content:center;">${a.bankIcon?iconImg(a.bankIcon,24):iconImg(a.currencyIcon||'vnd',24)}</div>
          <div class="info">
            <div class="name">${a.name}</div>
            <div class="type">${{bank:'은행',cash:'현금',loan:'대출',savings:'적금'}[a.type]||a.type} · ${a.currency}</div>
          </div>
          <div class="actions">
            <button class="btn-secondary btn-sm" onclick="window.openAccountModal('${a.$id}')">수정</button>
            <button class="btn-secondary btn-sm btn-danger" onclick="window.deleteAccount('${a.$id}')">삭제</button>
          </div>
        </div>`).join('');
    }
  }

  const budgetEl = document.getElementById('budgetSettingList');
  if(budgetEl) {
    const monthBudgets = state.budgets.filter(b => b.yearMonth === state.currentMonth);
    if (!monthBudgets.length) {
      budgetEl.innerHTML = '<div style="color:var(--text3);font-size:13px;">이번달 예산이 없습니다</div>';
    } else {
      const defaultCur = state.accounts[0]?.currency || 'VND';
      budgetEl.innerHTML = monthBudgets.map(b => {
        const title = b.subCategory ? `${b.category} > ${b.subCategory}` : b.category;
        return `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <span>${title}</span>
          <span style="font-weight:700;">${fmtMoney(b.amount, defaultCur)}</span>
        </div>`;
      }).join('');
    }
  }
}

// ─────────────────────────────────────────────
// 계좌 모달 및 로직 (기존 main.js로 통합)
// ─────────────────────────────────────────────
export function openAccountModal(accId = null) {
  document.getElementById('editAccountId').value = accId || '';
  document.getElementById('accountModalTitle').textContent = accId ? '계좌 수정' : '계좌 추가';
  
  // 기본 필드 초기화
  document.getElementById('accountOrder').value = 0;
  document.getElementById('accountName').value = '';
  document.getElementById('accountType').value = 'bank';
  document.getElementById('accountCurrency').value = 'VND';
  document.getElementById('accountBalance').value = '';
  if (document.getElementById('accountBalance').dataset) {
    document.getElementById('accountBalance').dataset.raw = '';
  }
  
  // 글로벌 아이콘 선택 상태 초기화
  store.selectedCurrencyIcon = 'vnd';
  store.selectedBankIcon = null;

  if (accId) {
    const a = state.accounts.find(ac => ac.$id === accId);
    if (a) {
      document.getElementById('accountName').value = a.name || '';
      document.getElementById('accountType').value = a.type || 'bank';
      document.getElementById('accountCurrency').value = a.currency || 'VND';
      document.getElementById('accountBalance').value = a.initialBalance ? Number(a.initialBalance).toLocaleString() : '';
      if (document.getElementById('accountBalance').dataset) {
        document.getElementById('accountBalance').dataset.raw = String(a.initialBalance || 0);
      }
      document.getElementById('accountOrder').value = a.order || 0;
      store.selectedCurrencyIcon = a.currencyIcon || 'vnd';
      store.selectedBankIcon = a.bankIcon || null;
    }
  }
  
  const btnDel = document.getElementById('btnDeleteAccount');
  if (btnDel) btnDel.style.display = accId ? 'block' : 'none';

  window.renderCurrencyIconGrid();
  window.renderBankIconGrid();
  openModal('accountModal');
}

export async function saveAccount() {
  const name = document.getElementById('accountName').value.trim();
  if (!name) { toast('계좌명을 입력해주세요', 'error'); return; }
  const rawBal = document.getElementById('accountBalance').dataset?.raw || document.getElementById('accountBalance').value.replace(/,/g,'');
  const data = {
    name,
    type: document.getElementById('accountType').value,
    currency: document.getElementById('accountCurrency').value,
    currencyIcon: store.selectedCurrencyIcon,
    bankIcon: store.selectedBankIcon,
    initialBalance: Number(rawBal) || 0,
    order: parseInt(document.getElementById('accountOrder').value) || 0
  };
  showLoading(true);
  try {
    const editId = document.getElementById('editAccountId').value;
    if (editId) {
      const updated = await db.updateAccount(editId, data);
      const idx = state.accounts.findIndex(a => a.$id === editId);
      if (idx >= 0) state.accounts[idx] = { ...state.accounts[idx], ...data };
      toast('✅ 수정됐어요!');
    } else {
      const saved = await db.createAccount(data);
      state.accounts.push(saved);
      toast('✅ 계좌가 추가됐어요!');
    }
    closeModal('accountModal');
    renderHome();
    renderSettings();
    if(state.currentTab === 'accounts') renderAccountsList();
  } catch(e) { toast('❌ ' + e.message, 'error'); }
  showLoading(false);
}

export async function deleteAccount(id) {
  if (!confirm('이 계좌를 삭제할까요?')) return;
  showLoading(true);
  try {
    await db.deleteAccount(id);
    state.accounts = state.accounts.filter(a => a.$id !== id);
    toast('🗑️ 계좌 삭제됐어요');
    renderHome();
    renderSettings();
    if(state.currentTab === 'accounts') renderAccountsList();
  } catch(e) { toast('❌ ' + e.message, 'error'); }
  showLoading(false);
}

// ─────────────────────────────────────────────
// 전역 (HTML 인라인 등) 함수 바인딩
// ─────────────────────────────────────────────
window.showPage = showPage;
window.prevMonth = prevMonth;
window.nextMonth = nextMonth;
window.openCamera = openCamera;
window.handleCameraInput = handleCameraInput;

window.calPrevMonth = calPrevMonth;
window.calNextMonth = calNextMonth;
window.showCalDetail = showCalDetail;

window.setStatsPeriod = setStatsPeriod;
window.setStatsType = setStatsType;
window.setReportPeriod = setReportPeriod;
window.doSearch = doSearch;

window.openAddModal = openAddModal;
window.setTxType = setTxType;
window.onMainCatChange = onMainCatChange;
window.selectTxAccount = selectTxAccount;
window.selectTxIcon = selectTxIcon;
window.selectTransferFrom = selectTransferFrom;
window.selectTransferTo = selectTransferTo;
window.saveTx = saveTx;
window.showTxDetail = showTxDetail;
window.deleteTx = deleteTx;

window.openAccountModal = openAccountModal;
window.saveAccount = saveAccount;
window.deleteAccount = deleteAccount;
window.formatNumberInput = formatNumberInput;

window.openBudgetModal = openBudgetModal;
window.saveBudgets = saveBudgets;

window.applyThemePreset = applyThemePreset;
window.toggleDarkMode = toggleDarkMode;
window.toggleReminder = toggleReminder;
window.saveReminderTime = saveReminderTime;

// UI 전역 렌더
window.renderCurrencyIconGrid = function() {
  const el = document.getElementById('currencyIconGrid');
  const cur = ['vnd','krw','usd','cny','cad','php','thb','mvr'];
  el.innerHTML = cur.map(k => `
    <div class="icon-item ${store.selectedCurrencyIcon===k?'selected':''}" onclick="window.selectCurrencyIcon('${k}')" id="cur-icon-${k}">
      ${iconImg(k, 28)}
      <span>${k.toUpperCase()}</span>
    </div>`).join('');
};
window.selectCurrencyIcon = function(key) {
  store.selectedCurrencyIcon = key;
  document.querySelectorAll('#currencyIconGrid .icon-item').forEach(el => el.classList.remove('selected'));
  document.getElementById('cur-icon-' + key)?.classList.add('selected');
};
window.renderBankIconGrid = function() {
  const el = document.getElementById('bankIconGrid');
  const banks = ['hana','mg','nh','shinhan','woori'];
  el.innerHTML = banks.map(k => `
    <div class="icon-item ${store.selectedBankIcon===k?'selected':''}" onclick="window.selectBankIcon('${k}')" id="bank-icon-${k}">
      ${iconImg(k, 28)}
      <span>${{hana:'하나',mg:'MG',nh:'NH농협',shinhan:'신한',woori:'우리'}[k]||k}</span>
    </div>`).join('') + `
    <div class="icon-item ${!store.selectedBankIcon?'selected':''}" onclick="window.selectBankIcon(null)" id="bank-icon-none">
      <div style="width:28px;height:28px;background:var(--bg2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;">💵</div>
      <span>없음</span>
    </div>`;
};
window.selectBankIcon = function(key) {
  store.selectedBankIcon = key;
  document.querySelectorAll('#bankIconGrid .icon-item').forEach(el => el.classList.remove('selected'));
  if (key) document.getElementById('bank-icon-' + key)?.classList.add('selected');
  else document.getElementById('bank-icon-none')?.classList.add('selected');
};
window.updateAccountIcons = function() {
  const cur = document.getElementById('accountCurrency').value.toLowerCase();
  const map = {vnd:'vnd',krw:'krw',usd:'usd',cny:'cny',cad:'cad',php:'php',thb:'thb',mvr:'mvr'};
  if (map[cur]) { store.selectedCurrencyIcon = map[cur]; window.renderCurrencyIconGrid(); }
};
window.closeModal = closeModal;
window.closeModalOnBg = closeModalOnBg;
window.renderStats = renderStatsScreen;
window.renderReport = renderReportScreen;
window.openBudgetModal = openBudgetModal;
window.updateCategoryTotal = updateCategoryTotal;
window.saveBudgets = saveBudgets;

window.saveApiSettings = async function() {
  const key = document.getElementById('geminiKeyInput')?.value?.trim() || state.settings.geminiApiKey;
  state.settings.geminiApiKey = key;
  try {
    await db.saveSettings({ ...state.settings, geminiApiKey: key });
    if (document.getElementById('geminiKeyInput')?.value) toast('✅ API 설정 저장됐어요!');
  } catch(e) { console.error(e); }
};
window.clearAllData = async function() {
  if (!confirm('정말 모든 데이터를 삭제할까요?\n⚠️ 이 작업은 되돌릴 수 없습니다!')) return;
  localStorage.clear();
  toast('🗑️ 로컬 데이터가 삭제됐어요. 앱을 새로고침해주세요.', 'info');
  setTimeout(() => location.reload(), 1500);
}
window.executeDeleteAccount = function() {
  const id = document.getElementById('editAccountId').value;
  if(id) {
    deleteAccount(id);
    closeModal('accountModal');
  }
};

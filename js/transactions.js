import { db } from './db.js';
import { state, fmtDate, fmtMoney, getCurrencySymbol, findAccount, iconImg, toast, showLoading } from './utils.js';
import { store } from './store.js';
import { CATEGORIES, ICONS, MAIN_CAT_ICONS } from './config.js';
import { openModal, closeModal } from './ui.js';

// renderHome은 main.js에서 순환 참조를 피하기 위해 window.renderHome을 사용합니다.

// =============================================
// 민성이의 가계부 - 거래 및 모달 관리
// =============================================

export function renderTxItem(t) {
  let defaultIcon = 'etc';
  if (t.type === 'income') defaultIcon = 'income';
  else if (t.type === 'transfer') defaultIcon = 'transfer';
  else if (t.mainCategory && MAIN_CAT_ICONS[t.mainCategory]) defaultIcon = MAIN_CAT_ICONS[t.mainCategory];

  const iconKey = t.iconKey && t.iconKey !== 'etc' ? t.iconKey : defaultIcon;
  const acc = findAccount(t.accountId || t.fromAccountId);
  const cur = acc?.currency || 'VND';
  const sign = t.type === 'income' ? '<span class="money-symbol">+</span>' : t.type === 'transfer' ? '<span class="money-symbol">↔</span>' : '';
  const cls = t.type;
  return `<div class="tx-item" onclick="window.showTxDetail('${t.$id}')">
    <div class="tx-icon">${iconImg(iconKey, 28)}</div>
    <div class="tx-info">
      <div class="tx-name">${t.memo || t.subCategory || t.mainCategory || '내역 없음'}</div>
      <div class="tx-cat">${t.mainCategory || ''} ${t.subCategory ? '> ' + t.subCategory : ''}</div>
    </div>
    <div class="tx-amount ${cls}">${sign}${fmtMoney(t.type === 'expense' ? -Math.abs(t.amount) : t.amount, cur)}</div>
  </div>`;
}

// ─────────────────────────────────────────────
// 거래 입력 모달
// ─────────────────────────────────────────────
export function openAddModal(txId = null) {
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

export function setTxType(type, btn) {
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

export function onMainCatChange() {
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

export function renderMainCategories() {
  const el = document.getElementById('mainCatSelect');
  if(!el) return;
  const cats = Object.keys(CATEGORIES);
  el.innerHTML = '<option value="">대분류 선택</option>' + 
    cats.map(c => `<option value="${c}">${c}</option>`).join('');
}

export function renderTxAccountChips() {
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

export function selectTxAccount(id) {
  store.selectedTxAccountId = id;
  renderTxAccountChips();
  updateAmountSymbol();
}

export function renderTransferChips() {
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

export function selectTransferFrom(id) { store.selectedTransferFrom = id; renderTransferChips(); }
export function selectTransferTo(id) { store.selectedTransferTo = id; renderTransferChips(); }

export function selectTxIcon(key) {
  store.selectedTxIcon = key;
  document.querySelectorAll('#txIconGrid .icon-item').forEach(el => el.classList.remove('selected'));
  document.getElementById('icon-item-' + key)?.classList.add('selected');
}

export function highlightSelectedIcon() {
  if (!store.selectedTxIcon) return;
  setTimeout(() => {
    document.querySelectorAll('#txIconGrid .icon-item').forEach(el => el.classList.remove('selected'));
    document.getElementById('icon-item-' + store.selectedTxIcon)?.classList.add('selected');
  }, 50);
}

export async function saveTx() {
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
export function showTxDetail(txId) {
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

export async function deleteTx(txId) {
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
export function doSearch() {
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

    return `<div class="report-tx-item" onclick="window.showTxDetail('${t.$id}')">
      <div class="report-tx-date">${fmtDate(t.date?.slice(0,10))}</div>
      <div style="display:flex;align-items:center;gap:8px;flex:1;">
        <div class="report-tx-icon" style="width:24px;height:24px;flex-shrink:0;">${iconImg(iconKey, 24)}</div>
        <div class="report-tx-name">${t.memo || t.subCategory || t.mainCategory || '-'}</div>
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

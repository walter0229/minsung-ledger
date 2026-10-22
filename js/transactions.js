import { db } from './db.js';
import { state, fmtDate, fmtMoney, getCurrencySymbol, findAccount, iconImg, toast, showLoading, calcBalance, parseTransferMeta, sortTransactions } from './utils.js';
import { store } from './store.js';
import { CATEGORIES, ICONS, MAIN_CAT_ICONS, INCOME_CATEGORIES } from './config.js';
import { openModal, closeModal } from './ui.js';

// renderHome은 main.js에서 순환 참조를 피하기 위해 window.renderHome을 사용합니다.

// 브릿지 연결
window.__openAddModal = openAddModal;

// =============================================
// 민성이의 가계부 - 거래 및 모달 관리
// =============================================

export function renderTxItem(t, context = 'home') {
  let defaultIcon = 'etc';
  if (t.type === 'income') {
    const matchedInc = INCOME_CATEGORIES.find(c => c.name === t.mainCategory);
    defaultIcon = matchedInc ? matchedInc.icon : 'income';
  } else if (t.type === 'transfer') {
    defaultIcon = 'transfer';
  } else if (t.mainCategory && MAIN_CAT_ICONS[t.mainCategory]) {
    defaultIcon = MAIN_CAT_ICONS[t.mainCategory];
  }

  const iconKey = t.iconKey && t.iconKey !== 'etc' ? t.iconKey : defaultIcon;
  let acc = findAccount(t.accountId || t.fromAccountId);
  let cur = acc?.currency || 'VND';
  let amount = t.amount;
  let sign = t.type === 'income' ? '<span class="money-symbol">+</span>' : t.type === 'transfer' ? '<span class="money-symbol">↔</span>' : '';
  let cls = t.type;

  let meta = parseTransferMeta(t);

  // 계좌 상세 내역(context === 'account')인 경우 이체 금액 및 기호 맞춤
  if (context === 'account' && t.type === 'transfer' && window.currentAccountHistoryId) {
    const accId = window.currentAccountHistoryId;
    if (t.toAccountId === accId) {
      const toAcc = findAccount(t.toAccountId);
      cur = toAcc?.currency || meta?.toCur || 'VND';
      amount = meta && typeof meta.toAmount === 'number' ? meta.toAmount : t.amount;
      sign = '<span class="money-symbol">+</span>';
      cls = 'income';
    } else if (t.fromAccountId === accId) {
      sign = '<span class="money-symbol">-</span>';
      cls = 'expense';
    }
  }

  let txDisplayName = t.memo || (meta ? '' : t.subCategory) || t.mainCategory;
  if (!txDisplayName) {
    if (t.type === 'transfer') {
      const fromAcc = findAccount(t.fromAccountId);
      const toAcc = findAccount(t.toAccountId);
      txDisplayName = `${fromAcc?.name || '?'} → ${toAcc?.name || '?'}`;
    } else {
      txDisplayName = '내역 없음';
    }
  }

  let catDisplay = '';
  if (t.type === 'transfer') {
    if (meta && meta.rate && meta.toAmount) {
      catDisplay = `환율 1:${meta.rate} (입금: ${fmtMoney(meta.toAmount, meta.toCur || 'VND')})`;
    } else {
      catDisplay = t.mainCategory || '이체';
    }
  } else {
    catDisplay = `${t.mainCategory || ''} ${t.subCategory ? '> ' + t.subCategory : ''}`.trim();
  }

  const isReorder = window.txReorderMode === true;
  let upDownBtns = '';
  
  if (isReorder) {
    upDownBtns = `
      <div style="display:flex; gap:6px; padding-left:8px; align-items:center; flex-shrink:0; pointer-events:auto;">
        <button onclick="event.stopPropagation(); window.moveTxUp('${t.$id}', '${context}')" 
                style="background:linear-gradient(135deg,#7c6af7,#6366f1); border:none; color:#fff; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:700; cursor:pointer; box-shadow:0 2px 6px rgba(124,106,247,0.4);" 
                title="위로 이동">
          ▲ 위로
        </button>
        <button onclick="event.stopPropagation(); window.moveTxDown('${t.$id}', '${context}')" 
                style="background:var(--bg3); border:1px solid var(--border); color:var(--text1); padding:6px 12px; border-radius:6px; font-size:12px; font-weight:700; cursor:pointer;" 
                title="아래로 이동">
          ▼ 아래로
        </button>
      </div>
    `;
  }

  return `<div class="tx-item ${isReorder ? 'reorder-mode' : ''}" data-id="${t.$id}" ${isReorder ? '' : `onclick="window.showTxDetail('${t.$id}')"`}>
    <div class="tx-icon">${iconImg(iconKey, 28)}</div>
    <div class="tx-info">
      <div class="tx-name">${txDisplayName}</div>
      <div class="tx-cat">${catDisplay}</div>
    </div>
    <div class="tx-amount ${cls}">${sign}${fmtMoney(t.type === 'expense' ? -Math.abs(amount) : amount, cur)}</div>
    ${upDownBtns}
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
  delete document.getElementById('txAmount').dataset.raw;
  document.getElementById('txMemo').value = '';

  // 이체 관련 필드 초기화
  const transferAmtEl = document.getElementById('transferAmount');
  if (transferAmtEl) { transferAmtEl.value = ''; delete transferAmtEl.dataset.raw; }
  const transferMemoEl = document.getElementById('transferMemo');
  if (transferMemoEl) transferMemoEl.value = '';
  const rateInput = document.getElementById('transferExchangeRate');
  if (rateInput) rateInput.value = '';
  const convertedRes = document.getElementById('transferConvertedResult');
  if (convertedRes) convertedRes.textContent = '0 ₫';
  const exchangeWrap = document.getElementById('transferExchangeWrap');
  if (exchangeWrap) exchangeWrap.style.display = 'none';
  
  renderMainCategories(); // 대분류 목록 채우기
  renderIncomeCategories(); // 수입 분류 목록 채우기
  document.getElementById('mainCatSelect').value = '';
  document.getElementById('subCatSelect').innerHTML = '<option value="">소분류 선택</option>';
  const elIncInit = document.getElementById('incomeCatSelect');
  if (elIncInit) elIncInit.value = '';

  if (txId) {
    const t = state.transactions.find(tx => tx.$id === txId);
    if (t) {
      window.setTxType(t.type, document.querySelector(`.type-tab[data-type="${t.type}"]`));
      document.getElementById('txDate').value = t.date?.slice(0, 10) || '';
      document.getElementById('txAmount').value = Number(t.amount).toLocaleString();
      document.getElementById('txAmount').dataset.raw = String(t.amount);
      document.getElementById('txMemo').value = t.memo || '';
      if (t.type === 'expense') {
        if (t.mainCategory) {
          document.getElementById('mainCatSelect').value = t.mainCategory;
          window.onMainCatChange();
          setTimeout(() => { document.getElementById('subCatSelect').value = t.subCategory || ''; }, 50);
        }
      } else if (t.type === 'income') {
        const elInc = document.getElementById('incomeCatSelect');
        if (elInc) elInc.value = t.mainCategory || '';
      } else if (t.type === 'transfer') {
        if (transferAmtEl) {
          transferAmtEl.value = Number(t.amount).toLocaleString();
          transferAmtEl.dataset.raw = String(t.amount);
        }
        if (transferMemoEl) transferMemoEl.value = t.memo || '';
        store.selectedTransferFrom = t.fromAccountId;
        store.selectedTransferTo = t.toAccountId;

        const meta = parseTransferMeta(t);
        if (meta && meta.rate && rateInput) {
          rateInput.value = meta.rate;
        }
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
  updateTransferExchangeUI();
  highlightSelectedIcon();
  openModal('addModal');
}

export function setTxType(type, btn) {
  store.currentTxType = type;
  document.querySelectorAll('.type-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else document.querySelector(`.type-tab[data-type="${type}"]`)?.classList.add('active');

  const isTransfer = type === 'transfer';
  const isExpense = type === 'expense';
  const isIncome = type === 'income';

  document.getElementById('expenseIncomeForm').style.display = isTransfer ? 'none' : 'block';
  document.getElementById('transferForm').style.display = isTransfer ? 'block' : 'none';
  document.getElementById('categorySection').style.display = isExpense ? 'block' : 'none';
  const elIncomeCat = document.getElementById('incomeCategorySection');
  if (elIncomeCat) elIncomeCat.style.display = isIncome ? 'block' : 'none';

  updateAmountSymbol();
  if (isTransfer) {
    updateTransferExchangeUI();
  }
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

export function renderIncomeCategories() {
  const el = document.getElementById('incomeCatSelect');
  if (!el) return;
  el.innerHTML = '<option value="">수입 분류 선택</option>' + 
    INCOME_CATEGORIES.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
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

export function selectTransferFrom(id) {
  store.selectedTransferFrom = id;
  renderTransferChips();
  updateTransferExchangeUI();
}

export function selectTransferTo(id) {
  store.selectedTransferTo = id;
  renderTransferChips();
  updateTransferExchangeUI();
}

export function updateTransferExchangeUI() {
  const wrap = document.getElementById('transferExchangeWrap');
  if (!wrap) return;

  const fromAcc = findAccount(store.selectedTransferFrom);
  const toAcc = findAccount(store.selectedTransferTo);

  const fromCur = fromAcc?.currency || 'VND';
  const toCur = toAcc?.currency || 'VND';

  const symEl = document.getElementById('transferSymbol');
  if (symEl) symEl.textContent = getCurrencySymbol(fromCur);

  if (fromAcc && toAcc && fromCur !== toCur) {
    wrap.style.display = 'block';

    const titleEl = document.getElementById('transferExchangeTitle');
    const labelEl = document.getElementById('transferRateLabel');
    const rateSymEl = document.getElementById('transferRateSymbol');
    const convertedLabel = document.getElementById('transferConvertedLabel');
    const rateInput = document.getElementById('transferExchangeRate');

    if (fromCur !== 'VND' && toCur === 'VND') {
      if (titleEl) titleEl.textContent = `환율 및 VND 환산 (${fromCur} → VND)`;
      if (labelEl) labelEl.textContent = `환율 (1 ${fromCur}당 VND)`;
      if (rateSymEl) rateSymEl.textContent = '₫';
      if (convertedLabel) convertedLabel.textContent = `베트남동(VND) 입금액:`;
      if (rateInput && !rateInput.value) {
        rateInput.placeholder = fromCur === 'USD' ? '예: 25400' : '예: 18.5';
      }
    } else if (fromCur === 'VND' && toCur !== 'VND') {
      if (titleEl) titleEl.textContent = `환율 및 환산 (VND → ${toCur})`;
      if (labelEl) labelEl.textContent = `환율 (1 ${toCur}당 VND)`;
      if (rateSymEl) rateSymEl.textContent = '₫';
      if (convertedLabel) convertedLabel.textContent = `${toCur} 입금액:`;
      if (rateInput && !rateInput.value) {
        rateInput.placeholder = toCur === 'USD' ? '예: 25400' : '예: 18.5';
      }
    } else {
      if (titleEl) titleEl.textContent = `환율 및 환산 (${fromCur} → ${toCur})`;
      if (labelEl) labelEl.textContent = `환율 (1 ${fromCur}당 ${toCur})`;
      if (rateSymEl) rateSymEl.textContent = getCurrencySymbol(toCur);
      if (convertedLabel) convertedLabel.textContent = `${toCur} 입금액:`;
    }

    updateTransferExchangeCalc();
  } else {
    wrap.style.display = 'none';
  }
}

export function updateTransferExchangeCalc() {
  const fromAcc = findAccount(store.selectedTransferFrom);
  const toAcc = findAccount(store.selectedTransferTo);
  if (!fromAcc || !toAcc) return;

  const fromCur = fromAcc.currency || 'VND';
  const toCur = toAcc.currency || 'VND';
  if (fromCur === toCur) return;

  const amtInput = document.getElementById('transferAmount');
  const rawAmt = Number(amtInput?.dataset?.raw || amtInput?.value?.replace(/,/g, '')) || 0;
  const rateInput = document.getElementById('transferExchangeRate');
  const rate = parseFloat(rateInput?.value) || 0;

  let toAmount = 0;
  if (rate > 0 && rawAmt > 0) {
    if (fromCur !== 'VND' && toCur === 'VND') {
      toAmount = Math.round(rawAmt * rate);
    } else if (fromCur === 'VND' && toCur !== 'VND') {
      toAmount = toCur === 'USD' ? Number((rawAmt / rate).toFixed(2)) : Math.round(rawAmt / rate);
    } else {
      toAmount = Math.round(rawAmt * rate);
    }
  }

  const resEl = document.getElementById('transferConvertedResult');
  if (resEl) {
    resEl.innerHTML = fmtMoney(toAmount, toCur);
  }
}

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
    if (store.selectedTransferFrom === store.selectedTransferTo) { toast('출금 계좌와 입금 계좌가 같습니다', 'error'); return; }
    const rawAmt = document.getElementById('transferAmount').dataset.raw || document.getElementById('transferAmount').value.replace(/,/g, '');
    if (!rawAmt || Number(rawAmt) <= 0) { toast('금액을 입력해주세요', 'error'); return; }

    const fromAcc = findAccount(store.selectedTransferFrom);
    const toAcc = findAccount(store.selectedTransferTo);
    const fromCur = fromAcc?.currency || 'VND';
    const toCur = toAcc?.currency || 'VND';

    let mainCat = '이체';
    let subCat = '';

    if (fromCur !== toCur) {
      const rateInput = document.getElementById('transferExchangeRate');
      const rateVal = parseFloat(rateInput?.value);
      if (!rateVal || rateVal <= 0) {
        toast('환율을 올바르게 입력해주세요', 'error');
        return;
      }
      const numRaw = Number(rawAmt);
      let toAmount = 0;
      if (fromCur !== 'VND' && toCur === 'VND') {
        toAmount = Math.round(numRaw * rateVal);
      } else if (fromCur === 'VND' && toCur !== 'VND') {
        toAmount = toCur === 'USD' ? Number((numRaw / rateVal).toFixed(2)) : Math.round(numRaw / rateVal);
      } else {
        toAmount = Math.round(numRaw * rateVal);
      }

      mainCat = '환전이체';
      // 💡 Appwrite subCategory 50자 제한 완벽 대응 (fromCur/toCur는 계좌에서 취득 가능하므로 환율과 입금액만 단축 저장)
      subCat = JSON.stringify({ r: rateVal, a: toAmount });
      if (subCat.length > 50) {
        subCat = JSON.stringify({ r: Number(rateVal.toFixed(4)), a: Math.round(toAmount) });
      }
    }

    data = {
      ...data,
      fromAccountId: store.selectedTransferFrom,
      toAccountId: store.selectedTransferTo,
      amount: Number(rawAmt),
      memo: document.getElementById('transferMemo').value,
      mainCategory: mainCat,
      subCategory: subCat,
      iconKey: 'transfer'
    };
  } else if (store.currentTxType === 'income') {
    if (!store.selectedTxAccountId) { toast('계좌를 선택해주세요', 'error'); return; }
    const rawAmt = document.getElementById('txAmount').dataset.raw || document.getElementById('txAmount').value.replace(/,/g, '');
    if (!rawAmt) { toast('금액을 입력해주세요', 'error'); return; }
    
    const incCat = document.getElementById('incomeCatSelect')?.value || '기타';
    const matchedInc = INCOME_CATEGORIES.find(c => c.name === incCat);
    const defaultIcon = matchedInc ? matchedInc.icon : 'income';

    data = {
      ...data,
      accountId: store.selectedTxAccountId,
      amount: Number(rawAmt),
      memo: document.getElementById('txMemo').value,
      mainCategory: incCat,
      subCategory: '',
      iconKey: store.selectedTxIcon || defaultIcon,
    };
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
      iconKey: store.selectedTxIcon || MAIN_CAT_ICONS[document.getElementById('mainCatSelect').value] || 'etc',
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
    state.transactions = (window.sortTransactions || sortTransactions)(state.transactions);
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

  let meta = parseTransferMeta(t);

  let catDisplay = `${t.mainCategory || ''}${t.subCategory ? ' > ' + t.subCategory : ''}`;
  if (t.type === 'transfer' && meta) {
    catDisplay = '환전이체';
  }

  let exchangeDetailHtml = '';
  if (meta) {
    exchangeDetailHtml = `
      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text2)">적용 환율</span><span>1 ${meta.fromCur} = ${meta.rate} ${meta.toCur}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text2)">입금 환산액</span><span style="font-weight:700;color:var(--accent);">${fmtMoney(meta.toAmount, meta.toCur)}</span></div>
    `;
  }

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
      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text2)">유형</span><span>${t.type==='expense'?'지출':t.type==='income'?'수입':(meta ? '환전이체' : '이체')}</span></div>
      ${catDisplay ? `<div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text2)">분류</span><span>${catDisplay}</span></div>` : ''}
      ${acc ? `<div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text2)">${t.type==='transfer'?'출금계좌':'계좌'}</span><span>${acc.name} (${acc.currency})</span></div>` : ''}
      ${toAcc ? `<div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text2)">입금계좌</span><span>${toAcc.name} (${toAcc.currency})</span></div>` : ''}
      ${exchangeDetailHtml}
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

  // 통화별 분리 집계 (수입: +, 지출: -, 계좌간 단순 이체는 순합계 제외)
  const totalsByCur = {};
  results.forEach(t => {
    if (t.type === 'transfer') return;
    const acc = findAccount(t.accountId || t.fromAccountId);
    const cur = acc?.currency || defaultCur;
    if (totalsByCur[cur] === undefined) totalsByCur[cur] = 0;
    const amt = Number(t.amount) || 0;
    if (t.type === 'expense') {
      totalsByCur[cur] -= amt;
    } else if (t.type === 'income') {
      totalsByCur[cur] += amt;
    }
  });

  const curKeys = Object.keys(totalsByCur);
  let totalHtml = '';
  if (curKeys.length === 0) {
    totalHtml = `<span style="font-weight:700;color:var(--text2);">${fmtMoney(0, defaultCur)}</span>`;
  } else {
    // 통화 정렬: VND 우선, KRW 차순, USD 차순, 그 외
    const orderMap = { 'VND': 1, 'KRW': 2, 'USD': 3, 'EUR': 4 };
    curKeys.sort((a, b) => (orderMap[a] || 99) - (orderMap[b] || 99) || a.localeCompare(b));

    totalHtml = curKeys.map(cur => {
      const tot = totalsByCur[cur];
      const color = tot > 0 ? 'var(--income)' : (tot < 0 ? 'var(--expense)' : 'var(--text2)');
      const signPrefix = tot > 0 ? '+' : '';
      return `<span style="font-weight:700;color:${color};white-space:nowrap;">${signPrefix}${fmtMoney(tot, cur)}</span>`;
    }).join(' <span style="color:var(--text3);margin:0 4px;font-weight:normal;">|</span> ');
  }

  el.innerHTML = `<div style="font-size:12px;color:var(--text2);margin:8px 0;padding:8px 0;border-bottom:1px solid var(--border);display:flex;flex-wrap:wrap;align-items:center;gap:4px;">
    <span>검색 결과: <strong>${results.length}</strong>건 / 합계:</span> ${totalHtml}
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
window.updateTransferExchangeUI = updateTransferExchangeUI;
window.updateTransferExchangeCalc = updateTransferExchangeCalc;
window.selectTxIcon = selectTxIcon;
window.saveTx = saveTx;
window.showTxDetail = showTxDetail;
window.deleteTx = deleteTx;
window.doSearch = doSearch;
window.renderTxItem = renderTxItem;
window.openAccountHistory = openAccountHistory;
window.renderAccountHistory = renderAccountHistory;

// ─────────────────────────────────────────────
// 계좌 상세 내역 조회
// ─────────────────────────────────────────────
export function openAccountHistory(accountId) {
  window.currentAccountHistoryId = accountId;
  const acc = findAccount(accountId);
  if (!acc) return;

  const titleEl = document.getElementById('accountHistoryTitle');
  const subEl = document.getElementById('accountHistorySub');
  const btnEdit = document.getElementById('btnEditAccountInHistory');

  if (titleEl) titleEl.textContent = `${acc.name} 내역`;
  if (subEl) {
    const bal = calcBalance(accountId) + (Number(acc.initialBalance) || 0);
    subEl.textContent = `현재 잔액: ${fmtMoney(bal, acc.currency || 'VND').replace(/<[^>]*>/g, '')}`;
  }
  
  if (btnEdit) {
    btnEdit.onclick = () => {
      closeModal('accountHistoryModal');
      if (window.openAccountModal) window.openAccountModal(accountId);
    };
  }

  renderAccountHistory(accountId);
  openModal('accountHistoryModal');
}

export function renderAccountHistory(accountId) {
  if (!accountId) accountId = window.currentAccountHistoryId;
  if (!accountId) return;
  window.currentAccountHistoryId = accountId;

  const el = document.getElementById('accountHistoryList');
  if (!el) return;
  el.dataset.accountId = accountId;

  // 해당 계좌와 관련된 모든 거래 필터링
  const results = state.transactions.filter(t => 
    t.accountId === accountId || 
    t.fromAccountId === accountId || 
    t.toAccountId === accountId
  ).sort((a, b) => b.date.localeCompare(a.date));

  if (!results.length) {
    el.innerHTML = '<div class="empty-state" style="padding:24px;"><p>거래 내역이 없습니다</p></div>';
    return;
  }

  el.innerHTML = results.map(t => renderTxItem(t, 'account')).join('');
}

// ─────────────────────────────────────────────
// 거래 내역 위치 변경 (순서 변경) 모드 - 100% 직관적인 원클릭 순서 변경
// ─────────────────────────────────────────────
window.txReorderMode = false;
window.txReorderContext = null;
window.txReorderPendingChanges = {};
window.currentAccountHistoryId = null;

window.toggleTxReorder = async function(context) {
  if (window.txReorderMode && window.txReorderContext === context) {
    window.txReorderMode = false;
    window.txReorderContext = null;
    
    const btn = document.getElementById(context === 'home' ? 'btnReorderHome' : 'btnReorderAccount');
    if (btn) btn.innerHTML = '↕️ 위치변경';

    const updates = Object.keys(window.txReorderPendingChanges);
    if (updates.length > 0) {
      if (typeof window.showLoading === 'function') window.showLoading(true);
      try {
        for (const id of updates) {
          const newDate = window.txReorderPendingChanges[id];
          await window.db.updateTransaction(id, { date: newDate });
          const idx = state.transactions.findIndex(t => t.$id === id);
          if (idx >= 0) state.transactions[idx].date = newDate;
        }
        if (typeof window.toast === 'function') window.toast('✅ 순서가 저장되었습니다.');
      } catch (e) {
        console.error(e);
        if (typeof window.toast === 'function') window.toast('❌ 저장 중 오류 발생', 'error');
      }
      window.txReorderPendingChanges = {};
      if (typeof window.showLoading === 'function') window.showLoading(false);
    }
  } else {
    window.txReorderMode = true;
    window.txReorderContext = context;
    window.txReorderPendingChanges = {};
    
    const btn = document.getElementById(context === 'home' ? 'btnReorderHome' : 'btnReorderAccount');
    if (btn) btn.innerHTML = '💾 저장';
    
    const txs = getTxListForContext(context);
    reassignGroupTimes(txs);
  }

  // 즉시 재렌더링
  refreshUI(context);
};

function refreshUI(context) {
  if (context === 'home') {
    if (window.renderTxList) window.renderTxList();
    else if (window.renderHome) window.renderHome();
  } else {
    if (window.renderAccountHistory) window.renderAccountHistory();
  }
}

function getTxListForContext(context) {
  const sortFn = window.sortTransactions || sortTransactions;
  if (context === 'home') {
    return sortFn(state.transactions.filter(t => t.date?.startsWith(state.currentMonth)));
  } else {
    const accId = window.currentAccountHistoryId;
    if (!accId) return [];
    return sortFn(state.transactions.filter(t => 
      t.accountId === accId || 
      t.fromAccountId === accId || 
      t.toAccountId === accId
    ));
  }
}

function reassignGroupTimes(txs) {
  const groups = {};
  txs.forEach(t => {
    const d = (t.date || '').slice(0, 10);
    if (!groups[d]) groups[d] = [];
    groups[d].push(t);
  });

  for (const d in groups) {
    const list = groups[d];
    let hour = 23;
    let min = 59;
    for (const t of list) {
      const newTimeStr = `${hour.toString().padStart(2,'0')}:${min.toString().padStart(2,'0')}:00`;
      const fullDate = `${d}T${newTimeStr}`;
      if (t.date !== fullDate) {
        t.date = fullDate;
        window.txReorderPendingChanges[t.$id] = fullDate;
      }
      min--;
      if (min < 0) { min = 59; hour--; }
      if (hour < 0) hour = 0;
    }
  }
}

window.moveTxUp = function(txId, context) {
  const txs = getTxListForContext(context);
  const idx = txs.findIndex(t => t.$id === txId);
  if (idx <= 0) return;

  const currentTx = txs[idx];
  const targetTx = txs[idx - 1];

  const targetDateStr = (targetTx.date || '').slice(0, 10);
  const currentDateStr = (currentTx.date || '').slice(0, 10);

  txs.splice(idx, 1);
  txs.splice(idx - 1, 0, currentTx);

  if (currentDateStr !== targetDateStr) {
    const timePart = (currentTx.date || '').slice(10) || 'T12:00:00';
    currentTx.date = targetDateStr + (timePart.startsWith('T') ? timePart : 'T' + timePart);
  }

  reassignGroupTimes(txs);
  refreshUI(context);
};

window.moveTxDown = function(txId, context) {
  const txs = getTxListForContext(context);
  const idx = txs.findIndex(t => t.$id === txId);
  if (idx < 0 || idx >= txs.length - 1) return;

  const currentTx = txs[idx];
  const targetTx = txs[idx + 1];

  const targetDateStr = (targetTx.date || '').slice(0, 10);
  const currentDateStr = (currentTx.date || '').slice(0, 10);

  txs.splice(idx, 1);
  txs.splice(idx + 1, 0, currentTx);

  if (currentDateStr !== targetDateStr) {
    const timePart = (currentTx.date || '').slice(10) || 'T12:00:00';
    currentTx.date = targetDateStr + (timePart.startsWith('T') ? timePart : 'T' + timePart);
  }

  reassignGroupTimes(txs);
  refreshUI(context);
};

// ─────────────────────────────────────────────
// 포인터 기반 드래그 앤 드롭 (마우스/터치 완벽 지원 & 텍스트 드래그 방지)
// ─────────────────────────────────────────────
window.dragState = null;

window.txPointerDown = function(e, id, context) {
  if (!window.txReorderMode) return;
  e.stopPropagation();

  const handleEl = e.currentTarget;
  const itemEl = handleEl.closest('.tx-item');
  if (!itemEl) return;
  
  window.dragState = {
    pointerId: e.pointerId,
    sourceId: id,
    context: context,
    itemEl: itemEl,
    handleEl: handleEl,
    startY: e.clientY,
    isDragging: false,
    lastOverEl: null
  };

  try {
    handleEl.setPointerCapture(e.pointerId);
  } catch(err) {}

  handleEl.onpointermove = window.txPointerMove;
  handleEl.onpointerup = window.txPointerUp;
  handleEl.onpointercancel = window.txPointerUp;
};

window.txPointerMove = function(e) {
  const s = window.dragState;
  if (!s) return;

  if (!s.isDragging && Math.abs(e.clientY - s.startY) > 3) {
    s.isDragging = true;
    s.itemEl.classList.add('tx-dragging');
    s.handleEl.style.cursor = 'grabbing';
  }

  if (!s.isDragging) return;

  s.itemEl.style.pointerEvents = 'none';
  const target = document.elementFromPoint(e.clientX, e.clientY);
  s.itemEl.style.pointerEvents = '';

  if (s.lastOverEl && s.lastOverEl !== target) {
    s.lastOverEl.classList.remove('tx-drop-target');
  }

  const overItem = target?.closest('.tx-item');
  const overGroup = target?.closest('.tx-date-group');

  if (overItem && overItem !== s.itemEl) {
    overItem.classList.add('tx-drop-target');
    s.lastOverEl = overItem;
  } else if (overGroup) {
    overGroup.classList.add('tx-drop-target');
    s.lastOverEl = overGroup;
  }
};

window.txPointerUp = function(e) {
  const s = window.dragState;
  if (!s) return;

  s.handleEl.onpointermove = null;
  s.handleEl.onpointerup = null;
  s.handleEl.onpointercancel = null;
  s.handleEl.style.cursor = 'grab';
  s.itemEl.classList.remove('tx-dragging');

  if (s.lastOverEl) {
    s.lastOverEl.classList.remove('tx-drop-target');
  }

  if (s.isDragging) {
    s.itemEl.style.pointerEvents = 'none';
    const dropTarget = document.elementFromPoint(e.clientX, e.clientY);
    s.itemEl.style.pointerEvents = '';

    const targetItemEl = dropTarget?.closest('.tx-item');
    const targetGroupEl = dropTarget?.closest('.tx-date-group');

    let targetId = targetItemEl?.dataset?.id || null;
    let targetDate = targetGroupEl?.dataset?.date || null;

    if (targetItemEl && !targetDate) {
      const parentGroup = targetItemEl.closest('.tx-date-group');
      if (parentGroup) targetDate = parentGroup.dataset.date;
    }

    if (targetId || targetDate) {
      window.processTxDrop(s.sourceId, targetId, targetDate, s.context);
    }
  }

  window.dragState = null;
};

window.processTxDrop = function(sourceId, targetId, targetDate, context) {
  if (!sourceId) return;

  const sourceTx = window.state.transactions.find(t => t.$id === sourceId);
  if (!sourceTx) return;

  let newDateStr = targetDate;
  if (!newDateStr && targetId) {
    const targetTx = window.state.transactions.find(t => t.$id === targetId);
    if (targetTx) newDateStr = (targetTx.date || '').slice(0, 10);
  }

  if (!newDateStr) {
    newDateStr = (sourceTx.date || '').slice(0, 10);
  }

  let txs = [];
  if (context === 'home') {
    txs = window.state.transactions.filter(t => t.date?.startsWith(window.state.currentMonth))
      .sort((a, b) => b.date.localeCompare(a.date));
  } else {
    const el = document.getElementById('accountHistoryList');
    if (!el || !el.dataset.accountId) return;
    const accId = el.dataset.accountId;
    txs = window.state.transactions.filter(t => 
      t.accountId === accId || 
      t.fromAccountId === accId || 
      t.toAccountId === accId
    ).sort((a, b) => b.date.localeCompare(a.date));
  }

  if (sourceId === targetId && (sourceTx.date || '').slice(0, 10) === newDateStr) return;

  const oldIdx = txs.findIndex(t => t.$id === sourceId);
  if (oldIdx >= 0) txs.splice(oldIdx, 1);

  const currentTimePart = (sourceTx.date || '').slice(10) || 'T12:00:00';
  sourceTx.date = newDateStr + (currentTimePart.startsWith('T') ? currentTimePart : 'T' + currentTimePart);

  if (targetId) {
    const targetIdx = txs.findIndex(t => t.$id === targetId);
    if (targetIdx >= 0) {
      txs.splice(targetIdx, 0, sourceTx);
    } else {
      txs.push(sourceTx);
    }
  } else {
    const groupIdx = txs.findIndex(t => (t.date || '').slice(0, 10) === newDateStr);
    if (groupIdx >= 0) {
      txs.splice(groupIdx, 0, sourceTx);
    } else {
      txs.unshift(sourceTx);
    }
  }

  reassignGroupTimes(txs);

  if (context === 'home') {
    if (window.renderHome) window.renderHome();
  } else {
    const el = document.getElementById('accountHistoryList');
    if (el && el.dataset.accountId) window.renderAccountHistory(el.dataset.accountId);
  }
};

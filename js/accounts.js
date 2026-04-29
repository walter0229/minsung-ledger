import { state, toast, showLoading, iconImg } from './utils.js';
import { db } from './db.js';
import { store } from './store.js';

export function openAccountModal(accId = null) {
  document.getElementById('editAccountId').value = accId || '';
  if (!accId) {
    document.getElementById('accountModalTitle').textContent = '계좌 추가';
    document.getElementById('accountName').value = '';
    document.getElementById('accountType').value = 'bank';
    document.getElementById('accountCurrency').value = 'VND';
    document.getElementById('accountOrder').value = '0';
    document.getElementById('accountBalance').value = '';
    store.selectedCurrencyIcon = 'vnd';
    store.selectedBankIcon = null;
  } else {
    document.getElementById('accountModalTitle').textContent = '계좌 수정';
    const a = state.accounts.find(x => x.$id === accId);
    if (a) {
      document.getElementById('accountName').value = a.name || '';
      document.getElementById('accountType').value = a.type || 'bank';
      document.getElementById('accountCurrency').value = a.currency || 'VND';
      document.getElementById('accountBalance').value = (Number(a.initialBalance) || 0).toLocaleString();
      document.getElementById('accountBalance').dataset.raw = a.initialBalance || 0;
      document.getElementById('accountOrder').value = a.order || 0;
      store.selectedCurrencyIcon = a.currencyIcon || 'vnd';
      store.selectedBankIcon = a.bankIcon || null;
    }
  }
  
  const btnDel = document.getElementById('btnDeleteAccount');
  if (btnDel) btnDel.style.display = accId ? 'block' : 'none';

  if (window.renderCurrencyIconGrid) window.renderCurrencyIconGrid();
  if (window.renderBankIconGrid) window.renderBankIconGrid();
  if (window.openModal) window.openModal('accountModal');
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
      await db.updateAccount(editId, data);
      const idx = state.accounts.findIndex(a => a.$id === editId);
      if (idx >= 0) state.accounts[idx] = { ...state.accounts[idx], ...data };
      toast('✅ 수정됐어요!');
    } else {
      const saved = await db.createAccount(data);
      state.accounts.push(saved);
      toast('✅ 계좌가 추가됐어요!');
    }
    if (window.closeModal) window.closeModal('accountModal');
    if (window.renderHome) window.renderHome();
    if (window.renderSettings) window.renderSettings();
    if (state.currentTab === 'accounts' && window.renderAccountsList) window.renderAccountsList();
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
    if (window.renderHome) window.renderHome();
    if (window.renderSettings) window.renderSettings();
    if (state.currentTab === 'accounts' && window.renderAccountsList) window.renderAccountsList();
  } catch(e) { toast('❌ ' + e.message, 'error'); }
  showLoading(false);
}

window.openAccountModal = openAccountModal;
window.saveAccount = saveAccount;
window.deleteAccount = deleteAccount;
window.executeDeleteAccount = function() {
  const id = document.getElementById('editAccountId').value;
  if(id) {
    deleteAccount(id);
    if(window.closeModal) window.closeModal('accountModal');
  }
};
window.updateAccountIcons = function() {
  const cur = document.getElementById('accountCurrency').value.toLowerCase();
  const map = {vnd:'vnd',krw:'krw',usd:'usd',cny:'cny',cad:'cad',php:'php',thb:'thb',mvr:'mvr'};
  if (map[cur]) { store.selectedCurrencyIcon = map[cur]; window.renderCurrencyIconGrid(); }
};

window.renderCurrencyIconGrid = function() {
  const el = document.getElementById('currencyIconGrid');
  if(!el) return;
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
  if(!el) return;
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

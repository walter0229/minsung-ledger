import { db } from './db.js';
import { state, toast, showLoading, parseReceipt } from './utils.js';
import { store } from './store.js';
import { APP_VERSION, CATEGORIES, MAIN_CAT_ICONS, ICONS } from './config.js';

// =============================================
// 민성이의 가계부 - 공통 UI 제어
// =============================================

// 브릿지 연결
window.__showPage = showPage;
window.__openModal = openModal;
window.__closeModal = closeModal;

export function initUI() {
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

export function checkDbStatus() {
  const el = document.getElementById('diagnosticBoard');
  if (el) {
    const statusText = db.online ? '✅ 서버 연결됨' : '❌ 오프라인 모드';
    const logText = db.errorLog.length > 0 ? db.errorLog.join('<br>') : '기록된 에러가 없습니다.';
    el.innerHTML = `<div style="color:${db.online ? '#4ade80' : '#f87171'}; font-weight:700; margin-bottom:8px;">상태: ${statusText}</div>${logText}`;
  }
}

export function renderDiagnostics() {
  checkDbStatus();
}

// ─────────────────────────────────────────────
// 페이지 네비게이션
// ─────────────────────────────────────────────
export function showPage(name) {
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
export function openCamera() {
  document.getElementById('cameraInput').click();
}

export async function handleCameraInput(input) {
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
export function renderThemeGrid() {
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

export function applyThemePreset(name) {
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
export function openModal(id) { document.getElementById(id)?.classList.add('open'); }
export function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
export function closeModalOnBg(e, id) { if (e.target === e.currentTarget) closeModal(id); }

export function toggleDarkMode() {
  const dark = document.getElementById('darkModeToggle').checked;
  window.applyThemePreset(dark ? 'dark' : 'light');
}

export function toggleReminder() {
  const enabled = document.getElementById('reminderToggle').checked;
  state.settings.reminderEnabled = enabled;
  window.saveApiSettings();
}

export function saveReminderTime() {
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

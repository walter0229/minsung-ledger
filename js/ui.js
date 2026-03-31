import { db } from './db.js';
import { state, toast, showLoading, parseReceipt } from './utils.js';
import { store } from './store.js';

// =============================================
// 민성이의 가계부 - 공통 UI 제어
// =============================================

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

  // 카메라 FAB 표시
  const fab = document.getElementById('fabCamera');
  if (fab) fab.classList.add('visible');
}

export function checkDbStatus() {
  const el = document.getElementById('dbStatus');
  if (el) el.textContent = db.online ? '✅ Appwrite 연결됨 (동기화완료)' : '⚠️ 오프라인 모드';
  if (el) el.style.color = db.online ? 'var(--income)' : 'var(--yellow)';
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
      if (data) {
        if(window.openAddModal) window.openAddModal();
        if (data.date) document.getElementById('txDate').value = data.date;
        if (data.amount) {
          document.getElementById('txAmount').value = Number(data.amount).toLocaleString();
          document.getElementById('txAmount').dataset.raw = String(data.amount);
        }
        if (data.merchant) document.getElementById('txMemo').value = data.merchant;
        toast('✅ 영수증 분석 완료!', 'success');
      } else {
        toast('⚠️ 영수증 인식 실패. 직접 입력해주세요', 'error');
        if(window.openAddModal) window.openAddModal();
      }
    } catch(err) {
      toast('❌ ' + err.message, 'error');
      if(window.openAddModal) window.openAddModal();
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

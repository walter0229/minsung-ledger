// =============================================
// 민성이의 가계부 - 메인 앱 로직
// =============================================

let currentTxType = 'expense';
let selectedTxAccountId = null;
let selectedTxIcon = null;
let selectedTransferFrom = null;
let selectedTransferTo = null;
let selectedCurrencyIcon = null;
let selectedBankIcon = null;
let editingTxId = null;
let statsPeriod = 'monthly';
let statsType = 'expense';
let reportPeriod = 'monthly';
let donutChart = null, usageChart = null, progressChart = null, assetChart = null;

// ─────────────────────────────────────────────
// 초기화
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadAll();
  initUI();
  renderHome();
  renderCalendar();
  setSearchDates();
  setTimeout(() => {
    checkDbStatus();
    // 계좌 데이터 미리 캐시
    if (state.accounts.length === 0) {
      db.listAccounts().then(accs => { state.accounts = accs; });
    }
  }, 1500);
});

function initUI() {
  document.getElementById('txDate').value = todayStr();
  document.getElementById('budgetMonth').value = state.currentMonth;

  // 메인 카테고리 옵션
  const sel = document.getElementById('mainCatSelect');
  Object.keys(CATEGORIES).forEach(k => {
    const o = document.createElement('option');
    o.value = k; o.textContent = k;
    sel.appendChild(o);
  });

  // 아이콘 그리드 채우기
  renderTxIconGrid();
  renderCurrencyIconGrid();
  renderBankIconGrid();
  renderThemeGrid();

  // 설정 값 불러오기
  if (!state.settings.geminiApiKey) state.settings.geminiApiKey = 'AIzaSyAsRp-sMxPJKwG-0hV-aBYxc7u_TLODr-4';
  document.getElementById('geminiKeyInput').value = state.settings.geminiApiKey;
  const dark = (state.settings.theme || 'dark') === 'dark';
  document.getElementById('darkModeToggle').checked = dark;
  const reminderToggle = document.getElementById('reminderToggle');
  if (reminderToggle && state.settings.reminderEnabled) reminderToggle.checked = true;
  const reminderTimeEl = document.getElementById('reminderTime');
  if (reminderTimeEl && state.settings.reminderTime) reminderTimeEl.value = state.settings.reminderTime;

  // FAB 드래그 기능 초기화
  initFabDrag();
}

function initFabDrag() {
  const fab = document.getElementById('fabBtn');
  if (!fab) return;
  let isDragging = false, startX, startY, initX, initY;
  let moved = false;

  // 초기 위치 설정
  fab.style.position = 'fixed';
  fab.style.bottom = '80px';
  fab.style.right = '16px';
  fab.style.left = 'auto';
  fab.style.top = 'auto';
  fab.style.zIndex = '300';
  fab.style.background = 'linear-gradient(135deg, #7c6af7 0%, #f472b6 50%, #fb923c 100%)';
  fab.style.boxShadow = '0 6px 24px rgba(124,106,247,0.6)';

  const onStart = (e) => {
    isDragging = true; moved = false;
    const touch = e.touches ? e.touches[0] : e;
    startX = touch.clientX; startY = touch.clientY;
    const rect = fab.getBoundingClientRect();
    initX = rect.left; initY = rect.top;
    fab.style.transition = 'none';
    e.preventDefault();
  };
  const onMove = (e) => {
    if (!isDragging) return;
    const touch = e.touches ? e.touches[0] : e;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
    const newLeft = Math.max(10, Math.min(window.innerWidth - 66, initX + dx));
    const newTop = Math.max(10, Math.min(window.innerHeight - 126, initY + dy));
    fab.style.left = newLeft + 'px';
    fab.style.top = newTop + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
    e.preventDefault();
  };
  const onEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    fab.style.transition = 'box-shadow 0.2s';
    if (!moved) openAddModal();
  };

  fab.addEventListener('mousedown', onStart);
  fab.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchend', onEnd);
}

function checkDbStatus() {
  const el = document.getElementById('dbStatus');
  if (el) el.textContent = db.online ? '✅ Appwrite 연결됨' : '⚠️ 로컬 모드';
  if (el) el.style.color = db.online ? 'var(--income)' : 'var(--yellow)';
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

  if (name === 'home') renderHome();
  if (name === 'calendar') renderCalendar();
  if (name === 'stats') renderStats();
  if (name === 'report') renderReport();
  if (name === 'accounts') renderAccountsPage();
  if (name === 'settings') renderSettings();
}

function prevMonth() {
  const [y, m] = state.currentMonth.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  state.currentMonth = monthStr(d);
  renderHome();
}
function nextMonth() {
  const [y, m] = state.currentMonth.split('-').map(Number);
  const d = new Date(y, m, 1);
  state.currentMonth = monthStr(d);
  renderHome();
}

// ─────────────────────────────────────────────
// 홈 렌더
// ─────────────────────────────────────────────
function renderHome() {
  const [y, m] = state.currentMonth.split('-').map(Number);
  const label = `${y}년 ${m}월`;
  document.getElementById('homeMonthLabel').textContent = label;

  const { income, expense, balance } = getMonthSummary(state.currentMonth);
  const defaultCur = state.accounts[0]?.currency || 'VND';

  const balEl = document.getElementById('homeTotalBalance');
  balEl.textContent = fmtMoney(balance, defaultCur);
  balEl.className = 'balance ' + (balance >= 0 ? 'positive' : 'negative');
  document.getElementById('homeIncome').textContent = fmtMoney(income, defaultCur);
  document.getElementById('homeExpense').textContent = fmtMoney(expense, defaultCur);

  renderTxList();
  renderBudgetAlerts();
}

function renderAccountsList() {
  const el = document.getElementById('accountsList');
  if (!state.accounts.length) {
    el.innerHTML = '<div style="padding:16px;color:var(--text3);font-size:13px;">계좌를 추가해주세요</div>';
    return;
  }
  // 가로 스크롤 대신 그리드로 전체 표시
  el.style.display = 'grid';
  el.style.gridTemplateColumns = 'repeat(2, 1fr)';
  el.style.gap = '10px';
  el.style.padding = '0 16px';
  el.style.overflowX = 'unset';

  el.innerHTML = state.accounts.map(a => {
    const isLoan = a.type === 'loan';
    const bal = isLoan ? calcBalance(a.$id) : calcBalance(a.$id) + (Number(a.initialBalance) || 0);
    const cur = a.currency || 'VND';
    const bankIcon = a.bankIcon ? `<img src="${ICONS[a.bankIcon]||''}" width="20" height="20" style="border-radius:4px;object-fit:contain;">` : '';
    const curIcon = a.currencyIcon ? `<img src="${ICONS[a.currencyIcon]||''}" width="16" height="16" style="object-fit:contain;">` : '';
    return `<div class="account-card" onclick="openAccountModal('${a.$id}')" style="cursor:pointer;min-width:unset;transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:4px;">
          ${bankIcon}
          <span class="name" style="font-size:13px;">${a.name}</span>
        </div>
        <span style="font-size:10px;color:var(--text3);">✏️</span>
      </div>
      <div style="display:flex;align-items:center;gap:4px;">
        ${curIcon}
        <div class="bal ${bal >= 0 ? 'positive' : 'negative'}" style="font-size:14px;">${fmtMoney(bal, cur)}</div>
      </div>
    </div>`;
  }).join('');
}

function renderTxList() {
  const el = document.getElementById('txList');
  const txs = state.transactions.filter(t => {
    if (!t.date) return false;
    // ISO 형식(2026-03-31T...) 또는 단순 날짜(2026-03-31) 모두 처리
    const dateStr = t.date.slice(0, 7); // YYYY-MM
    return dateStr === state.currentMonth;
  }).sort((a, b) => (b.date||'').localeCompare(a.date||''));

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

function renderTxItem(t) {
  const iconKey = t.iconKey || (t.type === 'income' ? 'income' : t.type === 'transfer' ? 'transfer' : 'etc');
  const acc = findAccount(t.accountId || t.fromAccountId);
  const cur = acc?.currency || 'VND';
  const sign = t.type === 'income' ? '+' : t.type === 'transfer' ? '↔' : '-';
  const cls = t.type;
  return `<div class="tx-item" onclick="showTxDetail('${t.$id}')">
    <div class="tx-icon">${iconImg(iconKey, 28)}</div>
    <div class="tx-info">
      <div class="tx-name">${t.memo || t.subCategory || t.mainCategory || '내역 없음'}</div>
      <div class="tx-cat">${t.mainCategory || ''} ${t.subCategory ? '> ' + t.subCategory : ''}</div>
    </div>
    <div class="tx-amount ${cls}">${sign}${fmtMoney(t.amount, cur)}</div>
  </div>`;
}

function renderBudgetAlerts() {
  const el = document.getElementById('budgetAlerts');
  const status = getBudgetStatus(state.currentMonth);
  const over = status.filter(b => Number(b.percent) > 100);
  if (!over.length) { el.innerHTML = ''; return; }
  el.innerHTML = over.map(b => `
    <div style="background:rgba(239,68,68,0.1);border:1px solid var(--red);border-radius:10px;padding:8px 12px;margin-bottom:6px;font-size:12px;color:var(--expense);">
      ⚠️ <strong>${b.category}</strong> 예산 초과! (${b.percent}% 사용)
    </div>`).join('');
}

// ─────────────────────────────────────────────
// 달력 렌더
// ─────────────────────────────────────────────
function renderCalendar() {
  const d = state.calendarDate;
  const year = d.getFullYear(), month = d.getMonth();
  document.getElementById('calTitle').textContent = `${year}년 ${month + 1}월`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = getDaysInMonth(year, month);
  const today = new Date();
  const ym = `${year}-${String(month + 1).padStart(2, '0')}`;

  const txs = state.transactions.filter(t => t.date?.startsWith(ym));

  const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
  let html = dayLabels.map(l => `<div class="cal-day-label">${l}</div>`).join('');

  for (let i = 0; i < firstDay; i++) html += '<div></div>';

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${ym}-${String(day).padStart(2, '0')}`;
    const dayTxs = txs.filter(t => t.date?.slice(0, 10) === dateStr);
    const inc = dayTxs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const exp = dayTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

    let dots = '';
    if (inc > 0) dots += '<div class="cal-dot income"></div>';
    if (exp > 0) dots += '<div class="cal-dot expense"></div>';

    let balHtml = '';
    if (inc > 0 || exp > 0) {
      const bal = inc - exp;
      balHtml = `<div class="cal-bal ${bal >= 0 ? 'positive' : 'negative'}">${bal >= 0 ? '+' : '-'}</div>`;
    }

    html += `<div class="cal-cell ${isToday ? 'today' : ''}" onclick="showCalDetail('${dateStr}')">
      <div class="cal-num">${day}</div>
      <div class="cal-dot-row">${dots}</div>
      ${balHtml}
    </div>`;
  }

  document.getElementById('calGrid').innerHTML = html;
}

function calPrevMonth() {
  const d = state.calendarDate;
  state.calendarDate = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  renderCalendar();
}
function calNextMonth() {
  const d = state.calendarDate;
  state.calendarDate = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  renderCalendar();
}

function showCalDetail(dateStr) {
  const detailEl = document.getElementById('calDetail');
  const txs = state.transactions.filter(t => t.date?.slice(0, 10) === dateStr);
  detailEl.style.display = 'block';

  if (!txs.length) {
    detailEl.innerHTML = `<div class="cal-detail-date">${fmtDate(dateStr)}</div><div class="cal-detail-empty">이날 거래 내역이 없습니다</div>`;
    return;
  }

  const items = txs.map(t => renderTxItem(t)).join('');
  detailEl.innerHTML = `<div class="cal-detail-date">${fmtDate(dateStr)}</div>${items}`;
}

// ─────────────────────────────────────────────
// 통계 렌더
// ─────────────────────────────────────────────
function setStatsPeriod(p, btn) {
  statsPeriod = p;
  btn.closest('.period-tabs').querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderStats();
}
function setStatsType(t, btn) {
  statsType = t;
  document.getElementById('statsExpenseTab').classList.toggle('active', t === 'expense');
  document.getElementById('statsIncomeTab').classList.toggle('active', t === 'income');
  renderStats();
}

function getStatsTxs() {
  const now = new Date();
  if (statsPeriod === 'monthly') return state.transactions.filter(t => t.date?.startsWith(state.currentMonth) && t.type === statsType);
  if (statsPeriod === 'yearly') return state.transactions.filter(t => t.date?.startsWith(String(now.getFullYear())) && t.type === statsType);
  // weekly
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - (now.getDay() || 7) + 1);
  const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 6);
  return state.transactions.filter(t => {
    const d = new Date(t.date);
    return d >= startOfWeek && d <= endOfWeek && t.type === statsType;
  });
}

function renderStats() {
  const txs = getStatsTxs();
  const stats = getCategoryStats(txs.filter(t => t.type === 'expense'));
  const incomeTxs = txs.filter(t => t.type === 'income');
  const total = txs.reduce((s, t) => s + Number(t.amount), 0);
  const defaultCur = state.accounts[0]?.currency || 'VND';

  document.getElementById('donutTotal').textContent = fmtMoney(total, defaultCur);
  document.getElementById('donutLabel').textContent = statsType === 'expense' ? '지출 합계' : '수입 합계';

  const statData = statsType === 'expense' ? stats : Object.entries(
    incomeTxs.reduce((m, t) => { m[t.mainCategory || '수입'] = (m[t.mainCategory || '수입'] || 0) + Number(t.amount); return m; }, {})
  );

  const colors = ['#7c6af7','#f87171','#34d399','#fbbf24','#60a5fa','#a78bfa','#fb923c','#4ade80','#f472b6','#38bdf8','#facc15','#818cf8'];
  const labels = statData.map(([k]) => k);
  const values = statData.map(([, v]) => v);

  if (donutChart) donutChart.destroy();
  const ctx = document.getElementById('donutChart').getContext('2d');
  donutChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors.slice(0, values.length), borderWidth: 0, hoverOffset: 8 }]
    },
    options: {
      cutout: '70%', plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => ` ${ctx.label}: ${fmtMoney(ctx.raw, defaultCur)}` }
      }},
      animation: { animateScale: true }
    }
  });

  // 범례
  document.getElementById('statsLegend').innerHTML = statData.map(([cat, amt], i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${colors[i % colors.length]}"></div>
      <div class="legend-name">${cat}</div>
      <div class="legend-pct">${total > 0 ? (amt/total*100).toFixed(1) : 0}%</div>
      <div class="legend-amount">${fmtMoney(amt, defaultCur)}</div>
    </div>`).join('');

  // 예산 바
  renderBudgetBars();
}

function renderBudgetBars() {
  const el = document.getElementById('budgetBars');
  const status = getBudgetStatus(state.currentMonth);
  if (!status.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:13px;text-align:center;padding:16px;">예산을 설정해주세요</div>';
    return;
  }
  const defaultCur = state.accounts[0]?.currency || 'VND';
  el.innerHTML = status.map(b => {
    const pct = Math.min(Number(b.percent), 100);
    const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
    return `<div class="budget-bar-wrap">
      <div class="budget-bar-label">
        <span>${b.category}</span>
        <span style="color:var(--text2)">${fmtMoney(b.used, defaultCur)} / ${fmtMoney(b.amount, defaultCur)} (${b.percent}%)</span>
      </div>
      <div class="budget-bar-bg"><div class="budget-bar-fill ${cls}" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
// 보고서 렌더
// ─────────────────────────────────────────────
function setReportPeriod(p, btn) {
  reportPeriod = p;
  btn.closest('.period-tabs').querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderReport();
}

function renderReport() {
  renderAnalysisCharts();
  renderAssetChart();
}

function renderAnalysisCharts() {
  const status = getBudgetStatus(state.currentMonth);
  const defaultCur = state.accounts[0]?.currency || 'VND';
  const labels = status.map(b => b.category);
  const used = status.map(b => Number(b.used));
  const budget = status.map(b => Number(b.amount));
  const timeProgress = getTimeProgress(reportPeriod === 'monthly' ? 'monthly' : reportPeriod === 'weekly' ? 'weekly' : 'yearly');

  // 사용률 차트
  if (usageChart) usageChart.destroy();
  const ctx1 = document.getElementById('usageChart').getContext('2d');
  usageChart = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: '예산', data: budget, backgroundColor: 'rgba(124,106,247,0.2)', borderColor: 'rgba(124,106,247,0.6)', borderWidth: 1 },
        { label: '사용', data: used, backgroundColor: used.map((u, i) => u > budget[i] ? 'rgba(248,113,113,0.7)' : 'rgba(52,211,153,0.7)'), borderWidth: 0 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#9090b0', font: { size: 11 } } } }, scales: { x: { ticks: { color: '#9090b0', font: { size: 10 } }, grid: { color: '#2e2e3e' } }, y: { ticks: { color: '#9090b0', font: { size: 10 } }, grid: { color: '#2e2e3e' } } } }
  });

  // 시간 경과율 차트
  if (progressChart) progressChart.destroy();
  const ctx2 = document.getElementById('progressChart').getContext('2d');
  const now = new Date();
  const totalBudget = budget.reduce((s, v) => s + v, 0);
  const totalUsed = used.reduce((s, v) => s + v, 0);
  const usagePct = totalBudget > 0 ? (totalUsed / totalBudget * 100) : 0;

  progressChart = new Chart(ctx2, {
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

function renderAssetChart() {
  if (assetChart) assetChart.destroy();
  const ctx = document.getElementById('assetChart').getContext('2d');
  const now = new Date();
  let labels = [], data = [];

  if (reportPeriod === 'monthly') {
    for (let d = 1; d <= getDaysInMonth(now.getFullYear(), now.getMonth()); d++) {
      const dateStr = `${state.currentMonth}-${String(d).padStart(2, '0')}`;
      labels.push(d + '일');
      const txsUntil = state.transactions.filter(t => t.date?.slice(0, 10) <= dateStr);
      const inc = txsUntil.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
      const exp = txsUntil.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
      const initBal = state.accounts.reduce((s, a) => s + (Number(a.initialBalance) || 0), 0);
      data.push(initBal + inc - exp);
    }
  } else if (reportPeriod === 'yearly') {
    for (let m = 1; m <= 12; m++) {
      const ym = `${now.getFullYear()}-${String(m).padStart(2, '0')}`;
      labels.push(m + '월');
      const txsUntil = state.transactions.filter(t => t.date?.startsWith(String(now.getFullYear())) && t.date?.slice(0, 7) <= ym);
      const inc = txsUntil.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
      const exp = txsUntil.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
      const initBal = state.accounts.reduce((s, a) => s + (Number(a.initialBalance) || 0), 0);
      data.push(initBal + inc - exp);
    }
  } else {
    // weekly - 7일
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - (now.getDay() || 7) + 1);
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek); d.setDate(startOfWeek.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      labels.push(['월','화','수','목','금','토','일'][i]);
      const txsUntil = state.transactions.filter(t => t.date?.slice(0, 10) <= dateStr);
      const inc = txsUntil.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
      const exp = txsUntil.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
      const initBal = state.accounts.reduce((s, a) => s + (Number(a.initialBalance) || 0), 0);
      data.push(initBal + inc - exp);
    }
  }

  assetChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '자산',
        data,
        borderColor: '#7c6af7',
        backgroundColor: 'rgba(124,106,247,0.1)',
        fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#7c6af7'
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#9090b0', font: { size: 10 } }, grid: { color: '#2e2e3e' } },
        y: { ticks: { color: '#9090b0', font: { size: 10 } }, grid: { color: '#2e2e3e' } }
      }
    }
  });
}

// ─────────────────────────────────────────────
// 검색
// ─────────────────────────────────────────────
function setSearchDates() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  document.getElementById('searchFrom').value = firstDay;
  document.getElementById('searchTo').value = todayStr();
}

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
    const sign = t.type === 'income' ? '+' : t.type === 'transfer' ? '↔' : '-';
    const acc = findAccount(t.accountId || t.fromAccountId);
    const cur = acc?.currency || defaultCur;
    return `<div class="report-tx-item" onclick="showTxDetail('${t.$id}')">
      <div class="report-tx-date">${fmtDate(t.date?.slice(0,10))}</div>
      <div class="report-tx-name">${t.memo || t.subCategory || t.mainCategory || '-'}</div>
      <div class="report-tx-amount" style="color:${t.type==='income'?'var(--income)':t.type==='transfer'?'var(--transfer)':'var(--expense)'}">${sign}${fmtMoney(t.amount, cur)}</div>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
// AI 금융 비서
// ─────────────────────────────────────────────
async function sendAiMsg() {
  const input = document.getElementById('aiInput');
  const msg = input.value.trim();
  if (!msg) return;

  const msgEl = document.getElementById('aiMsg');
  msgEl.textContent = '🤔 분석 중...';
  input.value = '';

  try {
    const { income, expense } = getMonthSummary(state.currentMonth);
    const catStats = getCategoryStats(state.transactions.filter(t => t.date?.startsWith(state.currentMonth)));
    const topCats = catStats.slice(0, 5).map(([k, v]) => `${k}: ${v.toLocaleString()}`).join(', ');
    const budgetStatus = getBudgetStatus(state.currentMonth);
    const overBudget = budgetStatus.filter(b => Number(b.percent) > 100).map(b => b.category).join(', ');

    const context = `
당신은 한국어를 사용하는 친근한 AI 금융 비서입니다. 
현재 데이터:
- 이번달 수입: ${income.toLocaleString()}
- 이번달 지출: ${expense.toLocaleString()}
- 잔액: ${(income - expense).toLocaleString()}
- 상위 지출 카테고리: ${topCats || '없음'}
- 예산 초과 항목: ${overBudget || '없음'}
- 총 계좌 수: ${state.accounts.length}개

사용자 질문: ${msg}

짧고 실용적인 조언을 3-5문장으로 해주세요.`;

    const reply = await callGemini(context);
    msgEl.textContent = reply;
  } catch (e) {
    msgEl.textContent = '❌ ' + e.message + '\n\n설정에서 Gemini API Key를 확인해주세요.';
  }
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
  const mimeType = file.type || 'image/jpeg';
  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    const base64 = dataUrl.split(',')[1];
    toast('📸 영수증 분석 중... 잠시 기다려주세요!', 'info');
    try {
      const data = await parseReceipt(base64, mimeType);
      openAddModal();
      await new Promise(r => setTimeout(r, 300)); // 모달 열리길 기다림
      if (data) {
        if (data.date) document.getElementById('txDate').value = data.date;
        if (data.amount) {
          const amt = Number(String(data.amount).replace(/[^0-9.]/g, ''));
          document.getElementById('txAmount').value = amt.toLocaleString();
          document.getElementById('txAmount').dataset.raw = String(amt);
        }
        if (data.merchant || data.items) {
          document.getElementById('txMemo').value = data.merchant || (data.items||[]).join(', ');
        }
        if (data.currency) {
          const acc = state.accounts.find(a => a.currency === data.currency);
          if (acc) { selectedTxAccountId = acc.$id; renderTxAccountChips(); updateAmountSymbol(); }
        }
        toast('✅ 영수증 분석 완료! 내용을 확인해주세요', 'success');
      } else {
        toast('⚠️ 영수증 인식 실패. 직접 입력해주세요', 'error');
      }
    } catch(e) {
      openAddModal();
      toast('❌ ' + e.message, 'error');
    }
  };
  reader.readAsDataURL(file);
  input.value = '';
}

// ─────────────────────────────────────────────
// 거래 입력 모달
// ─────────────────────────────────────────────
function openAddModal(txId = null) {
  editingTxId = txId;
  selectedTxAccountId = null;
  selectedTxIcon = null;
  selectedTransferFrom = null;
  selectedTransferTo = null;

  document.getElementById('addModalTitle').textContent = txId ? '거래 수정' : '거래 입력';
  document.getElementById('txDate').value = todayStr();
  document.getElementById('txAmount').value = '';
  document.getElementById('txMemo').value = '';
  document.getElementById('mainCatSelect').value = '';
  document.getElementById('subCatSelect').innerHTML = '<option value="">소분류 선택</option>';

  if (txId) {
    const t = state.transactions.find(tx => tx.$id === txId);
    if (t) {
      setTxType(t.type, document.querySelector(`.type-tab[data-type="${t.type}"]`));
      document.getElementById('txDate').value = t.date?.slice(0, 10) || todayStr();
      document.getElementById('txAmount').value = Number(t.amount).toLocaleString();
      document.getElementById('txAmount').dataset.raw = String(t.amount);
      document.getElementById('txMemo').value = t.memo || '';
      if (t.mainCategory) {
        document.getElementById('mainCatSelect').value = t.mainCategory;
        onMainCatChange();
        setTimeout(() => { document.getElementById('subCatSelect').value = t.subCategory || ''; }, 50);
      }
      selectedTxAccountId = t.accountId || t.fromAccountId;
      selectedTxIcon = t.iconKey;
      selectedTransferFrom = t.fromAccountId;
      selectedTransferTo = t.toAccountId;
    }
  }

  renderTxAccountChips();
  renderTransferChips();
  highlightSelectedIcon();
  openModal('addModal');
}

function setTxType(type, btn) {
  currentTxType = type;
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
  const acc = findAccount(selectedTxAccountId);
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

function renderTxAccountChips() {
  const el = document.getElementById('txAccountChips');
  if (!state.accounts.length) {
    el.innerHTML = '<span style="color:var(--text3);font-size:13px;">계좌를 먼저 추가해주세요</span>';
    return;
  }
  el.innerHTML = state.accounts.map(a => {
    const bankIcon = a.bankIcon ? `<img src="${ICONS[a.bankIcon]||''}" width="18" height="18" style="object-fit:contain;border-radius:3px;">` : '';
    const sel = selectedTxAccountId === a.$id ? 'selected' : '';
    return `<div class="account-chip ${sel}" onclick="selectTxAccount('${a.$id}')">
      ${bankIcon}<span>${a.name}</span>
    </div>`;
  }).join('');
}

function selectTxAccount(id) {
  selectedTxAccountId = id;
  renderTxAccountChips();
  updateAmountSymbol();
}

function renderTransferChips() {
  const makeChips = (elId, selectedId, clickFn) => {
    const el = document.getElementById(elId);
    if (!state.accounts.length) { el.innerHTML = '<span style="color:var(--text3);font-size:13px;">계좌를 먼저 추가해주세요</span>'; return; }
    el.innerHTML = state.accounts.map(a => {
      const bankIcon = a.bankIcon ? `<img src="${ICONS[a.bankIcon]||''}" width="18" height="18" style="object-fit:contain;">` : '';
      const sel = selectedId === a.$id ? 'selected' : '';
      return `<div class="account-chip ${sel}" onclick="${clickFn}('${a.$id}')">${bankIcon}<span>${a.name}</span></div>`;
    }).join('');
  };
  makeChips('transferFromChips', selectedTransferFrom, 'selectTransferFrom');
  makeChips('transferToChips', selectedTransferTo, 'selectTransferTo');
}

function selectTransferFrom(id) { selectedTransferFrom = id; renderTransferChips(); }
function selectTransferTo(id) { selectedTransferTo = id; renderTransferChips(); }

function renderTxIconGrid() {
  const el = document.getElementById('txIconGrid');
  const expenseIcons = [
    'food','grocery','drink','snack','shopping','leisure','health','transport','housing',
    'electricity','water','phone','cleaning','beauty','massage','golf','billiards','travel',
    'insurance','loan','subscription','tip_vn','cigarette','alcohol','lotto','pet_cat',
    'gift_box','donation','commission','family_kr','apartment','apartment_rent','rent_dollar',
    'date_rose','credit_card','etc'
  ];
  el.innerHTML = expenseIcons.map(k => `
    <div class="icon-item ${selectedTxIcon===k?'selected':''}" onclick="selectTxIcon('${k}')" id="icon-item-${k}">
      ${iconImg(k, 28)}
      <span>${getIconLabel(k)}</span>
    </div>`).join('');
}

function selectTxIcon(key) {
  selectedTxIcon = key;
  document.querySelectorAll('.icon-item').forEach(el => el.classList.remove('selected'));
  document.getElementById('icon-item-' + key)?.classList.add('selected');
}

function highlightSelectedIcon() {
  if (!selectedTxIcon) return;
  setTimeout(() => {
    document.querySelectorAll('.icon-item').forEach(el => el.classList.remove('selected'));
    document.getElementById('icon-item-' + selectedTxIcon)?.classList.add('selected');
  }, 50);
}

function getIconLabel(key) {
  const map = {
    food:'식사',grocery:'장보기',drink:'음료',snack:'간식',shopping:'쇼핑',
    leisure:'여가',health:'건강',transport:'교통',housing:'주거',electricity:'전기',
    water:'수도',phone:'통신',cleaning:'청소',beauty:'미용',massage:'마사지',
    golf:'골프',billiards:'당구',travel:'여행',insurance:'보험',loan:'대출',
    subscription:'구독',tip_vn:'팁',cigarette:'담배',alcohol:'술',lotto:'로또',
    pet_cat:'반려동물',gift_box:'선물',donation:'헌금',commission:'수수료',
    family_kr:'가족',apartment:'아파트',apartment_rent:'월세',rent_dollar:'임대',
    date_rose:'데이트',credit_card:'카드',etc:'기타',income:'수입',
    transfer:'이체',transfer_custom:'이체',
  };
  return map[key] || key;
}

async function saveTx() {
  const date = document.getElementById('txDate').value;
  if (!date) { toast('날짜를 선택해주세요', 'error'); return; }

  let data = { date, type: currentTxType };

  if (currentTxType === 'transfer') {
    if (!selectedTransferFrom || !selectedTransferTo) { toast('출금/입금 계좌를 선택해주세요', 'error'); return; }
    const rawAmt = document.getElementById('transferAmount').dataset.raw || document.getElementById('transferAmount').value.replace(/,/g, '');
    if (!rawAmt) { toast('금액을 입력해주세요', 'error'); return; }
    data = { ...data, fromAccountId: selectedTransferFrom, toAccountId: selectedTransferTo, amount: Number(rawAmt), memo: document.getElementById('transferMemo').value, iconKey: 'transfer' };
  } else {
    if (!selectedTxAccountId) { toast('계좌를 선택해주세요', 'error'); return; }
    const rawAmt = document.getElementById('txAmount').dataset.raw || document.getElementById('txAmount').value.replace(/,/g, '');
    if (!rawAmt) { toast('금액을 입력해주세요', 'error'); return; }
    data = {
      ...data,
      accountId: selectedTxAccountId,
      amount: Number(rawAmt),
      memo: document.getElementById('txMemo').value,
      mainCategory: document.getElementById('mainCatSelect').value,
      subCategory: document.getElementById('subCatSelect').value,
      iconKey: selectedTxIcon || (currentTxType === 'income' ? 'income' : 'etc'),
    };
  }

  showLoading(true);
  try {
    if (editingTxId) {
      await db.updateTransaction(editingTxId, data);
      const idx = state.transactions.findIndex(t => t.$id === editingTxId);
      if (idx >= 0) state.transactions[idx] = { ...state.transactions[idx], ...data };
      toast('✅ 수정됐어요!');
    } else {
      const saved = await db.createTransaction(data);
      state.transactions.unshift(saved);
      toast('✅ 저장됐어요!');
    }
    closeModal('addModal');
    renderHome();
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
        ${t.type==='income'?'+':t.type==='transfer'?'↔':'-'}${fmtMoney(t.amount, cur)}
      </div>
      <div style="font-size:14px;color:var(--text2);margin-top:4px;">${t.memo || '-'}</div>
    </div>
    <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:14px;display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text2)">날짜</span><span>${fmtDate(t.date?.slice(0,10))}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text2)">유형</span><span>${t.type==='expense'?'지출':t.type==='income'?'수입':'이체'}</span></div>
      ${t.mainCategory?`<div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text2)">분류</span><span>${t.mainCategory}${t.subCategory?' > '+t.subCategory:''}</span></div>`:''}
      ${acc?`<div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text2)">계좌</span><span>${acc.name}</span></div>`:''}
      ${toAcc?`<div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text2)">입금계좌</span><span>${toAcc.name}</span></div>`:''}
    </div>
    <div style="display:flex;gap:8px;margin-top:14px;">
      <button class="btn-secondary btn-sm" style="flex:1;" onclick="closeModal('txDetailModal');openAddModal('${txId}')">✏️ 수정</button>
      <button class="btn-secondary btn-sm btn-danger" style="flex:1;" onclick="deleteTx('${txId}')">🗑️ 삭제</button>
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
    renderHome();
  } catch(e) { toast('❌ ' + e.message, 'error'); }
  showLoading(false);
}

// ─────────────────────────────────────────────
// 계좌 모달
// ─────────────────────────────────────────────
function openAccountModal(accId = null) {
  document.getElementById('editAccountId').value = accId || '';
  document.getElementById('accountModalTitle').textContent = accId ? '계좌 수정' : '계좌 추가';
  document.getElementById('accountName').value = '';
  document.getElementById('accountType').value = 'bank';
  document.getElementById('accountCurrency').value = 'VND';
  document.getElementById('accountBalance').value = '';
  selectedCurrencyIcon = 'vnd';
  selectedBankIcon = null;

  if (accId) {
    const a = state.accounts.find(ac => ac.$id === accId);
    if (a) {
      document.getElementById('accountName').value = a.name || '';
      document.getElementById('accountType').value = a.type || 'bank';
      document.getElementById('accountCurrency').value = a.currency || 'VND';
      document.getElementById('accountBalance').value = a.initialBalance ? Number(a.initialBalance).toLocaleString() : '';
      selectedCurrencyIcon = a.currencyIcon || 'vnd';
      selectedBankIcon = a.bankIcon || null;
    }
  }
  renderCurrencyIconGrid();
  renderBankIconGrid();
  openModal('accountModal');
}

function renderCurrencyIconGrid() {
  const el = document.getElementById('currencyIconGrid');
  const cur = ['vnd','krw','usd','cny','cad','php'];
  el.innerHTML = cur.map(k => `
    <div class="icon-item ${selectedCurrencyIcon===k?'selected':''}" onclick="selectCurrencyIcon('${k}')" id="cur-icon-${k}">
      ${iconImg(k, 28)}
      <span>${k.toUpperCase()}</span>
    </div>`).join('');
}

function selectCurrencyIcon(key) {
  selectedCurrencyIcon = key;
  document.querySelectorAll('#currencyIconGrid .icon-item').forEach(el => el.classList.remove('selected'));
  document.getElementById('cur-icon-' + key)?.classList.add('selected');
}

function renderBankIconGrid() {
  const el = document.getElementById('bankIconGrid');
  const banks = ['hana','mg','nh','shinhan','woori'];
  el.innerHTML = banks.map(k => `
    <div class="icon-item ${selectedBankIcon===k?'selected':''}" onclick="selectBankIcon('${k}')" id="bank-icon-${k}">
      ${iconImg(k, 28)}
      <span>${getBankLabel(k)}</span>
    </div>`).join('') + `
    <div class="icon-item ${!selectedBankIcon?'selected':''}" onclick="selectBankIcon(null)" id="bank-icon-none">
      <div style="width:28px;height:28px;background:var(--bg2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;">💵</div>
      <span>없음</span>
    </div>`;
}

function selectBankIcon(key) {
  selectedBankIcon = key;
  document.querySelectorAll('#bankIconGrid .icon-item').forEach(el => el.classList.remove('selected'));
  if (key) document.getElementById('bank-icon-' + key)?.classList.add('selected');
  else document.getElementById('bank-icon-none')?.classList.add('selected');
}

function getBankLabel(k) { return {hana:'하나',mg:'MG',nh:'NH농협',shinhan:'신한',woori:'우리'}[k]||k; }

function updateAccountIcons() {
  const cur = document.getElementById('accountCurrency').value.toLowerCase();
  const map = {vnd:'vnd',krw:'krw',usd:'usd',cny:'cny',cad:'cad',php:'php'};
  if (map[cur]) { selectedCurrencyIcon = map[cur]; renderCurrencyIconGrid(); }
}

async function saveAccount() {
  const name = document.getElementById('accountName').value.trim();
  if (!name) { toast('계좌명을 입력해주세요', 'error'); return; }
  const rawBal = document.getElementById('accountBalance').dataset?.raw || document.getElementById('accountBalance').value.replace(/,/g,'');
  const data = {
    name,
    type: document.getElementById('accountType').value,
    currency: document.getElementById('accountCurrency').value,
    currencyIcon: selectedCurrencyIcon,
    bankIcon: selectedBankIcon,
    initialBalance: Number(rawBal) || 0,
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
    // 계좌 목록 항상 최신화
    const freshAccounts = await db.listAccounts();
    state.accounts = freshAccounts;
    renderAccountsPage();
  } catch(e) { toast('❌ ' + e.message, 'error'); }
  showLoading(false);
}

// ─────────────────────────────────────────────
// 예산 모달
// ─────────────────────────────────────────────
function openBudgetModal() {
  document.getElementById('budgetMonth').value = state.currentMonth;
  renderBudgetInputList();
  openModal('budgetModal');
}

function renderBudgetInputList() {
  const el = document.getElementById('budgetInputList');
  const ym = document.getElementById('budgetMonth').value || state.currentMonth;
  const existing = state.budgets.filter(b => b.yearMonth === ym);
  const cats = Object.keys(CATEGORIES);
  const defaultCur = state.accounts[0]?.currency || 'VND';
  const sym = getCurrencySymbol(defaultCur);

  el.innerHTML = cats.map(cat => {
    const b = existing.find(e => e.category === cat);
    const val = b ? Number(b.amount).toLocaleString() : '';
    return `<div class="form-group">
      <label class="form-label">${cat}</label>
      <div class="amount-input-wrap">
        <span class="amount-symbol">${sym}</span>
        <input type="text" inputmode="numeric" class="form-input" id="budget-${cat}" value="${val}" placeholder="0" oninput="formatNumberInput(this)" style="padding-left:36px;">
      </div>
    </div>`;
  }).join('');
}

async function saveBudgets() {
  const ym = document.getElementById('budgetMonth').value || state.currentMonth;
  const cats = Object.keys(CATEGORIES);
  showLoading(true);
  try {
    for (const cat of cats) {
      const inp = document.getElementById('budget-' + cat);
      if (!inp) continue;
      const raw = inp.dataset.raw || inp.value.replace(/,/g, '');
      if (!raw) continue;
      const saved = await db.saveBudget({ category: cat, amount: Number(raw), yearMonth: ym });
      const idx = state.budgets.findIndex(b => b.category === cat && b.yearMonth === ym);
      if (idx >= 0) state.budgets[idx] = saved;
      else state.budgets.push(saved);
    }
    toast('✅ 예산 저장됐어요!');
    closeModal('budgetModal');
    renderStats();
  } catch(e) { toast('❌ ' + e.message, 'error'); }
  showLoading(false);
}


// ─────────────────────────────────────────────
// 계좌 페이지 렌더 (추가/수정/삭제 모두 여기서)
// ─────────────────────────────────────────────
function renderAccountsPage() {
  const summaryEl = document.getElementById('accountsPageSummary');
  const listEl = document.getElementById('accountsPageList');
  if (!listEl) return;

  // 데이터 없고 온라인이면 다시 불러오기
  if (!state.accounts.length && db.online) {
    listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3);">⏳ 불러오는 중...</div>';
    db.listAccounts().then(accs => {
      state.accounts = accs;
      renderAccountsPage();
    });
    return;
  }

  // 전체 자산 요약 (통화별)
  const totalByGroup = {};
  state.accounts.forEach(a => {
    const isLoan = a.type === 'loan';
    const bal = isLoan ? calcBalance(a.$id) : calcBalance(a.$id) + (Number(a.initialBalance) || 0);
    const cur = a.currency || 'VND';
    if (!totalByGroup[cur]) totalByGroup[cur] = 0;
    totalByGroup[cur] += bal;
  });

  summaryEl.innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="font-size:12px;color:var(--text2);margin-bottom:8px;font-weight:600;">💰 전체 자산</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${Object.entries(totalByGroup).map(([cur, total]) => `
          <div style="display:flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--border);border-radius:20px;padding:8px 14px;">
            <img src="${ICONS[cur.toLowerCase()]||''}" width="18" height="18" style="object-fit:contain;">
            <span style="font-size:14px;font-weight:700;color:${total>=0?'var(--income)':'var(--expense)'}">${fmtMoney(total, cur)}</span>
          </div>`).join('') || '<span style="color:var(--text3);font-size:13px;">계좌를 추가해주세요</span>'}
      </div>
    </div>`;

  if (!state.accounts.length) {
    listEl.innerHTML = '<div class="empty-state"><div class="icon">🏦</div><p>+ 추가 버튼을 눌러 계좌를 등록하세요</p></div>';
    return;
  }

  // 유형별 그룹으로 표시 + 수정/삭제 버튼 포함
  const typeLabel = {bank:'🏦 은행', cash:'💵 현금', loan:'📋 대출', savings:'🐷 적금'};
  const groups = {};
  state.accounts.forEach(a => {
    const t = a.type || 'bank';
    if (!groups[t]) groups[t] = [];
    groups[t].push(a);
  });

  listEl.innerHTML = Object.entries(groups).map(([type, accs]) => `
    <div style="margin-bottom:24px;">
      <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px;letter-spacing:0.5px;text-transform:uppercase;">${typeLabel[type]||type}</div>
      ${accs.map(a => {
        const isLoan = a.type === 'loan';
        const bal = isLoan ? calcBalance(a.$id) : calcBalance(a.$id) + (Number(a.initialBalance) || 0);
        const cur = a.currency || 'VND';
        const bankIcon = a.bankIcon
          ? `<img src="${ICONS[a.bankIcon]||''}" width="40" height="40" style="object-fit:contain;border-radius:10px;">`
          : `<div style="width:40px;height:40px;background:linear-gradient(135deg,var(--accent),#6366f1);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;">🏦</div>`;
        const curIcon = a.currencyIcon ? `<img src="${ICONS[a.currencyIcon]||''}" width="14" height="14" style="object-fit:contain;">` : '';
        const txCount = state.transactions.filter(t => t.accountId === a.$id || t.fromAccountId === a.$id || t.toAccountId === a.$id).length;
        return `
          <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:8px;overflow:hidden;">
            <div style="display:flex;align-items:center;gap:12px;padding:14px;">
              ${bankIcon}
              <div style="flex:1;min-width:0;">
                <div style="font-size:15px;font-weight:700;">${a.name}</div>
                <div style="font-size:11px;color:var(--text3);margin-top:2px;">${{bank:'은행',cash:'현금',loan:'대출',savings:'적금'}[a.type]||a.type} · ${cur} · 거래 ${txCount}건</div>
              </div>
              <div style="text-align:right;">
                ${curIcon ? `<div style="display:flex;align-items:center;gap:3px;justify-content:flex-end;margin-bottom:2px;">${curIcon}</div>` : ''}
                <div style="font-size:15px;font-weight:900;color:${bal>=0?'var(--income)':'var(--expense)'}">${fmtMoney(bal, cur)}</div>
              </div>
            </div>
            <div style="display:flex;border-top:1px solid var(--border);">
              <button onclick="openAccountModal('${a.$id}')" style="flex:1;padding:10px;background:none;border:none;border-right:1px solid var(--border);color:var(--accent2);font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font);">✏️ 수정</button>
              <button onclick="deleteAccount('${a.$id}')" style="flex:1;padding:10px;background:none;border:none;color:var(--expense);font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font);">🗑️ 삭제</button>
            </div>
          </div>`;
      }).join('')}
    </div>`).join('');
}

// ─────────────────────────────────────────────
// 설정 렌더
// ─────────────────────────────────────────────
function renderSettings() {
  // 예산 설정 목록
  const budgetEl = document.getElementById('budgetSettingList');
  if (!budgetEl) return;
  const monthBudgets = state.budgets.filter(b => b.yearMonth === state.currentMonth);
  if (!monthBudgets.length) {
    budgetEl.innerHTML = '<div style="color:var(--text3);font-size:13px;">이번달 예산이 없습니다</div>';
  } else {
    const defaultCur = state.accounts[0]?.currency || 'VND';
    budgetEl.innerHTML = monthBudgets.map(b => `
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">
        <span>${b.category}</span>
        <span style="font-weight:700;">${fmtMoney(b.amount, defaultCur)}</span>
      </div>`).join('');
  }
}

function renderThemeGrid() {
  const themes = [
    { name: 'dark', label: '다크', bg: '#0f0f14', accent: '#7c6af7' },
    { name: 'light', label: '라이트', bg: '#f5f5fa', accent: '#7c6af7' },
    { name: 'ocean', label: '오션', bg: '#0a1628', accent: '#38bdf8' },
    { name: 'forest', label: '포레스트', bg: '#0a1a0f', accent: '#34d399' },
    { name: 'sunset', label: '선셋', bg: '#1a0a0a', accent: '#fb923c' },
    { name: 'pink', label: '핑크', bg: '#1a0a14', accent: '#f472b6' },
  ];
  document.getElementById('themeGrid').innerHTML = themes.map(t => `
    <div class="theme-item ${state.settings.theme === t.name ? 'selected' : ''}" onclick="applyThemePreset('${t.name}')" style="background:${t.bg};">
      <div style="height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;">
        <div style="width:20px;height:4px;border-radius:2px;background:${t.accent};"></div>
        <div style="font-size:9px;color:${t.accent};font-weight:700;">${t.label}</div>
      </div>
    </div>`).join('');
}

function applyThemePreset(name) {
  const themes = {
    dark: { '--bg': '#0f0f14', '--bg2': '#1a1a24', '--bg3': '#22222f', '--card': '#1e1e2a', '--accent': '#7c6af7', '--accent2': '#a78bfa' },
    light: { '--bg': '#f5f5fa', '--bg2': '#ebebf5', '--bg3': '#e0e0ee', '--card': '#ffffff', '--accent': '#7c6af7', '--accent2': '#6366f1' },
    ocean: { '--bg': '#0a1628', '--bg2': '#0f1f3d', '--bg3': '#162647', '--card': '#112034', '--accent': '#38bdf8', '--accent2': '#7dd3fc' },
    forest: { '--bg': '#0a1a0f', '--bg2': '#0f2517', '--bg3': '#16301e', '--card': '#112014', '--accent': '#34d399', '--accent2': '#6ee7b7' },
    sunset: { '--bg': '#1a0a0a', '--bg2': '#2a1010', '--bg3': '#361616', '--card': '#241010', '--accent': '#fb923c', '--accent2': '#fdba74' },
    pink: { '--bg': '#1a0a14', '--bg2': '#2a1020', '--bg3': '#361628', '--card': '#241018', '--accent': '#f472b6', '--accent2': '#f9a8d4' },
  };
  const vars = themes[name] || themes.dark;
  Object.entries(vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
  state.settings.theme = name;
  saveApiSettings();
  renderThemeGrid();
}

function toggleDarkMode(checkbox) {
  applyTheme(checkbox.checked ? 'dark' : 'light');
  saveApiSettings();
}

function toggleReminder(checkbox) {
  state.settings.reminderEnabled = checkbox.checked;
  saveApiSettings();
  if (checkbox.checked && 'Notification' in window) {
    Notification.requestPermission();
  }
}

function saveReminderTime(input) {
  state.settings.reminderTime = input.value;
  saveApiSettings();
}

async function saveApiSettings() {
  const key = document.getElementById('geminiKeyInput')?.value?.trim() || state.settings.geminiApiKey;
  state.settings.geminiApiKey = key;
  try {
    await db.saveSettings({ ...state.settings, geminiApiKey: key });
    if (document.getElementById('geminiKeyInput')?.value) toast('✅ 설정 저장됐어요!');
  } catch(e) { console.error(e); }
}

async function deleteAccount(id) {
  if (!confirm('이 계좌를 삭제할까요?')) return;
  showLoading(true);
  try {
    await db.deleteAccount(id);
    state.accounts = state.accounts.filter(a => a.$id !== id);
    toast('🗑️ 계좌 삭제됐어요');
    const freshAccs = await db.listAccounts();
    state.accounts = freshAccs;
    renderHome();
    renderAccountsPage();
  } catch(e) { toast('❌ ' + e.message, 'error'); }
  showLoading(false);
}

async function clearAllData() {
  if (!confirm('정말 모든 데이터를 삭제할까요?\n⚠️ 이 작업은 되돌릴 수 없습니다!')) return;
  localStorage.clear();
  toast('🗑️ 로컬 데이터가 삭제됐어요. 앱을 새로고침해주세요.', 'info');
  setTimeout(() => location.reload(), 1500);
}

// ─────────────────────────────────────────────
// 모달 공통
// ─────────────────────────────────────────────
function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
function closeModalOnBg(e, id) { if (e.target === e.currentTarget) closeModal(id); }

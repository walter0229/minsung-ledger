import { state, fmtMoney, fmtDate, getCategoryStats, getBudgetStatus, getTimeProgress, getDaysInMonth } from './utils.js';
import { store } from './store.js';
import { ICONS } from './config.js';
import { renderTxItem } from './transactions.js';
import { fetchExchangeRates, convertCurrency, getBalanceAtDate } from './sync.js';

// =============================================
// 민성이의 가계부 - 통계 및 차트 전담
// =============================================

export function setStatsPeriod(p, btn) {
  store.statsPeriod = p;
  btn.closest('.period-tabs').querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  window.renderStats();
}

export function setStatsType(t, btn) {
  store.statsType = t;
  document.getElementById('statsExpenseTab').classList.toggle('active', t === 'expense');
  document.getElementById('statsIncomeTab').classList.toggle('active', t === 'income');
  window.renderStats();
}

function getStatsTxs() {
  const now = new Date();
  if (store.statsPeriod === 'monthly') return state.transactions.filter(t => t.date?.startsWith(state.currentMonth) && t.type === store.statsType);
  if (store.statsPeriod === 'yearly') return state.transactions.filter(t => t.date?.startsWith(String(now.getFullYear())) && t.type === store.statsType);
  // weekly
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - (now.getDay() || 7) + 1);
  const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 6);
  return state.transactions.filter(t => {
    const d = new Date(t.date);
    return d >= startOfWeek && d <= endOfWeek && t.type === store.statsType;
  });
}

export async function renderStatsScreen() {
  const txs = getStatsTxs();
  const baseCur = 'VND';
  
  // 모든 거래 내역에 대해 환율을 적용하여 VND 금액(vndAmt) 산출
  for (const t of txs) {
    const acc = state.accounts.find(a => a.$id === (t.accountId || t.fromAccountId));
    const cur = acc?.currency || 'VND';
    t.vndAmt = await convertCurrency(Number(t.amount), cur, baseCur);
  }

  // 지출 통계 그룹화 로직 (환산된 금액 기준)
  const statsMap = {};
  txs.filter(t => t.type === 'expense').forEach(t => {
    const k = t.mainCategory || '기타';
    statsMap[k] = (statsMap[k] || 0) + t.vndAmt;
  });
  const expenseStats = Object.entries(statsMap).sort((a,b) => b[1]-a[1]);

  // 수입 통계 그룹화 로직 (환산된 금액 기준)
  const incomeMap = {};
  txs.filter(t => t.type === 'income').forEach(t => {
    const k = t.mainCategory || '수입';
    incomeMap[k] = (incomeMap[k] || 0) + t.vndAmt;
  });
  const incomeStats = Object.entries(incomeMap).sort((a,b) => b[1]-a[1]);

  const total = txs.reduce((s, t) => s + (t.vndAmt || 0), 0);
  const displayCur = 'VND';

  document.getElementById('donutTotal').innerHTML = fmtMoney(total, displayCur);
  document.getElementById('donutLabel').textContent = store.statsType === 'expense' ? '지출 합계' : '수입 합계';

  const statData = store.statsType === 'expense' ? expenseStats : incomeStats;

  const colors = ['#7c6af7','#f87171','#34d399','#fbbf24','#60a5fa','#a78bfa','#fb923c','#4ade80','#f472b6','#38bdf8','#facc15','#818cf8'];
  const labels = statData.map(([k]) => k);
  const values = statData.map(([, v]) => v);

  if (store.donutChart) store.donutChart.destroy();
  const ctx = document.getElementById('donutChart').getContext('2d');
  
  // Chart.js가 글로벌로 있다고 가정(index.html 안에 cdn)
  if(window.Chart) {
    store.donutChart = new window.Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: colors.slice(0, values.length), borderWidth: 0, hoverOffset: 8 }]
      },
      options: {
        cutout: '70%', plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: ctx => ` ${ctx.label}: ${fmtMoney(ctx.raw, displayCur)}` }
        }},
        animation: { animateScale: true }
      }
    });
  }

  // 범례
  document.getElementById('statsLegend').innerHTML = statData.map(([cat, amt], i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${colors[i % colors.length]}"></div>
      <div class="legend-name">${cat}</div>
      <div class="legend-pct">${total > 0 ? (amt/total*100).toFixed(1) : 0}%</div>
      <div class="legend-amount">${fmtMoney(amt, displayCur)}</div>
    </div>`).join('');

  // 예산 바
  await renderBudgetBars();
}

async function renderBudgetBars() {
  const el = document.getElementById('budgetBars');
  const month = state.currentMonth;
  const budgets = state.budgets.filter(b => b.yearMonth === month);
  const txs = state.transactions.filter(t => t.date?.startsWith(month) && t.type === 'expense');
  
  if (!budgets.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:13px;text-align:center;padding:16px;">예산을 설정해주세요</div>';
    return;
  }
  
  const baseCur = 'VND';
  const status = [];

  for (const b of budgets) {
    let usedInVnd = 0;
    const filterTxs = b.subCategory 
      ? txs.filter(t => t.mainCategory === b.category && t.subCategory === b.subCategory)
      : txs.filter(t => t.mainCategory === b.category);

    for (const t of filterTxs) {
      const acc = state.accounts.find(a => a.$id === (t.accountId || t.fromAccountId));
      const cur = acc?.currency || 'VND';
      usedInVnd += await convertCurrency(Number(t.amount), cur, baseCur);
    }
    
    status.push({ ...b, usedVnd: usedInVnd, percent: b.amount > 0 ? (usedInVnd / b.amount * 100).toFixed(1) : 0 });
  }

  el.innerHTML = status.map(b => {
    const pct = Math.min(Number(b.percent), 100);
    const title = b.subCategory ? `${b.category}(${b.subCategory})` : b.category;
    return `
    <div class="budget-item">
      <div class="budget-info">
        <span>${title}</span>
        <span>${fmtMoney(b.usedVnd, baseCur)} / ${fmtMoney(b.amount, baseCur)}</span>
      </div>
      <div class="progress-bg">
        <div class="progress-bar" style="width:${pct}%; background:${pct > 90 ? 'var(--expense)' : 'var(--income)'}"></div>
      </div>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
// 보고서
// ─────────────────────────────────────────────
export function setReportPeriod(p, btn) {
  store.reportPeriod = p;
  btn.closest('.period-tabs').querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  window.renderReport();
}

export function renderReportScreen() {
  renderAnalysisCharts();
  renderAssetChart();
}

function renderAnalysisCharts() {
  const status = getBudgetStatus(state.currentMonth);
  const labels = status.map(b => b.subCategory ? `${b.category}(${b.subCategory})` : b.category);
  const used = status.map(b => Number(b.used));
  const budget = status.map(b => Number(b.amount));
  const timeProgress = getTimeProgress(store.reportPeriod === 'monthly' ? 'monthly' : store.reportPeriod === 'weekly' ? 'weekly' : 'yearly');

  if (store.usageChart) store.usageChart.destroy();
  const ctx1 = document.getElementById('usageChart').getContext('2d');
  
  if(window.Chart) {
    store.usageChart = new window.Chart(ctx1, {
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
  }

  // 시간 경과율 차트
  if (store.progressChart) store.progressChart.destroy();
  const ctx2 = document.getElementById('progressChart').getContext('2d');
  const totalBudget = budget.reduce((s, v) => s + v, 0);
  const totalUsed = used.reduce((s, v) => s + v, 0);
  const usagePct = totalBudget > 0 ? (totalUsed / totalBudget * 100) : 0;

  if(window.Chart) {
    store.progressChart = new window.Chart(ctx2, {
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
}

function renderAssetChart() {
  if (store.assetChart) store.assetChart.destroy();
  const ctx = document.getElementById('assetChart').getContext('2d');
  const now = new Date();
  let labels = [], data = [];

  // TODO: getTotalBalanceInBase() 를 통한 다중 통화 통합은
  // 복잡성을 피하기 위해 여기서는 단순 로직 유지 혹은 환율 모듈 적용 시 수정 가능
  if (store.reportPeriod === 'monthly') {
    for (let d = 1; d <= getDaysInMonth(now.getFullYear(), now.getMonth()); d++) {
      const dateStr = `${state.currentMonth}-${String(d).padStart(2, '0')}`;
      labels.push(d + '일');
      const txsUntil = state.transactions.filter(t => t.date?.slice(0, 10) <= dateStr);
      const inc = txsUntil.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
      const exp = txsUntil.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
      const initBal = state.accounts.reduce((s, a) => s + (Number(a.initialBalance) || 0), 0);
      data.push(initBal + inc - exp);
    }
  } else if (store.reportPeriod === 'yearly') {
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
    // weekly
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

  if(window.Chart) {
    store.assetChart = new window.Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: '총 자산 흐름',
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
}

// ─────────────────────────────────────────────
// 달력 렌더링
// ─────────────────────────────────────────────
export async function renderCalendarScreen() {
  const d = state.calendarDate;
  const year = d.getFullYear(), month = d.getMonth();
  document.getElementById('calTitle').textContent = `${year}년 ${month + 1}월`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = getDaysInMonth(year, month);
  const today = new Date();
  const ym = `${year}-${String(month + 1).padStart(2, '0')}`;
  const baseCur = 'VND';

  const txs = state.transactions.filter(t => t.date?.startsWith(ym));
  const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
  let html = dayLabels.map(l => `<div class="cal-day-label">${l}</div>`).join('');

  const firstOfMonth = `${ym}-01`;
  let runningBal = await getBalanceAtDate(firstOfMonth, baseCur);

  for (let i = 0; i < firstDay; i++) html += '<div></div>';

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${ym}-${String(day).padStart(2, '0')}`;
    const dayTxs = txs.filter(t => t.date?.slice(0, 10) === dateStr);
    
    let dayInc = 0, dayExp = 0;
    for (const t of dayTxs) {
      const acc = state.accounts.find(a => a.$id === (t.accountId || t.fromAccountId));
      const cur = acc?.currency || 'VND';
      const conv = await convertCurrency(Number(t.amount), cur, baseCur);
      if (t.type === 'income') dayInc += conv;
      if (t.type === 'expense') dayExp += conv;
    }
    const dayNet = dayInc - dayExp;
    runningBal += dayNet;
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

    // 칸이 좁으므로 세 자릿수 콤마 없이 정수로만 표시하거나 축약 가능. 대개 콤마 없이 표시
    const f = (v) => v > 0 ? Math.round(v).toLocaleString().replace(/,/g,'.') : '';
    const fNet = (v) => v !== 0 ? Math.round(v).toLocaleString().replace(/,/g,'.') : '';
    const fBal = (v) => Math.round(v).toLocaleString().replace(/,/g,'.');

    html += `<div class="cal-cell ${isToday ? 'today' : ''}" onclick="window.showCalDetail('${dateStr}')">
      <div class="cal-num">${day}</div>
      <div class="cal-daily-stats">
        ${dayInc > 0 ? `<div class="cal-inc-txt">${f(dayInc)}</div>` : ''}
        ${dayExp > 0 ? `<div class="cal-exp-txt">${f(dayExp)}</div>` : ''}
        <div class="cal-net-txt ${dayNet > 0 ? 'pos' : dayNet < 0 ? 'neg' : ''}">${fNet(dayNet)}</div>
        <div class="cal-cum-txt">${fBal(runningBal)}</div>
      </div>
    </div>`;
  }

  document.getElementById('calGrid').innerHTML = html;
}

export function calPrevMonth() {
  const d = state.calendarDate;
  state.calendarDate = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  renderCalendarScreen();
}
export function calNextMonth() {
  const d = state.calendarDate;
  state.calendarDate = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  renderCalendarScreen();
}

export function showCalDetail(dateStr) {
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

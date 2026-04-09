import { state, fmtMoney, fmtDate, getCategoryStats, getBudgetStatus, getTimeProgress, getDaysInMonth, callGemini, findAccount, calcBalance } from './utils.js';
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
  if (store.statsPeriod === 'yearly') {
    const year = state.currentMonth.split('-')[0];
    return state.transactions.filter(t => (t.date || '').startsWith(year) && t.type === store.statsType);
  }
  if (store.statsPeriod === 'monthly') {
    const month = state.currentMonth; // YYYY-MM
    return state.transactions.filter(t => (t.date || '').replace(/\./g, '-').startsWith(month.replace(/\./g, '-')) && t.type === store.statsType);
  }
  // 주간 (현재 주)
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - (now.getDay() || 7) + 1);
  startOfWeek.setHours(0,0,0,0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23,59,59,999);
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
  if(!el) return;
  
  const status = getBudgetStatus(state.currentMonth, store.statsPeriod);
  
  if (!status.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:13px;text-align:center;padding:16px;">예산을 설정해주세요</div>';
    return;
  }
  
  // 🚀 전체 합계 계산 (대분류항목만 필터링하여 정확한 1배수 합계 산출)
  const topLevel = status.filter(b => !b.subCategory || b.subCategory === "");
  const totalBudgetSum = topLevel.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const totalUsedSum = topLevel.reduce((s, b) => s + (Number(b.used) || 0), 0);
  const totalPct = totalBudgetSum > 0 ? (totalUsedSum / totalBudgetSum * 100).toFixed(1) : 0;

  let summaryHtml = `
  <div class="budget-item total-summary" style="display:flex; align-items:center; gap:8px; margin-bottom:20px; padding:12px; background:rgba(124,106,247,0.1); border-radius:12px; border:1px solid rgba(124,106,247,0.3);">
    <span style="flex:0 0 130px; font-size:13px; font-weight:800; color:var(--accent2);">전체 합계</span>
    <div class="progress-bg" style="flex:1; height:12px; margin-bottom:0; background:var(--bg3); border-radius:6px; overflow:hidden; position:relative;">
      <div class="progress-bar" style="width:${Math.min(totalPct, 100)}%; height:100%; border-radius:6px; background:linear-gradient(90deg, var(--accent), var(--accent2)); transition: width 0.5s;"></div>
      <span style="position:absolute; right:6px; top:50%; transform:translateY(-50%); font-size:9px; font-weight:900; color:white; text-shadow:0 1px 2px rgba(0,0,0,0.5);">${totalPct}%</span>
    </div>
    <span style="flex:1.2; text-align:right; font-size:12px; color:var(--text); font-weight:700;">
      ${Math.round(totalUsedSum).toLocaleString()} / ${Math.round(totalBudgetSum).toLocaleString()}
    </span>
  </div>`;

  el.innerHTML = summaryHtml + status.map(b => {
    const pct = Number(b.percent);
    const title = (b.subCategory && b.subCategory !== "") ? `${b.category}(${b.subCategory})` : b.category;
    // 시각적 구분을 위해 소분류는 살짝 들여쓰기
    const paddingLeft = (b.subCategory && b.subCategory !== "") ? '16px' : '4px';
    const fontSize = (b.subCategory && b.subCategory !== "") ? '10px' : '11px';
    const color = (b.subCategory && b.subCategory !== "") ? 'var(--text3)' : 'var(--text)';

    return `
    <div class="budget-item" style="display:flex; align-items:center; gap:8px; margin-bottom:10px; padding-left:${paddingLeft};">
      <span style="flex:0 0 130px; font-size:${fontSize}; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:${color};">${title}</span>
      <div class="progress-bg" style="flex:1; height:8px; margin-bottom:0; background:var(--bg3); border-radius:4px; overflow:hidden; position:relative; margin-left:4px;">
        <div class="progress-bar" style="width:${Math.min(pct, 100)}%; height:100%; border-radius:4px; background:${pct > 90 ? 'var(--expense)' : 'var(--income)'}; transition: width 0.3s;"></div>
      </div>
      <span style="flex:0 0 35px; font-size:10px; font-weight:700; color:${pct>90?'var(--expense)':'var(--text2)'}; text-align:center; margin-left:2px;">${pct.toFixed(0)}%</span>
      <span style="flex:1.2; text-align:right; font-size:10.5px; color:var(--text2); font-family:var(--font); font-weight:500;">
        ${Math.round(b.used).toLocaleString()} / ${Math.round(Number(b.amount) || 0).toLocaleString()}
      </span>
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

// ─────────────────────────────────────────────
// AI 금융 비서 구현
// ─────────────────────────────────────────────
export async function sendAiMsg() {
  const inputEl = document.getElementById('aiInput');
  const msgEl = document.getElementById('aiMsg');
  if (!inputEl || !msgEl) return;

  const userQuery = inputEl.value.trim();
  if (!userQuery) return;

  const apiKey = state.settings.geminiApiKey;
  if (!apiKey) {
    msgEl.innerHTML = '⚠️ 설정에서 <b>Gemini API Key</b>를 먼저 입력해주세요.<br><br><small>설정 탭 하단에서 API 키를 저장할 수 있습니다.</small>';
    return;
  }

  const accountCtx = state.accounts.map(a => `${a.name}: ${Math.round(a.initialBalance).toLocaleString()} ${a.currency || 'VND'}`).join(', ');
  const budgetStatus = getBudgetStatus(state.currentMonth);
  const budgetCtx = budgetStatus.map(b => `${b.category}: ${Math.round(b.used).toLocaleString()} / ${Math.round(b.amount).toLocaleString()}`).join(', ');
  const recentTxs = state.transactions.slice(0, 10).map(t => `${t.date} ${t.type === 'income' ? '수입' : '지출'} ${t.merchant || ''} ${Math.round(t.amount).toLocaleString()}`).join(', ');

  const prompt = `사용자의 금융 가계부 데이터를 바탕으로 질문에 친절하고 전문적으로 답변해줘.

현재 계좌 상황: ${accountCtx}
이번 달 예산 현황: ${budgetCtx}
최근 거래(10건): ${recentTxs}

사용자 질문: ${userQuery}

한국어로 답변해주고, 가능한 구체적인 수치나 분석을 포함해줘.`;

  try {
    msgEl.innerHTML = '🤖 <b>AI 비서가 데이터를 분석 중입니다...</b><br><small>잠시만 기다려주세요.</small>';
    inputEl.value = '';
    const response = await callGemini(prompt);
    const formatted = response.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    msgEl.innerHTML = formatted;
  } catch (e) {
    console.error('AI 비서 오류:', e);
    msgEl.innerHTML = `⚠️ <b>AI 분석 중 오류가 발생했습니다.</b><br><small>${e.message}</small>`;
  }
}

export async function renderReportScreen() {
  await renderAnalysisCharts();
  await renderAssetChart();
  await renderBalanceTrendChart();
}

async function renderAnalysisCharts() {
  const baseCur = 'VND';
  let txs = [];
  const now = new Date();
  if (store.reportPeriod === 'yearly') {
    const year = state.currentMonth.split('-')[0];
    txs = state.transactions.filter(t => t.date?.startsWith(year));
  } else if (store.reportPeriod === 'weekly') {
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - (now.getDay() || 7) + 1);
    startOfWeek.setHours(0,0,0,0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23,59,59,999);
    txs = state.transactions.filter(t => {
      const d = new Date(t.date);
      return d >= startOfWeek && d <= endOfWeek;
    });
  } else {
    txs = state.transactions.filter(t => t.date?.startsWith(state.currentMonth));
  }

  // 환율 변환 먼저 완료 (KRW 등 타 통화 정확히 처리)
  for (const t of txs) {
    const acc = findAccount(t.accountId || t.fromAccountId);
    const cur = acc?.currency || 'VND';
    t.vndAmt = await convertCurrency(Number(t.amount), cur, baseCur);
  }

  const status = getBudgetStatus(state.currentMonth, store.reportPeriod);
  // 대분류별로 그룹화 (여러 개의 소분류 예산이 있을 경우 합산)
  const catMap = {};
  // 1단계: 대분류 예산이 있는 항목들 먼저 등록
  status.forEach(b => {
    if (!b.subCategory || b.subCategory === "") {
      catMap[b.category] = { budget: Number(b.amount || 0), used: Number(b.used || 0), mainFound: true };
    }
  });
  // 2단계: 대분류 예산이 없는 경우, 해당 카테고리에 속한 소분류 항목들을 합산
  status.forEach(b => {
    if (b.subCategory && b.subCategory !== "") {
      if (!catMap[b.category]) {
        catMap[b.category] = { budget: 0, used: 0, mainFound: false };
      }
      if (!catMap[b.category].mainFound) {
        catMap[b.category].budget += Number(b.amount || 0);
        catMap[b.category].used += Number(b.used || 0);
      }
    }
  });

  const labels = Object.keys(catMap);
  const used = labels.map(k => catMap[k].used);
  const budget = labels.map(k => catMap[k].budget);
  const timeProgress = getTimeProgress(store.reportPeriod === 'monthly' ? 'monthly' : store.reportPeriod === 'weekly' ? 'weekly' : 'yearly');
  
  // 🚀 예산 사용률 집계 강화 (대분류만 추출하여 합산)
  const topLevelStatus = status.filter(b => !b.subCategory || b.subCategory === "");
  const totalBudget = topLevelStatus.reduce((s, b) => s + Number(b.amount || 0), 0);
  const totalUsed = topLevelStatus.reduce((s, b) => s + Number(b.used || 0), 0);
  const usagePct = totalBudget > 0 ? (totalUsed / totalBudget * 100) : 0;

  console.log(`📊 [Report:${store.reportPeriod}] Budget:${totalBudget}, Used:${totalUsed}, UsageRate:${usagePct.toFixed(1)}%, TimeProgress:${timeProgress.toFixed(1)}%`);

  if (store.usageChart) store.usageChart.destroy();
  const ctx1 = document.getElementById('usageChart').getContext('2d');
  if(window.Chart) {
    store.usageChart = new window.Chart(ctx1, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '예산', data: budget, backgroundColor: 'rgba(124,106,247,0.2)', borderColor: 'rgba(124,106,247,0.6)', borderWidth: 1 },
          { label: '지출', data: used, backgroundColor: used.map((u, i) => u > budget[i] ? 'rgba(248,113,113,0.7)' : 'rgba(52,211,153,0.7)'), borderWidth: 0 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#9090b0', font: { size: 11 } } } }, scales: { x: { ticks: { color: '#9090b0', font: { size: 10 } }, grid: { color: '#2e2e3e' } }, y: { ticks: { color: '#9090b0', font: { size: 10 } }, grid: { color: '#2e2e3e' } } } }
    });
  }

  if (store.progressChart) store.progressChart.destroy();
  const ctx2 = document.getElementById('progressChart').getContext('2d');
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


async function renderAssetChart() {
  // 현금 계좌 제외, 환율 VND 기준으로 환산
  const accounts = state.accounts.filter(a => a.type !== 'cash' && a.type !== 'loan');
  if (!accounts.length) return;

  const colors = ['#7c6af7','#34d399','#f87171','#fbbf24','#60a5fa','#a78bfa'];
  const labels = [];
  const data = [];
  const bgColors = [];

  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    // 초기잔액 + 거래내역 반영 실제 잔액
    const rawBal = (Number(a.initialBalance) || 0) + calcBalance(a.$id);
    // VND로 환산
    const inVND = await convertCurrency(rawBal, a.currency || 'VND', 'VND');
    const finalVal = a.type === 'loan' ? -Math.abs(inVND) : inVND;

    labels.push(`${a.name}${a.currency !== 'VND' ? ` (${a.currency})` : ''}`);
    data.push(Math.round(finalVal));
    bgColors.push(a.type === 'loan' ? 'rgba(248,113,113,0.7)' : colors[i % colors.length]);
  }

  if (store.assetChart) store.assetChart.destroy();
  const ctx = document.getElementById('assetChart').getContext('2d');

  if(window.Chart) {
    store.assetChart = new window.Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: '자산 (VND 환산)', data, backgroundColor: bgColors }]
      },
      options: {
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ${Math.round(ctx.raw).toLocaleString()} VND`
            }
          }
        },
        scales: {
          x: { ticks: { color: '#5a5a78', callback: v => (v/1000000).toFixed(1) + 'M' }, grid: { color: '#2e2e3e' } },
          y: { ticks: { color: '#9090b0' }, grid: { display: false } }
        }
      }
    });
  }
}

async function renderBalanceTrendChart() {
  const baseCur = 'VND';
  const [y, m] = state.currentMonth.split('-').map(Number);
  const today = new Date();
  // 이번 달 1일부터 오늘(또는 말일)까지 날짜 목록 생성
  const lastDay = (today.getFullYear() === y && today.getMonth() + 1 === m)
    ? today.getDate()
    : new Date(y, m, 0).getDate();

  const labels = [];
  const dataPoints = [];

  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    labels.push(`${m}/${day}`);

    // 해당 날짜 이전까지의 모든 거래 누적 잔액 계산
    let totalVND = 0;
    for (const acc of state.accounts) {
      const cur = acc.currency || 'VND';
      let bal = Number(acc.initialBalance) || 0;
      for (const t of state.transactions) {
        const tDate = (t.date || '').slice(0, 10);
        if (tDate > dateStr) continue;
        if (t.type === 'income' && t.accountId === acc.$id) bal += Number(t.amount);
        if (t.type === 'expense' && t.accountId === acc.$id) bal -= Number(t.amount);
        if (t.type === 'transfer') {
          if (t.fromAccountId === acc.$id) bal -= Number(t.amount);
          if (t.toAccountId === acc.$id) bal += Number(t.targetAmount || t.amount);
        }
      }
      const inVND = await convertCurrency(bal, cur, baseCur);
      if (acc.type === 'loan') totalVND -= Math.abs(inVND);
      else totalVND += inVND;
    }
    dataPoints.push(Math.round(totalVND));
  }

  if (store.balanceTrendChart) store.balanceTrendChart.destroy();
  const ctx = document.getElementById('balanceTrendChart');
  if (!ctx || !window.Chart) return;

  store.balanceTrendChart = new window.Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '총 잔액 (VND)',
        data: dataPoints,
        borderColor: '#7c6af7',
        backgroundColor: 'rgba(124,106,247,0.12)',
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: '#a78bfa',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${Math.round(ctx.raw).toLocaleString()} VND` } }
      },
      scales: {
        x: { ticks: { color: '#9090b0', font: { size: 9 }, maxTicksLimit: 10 }, grid: { color: '#2e2e3e' } },
        y: { ticks: { color: '#9090b0', font: { size: 9 }, callback: v => (v/1000000).toFixed(0) + 'M' }, grid: { color: '#2e2e3e' } }
      }
    }
  });
}

// ─────────────────────────────────────────────
// 달력 렌더링
// ─────────────────────────────────────────────
export async function renderCalendarScreen() {
  const d = state.calendarDate;
  const year = d.getFullYear(), month = d.getMonth();
  const calTitle = document.getElementById('calTitle');
  if(!calTitle) return;
  calTitle.textContent = `${year}년 ${month + 1}월`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = getDaysInMonth(year, month);
  const today = new Date();
  const ym = `${year}-${String(month + 1).padStart(2, '0')}`;
  const baseCur = 'VND';

  const txs = state.transactions.filter(t => (t.date || '').replace(/\./g, '-').startsWith(ym));
  const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
  let html = dayLabels.map(l => `<div class="cal-day-label">${l}</div>`).join('');

  let monthlyCumulativeNet = 0;
  for (let i = 0; i < firstDay; i++) html += '<div></div>';

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${ym}-${String(day).padStart(2, '0')}`;
    const dayTxs = txs.filter(t => (t.date || '').replace(/\./g, '-').slice(0, 10) === dateStr);
    
    let dayInc = 0, dayExp = 0;
    for (const t of dayTxs) {
      const acc = state.accounts.find(a => a.$id === (t.accountId || t.fromAccountId));
      const cur = acc?.currency || 'VND';
      const conv = await convertCurrency(Number(t.amount), cur, baseCur);
      if (t.type === 'income') dayInc += conv;
      if (t.type === 'expense') dayExp += conv;
    }
    const dayNet = dayInc - dayExp;
    monthlyCumulativeNet += dayNet;
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

    const fInc = (v) => v > 0 ? Math.round(v).toLocaleString() : '';
    const fExp = (v) => v > 0 ? Math.round(v).toLocaleString() : '';
    const fNet = (v) => Math.round(v).toLocaleString();

    html += `<div class="cal-cell ${isToday ? 'today' : ''}" onclick="window.showCalDetail('${dateStr}')">
      <div class="cal-num">${day}</div>
      <div class="cal-daily-stats">
        ${dayInc > 0 ? `<div class="cal-inc-txt">${fInc(dayInc)}</div>` : ''}
        ${dayExp > 0 ? `<div class="cal-exp-txt">${fExp(dayExp)}</div>` : ''}
        <div class="cal-net-txt ${monthlyCumulativeNet > 0 ? 'pos' : monthlyCumulativeNet < 0 ? 'neg' : ''}">${fNet(monthlyCumulativeNet)}</div>
      </div>
    </div>`;
  }

  const calGrid = document.getElementById('calGrid');
  if(calGrid) calGrid.innerHTML = html;
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
  if(!detailEl) return;
  const txs = state.transactions.filter(t => (t.date || '').replace(/\./g, '-').slice(0, 10) === dateStr);
  detailEl.style.display = 'block';
  if (!txs.length) {
    detailEl.innerHTML = `<div class="cal-detail-date">${fmtDate(dateStr)}</div><div class="cal-detail-empty">이날 거래 내역이 없습니다</div>`;
    return;
  }
  const items = txs.map(t => renderTxItem(t)).join('');
  detailEl.innerHTML = `<div class="cal-detail-date">${fmtDate(dateStr)}</div>${items}`;
}

// 윈도우 전역 함수 등록
window.sendAiMsg = sendAiMsg;
window.renderStats = renderStatsScreen;
window.renderReport = renderReportScreen;
window.calPrevMonth = calPrevMonth;
window.calNextMonth = calNextMonth;
window.showCalDetail = showCalDetail;
window.setStatsPeriod = setStatsPeriod;
window.setStatsType = setStatsType;
window.setReportPeriod = setReportPeriod;
window.renderCalendarScreen = renderCalendarScreen;

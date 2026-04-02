import { state, fmtMoney, fmtDate, getCategoryStats, getBudgetStatus, getTimeProgress, getDaysInMonth, callGemini } from './utils.js';
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
  if (store.statsPeriod === 'monthly') {
    const month = state.currentMonth; // YYYY-MM
    return state.transactions.filter(t => t.date?.startsWith(month) && t.type === store.statsType);
  }
  // 주간 (현재 주)
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
  
  try {
    // 🚀 최적화: 환율 정보를 미리 로드 (단 1번만 호출)
    const rates = await fetchExchangeRates(baseCur);

    for (const b of budgets) {
      let usedInVnd = 0;
      const filterTxs = b.subCategory 
        ? txs.filter(t => t.mainCategory === b.category && t.subCategory === b.subCategory)
        : txs.filter(t => t.mainCategory === b.category);

      for (const t of filterTxs) {
        const acc = state.accounts.find(a => a.$id === (t.accountId || t.fromAccountId));
        const cur = acc?.currency || 'VND';
        // 🚀 최적화: 개별 API 호출 대신 가져온 rates 객체 바로 이용
        const rate = (cur === baseCur) ? 1 : (rates[cur] ? 1/rates[cur] : 1);
        usedInVnd += Number(t.amount) * rate;
      }
      
      const bAmount = Number(b.amount) || 0;
      status.push({ ...b, usedVnd: usedInVnd, percent: bAmount > 0 ? (usedInVnd / bAmount * 100).toFixed(1) : 0 });
    }

    el.innerHTML = status.map(b => {
      const pct = Math.min(Number(b.percent), 100);
      const title = b.subCategory ? `${b.category}(${b.subCategory})` : b.category;
      return `
      <div class="budget-item" style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
        <span style="flex:0 0 110px; font-size:11px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text);">${title}</span>
        <div class="progress-bg" style="flex:1; height:8px; margin-bottom:0; background:var(--bg3); border-radius:4px; overflow:hidden;">
          <div class="progress-bar" style="width:${pct}%; height:100%; border-radius:4px; background:${pct > 90 ? 'var(--expense)' : 'var(--income)'}; transition: width 0.3s;"></div>
        </div>
        <span style="flex:1.2; text-align:right; font-size:10.5px; color:var(--text2); font-family:var(--font); font-weight:500;">
          ${Math.round(b.usedVnd).toLocaleString()} / ${Math.round(Number(b.amount) || 0).toLocaleString()}
        </span>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('예산 데이터 렌더링 실패:', err);
  }
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

  // 데이터 컨텍스트 구성
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
    
    // 마크다운 줄바꿈 처리 등을 위한 간단한 변환
    const formatted = response.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    msgEl.innerHTML = formatted;
  } catch (e) {
    console.error('AI 비서 오류:', e);
    msgEl.innerHTML = `⚠️ <b>AI 분석 중 오류가 발생했습니다.</b><br><small>${e.message}</small>`;
  }
}

// 윈도우 전역 함수로 등록 (HTML 호출용)
window.sendAiMsg = sendAiMsg;
window.renderStats = renderStatsScreen;
window.renderReport = renderReportScreen;

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
          { label: '지출', data: used, backgroundColor: 'rgba(248,113,113,0.5)', borderColor: 'var(--expense)', borderWidth: 1 }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#9090b0', font: { size: 10 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${Math.round(ctx.raw).toLocaleString()} VND`
            }
          }
        },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#5a5a78', font: { size: 10 } } },
          x: { grid: { display: false }, ticks: { color: '#9090b0', font: { size: 10 } } }
        }
      }
    });
  }

  if (store.progressChart) store.progressChart.destroy();
  const ctx2 = document.getElementById('progressChart').getContext('2d');
  
  if(window.Chart) {
    store.progressChart = new window.Chart(ctx2, {
      type: 'line',
      data: {
        labels: ['시작', '현재(경과)', '종료'],
        datasets: [{
          label: '시간 경과율',
          data: [0, timeProgress, 100],
          borderColor: 'var(--accent)',
          backgroundColor: 'rgba(124,106,247,0.1)',
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { min: 0, max: 100, ticks: { color: '#5a5a78' } },
          x: { ticks: { color: '#9090b0' } }
        }
      }
    });
  }
}

function renderAssetChart() {
  const accounts = state.accounts;
  const labels = accounts.map(a => a.name);
  const data = accounts.map(a => Number(a.initialBalance)); // 단순 초기화
  const colors = ['#7c6af7','#34d399','#f87171','#fbbf24','#60a5fa','#a78bfa'];

  if (store.assetChart) store.assetChart.destroy();
  const ctx = document.getElementById('assetChart').getContext('2d');
  
  if(window.Chart) {
    store.assetChart = new window.Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: '자산', data, backgroundColor: colors.slice(0, data.length) }]
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#5a5a78' } },
          y: { ticks: { color: '#9090b0' } }
        }
      }
    });
  }
}

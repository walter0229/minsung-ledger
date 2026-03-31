import { CATEGORIES } from './config.js';
import { db } from './db.js';
import { state, getCurrencySymbol, formatNumberInput, toast, showLoading } from './utils.js';
import { closeModal, renderStats } from './main.js';

// =============================================
// 민성이의 가계부 - 예산 설정 (소분류 지원)
// =============================================

export function openBudgetModal() {
  document.getElementById('budgetMonth').value = state.currentMonth;
  renderBudgetInputList();
}

export function renderBudgetInputList() {
  const el = document.getElementById('budgetInputList');
  const ym = document.getElementById('budgetMonth').value || state.currentMonth;
  const existing = state.budgets.filter(b => b.yearMonth === ym);
  const defaultCur = state.accounts[0]?.currency || 'VND';
  const sym = getCurrencySymbol(defaultCur);

  // 대분류별로 소분류 렌더링 (아코디언 혹은 리스트)
  let html = '';
  for (const [mainCat, subCats] of Object.entries(CATEGORIES)) {
    // 해당 대분류의 총 예산액 (소분류 합산용 또는 메인 단독)
    const mainBudget = existing.find(e => e.category === mainCat && !e.subCategory);
    const mainVal = mainBudget ? Number(mainBudget.amount).toLocaleString() : '';

    html += `<div class="budget-main-group" style="margin-bottom:16px; border:1px solid var(--border); border-radius: var(--radius-sm); overflow:hidden;">`;
    html += `  <div style="background:var(--bg3); padding:10px 14px; font-weight:bold; color:var(--text); display:flex; justify-content:space-between; align-items:center;">
                 ${mainCat} 
                 <div class="amount-input-wrap" style="width: 120px;">
                    <span class="amount-symbol" style="font-size:12px;">${sym}</span>
                    <input type="text" inputmode="numeric" class="form-input" id="budget-${mainCat}-main" value="${mainVal}" placeholder="대분류 전체예산" oninput="window.formatNumberInput(this)" style="padding-left:26px; height:28px; font-size:12px;">
                 </div>
               </div>`;
    html += `  <div style="padding:10px 14px; background:var(--card); display:flex; flex-direction:column; gap:8px;">`;

    for (const sub of subCats) {
      const b = existing.find(e => e.category === mainCat && e.subCategory === sub.name);
      const val = b ? Number(b.amount).toLocaleString() : '';
      html += `    <div class="form-group" style="margin-bottom:0; display:flex; align-items:center;">
                     <label class="form-label" style="margin-bottom:0; width:90px; font-size:13px; color:var(--text2);">↳ ${sub.name}</label>
                     <div class="amount-input-wrap" style="flex:1;">
                       <span class="amount-symbol" style="font-size:12px;">${sym}</span>
                       <input type="text" inputmode="numeric" class="form-input" id="budget-${mainCat}-sub-${sub.id}" value="${val}" placeholder="0" data-main="${mainCat}" data-sub="${sub.name}" oninput="window.formatNumberInput(this)" style="padding-left:26px; height:32px; font-size:13px;">
                     </div>
                   </div>`;
    }
    html += `  </div>`;
    html += `</div>`;
  }

  el.innerHTML = html;
}

export async function saveBudgets() {
  const ym = document.getElementById('budgetMonth').value || state.currentMonth;
  
  showLoading(true);
  try {
    for (const [mainCat, subCats] of Object.entries(CATEGORIES)) {
      // 대분류 전체 예산 저장
      const mainInp = document.getElementById(`budget-${mainCat}-main`);
      if (mainInp) {
        const raw = mainInp.dataset.raw || mainInp.value.replace(/,/g, '');
        if (raw) {
          const saved = await db.saveBudget({ category: mainCat, amount: Number(raw), yearMonth: ym, subCategory: null });
          updateLocalBudgetStore(saved);
        }
      }

      // 소분류 개별 예산 저장
      for (const sub of subCats) {
        const inp = document.getElementById(`budget-${mainCat}-sub-${sub.id}`);
        if (!inp) continue;
        const raw = inp.dataset.raw || inp.value.replace(/,/g, '');
        if (!raw) continue;
        const saved = await db.saveBudget({ category: mainCat, amount: Number(raw), yearMonth: ym, subCategory: sub.name });
        updateLocalBudgetStore(saved);
      }
    }
    
    toast('✅ 소분류가 적용된 예산이 저장됐어요!');
    closeModal('budgetModal');
    // 통계 및 예산 막대 갱신
    if(typeof window.renderStats === 'function') window.renderStats();
  } catch(e) { 
    toast('❌ ' + e.message, 'error'); 
  }
  showLoading(false);
}

function updateLocalBudgetStore(saved) {
  const idx = state.budgets.findIndex(b => b.category === saved.category && b.yearMonth === saved.yearMonth && b.subCategory === saved.subCategory);
  if (idx >= 0) state.budgets[idx] = saved;
  else state.budgets.push(saved);
}

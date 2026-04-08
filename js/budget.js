import { CATEGORIES } from './config.js';
import { db } from './db.js';
import { state, getCurrencySymbol, formatNumberInput, toast, showLoading } from './utils.js';
import { openModal, closeModal } from './ui.js';


// =============================================
// 민성이의 가계부 - 예산 설정 (소분류 지원)
// =============================================

export function openBudgetModal() {
  document.getElementById('budgetMonth').value = state.currentMonth;
  renderBudgetInputList();
  openModal('budgetModal');
}

export function renderBudgetInputList() {
  const el = document.getElementById('budgetInputList');
  const rawYm = document.getElementById('budgetMonth').value || state.currentMonth;
  const ym = (rawYm || '').replace(/\./g, '-'); // 🚀 날짜 포맷 강제 표준화
  const existing = state.budgets.filter(b => (b.yearMonth || '').replace(/\./g, '-') === ym);
  const defaultCur = state.accounts[0]?.currency || 'VND';
  const sym = getCurrencySymbol(defaultCur);

  let html = '';
  for (const [mainCat, subCats] of Object.entries(CATEGORIES)) {
    // 소분류 합계 계산
    const subs = existing.filter(e => e.category === mainCat && e.subCategory);
    const subTotal = subs.reduce((s, b) => s + Number(b.amount), 0);
    
    // 대분류 예산 (직접 입력한 값이 있으면 우선, 없으면 소분류 합계 프리뷰)
    const mainRecord = existing.find(e => e.category === mainCat && !e.subCategory);
    const mainVal = mainRecord ? Number(mainRecord.amount).toLocaleString() : subTotal > 0 ? subTotal.toLocaleString() : '';

    html += `<div class="budget-main-group" data-category="${mainCat}" style="margin-bottom:12px; border:1px solid var(--border); border-radius: var(--radius-sm); overflow:hidden;">`;
    html += `  <div style="background:var(--bg3); padding:8px 12px; font-weight:bold; color:var(--text); display:flex; justify-content:space-between; align-items:center;">
                 <span style="font-size:14px;">${mainCat} <small style="font-weight:normal; color:var(--text2); font-size:11px;">(계산된 합계)</small></span> 
                 <div class="amount-input-wrap" style="width: 130px;">
                    <span class="amount-symbol" style="font-size:11px;">${sym}</span>
                    <input type="text" inputmode="numeric" class="form-input" id="budget-${mainCat}-main" value="${mainVal}" placeholder="직접 입력 시 우선" oninput="window.formatNumberInput(this)" style="padding-left:24px; height:28px; font-size:13px; text-align:right;">
                 </div>
               </div>`;
    html += `  <div style="padding:8px 12px; background:var(--card); display:flex; flex-direction:column; gap:6px;">`;

    for (const sub of subCats) {
      const b = existing.find(e => e.category === mainCat && e.subCategory === sub.name);
      const val = b ? Number(b.amount).toLocaleString() : '';
      html += `    <div class="form-group" style="margin-bottom:0; display:flex; align-items:center; gap:8px;">
                     <label class="form-label" style="margin-bottom:0; width:80px; font-size:12px; color:var(--text2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">↳ ${sub.name}</label>
                     <div class="amount-input-wrap" style="flex:1;">
                       <span class="amount-symbol" style="font-size:11px;">${sym}</span>
                       <input type="text" inputmode="numeric" class="form-input sub-budget-input" 
                         id="budget-${mainCat}-sub-${sub.id}" value="${val}" placeholder="0" 
                         data-main="${mainCat}" 
                         oninput="window.formatNumberInput(this); window.updateCategoryTotal('${mainCat}')" 
                         style="padding-left:24px; height:30px; font-size:13px; text-align:right;">
                     </div>
                   </div>`;
    }
    html += `  </div>`;
    html += `</div>`;
  }
  el.innerHTML = html;
}

// 소분류 입력 시 실시간으로 대분류 합계 칸 업데이트
export function updateCategoryTotal(mainCat) {
  const group = document.querySelector(`.budget-main-group[data-category="${mainCat}"]`);
  if (!group) return;
  const subInputs = group.querySelectorAll('.sub-budget-input');
  let total = 0;
  subInputs.forEach(inp => {
    const v = (inp.dataset.raw || inp.value).replace(/,/g, '');
    if (v) total += Number(v);
  });
  const mainInp = document.getElementById(`budget-${mainCat}-main`);
  if (mainInp) {
    mainInp.value = total > 0 ? total.toLocaleString() : '';
    mainInp.dataset.raw = total;
  }
}

export async function saveBudgets() {
  const rawYm = document.getElementById('budgetMonth').value || state.currentMonth;
  const ym = (rawYm || '').replace(/\./g, '-');
  
  showLoading(true, '예산 저장 중...');
  try {
    // 🚀 전체 목록을 먼저 딱 한 번만 가져옴
    const existingList = await db.getBudgets();
    
    for (const [mainCat, subCats] of Object.entries(CATEGORIES)) {
      // 대분류 전체 예산 저장
      const mainInp = document.getElementById(`budget-${mainCat}-main`);
      if (mainInp) {
        const raw = (mainInp.dataset.raw || mainInp.value || '0').replace(/,/g, '');
        const saved = await db.saveBudget({ category: mainCat, amount: Number(raw)||0, yearMonth: ym, subCategory: null }, existingList);
        updateLocalBudgetStore(saved);
      }

      // 소분류 개별 예산 저장
      for (const sub of subCats) {
        const inp = document.getElementById(`budget-${mainCat}-sub-${sub.id}`);
        if (!inp) continue;
        const raw = (inp.dataset.raw || inp.value || '0').replace(/,/g, '');
        const saved = await db.saveBudget({ category: mainCat, amount: Number(raw)||0, yearMonth: ym, subCategory: sub.name }, existingList);
        updateLocalBudgetStore(saved);
      }
    }
    
    toast('✅ 모든 예산이 안전하게 저장됐어요!');
    if(window.closeModal) window.closeModal('budgetModal');
    if(typeof window.renderStats === 'function') window.renderStats();
  } catch(e) { 
    console.error('예산 저장 최종 실패:', e);
    toast('❌ 저장 실패: ' + (e.message || '알 수 없는 오류'), 'error'); 
    alert('⚠️ 예산 저장 중 오류가 발생했습니다.\n\n사유: ' + (e.message || '서버 연결 불안정 또는 권한 문제') + '\n\n페이지를 새로고침한 후 다시 시도해 주세요.');
  }
  showLoading(false);
}

function updateLocalBudgetStore(saved) {
  const idx = state.budgets.findIndex(b => b.category === saved.category && b.yearMonth === saved.yearMonth && b.subCategory === saved.subCategory);
  if (idx >= 0) state.budgets[idx] = saved;
  else state.budgets.push(saved);
}

// 전역 함수 자가 등록
window.openBudgetModal = openBudgetModal;
window.saveBudgets = saveBudgets;
window.updateCategoryTotal = updateCategoryTotal;
window.renderBudgetInputList = renderBudgetInputList;

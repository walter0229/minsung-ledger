import { CATEGORIES } from './config.js';
import { db } from './db.js';
import { state, getCurrencySymbol, formatNumberInput, toast, showLoading, getEffectiveBudgets } from './utils.js';
import { openModal, closeModal } from './ui.js';

// =============================================
// 민성이의 가계부 - 예산 설정 (소분류 지원 & 자동 동기화)
// =============================================

export function getNextMonth(ymStr) {
  const [y, m] = (ymStr || '').replace(/\./g, '-').split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function openBudgetModal() {
  document.getElementById('budgetMonth').value = state.currentMonth;
  renderBudgetInputList();
  openModal('budgetModal');
}

export function renderBudgetInputList() {
  const el = document.getElementById('budgetInputList');
  const rawYm = document.getElementById('budgetMonth').value || state.currentMonth;
  const ym = (rawYm || '').replace(/\./g, '-');
  // 해당 월에 예산이 없으면 가장 최근 설정된 월의 예산을 승계하여 프리뷰
  const existing = getEffectiveBudgets(ym);
  const defaultCur = state.accounts[0]?.currency || 'VND';
  const sym = getCurrencySymbol(defaultCur);

  let html = '';
  for (const [mainCat, subCats] of Object.entries(CATEGORIES)) {
    // 소분류 합계 계산
    const subs = existing.filter(e => e.category === mainCat && e.subCategory);
    const subTotal = subs.reduce((s, b) => s + Number(b.amount || 0), 0);
    
    // 소분류가 있으면 소분류 합계가 대분류 금액으로 고정, 없으면 직접 입력값
    const hasSubCats = subCats && subCats.length > 0;
    const mainRecord = existing.find(e => e.category === mainCat && !e.subCategory);
    const mainVal = hasSubCats ? (subTotal > 0 ? subTotal.toLocaleString() : '0') : (mainRecord ? Number(mainRecord.amount).toLocaleString() : '');

    html += `<div class="budget-main-group" data-category="${mainCat}" style="margin-bottom:12px; border:1px solid var(--border); border-radius: var(--radius-sm); overflow:hidden;">`;
    html += `  <div style="background:var(--bg3); padding:8px 12px; font-weight:bold; color:var(--text); display:flex; justify-content:space-between; align-items:center;">
                 <span style="font-size:14px;">${mainCat} <small style="font-weight:normal; color:#a78bfa; font-size:11px;">${hasSubCats ? '(소분류 합계 자동반영)' : '(직접 입력)'}</small></span> 
                 <div class="amount-input-wrap" style="width: 130px;">
                    <span class="amount-symbol" style="font-size:11px;">${sym}</span>
                    <input type="text" inputmode="numeric" class="form-input" id="budget-${mainCat}-main" value="${mainVal}" ${hasSubCats ? 'readonly' : ''} oninput="window.formatNumberInput(this)" style="padding-left:24px; height:28px; font-size:13px; text-align:right; ${hasSubCats ? 'background:rgba(255,255,255,0.05); color:var(--text2); cursor:not-allowed;' : ''}">
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

// 소분류 입력 시 실시간으로 대분류 합계 칸 업데이트 (소분류 합계로 강제 동기화)
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
    mainInp.value = total > 0 ? total.toLocaleString() : '0';
    mainInp.dataset.raw = total;
  }
}

export async function saveBudgets() {
  const rawYm = document.getElementById('budgetMonth').value || state.currentMonth;
  const ym = (rawYm || '').replace(/\./g, '-');
  const nextYm = getNextMonth(ym);
  
  showLoading(true, '예산 저장 및 다음 달 자동 반영 중...');
  try {
    const existingList = await db.getBudgets();
    
    // 현재 월과 다음 달 둘 다에 예산 동일 반영
    const targetMonths = [ym, nextYm];

    for (const targetMonth of targetMonths) {
      for (const [mainCat, subCats] of Object.entries(CATEGORIES)) {
        // 소분류 합계 계산
        let subTotal = 0;
        const subData = [];
        for (const sub of subCats) {
          const inp = document.getElementById(`budget-${mainCat}-sub-${sub.id}`);
          const raw = inp ? (inp.dataset.raw || inp.value || '0').replace(/,/g, '') : '0';
          const amt = Number(raw) || 0;
          subTotal += amt;
          subData.push({ subName: sub.name, amount: amt });
        }

        // 대분류 저장 (소분류가 있으면 소분류 합계로 100% 강제 일치)
        const hasSubCats = subCats && subCats.length > 0;
        let mainAmt = subTotal;
        if (!hasSubCats) {
          const mainInp = document.getElementById(`budget-${mainCat}-main`);
          const rawMain = mainInp ? (mainInp.dataset.raw || mainInp.value || '0').replace(/,/g, '') : '0';
          mainAmt = Number(rawMain) || 0;
        }

        const savedMain = await db.saveBudget({ category: mainCat, amount: mainAmt, yearMonth: targetMonth, subCategory: null }, existingList);
        updateLocalBudgetStore(savedMain);

        // 소분류 개별 저장
        for (const s of subData) {
          const savedSub = await db.saveBudget({ category: mainCat, amount: s.amount, yearMonth: targetMonth, subCategory: s.subName }, existingList);
          updateLocalBudgetStore(savedSub);
        }
      }
    }
    
    toast(`✅ 예산이 저장되었으며, 다음 달(${nextYm})에도 자동 반영됐어요!`);
    if(window.closeModal) window.closeModal('budgetModal');
    if(typeof window.renderStats === 'function') window.renderStats();
    if(typeof window.renderCalendar === 'function') window.renderCalendar();
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

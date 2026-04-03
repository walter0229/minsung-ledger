// =============================================
// 민성이의 가계부 - 전역 상태 로컬 보관소
// =============================================

export const store = {
  currentTxType: 'expense',
  selectedTxAccountId: null,
  selectedTxIcon: null,
  selectedTransferFrom: null,
  selectedTransferTo: null,
  selectedCurrencyIcon: null,
  selectedBankIcon: null,
  editingTxId: null,
  statsPeriod: 'monthly',
  statsType: 'expense',
  reportPeriod: 'monthly',
  donutChart: null,
  usageChart: null,
  progressChart: null,
  assetChart: null,
  balanceTrendChart: null,
};

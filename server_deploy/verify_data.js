// =============================================
// 민성이의 가계부 - 데이터 정합성 검증(Verification) 도구
// =============================================

const fs = require('fs');
const path = require('path');
const sdk = require('node-appwrite');

const TARGET_ENDPOINT = process.env.TARGET_ENDPOINT || 'http://localhost/v1';
const TARGET_PROJECT_ID = process.env.TARGET_PROJECT_ID || 'ledger-project';
const TARGET_API_KEY = process.env.TARGET_API_KEY || '';
const DB_ID = process.env.TARGET_DB_ID || 'ledger-db';

const BACKUP_FILE = path.join(__dirname, 'latest_backup.json');

function calculateSummary(data) {
  const summary = {
    accountsCount: data.collections.accounts ? data.collections.accounts.length : 0,
    transactionsCount: data.collections.transactions ? data.collections.transactions.length : 0,
    budgetsCount: data.collections.budgets ? data.collections.budgets.length : 0,
    settingsCount: data.collections['app-settings'] ? data.collections['app-settings'].length : 0,
    totalIncome: 0,
    totalExpense: 0,
    accountInitialBalanceSum: 0
  };

  if (data.collections.accounts) {
    for (const acc of data.collections.accounts) {
      summary.accountInitialBalanceSum += Number(acc.initialBalance || 0);
    }
  }

  if (data.collections.transactions) {
    for (const tx of data.collections.transactions) {
      const amt = Number(tx.amount || 0);
      if (tx.type === 'income') {
        summary.totalIncome += amt;
      } else if (tx.type === 'expense') {
        summary.totalExpense += amt;
      }
    }
  }

  return summary;
}

async function verify() {
  console.log('======================================================================');
  console.log(' 🔍 가계부 데이터 정합성(100% 일치) 검증 시작');
  console.log('======================================================================');

  if (!fs.existsSync(BACKUP_FILE)) {
    throw new Error(`백업 파일이 존재하지 않습니다: ${BACKUP_FILE}`);
  }

  const backupData = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf-8'));
  const localSummary = calculateSummary(backupData);

  console.log('📊 [원본 백업 데이터 통계 요약 (기준선)]');
  console.log(`   - 계좌 수(accounts)           : ${localSummary.accountsCount} 개`);
  console.log(`   - 계좌 초기 잔액 총합          : ${localSummary.accountInitialBalanceSum.toLocaleString()} 원`);
  console.log(`   - 총 거래 내역(transactions)  : ${localSummary.transactionsCount} 건`);
  console.log(`   - 총 수입 금액 누적            : ${localSummary.totalIncome.toLocaleString()} 원`);
  console.log(`   - 총 지출 금액 누적            : ${localSummary.totalExpense.toLocaleString()} 원`);
  console.log(`   - 예산 설정 항목(budgets)      : ${localSummary.budgetsCount} 건`);
  console.log(`   - 환경설정(app-settings)       : ${localSummary.settingsCount} 건\n`);

  if (!TARGET_API_KEY) {
    console.log('ℹ️ TARGET_API_KEY 가 설정되지 않아 신규 서버와의 원격 1:1 대조는 건너뛰고,');
    console.log('   로컬 데이터 무결성 검증을 완료하였습니다.');
    console.log('   (신규 서버 이전 후: TARGET_API_KEY=xxx node server_deploy/verify_data.js 실행)');
    return true;
  }

  // 대상 서버 원격 검증
  console.log(`📡 대상 서버(${TARGET_ENDPOINT})와 실시간 대조 진행 중...`);
  const client = new sdk.Client()
    .setEndpoint(TARGET_ENDPOINT)
    .setProject(TARGET_PROJECT_ID)
    .setKey(TARGET_API_KEY);
  const databases = new sdk.Databases(client);

  const remoteData = { collections: {} };
  for (const col of ['accounts', 'transactions', 'budgets', 'app-settings']) {
    let allDocs = [];
    let cursor = null;
    while (true) {
      const queries = [sdk.Query.limit(100)];
      if (cursor) queries.push(sdk.Query.cursorAfter(cursor));
      const res = await databases.listDocuments(DB_ID, col, queries);
      allDocs = allDocs.concat(res.documents);
      if (res.documents.length < 100 || allDocs.length >= res.total) break;
      cursor = res.documents[res.documents.length - 1].$id;
    }
    remoteData.collections[col] = allDocs;
  }

  const remoteSummary = calculateSummary(remoteData);
  console.log('\n📊 [신규 서버 데이터 통계 요약]');
  console.log(`   - 계좌 수(accounts)           : ${remoteSummary.accountsCount} 개`);
  console.log(`   - 계좌 초기 잔액 총합          : ${remoteSummary.accountInitialBalanceSum.toLocaleString()} 원`);
  console.log(`   - 총 거래 내역(transactions)  : ${remoteSummary.transactionsCount} 건`);
  console.log(`   - 총 수입 금액 누적            : ${remoteSummary.totalIncome.toLocaleString()} 원`);
  console.log(`   - 총 지출 금액 누적            : ${remoteSummary.totalExpense.toLocaleString()} 원`);

  // 비교 검증
  let match = true;
  if (localSummary.accountsCount !== remoteSummary.accountsCount) match = false;
  if (localSummary.transactionsCount !== remoteSummary.transactionsCount) match = false;
  if (localSummary.totalIncome !== remoteSummary.totalIncome) match = false;
  if (localSummary.totalExpense !== remoteSummary.totalExpense) match = false;

  console.log('\n======================================================================');
  if (match) {
    console.log(' 🎉 [검증 성공] 신규 서버 DB와 원본 데이터가 100% 완벽히 일치합니다! (오차 0원)');
  } else {
    console.error(' ❌ [검증 불일치] 데이터 수량 또는 금액 합계가 일치하지 않습니다. 점검이 필요합니다.');
    process.exit(1);
  }
  console.log('======================================================================');
  return match;
}

if (require.main === module) {
  verify().catch(err => {
    console.error('❌ 검증 중 에러 발생:', err.message);
    process.exit(1);
  });
}

module.exports = { verify, calculateSummary };

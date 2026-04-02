
const sdk = require('node-appwrite');
const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '69ca6dd30013a519ec48';
const APPWRITE_SECRET = 'standard_fa6edc6cc9bedfb43dfc66765bd9dba98211f1d96ca6f1320e679d7f345941bafe904d52c172586aa41590db7a00ce4c8d94010546d142a0179f9995390f381daac3fc4a3012e53b1fcb4c5074b8728796483f1903026d202df60fa0c931b749480325bc10ff6c44e553f1a3d7d667eb99c3ec8e05fb169ab9bb2626a126a030';
const DB_ID = 'ledger-db';

const client = new sdk.Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID).setKey(APPWRITE_SECRET);
const databases = new sdk.Databases(client);

async function diagnose() {
    try {
        console.log('🧐 중복 데이터 및 예산 구조 정밀 진단 시작...');
        const month = '2026-04';

        // 1. 거래 내역 중복 체크
        const txs = await databases.listDocuments(DB_ID, 'transactions', [sdk.Query.limit(5000)]);
        const txGroups = {};
        txs.documents.filter(d => d.date.startsWith(month)).forEach(t => {
            const key = `${t.date}_${t.amount}_${t.memo}_${t.mainCategory}`;
            txGroups[key] = (txGroups[key] || 0) + 1;
        });
        const dupTxs = Object.values(txGroups).filter(v => v > 1).length;
        console.log(`- 4월 거래 내역 중 중복 의심 건수: ${dupTxs}세트`);

        // 2. 예산 구조 체크
        const buds = await databases.listDocuments(DB_ID, 'budgets', [sdk.Query.equal('yearMonth', month)]);
        console.log(`- 4월 설정된 예산 건수: ${buds.total}개`);
        buds.documents.forEach(b => {
             console.log(`  [${b.category}] ${b.subCategory || '(마스터)'} : ${b.amount}`);
        });

    } catch (e) { console.error(e.message); }
}
diagnose();

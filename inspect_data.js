
const sdk = require('node-appwrite');

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '69ca6dd30013a519ec48';
const APPWRITE_SECRET = 'standard_fa6edc6cc9bedfb43dfc66765bd9dba98211f1d96ca6f1320e679d7f345941bafe904d52c172586aa41590db7a00ce4c8d94010546d142a0179f9995390f381daac3fc4a3012e53b1fcb4c5074b8728796483f1903026d202df60fa0c931b749480325bc10ff6c44e553f1a3d7d667eb99c3ec8e05fb169ab9bb2626a126a030';
const DB_ID = 'ledger-db';

const client = new sdk.Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID).setKey(APPWRITE_SECRET);
const databases = new sdk.Databases(client);

async function inspectData() {
    try {
        console.log('🔍 데이터 정밀 분석 시작...');

        // 1. 계좌 이름 확인
        const accs = await databases.listDocuments(DB_ID, 'accounts');
        console.log('\n🏦 복구된 계좌 목록:');
        accs.documents.forEach(a => console.log(`- ${a.name} (${a.currency}) - $id: ${a.$id}`));

        // 2. 거래 날짜 분포 확인
        const txs = await databases.listDocuments(DB_ID, 'transactions', [sdk.Query.limit(10), sdk.Query.orderDesc('date')]);
        console.log('\n📝 최근 거래 샘플 (날짜 확인):');
        txs.documents.forEach(t => console.log(`- [${t.date}] ${t.memo || '내역없음'}: ${t.amount} ${t.mainCategory || ''}`));

        // 3. 예산 연월 확인
        const buds = await databases.listDocuments(DB_ID, 'budgets', [sdk.Query.limit(5)]);
        console.log('\n📅 설정된 예산 기간 샘플:');
        buds.documents.forEach(b => console.log(`- ${b.yearMonth}: ${b.category}`));

    } catch (e) {
        console.error('❌ 분석 실패:', e.message);
    }
}
inspectData();

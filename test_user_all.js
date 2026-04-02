
const sdk = require('node-appwrite');
const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '69ca6dd30013a519ec48';
const DB_ID = 'ledger-db';

const client = new sdk.Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID);
const databases = new sdk.Databases(client);

async function testAll() {
    for (const colId of ['accounts', 'transactions', 'budgets']) {
        try {
            const res = await databases.listDocuments(DB_ID, colId);
            console.log(`✅ [${colId}] 총 ${res.total}개의 공개 데이터 확인 완료!`);
        } catch (e) {
            console.log(`❌ [${colId}] 접근 실패: ${e.message}`);
        }
    }
}
testAll();

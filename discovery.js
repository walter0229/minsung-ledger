
const sdk = require('node-appwrite');
const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '69ca6dd30013a519ec48';
const APPWRITE_SECRET = 'standard_fa6edc6cc9bedfb43dfc66765bd9dba98211f1d96ca6f1320e679d7f345941bafe904d52c172586aa41590db7a00ce4c8d94010546d142a0179f9995390f381daac3fc4a3012e53b1fcb4c5074b8728796483f1903026d202df60fa0c931b749480325bc10ff6c44e553f1a3d7d667eb99c3ec8e05fb169ab9bb2626a126a030';
const DB_ID = 'ledger-db';

const client = new sdk.Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID).setKey(APPWRITE_SECRET);
const databases = new sdk.Databases(client);

async function findTheData() {
    try {
        console.log('--- 데이터베이스 탐색 ---');
        const dbList = await databases.list();
        console.log('DB 목록:', dbList.databases.map(d => `${d.name} (${d.$id})`));

        console.log(`\n--- [${DB_ID}] 컬렉션 탐색 ---`);
        const colList = await databases.listCollections(DB_ID);
        for (const col of colList.collections) {
            const docs = await databases.listDocuments(DB_ID, col.$id, [sdk.Query.limit(1)]);
            console.log(`- ${col.name} (${col.$id}): ${docs.total} docs`);
        }
    } catch (e) {
        console.error('탐색 실패:', e.message);
    }
}
findTheData();

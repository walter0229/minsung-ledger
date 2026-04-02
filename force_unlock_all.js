
const sdk = require('node-appwrite');
const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '69ca6dd30013a519ec48';
const APPWRITE_SECRET = 'standard_fa6edc6cc9bedfb43dfc66765bd9dba98211f1d96ca6f1320e679d7f345941bafe904d52c172586aa41590db7a00ce4c8d94010546d142a0179f9995390f381daac3fc4a3012e53b1fcb4c5074b8728796483f1903026d202df60fa0c931b749480325bc10ff6c44e553f1a3d7d667eb99c3ec8e05fb169ab9bb2626a126a030';
const DB_ID = 'ledger-db';

const client = new sdk.Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID).setKey(APPWRITE_SECRET);
const databases = new sdk.Databases(client);

async function forceUnlock() {
    const targetCols = ['transactions', 'budgets'];
    const perms = [
        sdk.Permission.read(sdk.Role.any()),
        sdk.Permission.create(sdk.Role.any()),
        sdk.Permission.update(sdk.Role.any()),
        sdk.Permission.delete(sdk.Role.any())
    ];

    for (const colId of targetCols) {
        console.log(`\n🚨 [${colId}] 권한 강제 주입 중...`);
        try {
            const res = await databases.listDocuments(DB_ID, colId, [sdk.Query.limit(5000)]);
            console.log(`   - 발견된 문서: ${res.total}개`);
            
            let count = 0;
            for (const doc of res.documents) {
                try {
                    await databases.updateDocument(DB_ID, colId, doc.$id, undefined, perms);
                    count++;
                    if (count % 50 === 0) console.log(`   ... ${count}개 완료`);
                } catch (e) {
                    console.error(`   ❌ [${doc.$id}] 실패: ${e.message}`);
                }
            }
            console.log(`   ✅ ${count}개 문서 권한 주입 성공!`);
        } catch (e) {
            console.error(`   ❌ 컬렉션 로드 실패: ${e.message}`);
        }
    }
    console.log('\n✨ 모든 거래와 예산의 자물쇠를 풀었습니다. 이제 정말 보일 겁니다!');
}
forceUnlock();


const sdk = require('node-appwrite');
const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '69ca6dd30013a519ec48';
const APPWRITE_SECRET = 'standard_fa6edc6cc9bedfb43dfc66765bd9dba98211f1d96ca6f1320e679d7f345941bafe904d52c172586aa41590db7a00ce4c8d94010546d142a0179f9995390f381daac3fc4a3012e53b1fcb4c5074b8728796483f1903026d202df60fa0c931b749480325bc10ff6c44e553f1a3d7d667eb99c3ec8e05fb169ab9bb2626a126a030';
const DB_ID = 'ledger-db';

const client = new sdk.Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID).setKey(APPWRITE_SECRET);
const databases = new sdk.Databases(client);

async function addAttribute() {
    try {
        console.log('🛠️ Budgets 컬렉션에 subCategory 속성 추가 시도...');
        await databases.createStringAttribute(
            DB_ID,
            'budgets',
            'subCategory',
            255,   // length
            false, // required (상세 카테고리는 없을 수도 있음)
            '',    // default
            false  // array
        );
        console.log('✅ subCategory 속성이 추가되었습니다! 서버 반영 대기 중...');
    } catch (e) {
        if (e.message.includes('already exists')) {
            console.log('ℹ️ 이미 존재하는 속성입니다.');
        } else {
            console.error('❌ 실패:', e.message);
        }
    }
}
addAttribute();

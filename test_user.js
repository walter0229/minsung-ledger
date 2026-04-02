
const sdk = require('node-appwrite');

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '69ca6dd30013a519ec48';
const DB_ID = 'ledger-db';

// 🚀 시크릿 키 없이 '일반 사용자'처럼 접속 시도
const client = new sdk.Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID);
const databases = new sdk.Databases(client);

async function simulateUser() {
    console.log('🧪 일반 사용자 권한으로 데이터 로드 테스트...');
    try {
        const res = await databases.listDocuments(DB_ID, 'transactions', [sdk.Query.limit(1)]);
        console.log(`✅ 성공! ${res.total}개의 데이터를 확인했습니다.`);
    } catch (e) {
        console.error(`❌ 실패: ${e.message}`);
        console.log('💡 원인 분석: 여전히 일반 사용자의 접근이 제한되어 있습니다.');
    }
}
simulateUser();

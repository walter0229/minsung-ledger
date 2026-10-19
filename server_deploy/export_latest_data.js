// =============================================
// 민성이의 가계부 - Appwrite Cloud 최신 데이터 실시간 덤프 도구
// =============================================

const https = require('https');
const fs = require('fs');
const path = require('path');

const ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const PROJECT_ID = '69ca6dd30013a519ec48';
const DB_ID = 'ledger-db';

const COLLECTIONS = ['accounts', 'transactions', 'budgets', 'app-settings'];

function request(url, options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data: body });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function buildQuery(method, values) {
  return encodeURIComponent(JSON.stringify({ method, values }));
}

async function exportAllData() {
  console.log('🚀 [1/3] Appwrite Cloud 세션 연결 중...');
  const sessionRes = await request(`${ENDPOINT}/account/sessions/anonymous`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Appwrite-Project': PROJECT_ID
    }
  }, '{}');

  if (sessionRes.status !== 201) {
    throw new Error(`세션 생성 실패 (HTTP ${sessionRes.status}): ${JSON.stringify(sessionRes.data)}`);
  }

  const cookie = sessionRes.headers['set-cookie']
    ? sessionRes.headers['set-cookie'].map(c => c.split(';')[0]).join('; ')
    : '';

  console.log('✅ 세션 연결 성공! 실시간 데이터 다운로드를 시작합니다.');

  const backupData = {
    exportedAt: new Date().toISOString(),
    sourceEndpoint: ENDPOINT,
    projectId: PROJECT_ID,
    databaseId: DB_ID,
    collections: {}
  };

  for (const colId of COLLECTIONS) {
    console.log(`\n📦 컬렉션 조회 중: [${colId}]`);
    let allDocuments = [];
    let cursor = null;
    const PAGE_SIZE = 100;

    while (true) {
      let queryParams = [`queries[]=${buildQuery('limit', [PAGE_SIZE])}`];
      if (cursor) {
        queryParams.push(`queries[]=${buildQuery('cursorAfter', [cursor])}`);
      }

      const url = `${ENDPOINT}/databases/${DB_ID}/collections/${colId}/documents?${queryParams.join('&')}`;

      const res = await request(url, {
        method: 'GET',
        headers: {
          'X-Appwrite-Project': PROJECT_ID,
          'Cookie': cookie
        }
      });

      if (res.status !== 200) {
        console.warn(`\n⚠️ [${colId}] 조회 오류 (HTTP ${res.status}):`, res.data);
        break;
      }

      const docs = res.data.documents || [];
      allDocuments = allDocuments.concat(docs);
      process.stdout.write(`\r  - 로드 진행: ${allDocuments.length} / 총 ${res.data.total}건`);

      if (docs.length < PAGE_SIZE || allDocuments.length >= res.data.total) {
        break;
      }

      cursor = docs[docs.length - 1].$id;
    }

    backupData.collections[colId] = allDocuments;
    console.log(`\n  ✅ [${colId}] 완료: 총 ${allDocuments.length}개 문서 확보`);
  }

  const outPath = path.join(__dirname, 'latest_backup.json');
  fs.writeFileSync(outPath, JSON.stringify(backupData, null, 2), 'utf-8');
  console.log(`\n🎉 [3/3] 최신 백업 파일 저장 완료: ${outPath}`);
  console.log(`📊 다운로드 데이터 통계:`);
  for (const colId of COLLECTIONS) {
    console.log(`   - ${colId.padEnd(14)}: ${backupData.collections[colId].length}건`);
  }

  return backupData;
}

if (require.main === module) {
  exportAllData().catch(err => {
    console.error('❌ 백업 중 오류 발생:', err);
    process.exit(1);
  });
}

module.exports = { exportAllData };

// =============================================
// 민성이의 가계부 - 신규 서버 데이터베이스 마이그레이션 도구
// =============================================

const fs = require('fs');
const path = require('path');
const sdk = require('node-appwrite');

// 명령줄 인자 파싱
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

// 설정값 (환경 변수 또는 기본값)
const TARGET_ENDPOINT = process.env.TARGET_ENDPOINT || 'http://localhost/v1';
const TARGET_PROJECT_ID = process.env.TARGET_PROJECT_ID || 'ledger-project';
const TARGET_API_KEY = process.env.TARGET_API_KEY || '';
const DB_ID = process.env.TARGET_DB_ID || 'ledger-db';

const BACKUP_FILE = path.join(__dirname, 'latest_backup.json');

// 스키마 정의 (신규 서버 DB 생성 시 사용)
const SCHEMA_DEFINITIONS = {
  accounts: [
    { key: 'name', type: 'string', size: 128, required: true },
    { key: 'type', type: 'string', size: 64, required: true },
    { key: 'currency', type: 'string', size: 16, required: true },
    { key: 'currencyIcon', type: 'string', size: 256, required: false },
    { key: 'bankIcon', type: 'string', size: 256, required: false },
    { key: 'initialBalance', type: 'double', required: false, default: 0 },
    { key: 'order', type: 'integer', required: false, default: 0 }
  ],
  transactions: [
    { key: 'type', type: 'string', size: 32, required: true },
    { key: 'date', type: 'string', size: 32, required: true },
    { key: 'memo', type: 'string', size: 512, required: false },
    { key: 'accountId', type: 'string', size: 64, required: false },
    { key: 'fromAccountId', type: 'string', size: 64, required: false },
    { key: 'toAccountId', type: 'string', size: 64, required: false },
    { key: 'mainCategory', type: 'string', size: 128, required: false },
    { key: 'subCategory', type: 'string', size: 128, required: false },
    { key: 'iconKey', type: 'string', size: 128, required: false },
    { key: 'amount', type: 'double', required: true }
  ],
  budgets: [
    { key: 'category', type: 'string', size: 128, required: true },
    { key: 'yearMonth', type: 'string', size: 16, required: true },
    { key: 'amount', type: 'double', required: true },
    { key: 'subCategory', type: 'string', size: 128, required: false }
  ],
  'app-settings': [
    { key: 'geminiApiKey', type: 'string', size: 256, required: false },
    { key: 'theme', type: 'string', size: 32, required: false },
    { key: 'reminderEnabled', type: 'boolean', required: false, default: false },
    { key: 'reminderTime', type: 'string', size: 16, required: false }
  ]
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runMigration() {
  console.log('======================================================================');
  console.log(` 🚚 가계부 DB 마이그레이션 도구 시작 ${isDryRun ? '(🔍 Dry-run 시뮬레이션 모드)' : ''}`);
  console.log('======================================================================');

  if (!fs.existsSync(BACKUP_FILE)) {
    throw new Error(`백업 파일을 찾을 수 없습니다: ${BACKUP_FILE}\n먼저 'node server_deploy/export_latest_data.js'를 실행하세요.`);
  }

  const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf-8'));
  console.log(`📁 백업 파일 로드 완료: ${BACKUP_FILE}`);
  console.log(`   - 백업 일시: ${backup.exportedAt}`);

  const collections = Object.keys(backup.collections);
  let totalDocs = 0;
  for (const col of collections) {
    const count = backup.collections[col].length;
    totalDocs += count;
    console.log(`   - ${col.padEnd(14)}: ${count}개`);
  }
  console.log(`   총 이전 대상 문서 수: ${totalDocs}개\n`);

  if (isDryRun) {
    console.log('🔍 [Dry-Run] 데이터 유효성 및 스키마 검증을 수행합니다...');
    let validationErrors = 0;

    for (const col of collections) {
      const docs = backup.collections[col];
      const schema = SCHEMA_DEFINITIONS[col] || [];
      const requiredKeys = schema.filter(s => s.required).map(s => s.key);

      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        if (!doc.$id) {
          console.error(`❌ [${col} #${i}] $id 누락!`);
          validationErrors++;
        }
        for (const reqKey of requiredKeys) {
          if (doc[reqKey] === undefined || doc[reqKey] === null) {
            console.error(`❌ [${col} #${i}] 필수 속성 '${reqKey}' 누락! (ID: ${doc.$id})`);
            validationErrors++;
          }
        }
      }
    }

    if (validationErrors === 0) {
      console.log('✅ [Dry-Run 성공] 모든 백업 데이터가 정상 규격이며 오류 없이 이전 가능한 상태입니다.');
    } else {
      console.error(`❌ [Dry-Run 실패] ${validationErrors}개의 데이터 유효성 오류가 발견되었습니다.`);
      process.exit(1);
    }
    return;
  }

  // 실제 마이그레이션 실행
  if (!TARGET_API_KEY) {
    throw new Error('TARGET_API_KEY 환경 변수가 설정되지 않았습니다. 신규 Appwrite 관리자 API Key가 필요합니다.');
  }

  const client = new sdk.Client()
    .setEndpoint(TARGET_ENDPOINT)
    .setProject(TARGET_PROJECT_ID)
    .setKey(TARGET_API_KEY);

  const databases = new sdk.Databases(client);

  console.log(`📡 대상 서버 연결 시도: ${TARGET_ENDPOINT} (Project: ${TARGET_PROJECT_ID})`);

  // 1. Database 생성 확인
  try {
    await databases.get(DB_ID);
    console.log(`✅ 데이터베이스 [${DB_ID}] 가 이미 존재합니다.`);
  } catch (e) {
    console.log(`📦 데이터베이스 [${DB_ID}] 생성 중...`);
    await databases.create(DB_ID, '민성이의 가계부 DB');
    console.log(`✅ 데이터베이스 [${DB_ID}] 생성 완료.`);
  }

  // 2. 컬렉션 및 속성 생성
  for (const col of collections) {
    let colExists = false;
    try {
      await databases.getCollection(DB_ID, col);
      colExists = true;
      console.log(`✅ 컬렉션 [${col}] 이 이미 존재합니다.`);
    } catch (e) {
      console.log(`📦 컬렉션 [${col}] 생성 중...`);
      await databases.createCollection(
        DB_ID,
        col,
        col,
        [
          sdk.Permission.read(sdk.Role.any()),
          sdk.Permission.create(sdk.Role.any()),
          sdk.Permission.update(sdk.Role.any()),
          sdk.Permission.delete(sdk.Role.any())
        ]
      );
      console.log(`✅ 컬렉션 [${col}] 생성 완료.`);
    }

    // 속성(Attributes) 생성
    if (!colExists && SCHEMA_DEFINITIONS[col]) {
      console.log(`⚙️ [${col}] 속성(Attributes) 등록 중...`);
      for (const attr of SCHEMA_DEFINITIONS[col]) {
        try {
          if (attr.type === 'string') {
            await databases.createStringAttribute(DB_ID, col, attr.key, attr.size, attr.required, attr.default);
          } else if (attr.type === 'integer') {
            await databases.createIntegerAttribute(DB_ID, col, attr.key, attr.required, null, null, attr.default);
          } else if (attr.type === 'double') {
            await databases.createFloatAttribute(DB_ID, col, attr.key, attr.required, null, null, attr.default);
          } else if (attr.type === 'boolean') {
            await databases.createBooleanAttribute(DB_ID, col, attr.key, attr.required, attr.default);
          }
        } catch (err) {
          console.warn(`  - 속성 '${attr.key}' 등록 알림: ${err.message}`);
        }
      }
      console.log(`⏳ [${col}] 속성 반영 대기 중 (5초)...`);
      await sleep(5000);
    }
  }

  // 3. 데이터 일괄 주입
  console.log('\n🚀 데이터 일괄 적재(Import) 시작...');
  for (const col of collections) {
    const docs = backup.collections[col];
    console.log(`\n🚚 [${col}] ${docs.length}개 문서 이전 중...`);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const docId = doc.$id;

      // Appwrite 시스템 메타 속성 제외하고 실제 데이터 속성만 추출
      const cleanData = {};
      for (const key of Object.keys(doc)) {
        if (!key.startsWith('$')) {
          cleanData[key] = doc[key];
        }
      }

      try {
        await databases.createDocument(
          DB_ID,
          col,
          docId,
          cleanData,
          [
            sdk.Permission.read(sdk.Role.any()),
            sdk.Permission.update(sdk.Role.any()),
            sdk.Permission.delete(sdk.Role.any())
          ]
        );
        successCount++;
      } catch (err) {
        if (err.code === 409) {
          // 이미 존재하는 경우 업데이트
          try {
            await databases.updateDocument(DB_ID, col, docId, cleanData);
            successCount++;
          } catch (updateErr) {
            failCount++;
            console.error(`  ❌ [${col} ID:${docId}] 업데이트 실패:`, updateErr.message);
          }
        } else {
          failCount++;
          console.error(`  ❌ [${col} ID:${docId}] 생성 실패:`, err.message);
        }
      }

      if ((i + 1) % 50 === 0 || i === docs.length - 1) {
        process.stdout.write(`\r  - 진행률: ${i + 1} / ${docs.length} (성공: ${successCount}, 실패: ${failCount})`);
      }
    }
    console.log(`\n  ✅ [${col}] 이전 완료 (성공: ${successCount}, 실패: ${failCount})`);
  }

  console.log('\n======================================================================');
  console.log(' 🎉 마이그레이션이 완료되었습니다! 다음으로 verify_data.js를 실행하세요.');
  console.log('======================================================================');
}

if (require.main === module) {
  runMigration().catch(err => {
    console.error('❌ 마이그레이션 실패:', err);
    process.exit(1);
  });
}

module.exports = { runMigration };

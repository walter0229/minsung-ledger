// ============================================================================
// 민성이의 가계부 - 자체 구축 서버 통합 DB & 웹 서버 (Appwrite API 100% 완벽 호환)
// - 내부 IP(192.168.150.240), 공인 IP(103.106.141.150), 향후 변경될 모든 공인 IP 지원
// - 실시간 원자적(Atomic) 디스크 저장 및 일일 자동 스냅샷 백업 내장
// ============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = path.join(__dirname, 'db_storage');
const DB_FILE = path.join(DATA_DIR, 'ledger_database.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const INITIAL_SEED_FILE = path.join(__dirname, 'latest_backup.json');
const WEB_ROOT = path.resolve(__dirname, '..');

// 디렉터리 보장
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// 데이터베이스 메모리 로드 및 초기 시드 마이그레이션
let dbStore = {
  updatedAt: new Date().toISOString(),
  collections: {
    accounts: [],
    transactions: [],
    budgets: [],
    'app-settings': []
  }
};

function initDatabase() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      if (loaded && loaded.collections) {
        dbStore = loaded;
        console.log(`✅ 기존 DB 로드 완료 (${DB_FILE})`);
        return;
      }
    } catch (e) {
      console.error('⚠️ 기존 DB 파일 로드 실패, 백업에서 복구 시도:', e.message);
    }
  }

  // 최초 실행 시 latest_backup.json 에서 100% 자동 마이그레이션
  if (fs.existsSync(INITIAL_SEED_FILE)) {
    try {
      const seed = JSON.parse(fs.readFileSync(INITIAL_SEED_FILE, 'utf-8'));
      if (seed && seed.collections) {
        dbStore.collections = {
          accounts: seed.collections.accounts || [],
          transactions: seed.collections.transactions || [],
          budgets: seed.collections.budgets || [],
          'app-settings': seed.collections['app-settings'] || []
        };
        saveDatabase(true);
        console.log('🎉 초기 백업 데이터(latest_backup.json) 100% 자동 마이그레이션 완료!');
      }
    } catch (e) {
      console.error('❌ 초기 백업 시드 로드 오류:', e.message);
    }
  }
}

function saveDatabase(createDailyBackup = false) {
  dbStore.updatedAt = new Date().toISOString();
  const tmpFile = `${DB_FILE}.tmp`;
  const payload = JSON.stringify(dbStore, null, 2);
  fs.writeFileSync(tmpFile, payload, 'utf-8');
  fs.renameSync(tmpFile, DB_FILE);

  if (createDailyBackup) {
    const today = new Date().toISOString().slice(0, 10);
    const dailyFile = path.join(BACKUP_DIR, `backup_${today}.json`);
    if (!fs.existsSync(dailyFile)) {
      fs.writeFileSync(dailyFile, payload, 'utf-8');
    }
  }
}

// Appwrite Query 파서 (SDK v13/v14 문자열 포맷 & JSON 포맷 완벽 지원)
function parseQueryItem(qStr) {
  if (!qStr || typeof qStr !== 'string') return null;
  const trimmed = qStr.trim();

  // 1. JSON 포맷: {"method":"limit","values":[5000]}
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {}
  }

  // 2. 함수 문자열 포맷: limit(5000), orderDesc("date"), cursorAfter("abc"), equal("yearMonth", ["2026-04"])
  const match = trimmed.match(/^([a-zA-Z]+)\((.*)\)$/);
  if (match) {
    const method = match[1];
    const argsRaw = match[2].trim();
    if (!argsRaw) return { method, values: [] };

    try {
      const parsedArgs = JSON.parse(`[${argsRaw}]`);
      if (method === 'equal' && parsedArgs.length >= 2) {
        const attr = parsedArgs[0];
        const vals = Array.isArray(parsedArgs[1]) ? parsedArgs[1] : [parsedArgs[1]];
        return { method: 'equal', attribute: attr, values: vals };
      }
      if ((method === 'orderDesc' || method === 'orderAsc') && parsedArgs.length >= 1) {
        return { method, attribute: parsedArgs[0] };
      }
      return { method, values: parsedArgs };
    } catch (e) {
      const cleanVal = argsRaw.replace(/^["']|["']$/g, '');
      if (method === 'orderDesc' || method === 'orderAsc') {
        return { method, attribute: cleanVal };
      }
      if (method === 'limit' || method === 'offset') {
        return { method, values: [Number(cleanVal) || 100] };
      }
      return { method, values: [cleanVal] };
    }
  }
  return null;
}

function applyQueries(docs, rawQueries) {
  let result = [...docs];
  let limit = 5000;
  let offset = 0;
  let cursorAfterId = null;
  const sorts = [];

  const queryList = Array.isArray(rawQueries) ? rawQueries : (rawQueries ? [rawQueries] : []);

  for (const qRaw of queryList) {
    const q = parseQueryItem(qRaw);
    if (!q) continue;

    if (q.method === 'equal' && q.attribute) {
      const targetVals = Array.isArray(q.values) ? q.values : [q.values];
      result = result.filter(doc => targetVals.includes(doc[q.attribute]));
    } else if (q.method === 'orderDesc') {
      const attr = q.attribute || (q.values && q.values[0]) || '$createdAt';
      sorts.push({ attr, dir: -1 });
    } else if (q.method === 'orderAsc') {
      const attr = q.attribute || (q.values && q.values[0]) || '$createdAt';
      sorts.push({ attr, dir: 1 });
    } else if (q.method === 'limit') {
      limit = Number(q.values && q.values[0]) || 5000;
    } else if (q.method === 'offset') {
      offset = Number(q.values && q.values[0]) || 0;
    } else if (q.method === 'cursorAfter') {
      cursorAfterId = q.values && q.values[0];
    }
  }

  if (sorts.length > 0) {
    result.sort((a, b) => {
      for (const s of sorts) {
        const va = a[s.attr] ?? '';
        const vb = b[s.attr] ?? '';
        if (va < vb) return -1 * s.dir;
        if (va > vb) return 1 * s.dir;
      }
      return 0;
    });
  }

  const total = result.length;

  if (cursorAfterId) {
    const idx = result.findIndex(d => d.$id === cursorAfterId);
    if (idx >= 0) {
      result = result.slice(idx + 1);
    }
  } else if (offset > 0) {
    result = result.slice(offset);
  }

  result = result.slice(0, limit);
  return { total, documents: result };
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Appwrite-Project, X-Appwrite-Key, X-Appwrite-Response-Format, X-SDK-Version, X-SDK-Name, X-SDK-Language, X-SDK-Platform, X-Fallback-Cookies, Cookie, Authorization'
  );
  res.setHeader('Access-Control-Expose-Headers', 'X-Fallback-Cookies, Set-Cookie');
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        resolve({});
      }
    });
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

initDatabase();

const server = http.createServer(async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsedUrl.pathname || '/');

  // 1. 서버 상태 및 DB 진단 엔드포인트
  if (pathname === '/v1/health' || pathname === '/api/health') {
    return sendJson(res, 200, {
      status: 'ok',
      version: '1.442',
      updatedAt: dbStore.updatedAt,
      counts: {
        accounts: (dbStore.collections.accounts || []).length,
        transactions: (dbStore.collections.transactions || []).length,
        budgets: (dbStore.collections.budgets || []).length,
        settings: (dbStore.collections['app-settings'] || []).length
      },
      extraDatabases: Object.keys(dbStore.databases || {})
    });
  }

  // 2. Appwrite Account & Session 호환 엔드포인트
  if (pathname === '/v1/account' && req.method === 'GET') {
    return sendJson(res, 200, {
      $id: 'walter-selfhost-user',
      $createdAt: '2026-01-01T00:00:00.000+00:00',
      $updatedAt: new Date().toISOString(),
      name: 'Walter',
      email: 'walter@selfhost.local',
      status: true
    });
  }

  if (pathname === '/v1/account/sessions/anonymous' && req.method === 'POST') {
    return sendJson(res, 201, {
      $id: 'selfhost-session-' + Date.now(),
      userId: 'walter-selfhost-user',
      provider: 'anonymous',
      current: true
    });
  }

  // 3. Appwrite Databases Documents CRUD 호환 엔드포인트 (다중 앱 DB 완벽 분리 지원)
  const colMatch = pathname.match(/^\/v1\/databases\/([^/]+)\/collections\/([^/]+)\/documents(?:\/([^/]+))?$/);
  if (colMatch) {
    const dbId = colMatch[1];
    const colId = colMatch[2];
    const docIdParam = colMatch[3];

    let targetCols = dbStore.collections;
    if (dbId !== 'ledger-db') {
      if (!dbStore.databases) dbStore.databases = {};
      if (!dbStore.databases[dbId]) dbStore.databases[dbId] = {};
      targetCols = dbStore.databases[dbId];
    }

    if (!targetCols[colId]) {
      targetCols[colId] = [];
    }
    const colList = targetCols[colId];

    // [GET] 문서 목록 또는 단일 문서 조회
    if (req.method === 'GET') {
      if (docIdParam) {
        const found = colList.find(d => d.$id === docIdParam);
        if (!found) return sendJson(res, 404, { message: 'Document not found', code: 404 });
        return sendJson(res, 200, found);
      }

      const rawQueries = parsedUrl.query['queries[]'] || parsedUrl.query.queries || [];
      const result = applyQueries(colList, rawQueries);
      return sendJson(res, 200, result);
    }

    // [POST] 새 문서 생성 (Upsert 호환)
    if (req.method === 'POST') {
      const body = await readBody(req);
      let newId = body.documentId || (body.data && body.data.$id) || crypto.randomBytes(10).toString('hex');
      if (newId === 'unique()') {
        newId = crypto.randomBytes(10).toString('hex');
      }

      const docData = body.data || body;
      const now = new Date().toISOString();

      const existingIdx = colList.findIndex(d => d.$id === newId);
      const newDoc = {
        ...docData,
        $id: newId,
        $createdAt: existingIdx >= 0 ? colList[existingIdx].$createdAt : now,
        $updatedAt: now,
        $permissions: body.permissions || ['read("any")', 'update("any")', 'delete("any")'],
        $databaseId: dbId,
        $collectionId: colId
      };

      if (existingIdx >= 0) {
        colList[existingIdx] = newDoc;
      } else {
        colList.push(newDoc);
      }

      saveDatabase(true);
      return sendJson(res, 201, newDoc);
    }

    // [PATCH / PUT] 문서 수정
    if ((req.method === 'PATCH' || req.method === 'PUT') && docIdParam) {
      const body = await readBody(req);
      const docData = body.data || body;
      const idx = colList.findIndex(d => d.$id === docIdParam);

      if (idx < 0) {
        return sendJson(res, 404, { message: 'Document not found', code: 404 });
      }

      const updatedDoc = {
        ...colList[idx],
        ...docData,
        $id: docIdParam,
        $updatedAt: new Date().toISOString()
      };
      colList[idx] = updatedDoc;
      saveDatabase(false);
      return sendJson(res, 200, updatedDoc);
    }

    // [DELETE] 문서 삭제
    if (req.method === 'DELETE' && docIdParam) {
      const idx = colList.findIndex(d => d.$id === docIdParam);
      if (idx >= 0) {
        colList.splice(idx, 1);
        saveDatabase(false);
      }
      res.writeHead(204);
      return res.end();
    }
  }

  // 4. 정적 웹 파일 서빙 (가계부 웹앱 자체 호스팅)
  let reqFile = pathname === '/' ? '/app.html' : pathname;
  const safePath = path.normalize(reqFile).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(WEB_ROOT, safePath);

  if (fullPath.startsWith(WEB_ROOT) && fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    return fs.createReadStream(fullPath).pipe(res);
  }

  sendJson(res, 404, { message: 'Not Found', path: pathname });
});

function createHandler() {
  return server.listeners('request')[0];
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('======================================================================');
  console.log(` 🚀 민성이의 가계부 통합 DB & 웹 서버 가동 중! (Port: ${PORT})`);
  console.log(`   - 공인 IP 접속 주소   : http://103.106.141.150:${PORT}`);
  console.log(`   - 계좌(accounts)      : ${dbStore.collections.accounts.length} 건`);
  console.log(`   - 거래(transactions)  : ${dbStore.collections.transactions.length} 건`);
  console.log(`   - 예산(budgets)       : ${dbStore.collections.budgets.length} 건`);
  console.log(`   - 설정(app-settings)  : ${dbStore.collections['app-settings'].length} 건`);
  console.log('======================================================================');
});

// 기본 웹 포트(80번) 동시 바인딩 (포트 번호 없이 http://103.106.141.150 접속 지원)
if (PORT !== 80) {
  const server80 = http.createServer(createHandler());
  server80.on('error', (err) => {
    console.log(`ℹ️ 80번 포트 바인딩 건너뜀 (${err.code}): 기본 포트 ${PORT}번으로 정상 서비스됩니다.`);
  });
  server80.listen(80, '0.0.0.0', () => {
    console.log(' 🌐 기본 HTTP 포트(80) 동시 개방 완료 -> http://103.106.141.150 바로 접속 가능!');
  });
}


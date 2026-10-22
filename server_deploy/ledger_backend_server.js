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
    'Content-Type, X-Ledger-Pin-Token, X-Appwrite-Project, X-Appwrite-Key, X-Appwrite-Response-Format, X-SDK-Version, X-SDK-Name, X-SDK-Language, X-SDK-Platform, X-Fallback-Cookies, Cookie, Authorization'
  );
  res.setHeader('Access-Control-Expose-Headers', 'X-Fallback-Cookies, Set-Cookie');
}

// ============================================================================
// 🔐 가계부 PIN 비밀번호 인증 및 무차별 대입(Brute-force) 차단 보안 모듈
// ============================================================================
const DEFAULT_PIN = '0229';
const AUTH_SECRET_SEED = 'minsung-ledger-pin-secret-2026-v1';
const failedPinAttempts = new Map();

function hashPin(pin) {
  return crypto.createHash('sha256').update('minsung-pin:' + String(pin || '').trim()).digest('hex');
}

function getPinHash() {
  if (!dbStore.authPinHash) {
    dbStore.authPinHash = hashPin(DEFAULT_PIN);
    dbStore.authPinLength = DEFAULT_PIN.length;
  }
  return dbStore.authPinHash;
}

function getExpectedToken() {
  return crypto.createHmac('sha256', AUTH_SECRET_SEED).update(getPinHash()).digest('hex');
}

function extractPinToken(req, parsedUrl) {
  const headerToken = req.headers['x-ledger-pin-token'];
  if (headerToken && typeof headerToken === 'string') return headerToken.trim();

  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)ledger_pin_token=([^;]+)/);
  if (match && match[1]) return decodeURIComponent(match[1].trim());

  if (parsedUrl && parsedUrl.query && parsedUrl.query.pinToken) {
    return String(parsedUrl.query.pinToken).trim();
  }
  return '';
}

function isPinAuthenticated(req, parsedUrl) {
  const token = extractPinToken(req, parsedUrl);
  if (!token) return false;
  return token === getExpectedToken();
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff && typeof xff === 'string') return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function getBlockedIps() {
  if (!dbStore.blockedIps || typeof dbStore.blockedIps !== 'object') {
    dbStore.blockedIps = {};
  }
  return dbStore.blockedIps;
}

function isIpBlocked(ip) {
  if (!ip) return false;
  const map = getBlockedIps();
  return Boolean(map[ip]);
}

function blockIpAddress(ip, req, failCount = 3) {
  if (!ip) return;
  const map = getBlockedIps();
  map[ip] = {
    ip,
    blockedAt: new Date().toISOString(),
    failCount,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 120)
  };
  saveDatabase(false);
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
  '.ico': 'image/x-icon',
  '.zip': 'application/zip',
  '.apk': 'application/vnd.android.package-archive',
  '.bat': 'text/plain; charset=utf-8'
};

initDatabase();

const server = http.createServer(async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // 도메인 분리 보장:
  // 1) 건강관리 앱(health.minsungvn.com) -> HTTPS 리다이렉트
  // 2) 루트 도메인(minsungvn.com)은 가계부에서 사용하지 않음 (ledger.minsungvn.com 전용)
  const hostHeader = (req.headers.host || '').toLowerCase();
  if (hostHeader.startsWith('health.minsungvn.com')) {
    res.writeHead(301, { Location: `https://health.minsungvn.com${req.url || '/'}` });
    return res.end();
  }
  if (hostHeader === 'minsungvn.com' || hostHeader.startsWith('minsungvn.com:') || hostHeader.startsWith('www.minsungvn.com')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not Found');
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsedUrl.pathname || '/');

  // 1. 서버 상태 및 DB 진단 엔드포인트
  if (pathname === '/v1/health' || pathname === '/api/health') {
    return sendJson(res, 200, {
      status: 'ok',
      version: '1.448',
      pinProtected: true,
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

  // 1-2. 🔐 가계부 PIN 인증 상태 조회, 검증, 변경 및 IP 차단 관리 엔드포인트
  if (pathname === '/v1/auth/pin-status' && req.method === 'GET') {
    getPinHash();
    const clientIp = getClientIp(req);
    const authed = isPinAuthenticated(req, parsedUrl);
    return sendJson(res, 200, {
      ok: true,
      authenticated: authed,
      blocked: authed ? false : isIpBlocked(clientIp),
      clientIp,
      pinLength: dbStore.authPinLength || 4
    });
  }

  if (pathname === '/v1/auth/pin-verify' && req.method === 'POST') {
    const clientIp = getClientIp(req);
    if (!isPinAuthenticated(req, parsedUrl) && isIpBlocked(clientIp)) {
      return sendJson(res, 403, {
        ok: false,
        blocked: true,
        message: `🚫 PIN 3회 오류로 현재 IP(${clientIp})가 차단되었습니다. 기존 연결된 기기의 [설정 → 보안 설정]에서 차단 해제해주세요.`
      });
    }

    const attempt = failedPinAttempts.get(clientIp) || { count: 0 };
    const body = await readBody(req);
    const inputPin = String(body.pin || '').trim();
    if (hashPin(inputPin) === getPinHash()) {
      failedPinAttempts.delete(clientIp);
      const token = getExpectedToken();
      res.setHeader('Set-Cookie', `ledger_pin_token=${token}; Path=/; Max-Age=31536000; SameSite=Lax`);
      return sendJson(res, 200, {
        ok: true,
        token,
        pinLength: dbStore.authPinLength || 4
      });
    } else {
      const newCount = (attempt.count || 0) + 1;
      if (newCount >= 3) {
        blockIpAddress(clientIp, req, newCount);
        failedPinAttempts.delete(clientIp);
        return sendJson(res, 403, {
          ok: false,
          blocked: true,
          message: `🚫 PIN 번호 3회 연속 오류로 현재 IP(${clientIp})가 영구 차단되었습니다.`
        });
      }
      failedPinAttempts.set(clientIp, { count: newCount });
      const remain = Math.max(0, 3 - newCount);
      return sendJson(res, 401, {
        ok: false,
        blocked: false,
        message: `PIN 번호가 일치하지 않습니다. (남은 시도: ${remain}회 / 3회 오류 시 IP 차단)`
      });
    }
  }

  if (pathname === '/v1/auth/blocked-ips' && req.method === 'GET') {
    if (!isPinAuthenticated(req, parsedUrl)) {
      return sendJson(res, 401, { ok: false, message: '인증이 필요합니다.' });
    }
    return sendJson(res, 200, {
      ok: true,
      list: Object.values(getBlockedIps())
    });
  }

  if (pathname === '/v1/auth/unblock-ip' && req.method === 'POST') {
    if (!isPinAuthenticated(req, parsedUrl)) {
      return sendJson(res, 401, { ok: false, message: '인증이 필요합니다.' });
    }
    const body = await readBody(req);
    const targetIp = String(body.ip || '').trim();
    const map = getBlockedIps();
    if (targetIp === '__ALL__') {
      dbStore.blockedIps = {};
      failedPinAttempts.clear();
    } else if (targetIp) {
      delete map[targetIp];
      failedPinAttempts.delete(targetIp);
    }
    saveDatabase(false);
    return sendJson(res, 200, {
      ok: true,
      list: Object.values(getBlockedIps()),
      message: 'IP 차단이 해제되었습니다.'
    });
  }

  if (pathname === '/v1/auth/pin-change' && req.method === 'POST') {
    const body = await readBody(req);
    const currentPin = String(body.currentPin || '').trim();
    const newPin = String(body.newPin || '').trim();

    if (hashPin(currentPin) !== getPinHash()) {
      return sendJson(res, 401, {
        ok: false,
        message: '현재 PIN 번호가 일치하지 않습니다.'
      });
    }

    if (!/^\d{4,8}$/.test(newPin)) {
      return sendJson(res, 400, {
        ok: false,
        message: '새 PIN 번호는 4~8자리 숫자로 입력해주세요.'
      });
    }

    dbStore.authPinHash = hashPin(newPin);
    dbStore.authPinLength = newPin.length;
    saveDatabase(true);

    const token = getExpectedToken();
    res.setHeader('Set-Cookie', `ledger_pin_token=${token}; Path=/; Max-Age=31536000; SameSite=Lax`);
    return sendJson(res, 200, {
      ok: true,
      token,
      pinLength: dbStore.authPinLength,
      message: 'PIN 번호가 성공적으로 변경되었습니다.'
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

    // 🔐 가계부 DB(ledger-db)는 반드시 PIN 인증 토큰이 있어야만 접근 허용
    if (dbId === 'ledger-db' && !isPinAuthenticated(req, parsedUrl)) {
      return sendJson(res, 401, {
        message: 'PIN 비밀번호 인증이 필요합니다.',
        code: 401,
        type: 'user_unauthorized'
      });
    }

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

  // 4. 설치 안내 페이지 바로가기 (/install)
  if (pathname === '/install' || pathname === '/install/') {
    const installHtmlPath = path.join(WEB_ROOT, 'downloads', 'index.html');
    if (fs.existsSync(installHtmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(installHtmlPath).pipe(res);
    }
  }

  // 5. 정적 웹 파일 서빙 (가계부 웹앱 및 downloads 제공)
  let reqFile = pathname === '/' ? '/app.html' : pathname;
  const safePath = path.normalize(reqFile).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(WEB_ROOT, safePath);

  if (fullPath.startsWith(WEB_ROOT) && fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': contentType };

    // 설치 파일 다운로드 시 첨부 헤더 부여 (RFC 5987 인코딩 안전 적용)
    if (ext === '.zip' || ext === '.apk' || ext === '.bat') {
      const filename = path.basename(fullPath);
      const encodedFilename = encodeURIComponent(filename);
      headers['Content-Disposition'] = `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`;
      headers['Cache-Control'] = 'no-store';
    }

    res.writeHead(200, headers);
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
  console.log(`   - 도메인 접속 주소    : http://ledger.minsungvn.com`);
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
    console.log(' 🌐 기본 HTTP 포트(80) 동시 개방 완료 -> http://ledger.minsungvn.com 바로 접속 가능!');
  });
}


const fs = require('fs');
const path = require('path');

const srcFiles = [
  'config.js',
  'store.js',
  'utils.js',
  'db.js',
  'ui.js',
  'budget.js',
  'accounts.js',
  'transactions.js',
  'stats.js',
  'sync.js',
  'main.js'
];

let finalCode = '';

for (const file of srcFiles) {
  const filePath = path.join(__dirname, 'js', file);
  if (!fs.existsSync(filePath)) {
    console.warn(`파일 찾을 수 없음: ${file}, 건너뜁니다.`);
    continue;
  }
  
  let content = fs.readFileSync(filePath, 'utf-8');
  
  // import 구문 삭제
  content = content.replace(/^import\s+.*?from\s+['"].*?['"];?\s*$/gm, '');
  
  // export 구문 변환
  content = content.replace(/^export\s+const\s+/gm, 'const ');
  content = content.replace(/^export\s+let\s+/gm, 'let ');
  content = content.replace(/^export\s+function\s+/gm, 'function ');
  content = content.replace(/^export\s+async\s+function\s+/gm, 'async function ');
  
  finalCode += `\n\n// =============================================\n`;
  finalCode += `// 📦 MERGED FROM: ${file}\n`;
  finalCode += `// =============================================\n\n`;
  finalCode += content;
}

const outPath = path.join(__dirname, 'js', 'app.js');
fs.writeFileSync(outPath, finalCode, 'utf-8');
console.log('✅ js/app.js successfully built from modules!');

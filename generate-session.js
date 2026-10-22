// =========================================================
// أداة توليد SESSION_DATA - تشغّل مرة واحدة فقط من جهازك
// تأخذ فقط creds.json وملفات المفاتيح الصغيرة
// =========================================================

const fs   = require('fs');
const path = require('path');

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

if (!fs.existsSync(AUTH_DIR)) {
  console.error('❌ مجلد auth_info_baileys غير موجود!');
  process.exit(1);
}

// أخذ الملفات الجوهرية فقط (صغيرة الحجم)
const MAX_FILE_SIZE = 5 * 1024; // 5KB فقط
const ESSENTIAL_PATTERNS = [
  /^creds\.json$/,
  /^app-state-sync-key-/,  // صغيرة (161 bytes)
  /^sender-key-/,
  /^pre-key-/,
  /^session-/,
];

const allFiles = fs.readdirSync(AUTH_DIR);
const session  = {};
let count = 0;

for (const file of allFiles) {
  const isEssential = ESSENTIAL_PATTERNS.some(p => p.test(file));
  if (!isEssential) continue;

  const fullPath = path.join(AUTH_DIR, file);
  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) continue;
  if (stat.size > MAX_FILE_SIZE) continue; // تجاهل الملفات الكبيرة

  try {
    session[file] = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch {
    session[file] = fs.readFileSync(fullPath, 'utf8');
  }
  count++;
}

const encoded = Buffer.from(JSON.stringify(session)).toString('base64');
const sizeKB  = Math.round(encoded.length / 1024);

console.log(`\n✅ SESSION_DATA جاهز! (${count} ملف، ${sizeKB} KB)\n`);
console.log('======================================================');
console.log('الاسم: SESSION_DATA');
console.log('======================================================');
console.log(encoded);
console.log('======================================================');
console.log('\n📌 رابط إضافة Secret في GitHub:');
console.log('https://github.com/huhhikjj/whatsapp-channel-bot/settings/secrets/actions/new\n');

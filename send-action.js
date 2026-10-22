// =========================================================
// سكربت الإرسال المنفصل - يعمل عبر GitHub Actions كل ساعة
// يحتاج فقط متغيرات البيئة التالية:
//   CHANNEL_JID       - معرّف القناة (120363xxxxxxx@newsletter)
//   SESSION_DATA      - بيانات جلسة واتساب مضغوطة ومشفرة (Base64)
// =========================================================

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// ── تحميل الأذكار ────────────────────────────────────────
const REMINDERS_FILE = path.join(__dirname, 'reminders.json');
const CONFIG_FILE    = path.join(__dirname, 'config.json');
const AUTH_DIR       = path.join(__dirname, '.gh_auth_session');

// ── استعادة جلسة الواتساب من متغير البيئة ─────────────────
function restoreSession() {
  const encoded = process.env.SESSION_DATA;
  if (!encoded) {
    console.error('❌ SESSION_DATA غير موجود في متغيرات البيئة');
    process.exit(1);
  }
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  // فك ضغط وفك تشفير وكتابة ملفات الجلسة
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const files   = JSON.parse(decoded);
  for (const [filename, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(AUTH_DIR, filename), JSON.stringify(content));
  }
  console.log('✅ تم استعادة جلسة الواتساب من GitHub Secrets بنجاح');
}

// ── اختيار الذكر التالي بالترتيب ──────────────────────────
function pickNextReminder() {
  const reminders = JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8'));
  let config      = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const idx       = (config.currentIndex || 0) % reminders.length;
  const text      = reminders[idx];

  config.currentIndex = (idx + 1) % reminders.length;
  config.lastSentTime = new Date().toISOString();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

  return { text, channelJid: config.targetChannelJid };
}

// ── الإرسال عبر Baileys ───────────────────────────────────
async function sendMessage() {
  restoreSession();

  const { text, channelJid } = pickNextReminder();
  if (!channelJid) {
    console.error('❌ لم يتم تحديد القناة في config.json');
    process.exit(1);
  }

  console.log(`📤 جاري إرسال الذكر رقم ${JSON.parse(fs.readFileSync(CONFIG_FILE)).currentIndex} إلى ${channelJid}...`);

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version }          = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth:               state,
    printQRInTerminal:  false,
    logger:             pino({ level: 'silent' }),
    browser:            Browsers.macOS('Desktop'),
    syncFullHistory:    false,
    markOnlineOnConnect: false
  });

  sock.ev.on('creds.update', saveCreds);

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('انتهت مهلة الاتصال (60 ثانية)')), 60000);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (connection === 'open') {
        clearTimeout(timeout);
        try {
          await sock.sendMessage(channelJid, { text });
          console.log('✅ تم إرسال الذكر بنجاح!');
          console.log(`📝 النص المرسل: ${text.slice(0, 80)}...`);

          // حفظ الجلسة المحدّثة وطباعتها (لتحديث GitHub Secret لاحقاً)
          await new Promise(r => setTimeout(r, 2000));
          await sock.end(undefined);
          resolve();
        } catch (err) {
          reject(err);
        }
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          reject(new Error('❌ تم تسجيل الخروج من واتساب. يلزم تجديد الجلسة من جهازك.'));
        }
      }
    });
  });
}

sendMessage()
  .then(() => {
    console.log('🎉 انتهى الإرسال بنجاح. حتى الساعة القادمة إن شاء الله!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ فشل الإرسال:', err.message);
    process.exit(1);
  });

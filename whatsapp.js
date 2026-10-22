// =========================================================
// مُذكِّر قنوات الواتساب - محرك إدارة واتساب (Baileys Engine)
// =========================================================

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  Browsers,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class WhatsAppManager extends EventEmitter {
  constructor(authDir = './auth_info_baileys') {
    super();
    this.authDir = authDir;
    this.sock = null;
    this.state = {
      status: 'disconnected', // 'disconnected' | 'connecting' | 'connected'
      qr: null,
      user: null
    };
    this.isReconnecting = false;
  }

  // Get current state snapshot
  getState() {
    return this.state;
  }

  // Initialize and connect
  async start() {
    try {
      this.state.status = 'connecting';
      this.emit('status_change', this.state);

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      
      let version;
      try {
        const vInfo = await fetchLatestBaileysVersion();
        version = vInfo.version;
      } catch (e) {
        console.log('Using default Baileys version');
      }

      console.log('🔄 جاري تشغيل اتصال واتساب وتوليد الرمز...');
      this.sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        markOnlineOnConnect: false
      });

      // Save auth credentials whenever updated
      this.sock.ev.on('creds.update', saveCreds);

      // Handle connection updates
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log('📲 تم استلام رمز QR جديد، جاري إرساله إلى لوحة التحكم...');
          try {
            const qrDataUrl = await qrcode.toDataURL(qr);
            this.state.qr = qrDataUrl;
            this.state.status = 'connecting';
            this.emit('qr', { qrDataUrl, raw: qr });
            this.emit('status_change', this.state);
          } catch (err) {
            console.error('Failed to generate QR data URL:', err);
          }
        }

        if (connection === 'open') {
          this.state.status = 'connected';
          this.state.qr = null;
          this.state.user = {
            id: this.sock.user?.id || '',
            name: this.sock.user?.name || 'مستخدم واتساب'
          };
          this.isReconnecting = false;
          console.log('✅ تم الاتصال بواتساب بنجاح كـ:', this.state.user.id);
          this.emit('connected', this.state.user);
          this.emit('status_change', this.state);
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          console.log(`⚠️ تم قطع اتصال واتساب (كود: ${statusCode}). إعادة الاتصال: ${shouldReconnect}`);
          this.state.status = 'disconnected';
          this.state.user = null;
          this.emit('disconnected', { statusCode, shouldReconnect });
          this.emit('status_change', this.state);

          if (shouldReconnect) {
            if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
            console.log('⏳ جاري إعادة تشغيل جلسة واتساب وتوليد رمز جديد خلال 3 ثوانٍ...');
            this.reconnectTimeout = setTimeout(() => {
              this.reconnectTimeout = null;
              this.start();
            }, 3000);
          } else if (statusCode === DisconnectReason.loggedOut) {
            this.clearAuth();
          }
        }
      });

    } catch (err) {
      console.error('Error starting WhatsApp socket:', err);
      this.state.status = 'disconnected';
      this.emit('status_change', this.state);
    }
  }

  // Resolve invite link or channel JID to metadata
  async resolveChannel(input) {
    if (!this.sock) throw new Error('واتساب غير متصل حالياً');

    input = input.trim();

    // Check if it is a WhatsApp Channel invite link
    // e.g. https://whatsapp.com/channel/0029VaABCD1234
    const channelLinkMatch = input.match(/whatsapp\.com\/channel\/([a-zA-Z0-9_-]+)/);
    if (channelLinkMatch) {
      const inviteCode = channelLinkMatch[1];
      try {
        const metadata = await this.sock.newsletterMetadata('invite', inviteCode);
        return {
          id: metadata.id,
          name: metadata.name || 'قناة واتساب',
          isChannel: true,
          subscribers: metadata.subscribers || 0
        };
      } catch (err) {
        throw new Error('تعذر جلب بيانات القناة من الرابط. تأكد من صحة الرابط وأن حسابك منضم إليها.');
      }
    }

    // If input is directly a newsletter JID or plain number
    let jid = input;
    if (!jid.includes('@')) {
      jid = `${jid}@newsletter`;
    }

    if (jid.endsWith('@newsletter')) {
      try {
        const metadata = await this.sock.newsletterMetadata('jid', jid);
        return {
          id: metadata.id || jid,
          name: metadata.name || jid,
          isChannel: true,
          subscribers: metadata.subscribers || 0
        };
      } catch (e) {
        // Fallback if metadata query fails: assume valid JID
        return {
          id: jid,
          name: jid,
          isChannel: true,
          subscribers: 0
        };
      }
    }

    // Save channel if resolved
    if (result && result.id && result.id.endsWith('@newsletter')) {
      this.saveChannel(result);
    }

    return result;
  }

  saveChannel(channel) {
    try {
      const channelsFile = path.join(__dirname, 'channels.json');
      let channels = [];
      if (fs.existsSync(channelsFile)) {
        channels = JSON.parse(fs.readFileSync(channelsFile, 'utf8'));
      }
      const existingIdx = channels.findIndex(c => c.id === channel.id);
      if (existingIdx >= 0) {
        channels[existingIdx] = { ...channels[existingIdx], ...channel };
      } else {
        channels.push(channel);
      }
      fs.writeFileSync(channelsFile, JSON.stringify(channels, null, 2), 'utf8');
    } catch (e) {
      console.warn('Error saving channel to channels.json:', e.message);
    }
  }

  // Get channels (Newsletters only - completely hides private groups)
  async getChannelsAndGroups() {
    const channelsFile = path.join(__dirname, 'channels.json');
    let channels = [];
    try {
      if (fs.existsSync(channelsFile)) {
        channels = JSON.parse(fs.readFileSync(channelsFile, 'utf8'));
      }
    } catch (e) {
      console.error('Error reading channels.json:', e);
    }
    return channels.filter(c => c.id && c.id.endsWith('@newsletter') || c.isChannel);
  }

  // Send message to channel or group
  async sendMessageToChannel(target, text) {
    if (!this.sock || this.state.status !== 'connected') {
      throw new Error('واتساب غير متصل. تأكد من مسح رمز QR أولاً.');
    }

    // Resolve channel if needed
    const channelInfo = await this.resolveChannel(target);
    const jid = channelInfo.id;

    console.log(`📤 جاري إرسال الرسالة إلى [${channelInfo.name}] (${jid})...`);

    try {
      const sent = await this.sock.sendMessage(jid, { text });
      console.log(`✅ تم إرسال الرسالة بنجاح إلى [${channelInfo.name}]!`);
      return {
        success: true,
        channelId: jid,
        channelName: channelInfo.name,
        messageId: sent?.key?.id
      };
    } catch (err) {
      console.error('❌ خطأ أثناء الإرسال إلى القناة:', err);
      throw new Error(`فشل الإرسال: ${err.message || 'تأكد من أنك مشرف في القناة'}`);
    }
  }

  // Clear session / logout
  async logout() {
    try {
      if (this.sock) {
        await this.sock.logout();
      }
    } catch (e) {
      // ignore
    }
    this.clearAuth();
    this.state.status = 'disconnected';
    this.state.qr = null;
    this.state.user = null;
    this.emit('status_change', this.state);
    // Restart to display fresh QR
    setTimeout(() => this.start(), 2000);
  }

  // Reconnect manually
  async restart() {
    try {
      if (this.sock) {
        this.sock.end(undefined);
      }
    } catch (e) {}
    this.isReconnecting = false;
    await this.start();
  }

  clearAuth() {
    try {
      if (fs.existsSync(this.authDir)) {
        fs.rmSync(this.authDir, { recursive: true, force: true });
        console.log('🗑️ تم حذف بيانات جلسة واتساب القديمة.');
      }
    } catch (err) {
      console.error('Error clearing auth directory:', err);
    }
  }
}

module.exports = WhatsAppManager;

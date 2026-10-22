// =========================================================
// مُذكِّر قنوات الواتساب - خادم الويب والمجدول التلقائي (Server & Scheduler)
// =========================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const WhatsAppManager = require('./whatsapp');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// File paths
const CONFIG_FILE = path.join(__dirname, 'config.json');
const REMINDERS_FILE = path.join(__dirname, 'reminders.json');

// In-memory state
let botConfig = {
  intervalMinutes: 60,
  targetChannelJid: '',
  targetChannelName: '',
  isEnabled: false,
  mode: 'sequential',
  currentIndex: 0,
  lastSentTime: null,
  nextScheduledTime: null
};

let reminders = [];
let activityLogs = [];

// Helper: Load config
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      botConfig = { ...botConfig, ...data };
    }
  } catch (err) {
    console.error('Error loading config.json:', err);
  }
}

// Helper: Save config
function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(botConfig, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving config.json:', err);
  }
}

// Helper: Load reminders
function loadReminders() {
  try {
    if (fs.existsSync(REMINDERS_FILE)) {
      reminders = JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading reminders.json:', err);
  }
}

// Helper: Save reminders
function saveReminders() {
  try {
    fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving reminders.json:', err);
  }
}

// Add Activity Log
function addLog(message, channelName, status = 'success') {
  const logEntry = {
    id: Date.now() + Math.random().toString(36).substring(2, 7),
    timestamp: new Date().toISOString(),
    message,
    channelName: channelName || botConfig.targetChannelName || 'القناة',
    status
  };
  activityLogs.unshift(logEntry);
  if (activityLogs.length > 50) activityLogs.pop();
  io.emit('log_entry', logEntry);
}

// Initialize data
loadConfig();
loadReminders();

// Initialize WhatsApp
const waManager = new WhatsAppManager(path.join(__dirname, 'auth_info_baileys'));

waManager.on('status_change', (state) => {
  io.emit('connection_state', state);
});

// ==========================================
// Scheduler Engine
// ==========================================

function calculateNextTime() {
  const minutes = botConfig.intervalMinutes || 60;
  botConfig.nextScheduledTime = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  saveConfig();
  io.emit('config_updated', botConfig);
}

async function sendScheduledMessage() {
  if (!botConfig.isEnabled) return;
  if (!botConfig.targetChannelJid) {
    console.warn('⚠️ لم يتم تحديد القناة المستهدفة في الجدولة');
    return;
  }
  if (reminders.length === 0) {
    console.warn('⚠️ قائمة الأذكار فارغة');
    return;
  }

  // Pick reminder text
  let selectedText = '';
  if (botConfig.mode === 'random') {
    const randIdx = Math.floor(Math.random() * reminders.length);
    selectedText = reminders[randIdx];
    botConfig.currentIndex = randIdx;
  } else {
    // Sequential
    const idx = (botConfig.currentIndex || 0) % reminders.length;
    selectedText = reminders[idx];
    botConfig.currentIndex = (idx + 1) % reminders.length;
  }

  try {
    console.log(`⏰ حان موعد الإرسال المجدول للقناة [${botConfig.targetChannelName || botConfig.targetChannelJid}]`);
    const result = await waManager.sendMessageToChannel(botConfig.targetChannelJid, selectedText);
    
    botConfig.lastSentTime = new Date().toISOString();
    addLog(selectedText, result.channelName, 'success');
  } catch (err) {
    console.error('❌ فشل الإرسال المجدول:', err.message);
    addLog(`فشل الإرسال: ${err.message}`, botConfig.targetChannelName, 'error');
  } finally {
    // Plan next run
    calculateNextTime();
  }
}

// Scheduler ticker (checks every 5 seconds)
setInterval(() => {
  if (!botConfig.isEnabled) return;
  if (waManager.getState().status !== 'connected') return;
  if (!botConfig.targetChannelJid) return;

  const now = Date.now();
  if (!botConfig.nextScheduledTime) {
    calculateNextTime();
    return;
  }

  const nextTime = new Date(botConfig.nextScheduledTime).getTime();
  if (now >= nextTime) {
    sendScheduledMessage();
  }
}, 5000);

// ==========================================
// Socket.IO Client Communication
// ==========================================

io.on('connection', (socket) => {
  console.log('⚡ متصفح جديد متصل بلوحة التحكم:', socket.id);

  // Send initial states
  socket.emit('connection_state', waManager.getState());
  socket.emit('config_updated', botConfig);
  socket.emit('reminders_updated', reminders);
  waManager.getChannelsAndGroups().then(channels => socket.emit('channels_list', channels));

  // Send past logs
  activityLogs.forEach((log) => socket.emit('log_entry', log));

  // Get available channels
  socket.on('get_channels', async (callback) => {
    try {
      const channels = await waManager.getChannelsAndGroups();
      callback({ channels });
    } catch (err) {
      callback({ error: err.message });
    }
  });

  // Save config settings
  socket.on('save_config', async (newConfig, callback) => {
    try {
      const intervalChanged = botConfig.intervalMinutes !== newConfig.intervalMinutes;
      botConfig = { ...botConfig, ...newConfig };

      if (intervalChanged && botConfig.isEnabled) {
        calculateNextTime();
      } else {
        saveConfig();
        io.emit('config_updated', botConfig);
      }

      const updatedChannels = await waManager.getChannelsAndGroups();
      io.emit('channels_list', updatedChannels);

      callback({ success: true });
    } catch (err) {
      callback({ success: false, error: err.message });
    }
  });

  // Toggle scheduler ON / OFF
  socket.on('toggle_scheduler', ({ isEnabled }, callback) => {
    try {
      botConfig.isEnabled = !!isEnabled;
      if (botConfig.isEnabled) {
        calculateNextTime();
      } else {
        botConfig.nextScheduledTime = null;
        saveConfig();
        io.emit('config_updated', botConfig);
      }
      callback({ success: true });
    } catch (err) {
      callback({ success: false, error: err.message });
    }
  });

  // Manual test send
  socket.on('send_test_message', async ({ jid }, callback) => {
    try {
      if (reminders.length === 0) {
        throw new Error('قائمة الأذكار فارغة');
      }
      const previewText = reminders[botConfig.currentIndex % reminders.length] || reminders[0];
      const result = await waManager.sendMessageToChannel(jid, previewText);

      botConfig.lastSentTime = new Date().toISOString();
      if (result.channelName && result.channelName !== 'قناة واتساب') {
        botConfig.targetChannelName = result.channelName;
      }
      saveConfig();
      io.emit('config_updated', botConfig);

      const updatedChannels = await waManager.getChannelsAndGroups();
      io.emit('channels_list', updatedChannels);

      addLog(`[إرسال تجريبي] ${previewText}`, result.channelName, 'success');
      callback({ success: true });
    } catch (err) {
      addLog(`[فشل إرسال تجريبي] ${err.message}`, 'قناة', 'error');
      callback({ success: false, error: err.message });
    }
  });

  // Save reminder (create / update)
  socket.on('save_reminder', ({ index, text }, callback) => {
    try {
      if (index >= 0 && index < reminders.length) {
        reminders[index] = text;
      } else {
        reminders.push(text);
      }
      saveReminders();
      io.emit('reminders_updated', reminders);
      callback({ success: true });
    } catch (err) {
      callback({ success: false, error: err.message });
    }
  });

  // Delete reminder
  socket.on('delete_reminder', ({ index }, callback) => {
    try {
      if (index >= 0 && index < reminders.length) {
        reminders.splice(index, 1);
        saveReminders();
        io.emit('reminders_updated', reminders);
        callback({ success: true });
      } else {
        callback({ success: false, error: 'العنصر غير موجود' });
      }
    } catch (err) {
      callback({ success: false, error: err.message });
    }
  });

  // Restart WhatsApp socket
  socket.on('restart_whatsapp', async () => {
    await waManager.restart();
  });

  // Logout WhatsApp
  socket.on('logout_whatsapp', async (callback) => {
    await waManager.logout();
    if (callback) callback({ success: true });
  });

  // Clear logs
  socket.on('clear_logs', (callback) => {
    activityLogs = [];
    if (callback) callback({ success: true });
  });
});

// Start Express server and WhatsApp client
server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🕌 بوت أذكار قنوات الواتساب يعمل بنجاح!`);
  console.log(`🌐 لوحة التحكم: http://localhost:${PORT}`);
  console.log(`======================================================\n`);

  // Start WhatsApp instance
  waManager.start();
});

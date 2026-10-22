// =========================================================
// مُذكِّر قنوات الواتساب - الواجهة الأمامية الذكية (Dashboard Logic)
// =========================================================

const socket = io();

// State variables
let botConfig = {
  intervalMinutes: 60,
  targetChannelJid: '',
  targetChannelName: '',
  isEnabled: false,
  mode: 'sequential',
  currentIndex: 0,
  nextScheduledTime: null,
  lastSentTime: null
};

let remindersList = [];
let countdownInterval = null;

// DOM Elements
const connectionPill = document.getElementById('connection-pill');
const connectionText = document.getElementById('connection-text');
const liveClockTime = document.getElementById('clock-time');

// WhatsApp Status
const qrContainer = document.getElementById('qr-container');
const qrImage = document.getElementById('qr-image');
const qrLoading = document.getElementById('qr-loading');
const connectedContainer = document.getElementById('connected-container');
const waUserName = document.getElementById('wa-user-name');
const waUserPhone = document.getElementById('wa-user-phone');
const btnRestartWa = document.getElementById('btn-restart-wa');
const btnLogoutWa = document.getElementById('btn-logout-wa');

// Channel & Scheduler
const channelSelect = document.getElementById('channel-select');
const btnRefreshChannels = document.getElementById('btn-refresh-channels');
const manualJidInput = document.getElementById('manual-jid');
const intervalSelect = document.getElementById('interval-select');
const customMinutesGroup = document.getElementById('custom-minutes-group');
const customMinutesInput = document.getElementById('custom-minutes');
const modeSelect = document.getElementById('mode-select');
const toggleScheduler = document.getElementById('toggle-scheduler');
const schedulerStatusText = document.getElementById('scheduler-status-text');
const btnSaveSettings = document.getElementById('btn-save-settings');
const btnSendNow = document.getElementById('btn-send-now');

// Banner & Next message
const countdownDisplay = document.getElementById('countdown-display');
const nextTimeText = document.getElementById('next-time-text');
const nextMessagePreview = document.getElementById('next-message-preview');

// Reminders
const remindersListElem = document.getElementById('reminders-list');
const remindersCount = document.getElementById('reminders-count');
const btnOpenAddModal = document.getElementById('btn-open-add-modal');
const modalReminder = document.getElementById('modal-reminder');
const modalTitle = document.getElementById('modal-title');
const editIndexInput = document.getElementById('edit-index');
const reminderTextInput = document.getElementById('reminder-text');
const btnSaveReminder = document.getElementById('btn-save-reminder');
const btnCancelReminder = document.getElementById('btn-cancel-reminder');
const btnCloseModal = document.getElementById('btn-close-modal');

// Logs
const logsContainer = document.getElementById('logs-container');
const btnClearLogs = document.getElementById('btn-clear-logs');

// Deployment Modal
const btnOpenDeployGuide = document.getElementById('btn-open-deploy-guide');
const modalDeploy = document.getElementById('modal-deploy');
const btnCloseDeployModal = document.getElementById('btn-close-deploy-modal');
const btnDismissDeploy = document.getElementById('btn-dismiss-deploy');

// Toast
const toastContainer = document.getElementById('toast-container');

// ==========================================
// 1. Digital Clock & Initializers
// ==========================================
function updateClock() {
  const now = new Date();
  liveClockTime.textContent = now.toLocaleTimeString('ar-EG', {
    hour12: true,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}
setInterval(updateClock, 1000);
updateClock();

// Toast helper
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-circle-exclamation';

  toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==========================================
// 2. Socket.IO Listeners
// ==========================================

socket.on('connect', () => {
  console.log('Connected to server websocket');
  socket.emit('get_channels', (res) => {
    if (res && res.channels) populateChannels(res.channels);
  });
});

// WhatsApp Connection State Updates
socket.on('connection_state', (data) => {
  console.log('WA state:', data);
  if (data.status === 'connected') {
    connectionPill.className = 'status-pill status-connected';
    connectionText.textContent = 'متصل بنشاط';

    qrContainer.classList.add('hidden');
    connectedContainer.classList.remove('hidden');

    waUserName.textContent = data.user?.name || 'حساب الواتساب المتصل';
    waUserPhone.textContent = data.user?.id ? `+${data.user.id.split(':')[0].split('@')[0]}` : '---';
  } else if (data.status === 'connecting') {
    connectionPill.className = 'status-pill status-connecting';
    connectionText.textContent = 'جاري التوصيل...';

    if (data.qr) {
      qrLoading.classList.add('hidden');
      qrImage.src = data.qr;
      qrImage.classList.remove('hidden');
      qrContainer.classList.remove('hidden');
      connectedContainer.classList.add('hidden');
    }
  } else {
    // Disconnected
    connectionPill.className = 'status-pill status-disconnected';
    connectionText.textContent = 'غير متصل';

    connectedContainer.classList.add('hidden');
    qrContainer.classList.remove('hidden');

    if (data.qr) {
      qrLoading.classList.add('hidden');
      qrImage.src = data.qr;
      qrImage.classList.remove('hidden');
    } else {
      qrImage.classList.add('hidden');
      qrLoading.classList.remove('hidden');
    }
  }
});

// Bot Config & Scheduler updates
socket.on('config_updated', (cfg) => {
  botConfig = cfg;
  applyConfigToUI(cfg);
  updateNextPreview();
});

// Reminders list updates
socket.on('reminders_updated', (list) => {
  remindersList = list;
  renderReminders();
  updateNextPreview();
});

// Logs listener
socket.on('log_entry', (log) => {
  addLogToUI(log);
});

// Channels list received
socket.on('channels_list', (channels) => {
  populateChannels(channels);
});

// ==========================================
// 3. UI Helpers & Renders
// ==========================================

function applyConfigToUI(cfg) {
  toggleScheduler.checked = !!cfg.isEnabled;
  if (cfg.isEnabled) {
    schedulerStatusText.textContent = 'الجدولة تعمل تلقائياً الآن';
    schedulerStatusText.style.color = '#10b981';
  } else {
    schedulerStatusText.textContent = 'الجدولة متوقفة';
    schedulerStatusText.style.color = '#9ca3af';
  }

  // Interval
  if ([15, 30, 60, 120, 180, 360].includes(cfg.intervalMinutes)) {
    intervalSelect.value = String(cfg.intervalMinutes);
    customMinutesGroup.classList.add('hidden');
  } else {
    intervalSelect.value = 'custom';
    customMinutesGroup.classList.remove('hidden');
    customMinutesInput.value = cfg.intervalMinutes;
  }

  // Mode
  modeSelect.value = cfg.mode || 'sequential';

  // Manual JID
  if (cfg.targetChannelJid) {
    manualJidInput.value = cfg.targetChannelJid;
  }

  // Countdown timer trigger
  restartCountdown();
}

function updateNextPreview() {
  if (!remindersList || remindersList.length === 0) {
    nextMessagePreview.textContent = 'لا توجد أذكار في البنك حالياً. قم بإضافة ذكر جديد.';
    return;
  }

  let idx = botConfig.currentIndex || 0;
  if (botConfig.mode === 'random') {
    nextMessagePreview.textContent = remindersList[idx % remindersList.length] + ' (أو ذكر عشوائي آخر)';
  } else {
    const nextMsg = remindersList[idx % remindersList.length];
    nextMessagePreview.textContent = nextMsg || '---';
  }
}

function restartCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);

  if (!botConfig.isEnabled || !botConfig.nextScheduledTime) {
    countdownDisplay.textContent = '--:--:--';
    nextTimeText.textContent = 'الجدولة متوقفة حالياً';
    return;
  }

  function tick() {
    const next = new Date(botConfig.nextScheduledTime).getTime();
    const now = new Date().getTime();
    const diff = next - now;

    if (diff <= 0) {
      countdownDisplay.textContent = '00:00:00';
      nextTimeText.textContent = 'جاري الإرسال الآن...';
      return;
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);

    const pad = (n) => String(n).padStart(2, '0');
    countdownDisplay.textContent = `${pad(hours)}:${pad(mins)}:${pad(secs)}`;

    const nextDate = new Date(botConfig.nextScheduledTime);
    nextTimeText.textContent = `الموعد القادم: ${nextDate.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}`;
  }

  tick();
  countdownInterval = setInterval(tick, 1000);
}

function renderReminders() {
  remindersCount.textContent = `${remindersList.length} ذكر`;
  remindersListElem.innerHTML = '';

  if (remindersList.length === 0) {
    remindersListElem.innerHTML = `
      <div class="empty-state">
        <i class="fa-regular fa-folder-open"></i>
        <p>لا توجد أذكار في البنك. اضغط على "إضافة ذكر جديد" لإضافة أذكار وتذكيرات.</p>
      </div>
    `;
    return;
  }

  remindersList.forEach((text, i) => {
    const item = document.createElement('div');
    item.className = 'reminder-item';
    item.innerHTML = `
      <div class="reminder-index">${i + 1}</div>
      <div class="reminder-text-content">${escapeHtml(text)}</div>
      <div class="reminder-actions">
        <button class="btn-icon btn-edit" title="تعديل"><i class="fa-solid fa-pen-to-square"></i></button>
        <button class="btn-icon btn-delete text-danger" title="حذف"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    `;

    // Edit handler
    item.querySelector('.btn-edit').addEventListener('click', () => {
      openEditModal(i, text);
    });

    // Delete handler
    item.querySelector('.btn-delete').addEventListener('click', () => {
      deleteReminder(i);
    });

    remindersListElem.appendChild(item);
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function populateChannels(channels) {
  channelSelect.innerHTML = '<option value="">-- اختر القناة المستهدفة --</option>';
  
  // Filter: Only true WhatsApp Channels, strictly exclude any personal groups
  const onlyChannels = (channels || []).filter(ch => {
    if (!ch) return false;
    if (ch.isChannel === false) return false;
    if (ch.id && ch.id.endsWith('@g.us')) return false;
    return true;
  });

  if (onlyChannels.length === 0) {
    const opt = document.createElement('option');
    opt.value = "";
    opt.textContent = "لا توجد قنوات محفوظة (الصق رابط قناتك بالأسفل)";
    channelSelect.appendChild(opt);
    return;
  }

  onlyChannels.forEach((ch) => {
    const opt = document.createElement('option');
    opt.value = ch.id;
    opt.textContent = `📢 ${ch.name}`;
    if (ch.id === botConfig.targetChannelJid || (ch.link && ch.link === botConfig.targetChannelJid)) {
      opt.selected = true;
    }
    channelSelect.appendChild(opt);
  });
}

function addLogToUI(log) {
  // Remove empty state if present
  const empty = logsContainer.querySelector('.empty-state');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.className = `log-item ${log.status === 'success' ? 'success' : 'error'}`;
  item.innerHTML = `
    <span class="log-time">${new Date(log.timestamp).toLocaleTimeString('ar-EG')}</span>
    <span class="log-msg" title="${escapeHtml(log.message)}">${escapeHtml(log.message)}</span>
    <span class="log-channel badge">${escapeHtml(log.channelName || 'القناة')}</span>
  `;

  logsContainer.prepend(item);

  // Keep last 40 logs in UI
  while (logsContainer.children.length > 40) {
    logsContainer.removeChild(logsContainer.lastChild);
  }
}

// ==========================================
// 4. User Interaction Handlers
// ==========================================

// Custom Interval Select
intervalSelect.addEventListener('change', () => {
  if (intervalSelect.value === 'custom') {
    customMinutesGroup.classList.remove('hidden');
  } else {
    customMinutesGroup.classList.add('hidden');
  }
});

// Channel select change sync with manual JID
channelSelect.addEventListener('change', () => {
  if (channelSelect.value) {
    manualJidInput.value = channelSelect.value;
  }
});

// Refresh Channels button
btnRefreshChannels.addEventListener('click', () => {
  btnRefreshChannels.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الجلب...';
  socket.emit('get_channels', (res) => {
    btnRefreshChannels.innerHTML = '<i class="fa-solid fa-rotate"></i> تحديث';
    if (res && res.channels) {
      populateChannels(res.channels);
      showToast(`تم العثور على ${res.channels.length} قناة/مجموعة`, 'success');
    } else {
      showToast('تعذر جلب القنوات، تأكد من اتصال الواتساب أو أدخل المعرف يدوياً', 'error');
    }
  });
});

// Restart WhatsApp connection
btnRestartWa.addEventListener('click', () => {
  showToast('جاري إعادة تشغيل اتصال واتساب...', 'info');
  socket.emit('restart_whatsapp');
});

// Logout WhatsApp
btnLogoutWa.addEventListener('click', () => {
  if (confirm('هل أنت متأكد من رغبتك في تسجيل الخروج وفصل الجلسة؟ ستحتاج لمسح رمز QR مجدداً.')) {
    socket.emit('logout_whatsapp', (res) => {
      showToast('تم تسجيل الخروج وفصل الجلسة.', 'info');
    });
  }
});

// Save Settings Button
btnSaveSettings.addEventListener('click', () => {
  let minutes = parseInt(intervalSelect.value, 10);
  if (intervalSelect.value === 'custom') {
    minutes = parseInt(customMinutesInput.value, 10) || 60;
  }

  const jid = manualJidInput.value.trim() || channelSelect.value.trim();
  const selectedChannelText = channelSelect.options[channelSelect.selectedIndex]?.text || jid;

  const newConfig = {
    ...botConfig,
    intervalMinutes: minutes,
    targetChannelJid: jid,
    targetChannelName: selectedChannelText.split(' (')[0],
    mode: modeSelect.value,
    isEnabled: toggleScheduler.checked
  };

  socket.emit('save_config', newConfig, (res) => {
    if (res.success) {
      showToast('تم حفظ الإعدادات بنجاح!', 'success');
    } else {
      showToast('حدث خطأ أثناء حفظ الإعدادات: ' + res.error, 'error');
    }
  });
});

// Toggle Scheduler change directly
toggleScheduler.addEventListener('change', () => {
  const isEnabled = toggleScheduler.checked;
  const jid = manualJidInput.value.trim() || channelSelect.value.trim();

  if (isEnabled && !jid) {
    showToast('برجاء اختيار القناة أو إدخال معرّف القناة أولاً قبل تفعيل الجدولة', 'error');
    toggleScheduler.checked = false;
    return;
  }

  socket.emit('toggle_scheduler', { isEnabled }, (res) => {
    if (res.success) {
      showToast(isEnabled ? 'تم تفعيل الجدولة التلقائية بنجاح!' : 'تم إيقاف الجدولة مؤقتاً', 'info');
    } else {
      toggleScheduler.checked = !isEnabled;
      showToast(res.error || 'فشل تغيير حالة الجدولة', 'error');
    }
  });
});

// Send Now Button
btnSendNow.addEventListener('click', () => {
  const jid = manualJidInput.value.trim() || channelSelect.value.trim();
  if (!jid) {
    showToast('برجاء إدخال أو اختيار القناة المستهدفة أولاً', 'error');
    return;
  }

  btnSendNow.disabled = true;
  btnSendNow.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الإرسال...';

  socket.emit('send_test_message', { jid }, (res) => {
    btnSendNow.disabled = false;
    btnSendNow.innerHTML = '<i class="fa-solid fa-paper-plane"></i> إرسال تجريبي الآن';

    if (res.success) {
      showToast('تم إرسال الرسالة للقناة بنجاح! تفقد قناتك على الواتساب 🌟', 'success');
    } else {
      showToast('تعذر الإرسال: ' + (res.error || 'تأكد من أنك مشرف (Admin) في القناة'), 'error');
    }
  });
});

// Clear Logs
btnClearLogs.addEventListener('click', () => {
  socket.emit('clear_logs', () => {
    logsContainer.innerHTML = `
      <div class="empty-state">
        <i class="fa-regular fa-clock"></i>
        <p>تم مسح السجل.</p>
      </div>
    `;
    showToast('تم مسح السجل', 'info');
  });
});

// ==========================================
// 5. Reminders Modal Management
// ==========================================

btnOpenAddModal.addEventListener('click', () => {
  modalTitle.textContent = 'إضافة تذكير / ذكر جديد';
  editIndexInput.value = '-1';
  reminderTextInput.value = '';
  modalReminder.classList.remove('hidden');
});

function openEditModal(index, text) {
  modalTitle.textContent = 'تعديل الذكر';
  editIndexInput.value = String(index);
  reminderTextInput.value = text;
  modalReminder.classList.remove('hidden');
}

function closeModal() {
  modalReminder.classList.add('hidden');
}

btnCancelReminder.addEventListener('click', closeModal);
btnCloseModal.addEventListener('click', closeModal);

btnSaveReminder.addEventListener('click', () => {
  const text = reminderTextInput.value.trim();
  if (!text) {
    showToast('برجاء كتابة نص الذكر أو التذكير', 'error');
    return;
  }

  const index = parseInt(editIndexInput.value, 10);
  socket.emit('save_reminder', { index, text }, (res) => {
    if (res.success) {
      closeModal();
      showToast(index === -1 ? 'تمت إضافة الذكر بنجاح!' : 'تم حفظ التعديل بنجاح!', 'success');
    } else {
      showToast('حدث خطأ أثناء الحفظ', 'error');
    }
  });
});

function deleteReminder(index) {
  if (confirm('هل أنت متأكد من حذف هذا الذكر من البنك؟')) {
    socket.emit('delete_reminder', { index }, (res) => {
      if (res.success) {
        showToast('تم حذف الذكر بنجاح', 'info');
      } else {
        showToast('حدث خطأ أثناء الحذف', 'error');
      }
    });
  }
}

// ==========================================
// 6. Deployment Guide Modal
// ==========================================

btnOpenDeployGuide.addEventListener('click', () => {
  modalDeploy.classList.remove('hidden');
});

btnCloseDeployModal.addEventListener('click', () => {
  modalDeploy.classList.add('hidden');
});

btnDismissDeploy.addEventListener('click', () => {
  modalDeploy.classList.add('hidden');
});

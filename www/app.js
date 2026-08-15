// ========================================
// CONFIG / STATE
// ========================================

const STORAGE_KEYS = {
  token: 'tgu_bot_token',
  chatId: 'tgu_chat_id',
  history: 'tgu_history'
};

let settings = {
  token: localStorage.getItem(STORAGE_KEYS.token) || '',
  chatId: localStorage.getItem(STORAGE_KEYS.chatId) || ''
};

let selectedFiles = [];   // { id, file, url, status, progress }
let history = loadHistory();
let uploading = false;
let seq = 0;


// ========================================
// INIT
// ========================================

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('botToken').value = settings.token;
  document.getElementById('chatId').value = settings.chatId;
  updateConnStatus();
  renderHistory();
  registerServiceWorker();
  initNativeSync();
});


function isNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}


function updateConnStatus() {
  const el = document.getElementById('connStatus');
  if (settings.token && settings.chatId) {
    el.textContent = 'Siap mengirim';
    el.classList.remove('text-dim');
    el.classList.add('text-mint');
  } else {
    el.textContent = 'Belum diatur — buka ⚙️';
    el.classList.add('text-dim');
    el.classList.remove('text-mint');
  }
}


// ========================================
// SETTINGS MODAL
// ========================================

function openSettings() {
  document.getElementById('botToken').value = settings.token;
  document.getElementById('chatId').value = settings.chatId;
  document.getElementById('chatIdCandidates').classList.add('hidden');
  document.getElementById('chatIdCandidates').innerHTML = '';
  const modal = document.getElementById('settingsModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeSettings() {
  const modal = document.getElementById('settingsModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function saveSettings() {
  const token = document.getElementById('botToken').value.trim();
  const chatId = document.getElementById('chatId').value.trim();

  if (!token || !chatId) {
    showToast('Bot Token dan Chat ID wajib diisi', true);
    return;
  }

  settings.token = token;
  settings.chatId = chatId;

  localStorage.setItem(STORAGE_KEYS.token, token);
  localStorage.setItem(STORAGE_KEYS.chatId, chatId);

  if (isNative()) {
    window.Capacitor.Plugins.TgSync.configure({ token, chatId }).catch(() => {});
  }

  updateConnStatus();
  closeSettings();
  showToast('Pengaturan tersimpan di HP ini');
}


// ========================================
// TELEGRAM: TEST CONNECTION
// ========================================

async function testConnection() {
  const token = document.getElementById('botToken').value.trim();

  if (!token) {
    showToast('Isi Bot Token dulu', true);
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();

    if (!data.ok) throw new Error(data.description || 'Token tidak valid');

    showToast(`Terhubung sebagai @${data.result.username}`);
  } catch (err) {
    showToast(`Gagal: ${err.message}`, true);
  }
}


// ========================================
// TELEGRAM: DETECT CHAT ID
// ========================================

async function detectChatId() {
  const token = document.getElementById('botToken').value.trim();
  const box = document.getElementById('chatIdCandidates');

  if (!token) {
    showToast('Isi Bot Token dulu', true);
    return;
  }

  box.classList.remove('hidden');
  box.innerHTML = `<div class="text-xs text-dim py-2">Mencari pesan terbaru...</div>`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=20`);
    const data = await res.json();

    if (!data.ok) throw new Error(data.description || 'Gagal mengambil update');

    const seen = new Map();
    (data.result || []).forEach(update => {
      const msg = update.message || update.channel_post;
      if (!msg || !msg.chat) return;
      seen.set(msg.chat.id, msg.chat);
    });

    if (!seen.size) {
      box.innerHTML = `
        <div class="text-xs text-dim py-2 leading-relaxed">
          Belum ada pesan ditemukan. Kirim pesan apa saja ke bot kamu di Telegram dulu, lalu tekan "Deteksi" lagi.
        </div>`;
      return;
    }

    box.innerHTML = Array.from(seen.values()).map(chat => {
      const label = chat.title || chat.username || `${chat.first_name || ''} ${chat.last_name || ''}`.trim() || 'Chat';
      return `
        <button
          onclick="pickChatId(${chat.id}, ${JSON.stringify(label)})"
          class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-panel2 border border-line hover:border-amber/50 text-left transition"
        >
          <span class="text-sm font-semibold truncate">${escapeHtml(label)}</span>
          <span class="text-[11px] font-mono text-dim shrink-0 ml-2">${chat.id}</span>
        </button>`;
    }).join('');

  } catch (err) {
    box.innerHTML = `<div class="text-xs text-coral py-2">Gagal: ${escapeHtml(err.message)}</div>`;
  }
}

function pickChatId(id, label) {
  document.getElementById('chatId').value = id;
  document.getElementById('chatIdCandidates').classList.add('hidden');
  showToast(`Chat dipilih: ${label}`);
}


// ========================================
// FILE PICKING
// ========================================

function handleFilesPicked(fileList) {
  const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));

  if (!files.length) {
    showToast('Tidak ada gambar ditemukan di pilihan itu', true);
    return;
  }

  files.forEach(file => {
    selectedFiles.push({
      id: ++seq,
      file,
      url: URL.createObjectURL(file),
      status: 'pending',
      progress: 0
    });
  });

  document.getElementById('filePicker').value = '';
  document.getElementById('folderPicker').value = '';

  showToast(`${files.length} gambar ditambahkan`);
  renderSelectedGrid();
}


function removeSelected(id) {
  const item = selectedFiles.find(f => f.id === id);
  if (item) URL.revokeObjectURL(item.url);
  selectedFiles = selectedFiles.filter(f => f.id !== id);
  renderSelectedGrid();
}


function clearSelected() {
  selectedFiles.forEach(f => URL.revokeObjectURL(f.url));
  selectedFiles = [];
  renderSelectedGrid();
}


function renderSelectedGrid() {
  const section = document.getElementById('selectedSection');
  const grid = document.getElementById('selectedGrid');
  const title = document.getElementById('selectedTitle');
  const pickCount = document.getElementById('pickCount');

  if (!selectedFiles.length) {
    section.classList.add('hidden');
    pickCount.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  pickCount.classList.remove('hidden');
  pickCount.textContent = `${selectedFiles.length} dipilih`;
  title.textContent = `${selectedFiles.length} gambar`;

  grid.innerHTML = selectedFiles.map(item => `
    <div id="card-${item.id}" class="relative aspect-square rounded-xl overflow-hidden bg-panel2 border border-line group">
      <img src="${item.url}" class="w-full h-full object-cover" loading="lazy">

      ${item.status === 'pending' ? `
        <button onclick="removeSelected(${item.id})" class="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center active:scale-90">✕</button>
      ` : ''}

      ${item.status === 'uploading' ? `
        <div class="absolute inset-0 bg-black/50 flex items-center justify-center">
          <div class="w-8 h-8 rounded-full border-2 border-white/30 border-t-amber animate-spin"></div>
        </div>
      ` : ''}

      ${item.status === 'success' ? `
        <div class="absolute inset-0 bg-mint/20 flex items-center justify-center text-2xl">✅</div>
      ` : ''}

      ${item.status === 'error' ? `
        <button onclick="retryOne(${item.id})" class="absolute inset-0 bg-coral/30 flex flex-col items-center justify-center gap-1" title="Coba lagi">
          <span class="text-xl">⚠️</span>
          <span class="text-[10px] font-bold text-white">Ulangi</span>
        </button>
      ` : ''}
    </div>
  `).join('');
}


function retryOne(id) {
  const item = selectedFiles.find(f => f.id === id);
  if (item) {
    item.status = 'pending';
    renderSelectedGrid();
  }
}


// ========================================
// UPLOAD
// ========================================

async function uploadAll() {
  if (uploading) return;

  if (!settings.token || !settings.chatId) {
    showToast('Atur Bot Token & Chat ID dulu di ⚙️', true);
    openSettings();
    return;
  }

  const pending = selectedFiles.filter(f => f.status === 'pending' || f.status === 'error');

  if (!pending.length) {
    showToast('Tidak ada gambar yang perlu dikirim', true);
    return;
  }

  uploading = true;

  const uploadBtn = document.getElementById('uploadBtn');
  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Mengirim...';

  const mode = document.getElementById('uploadMode').value;

  const progressWrap = document.getElementById('overallProgressWrap');
  const progressBar = document.getElementById('overallProgressBar');
  const progressPct = document.getElementById('overallProgressPct');
  const progressLabel = document.getElementById('overallProgressLabel');
  progressWrap.classList.remove('hidden');

  let done = 0;
  const total = pending.length;

  for (const item of pending) {
    item.status = 'uploading';
    renderSelectedGrid();

    progressLabel.textContent = `Mengirim ${done + 1} dari ${total}...`;

    try {
      await uploadOne(item, mode, pct => {
        const overall = ((done + pct / 100) / total) * 100;
        progressBar.style.width = `${overall}%`;
        progressPct.textContent = `${Math.round(overall)}%`;
      });

      item.status = 'success';
      addHistory({
        name: item.file.name,
        size: item.file.size,
        status: 'success',
        time: Date.now()
      });

    } catch (err) {
      item.status = 'error';
      addHistory({
        name: item.file.name,
        size: item.file.size,
        status: 'error',
        error: err.message,
        time: Date.now()
      });
    }

    done++;
    renderSelectedGrid();
  }

  progressLabel.textContent = 'Selesai';
  progressBar.style.width = '100%';
  progressPct.textContent = '100%';

  const failed = selectedFiles.filter(f => f.status === 'error').length;
  const success = selectedFiles.filter(f => f.status === 'success').length;

  showToast(
    failed
      ? `${success} terkirim, ${failed} gagal`
      : `${success} gambar berhasil dikirim ke Telegram`,
    !!failed
  );

  setTimeout(() => {
    selectedFiles.filter(f => f.status === 'success').forEach(f => URL.revokeObjectURL(f.url));
    selectedFiles = selectedFiles.filter(f => f.status !== 'success');
    renderSelectedGrid();
    progressWrap.classList.add('hidden');
    progressBar.style.width = '0%';
  }, 1200);

  uploading = false;
  uploadBtn.disabled = false;
  uploadBtn.textContent = 'Kirim ke Telegram';
  renderHistory();
}


function uploadOne(item, mode, onProgress) {
  return new Promise((resolve, reject) => {
    const method = mode === 'document' ? 'sendDocument' : 'sendPhoto';
    const field = mode === 'document' ? 'document' : 'photo';

    const form = new FormData();
    form.append('chat_id', settings.chatId);
    form.append(field, item.file, item.file.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.telegram.org/bot${settings.token}/${method}`);

    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (data.ok) resolve(data.result);
        else reject(new Error(data.description || 'Ditolak Telegram'));
      } catch {
        reject(new Error('Respon tidak valid'));
      }
    };

    xhr.onerror = () => reject(new Error('Koneksi gagal'));

    xhr.send(form);
  });
}


// ========================================
// HISTORY
// ========================================

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.history)) || [];
  } catch {
    return [];
  }
}

function addHistory(entry) {
  history.unshift(entry);
  history = history.slice(0, 50);
  localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history));
}

function clearHistory() {
  history = [];
  localStorage.removeItem(STORAGE_KEYS.history);
  renderHistory();
  showToast('Riwayat dihapus');
}

function renderHistory() {
  const list = document.getElementById('historyList');

  if (!history.length) {
    list.innerHTML = `<div class="py-10 text-center text-dim text-sm">Belum ada riwayat kirim.</div>`;
    return;
  }

  list.innerHTML = history.map(h => `
    <div class="px-5 py-3 flex items-center gap-3">
      <span class="text-lg">${h.status === 'success' ? '✅' : '⚠️'}</span>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold truncate">${escapeHtml(h.name)}</div>
        <div class="text-[11px] text-dim font-mono">
          ${formatBytes(h.size)} • ${formatTime(h.time)}
          ${h.status === 'error' ? ` • ${escapeHtml(h.error || 'gagal')}` : ''}
        </div>
      </div>
    </div>
  `).join('');
}


// ========================================
// PWA
// ========================================

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}


// ========================================
// NATIVE AUTO-SYNC (Android app only)
// ========================================

async function initNativeSync() {
  if (!isNative()) return;

  document.getElementById('autoSyncSection').classList.remove('hidden');

  if (settings.token && settings.chatId) {
    window.Capacitor.Plugins.TgSync.configure({ token: settings.token, chatId: settings.chatId }).catch(() => {});
  }

  await refreshSyncStatus();
}


async function refreshSyncStatus() {
  if (!isNative()) return;

  try {
    const status = await window.Capacitor.Plugins.TgSync.getStatus();

    document.getElementById('autoSyncToggle').checked = !!status.enabled;
    document.getElementById('syncInterval').value = String(status.intervalMinutes || 15);
    document.getElementById('statTotalSynced').textContent = status.totalSynced || 0;
    document.getElementById('statLastSync').textContent = status.lastSyncTime
      ? formatTime(status.lastSyncTime)
      : '—';

    document.getElementById('permissionRow').classList.toggle('hidden', !!status.hasPermission);

    const names = status.selectedFolderNames;
    document.getElementById('selectedFoldersLabel').textContent =
      names && names.length ? names : 'Semua folder';

  } catch (err) {
    console.error('sync status error', err);
  }
}


// ========================================
// FOLDER PICKER
// ========================================

let folderPickerSelection = new Set();
let availableFolders = [];

async function openFolderPicker() {
  if (!isNative()) return;

  const modal = document.getElementById('folderModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  const perm = await window.Capacitor.Plugins.TgSync.checkPermission();
  if (!perm.granted) {
    const res = await window.Capacitor.Plugins.TgSync.requestStoragePermission();
    if (!res.granted) {
      showToast('Izin akses galeri diperlukan untuk melihat folder', true);
      closeFolderPicker();
      return;
    }
  }

  const list = document.getElementById('folderList');
  list.innerHTML = `<div class="py-10 text-center text-dim text-sm">Memuat folder...</div>`;

  try {
    const status = await window.Capacitor.Plugins.TgSync.getStatus();
    folderPickerSelection = new Set(status.selectedFolderIds || []);

    const res = await window.Capacitor.Plugins.TgSync.listFolders();
    availableFolders = res.folders || [];

    renderFolderList();
  } catch (err) {
    list.innerHTML = `<div class="py-10 text-center text-coral text-sm">Gagal memuat folder</div>`;
  }
}

function closeFolderPicker() {
  const modal = document.getElementById('folderModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function renderFolderList() {
  const list = document.getElementById('folderList');

  if (!availableFolders.length) {
    list.innerHTML = `<div class="py-10 text-center text-dim text-sm">Tidak ada folder foto ditemukan.</div>`;
    return;
  }

  list.innerHTML = availableFolders.map(f => {
    const checked = folderPickerSelection.has(f.id);
    return `
      <label class="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-panel2 border ${checked ? 'border-mint' : 'border-line'} cursor-pointer transition">
        <input
          type="checkbox"
          ${checked ? 'checked' : ''}
          onchange="toggleFolderSelection('${f.id}', this.checked)"
          class="w-5 h-5 accent-mint shrink-0"
        >
        <div class="min-w-0 flex-1">
          <div class="text-sm font-bold truncate">${escapeHtml(f.name)}</div>
          <div class="text-[11px] text-dim">${f.count} foto</div>
        </div>
      </label>
    `;
  }).join('');
}

function toggleFolderSelection(id, checked) {
  if (checked) folderPickerSelection.add(id);
  else folderPickerSelection.delete(id);
}

async function saveFolderSelection() {
  const ids = Array.from(folderPickerSelection);
  const names = availableFolders
    .filter(f => folderPickerSelection.has(f.id))
    .map(f => f.name);

  await window.Capacitor.Plugins.TgSync.setSyncFolders({ ids, names });

  showToast(ids.length ? `${ids.length} folder dipilih untuk auto-sync` : 'Auto-sync akan pakai semua folder');
  closeFolderPicker();
  refreshSyncStatus();
}


async function requestGalleryPermission() {
  try {
    const res = await window.Capacitor.Plugins.TgSync.requestStoragePermission();
    if (res.granted) {
      showToast('Izin akses galeri diberikan');
      document.getElementById('permissionRow').classList.add('hidden');
    } else {
      showToast('Izin ditolak — auto-sync tidak akan jalan', true);
    }
  } catch (err) {
    showToast('Gagal meminta izin', true);
  }
}


async function toggleAutoSync(enabled) {
  if (!settings.token || !settings.chatId) {
    showToast('Atur Bot Token & Chat ID dulu', true);
    document.getElementById('autoSyncToggle').checked = false;
    openSettings();
    return;
  }

  if (enabled) {
    const perm = await window.Capacitor.Plugins.TgSync.checkPermission();
    if (!perm.granted) {
      const res = await window.Capacitor.Plugins.TgSync.requestStoragePermission();
      if (!res.granted) {
        showToast('Izin akses galeri ditolak', true);
        document.getElementById('autoSyncToggle').checked = false;
        return;
      }
    }
  }

  const interval = parseInt(document.getElementById('syncInterval').value, 10) || 15;

  await window.Capacitor.Plugins.TgSync.setAutoSync({ enabled, intervalMinutes: interval });

  showToast(enabled ? 'Auto-sync diaktifkan' : 'Auto-sync dimatikan');
  refreshSyncStatus();
}


async function updateSyncInterval(value) {
  const enabled = document.getElementById('autoSyncToggle').checked;
  if (!enabled) return;

  await window.Capacitor.Plugins.TgSync.setAutoSync({
    enabled: true,
    intervalMinutes: parseInt(value, 10) || 15
  });

  showToast('Interval sync diperbarui');
}


async function syncNow() {
  if (!settings.token || !settings.chatId) {
    showToast('Atur Bot Token & Chat ID dulu', true);
    return;
  }

  const perm = await window.Capacitor.Plugins.TgSync.checkPermission();
  if (!perm.granted) {
    const res = await window.Capacitor.Plugins.TgSync.requestStoragePermission();
    if (!res.granted) {
      showToast('Izin akses galeri diperlukan', true);
      return;
    }
  }

  await window.Capacitor.Plugins.TgSync.syncNow();
  showToast('Sync dijalankan di latar belakang...');

  setTimeout(refreshSyncStatus, 4000);
}


// ========================================
// UTILS
// ========================================

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString('id-ID')} ${time}`;
}

let toastTimer = null;
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden', 'border-coral', 'border-line');
  toast.classList.add(isError ? 'border-coral' : 'border-line');
  toast.style.borderWidth = '1px';

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

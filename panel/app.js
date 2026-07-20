let token = localStorage.getItem('mc_token');
let currentUser = null;
let resetToken = null;
const API = '';

// Toast
function toast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  setTimeout(() => t.className = 'toast hidden', 3000);
}

function showEl(id, show) {
  document.getElementById(id).classList.toggle('hidden', !show);
}

// Loading
window.addEventListener('load', () => {
  let p = 0;
  const bar = document.getElementById('loadBar');
  const txt = document.getElementById('loadText');
  const texts = ['در حال بارگذاری...', 'آماده‌سازی...', 'تقریباً آماده...'];
  const iv = setInterval(() => {
    p += Math.random() * 35;
    if (p > 100) p = 100;
    bar.style.width = p + '%';
    txt.textContent = texts[Math.floor(p / 34)] || texts[2];
    if (p >= 100) {
      clearInterval(iv);
      setTimeout(() => {
        document.getElementById('loadingScreen').style.display = 'none';
        if (token) checkAuth();
        else showEl('loginScreen', true);
      }, 400);
    }
  }, 250);
});

// Tabs
function showTab(tab) {
  ['login', 'register', 'forgot', 'reset'].forEach(t => showEl('tab-' + t, t === tab));
  document.querySelectorAll('.login-tab').forEach((el, i) => el.classList.toggle('active', ['login', 'register'][i] === tab));
  document.getElementById('authError').style.display = 'none';
  document.getElementById('authSuccess').style.display = 'none';
}

function showAuthErr(msg) {
  const e = document.getElementById('authError');
  e.textContent = msg; e.style.display = 'block';
}
function showAuthOk(msg) {
  const s = document.getElementById('authSuccess');
  s.textContent = msg; s.style.display = 'block';
}

// Auth API
async function api(path, body, method) {
  const m = method || (body ? 'POST' : 'GET');
  const opts = { method: m, headers: { 'Content-Type': 'application/json' } };
  if (body && m !== 'DELETE') opts.body = JSON.stringify(body);
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(API + path, opts);
  return r.json();
}

async function apiGet(path) {
  const opts = { headers: {} };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(API + path, opts);
  return r.json();
}

async function checkAuth() {
  try {
    const d = await apiGet('/api/auth/me');
    if (d.user) {
      currentUser = d.user;
      enterApp();
    } else {
      showEl('loginScreen', true);
    }
  } catch { showEl('loginScreen', true); }
}

async function doLogin() {
  const u = document.getElementById('loginUser').value;
  const p = document.getElementById('loginPass').value;
  if (!u || !p) return showAuthErr('همه فیلدها را پر کنید');
  try {
    const d = await api('/api/auth/login', { username: u, password: p });
    if (d.error) return showAuthErr(d.error);
    token = d.token; localStorage.setItem('mc_token', token);
    currentUser = d.user; enterApp();
  } catch { showAuthErr('خطا در اتصال'); }
}

async function doRegister() {
  const u = document.getElementById('regUser').value;
  const e = document.getElementById('regEmail').value;
  const n = document.getElementById('regName').value;
  const p = document.getElementById('regPass').value;
  const p2 = document.getElementById('regPass2').value;
  if (!u || !p) return showAuthErr('نام کاربری و رمز الزامی است');
  if (p !== p2) return showAuthErr('رمزها مطابقت ندارند');
  if (p.length < 6) return showAuthErr('رمز باید حداقل 6 کاراکتر باشد');
  try {
    const d = await api('/api/auth/register', { username: u, email: e, password: p, display_name: n || u });
    if (d.error) return showAuthErr(d.error);
    token = d.token; localStorage.setItem('mc_token', token);
    currentUser = d.user; enterApp();
  } catch { showAuthErr('خطا در اتصال'); }
}

async function doForgot() {
  const e = document.getElementById('forgotEmail').value;
  if (!e) return showAuthErr('ایمیل را وارد کنید');
  try {
    const d = await api('/api/auth/forgot-password', { email: e });
    if (d.resetToken) resetToken = d.resetToken;
    showAuthOk('لینک بازیابی ارسال شد');
    setTimeout(() => showTab('reset'), 1500);
  } catch { showAuthErr('خطا در اتصال'); }
}

async function doReset() {
  const p = document.getElementById('resetPass').value;
  const p2 = document.getElementById('resetPass2').value;
  if (!p || !p2) return showAuthErr('فیلدها را پر کنید');
  if (p !== p2) return showAuthErr('رمزها مطابقت ندارند');
  if (!resetToken) return showAuthErr('ابتدا لینک بازیابی را دریافت کنید');
  try {
    const d = await api('/api/auth/reset-password', { token: resetToken, newPassword: p });
    if (d.error) return showAuthErr(d.error);
    showAuthOk('رمز با موفقیت تغییر کرد');
    setTimeout(() => showTab('login'), 1500);
  } catch { showAuthErr('خطا در اتصال'); }
}

function googleLogin() {
  toast('Google login requires setup', 'error');
}

// Enter App
function enterApp() {
  showEl('loginScreen', false);
  showEl('mainApp', true);
  document.getElementById('dispName').textContent = currentUser.display_name || currentUser.username;
  document.getElementById('dispRole').textContent = currentUser.role;
  
  const r = currentUser.role;
  const isAdmin = ['owner', 'admin'].includes(r);
  const isOwner = r === 'owner';
  const isMod = ['owner', 'admin', 'moderator'].includes(r);
  
  // Admin-only nav items
  const adminPages = ['users', 'logs', 'config', 'backups'];
  document.querySelectorAll('.nav-item').forEach(el => {
    const pg = el.dataset.page;
    if (adminPages.includes(pg) && !isAdmin) el.style.display = 'none';
    else el.style.display = '';
  });
  
  // Dashboard control buttons - admin only
  document.querySelectorAll('.control-buttons .mc-btn').forEach(btn => {
    if (!isAdmin) btn.style.display = 'none';
    else btn.style.display = '';
  });
  
  // Quick commands - mod+
  document.querySelectorAll('.quick-commands .mc-btn').forEach(btn => {
    if (!isMod) btn.style.display = 'none';
    else btn.style.display = '';
  });
  
  // Players page - player actions admin only
  const playerActions = document.querySelector('#page-players .card-body');
  if (playerActions && !isMod) {
    const actionSection = playerActions.querySelectorAll('button');
    actionSection.forEach(b => b.style.display = 'none');
  }
  
  initSocket();
  loadDashboard();
}

function doLogout() {
  token = null; currentUser = null;
  localStorage.removeItem('mc_token');
  showEl('mainApp', false);
  showEl('loginScreen', true);
}

// Socket
let socket;
function initSocket() {
  socket = io();
  socket.on('serverStatus', updateStatus);
  socket.on('consoleOutput', d => addConsole('[' + d.user + '] ' + d.command));
}

function updateStatus(s) {
  const on = s.online;
  document.getElementById('statusDot').className = 'status-dot ' + (on ? 'online' : 'offline');
  document.getElementById('statusText').textContent = on ? 'آنلاین' : 'آفلاین';
  document.getElementById('dashStatus').textContent = on ? 'آنلاین' : 'آفلاین';
  document.getElementById('dashPlayers').textContent = s.players.length + '/20';
  document.getElementById('dashTps').textContent = s.tps ? s.tps.toFixed(1) : '--';
  document.getElementById('dashMem').textContent = (s.memory.used || 0) + 'MB';
  document.getElementById('navPlayers').textContent = s.players.length + ' بازیکن';
  document.getElementById('navTps').textContent = 'TPS: ' + (s.tps ? s.tps.toFixed(1) : '--');
  document.getElementById('dashPlayerList').innerHTML = s.players.length ? s.players.map(p => '<div style="padding:8px;background:rgba(0,0,0,0.3);border:1px solid #333;margin-bottom:5px">' + p + '</div>').join('') : 'هیچ بازیکنی آنلاین نیست';
}

// Close sidebar on mobile
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('active');
}

// Navigation
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => {
    const pg = el.dataset.page;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + pg).classList.add('active');
    const titles = { dashboard: 'داشبورد', players: 'بازیکنان', console: 'کنسول', users: 'مدیریت کاربران', plugins: 'پلاگین‌ها', worlds: 'جهان‌ها', backups: 'بکاپ‌ها', config: 'تنظیمات', logs: 'لاگ فعالیت' };
    document.getElementById('pageTitle').textContent = titles[pg] || pg;
    if (pg === 'users') loadUsers();
    if (pg === 'logs') loadLogs();
    if (pg === 'config') loadConfig();
    if (pg === 'backups') loadBackups();
    if (window.innerWidth <= 768) closeSidebar();
  });
});

// Dashboard
async function loadDashboard() {
  try {
    const s = await apiGet('/api/status');
    updateStatus(s);
  } catch {}
}

// Server Actions
async function srvAction(action) {
  try {
    const d = await api('/api/server/' + action, {});
    toast(d.success ? 'انجام شد' : (d.error || 'خطا'), d.success ? 'success' : 'error');
  } catch { toast('خطا', 'error'); }
}

function quickCmd(cmd) { api('/api/command', { command: cmd }).then(d => toast(d.success ? 'انجام شد' : 'خطا', d.success ? 'success' : 'error')); }

// Players
function plrCmd(action) {
  const p = document.getElementById('targetPlayer').value;
  if (!p) return toast('نام بازیکن را وارد کنید', 'error');
  const endpoint = action === 'pardon' ? 'player/pardon' : action === 'op' || action === 'deop' ? 'player/' + action : 'player/' + action;
  api('/api/' + endpoint, { player: p, reason: 'By admin' }).then(d => {
    toast(d.success ? 'انجام شد' : 'خطا', d.success ? 'success' : 'error');
  });
}

function plrGm(mode) {
  const p = document.getElementById('targetPlayer').value;
  if (!p) return toast('نام بازیکن را وارد کنید', 'error');
  api('/api/player/gamemode', { player: p, mode }).then(d => toast(d.success ? 'انجام شد' : 'خطا', d.success ? 'success' : 'error'));
}

// Console
function addConsole(text) {
  const c = document.getElementById('consoleOut');
  c.innerHTML += '<div style="color:#4ade80;border-bottom:1px solid #222;padding:3px 0">' + text + '</div>';
  c.scrollTop = c.scrollHeight;
}

async function sendCmd() {
  const inp = document.getElementById('cmdInput');
  const cmd = inp.value.trim();
  if (!cmd) return;
  addConsole('> ' + cmd);
  inp.value = '';
  try {
    const d = await api('/api/command', { command: cmd });
    if (d.response) addConsole(d.response);
    if (d.error) addConsole('ERROR: ' + d.error);
  } catch { addConsole('ERROR: connection failed'); }
}

// Users Management
async function loadUsers() {
  try {
    const [users, stats] = await Promise.all([apiGet('/api/users'), apiGet('/api/users/stats/overview')]);
    document.getElementById('uTotal').textContent = stats.total || 0;
    document.getElementById('uActive').textContent = stats.active || 0;
    document.getElementById('uBanned').textContent = stats.banned || 0;
    document.getElementById('uWarns').textContent = stats.totalWarnings || 0;
    const c = document.getElementById('usersList');
    if (!users.length) { c.innerHTML = 'کاربری یافت نشد'; return; }
    
    const r = currentUser.role;
    const isAdmin = ['owner', 'admin'].includes(r);
    const isMod = ['owner', 'admin', 'moderator'].includes(r);
    
    c.innerHTML = users.map(u => {
      let btns = '';
      if (isMod && u.status === 'active') {
        btns += '<button onclick="warnUser(\'' + u.id + '\')" class="mc-btn mc-btn-gold" style="width:auto;padding:4px 8px;font-size:12px">هشدار</button>';
      }
      if (isAdmin && u.status === 'active') {
        btns += '<button onclick="banUser(\'' + u.id + '\')" class="mc-btn mc-btn-danger" style="width:auto;padding:4px 8px;font-size:12px">بن</button>';
      }
      if (isAdmin && u.status === 'banned') {
        btns += '<button onclick="unbanUser(\'' + u.id + '\')" class="mc-btn" style="width:auto;padding:4px 8px;font-size:12px">رفع بن</button>';
      }
      if (r === 'owner' && u.role !== 'owner') {
        btns += '<button onclick="changeRole(\'' + u.id + '\')" class="mc-btn" style="width:auto;padding:4px 8px;font-size:12px">نقش</button>';
      }
      if (r === 'owner' && u.role !== 'owner' && u.id !== currentUser.id) {
        btns += '<button onclick="deleteUser(\'' + u.id + '\')" class="mc-btn mc-btn-danger" style="width:auto;padding:4px 8px;font-size:12px">حذف</button>';
      }
      
      const roleColors = { owner: '#FFD700', admin: '#3498db', moderator: '#eab308', user: '#ccc' };
      
      return '<div class="user-card"><div class="user-card-left"><div class="user-card-avatar" style="background:' + (roleColors[u.role] || '#ccc') + '"><i class="fas fa-user"></i></div><div><div class="user-card-name">' + (u.display_name || u.username) + '</div><div class="user-card-role">' + u.role + ' | @' + u.username + '</div></div></div><div style="display:flex;align-items:center;gap:10px"><span class="user-card-status status-' + u.status + '">' + u.status + '</span><div class="user-card-actions">' + btns + '</div></div></div>';
    }).join('');
  } catch { document.getElementById('usersList').innerHTML = 'خطا در بارگذاری'; }
}

async function changeRole(id) {
  const r = prompt('نقش جدید (owner/admin/moderator/user):');
  if (!r) return;
  try { await api('/api/users/' + id + '/role', { role: r }, 'PUT'); loadUsers(); toast('نقش تغییر کرد', 'success'); } catch { toast('خطا', 'error'); }
}

async function warnUser(id) {
  const reason = prompt('دلیل هشدار:');
  if (!reason) return;
  try {
    const d = await api('/api/users/' + id + '/warn', { reason, severity: 'medium' });
    loadUsers();
    toast('هشدار صادر شد (' + (d.warningCount || 0) + ' هشدار)', 'success');
  } catch { toast('خطا', 'error'); }
}

async function banUser(id) {
  const reason = prompt('دلیل بن:');
  if (!reason) return;
  try { await api('/api/users/' + id + '/ban', { reason }); loadUsers(); toast('کاربر مسدود شد', 'success'); } catch { toast('خطا', 'error'); }
}

async function unbanUser(id) {
  try { await api('/api/users/' + id + '/unban', {}); loadUsers(); toast('بن رفع شد', 'success'); } catch { toast('خطا', 'error'); }
}

async function deleteUser(id) {
  if (!confirm('آیا از حذف این کاربر مطمئن هستید؟')) return;
  try { await api('/api/users/' + id, null, 'DELETE'); loadUsers(); toast('کاربر حذف شد', 'success'); } catch { toast('خطا', 'error'); }
}

// Logs
async function loadLogs() {
  try {
    const d = await apiGet('/api/logs?limit=100');
    const c = document.getElementById('logsList');
    if (!d.logs || !d.logs.length) { c.innerHTML = 'لاگی موجود نیست'; return; }
    c.innerHTML = d.logs.map(l => '<div style="padding:4px 0;border-bottom:1px solid #222"><span style="color:#3498db">' + (l.created_at || '') + '</span> | <span style="color:#FFD700">' + (l.username || 'system') + '</span> | ' + l.action + (l.details ? ' - ' + l.details : '') + '</div>').join('');
  } catch { document.getElementById('logsList').innerHTML = 'خطا'; }
}

// Config
async function loadConfig() {
  try {
    const d = await apiGet('/api/config');
    const c = document.getElementById('configList');
    const keys = { 'server-port': 'پورت', 'max-players': 'حداکثر بازیکن', 'difficulty': 'سختی', 'gamemode': 'حالت بازی', 'pvp': 'PVP', 'view-distance': 'فاصله دید', 'online-mode': 'حالت آنلاین', 'motd': 'پیام سرور' };
    c.innerHTML = Object.entries(d).map(([k, v]) => '<div style="display:flex;justify-content:space-between;padding:10px;background:rgba(0,0,0,0.3);border:1px solid #333;margin-bottom:5px"><span>' + (keys[k] || k) + '</span><span style="color:#ccc">' + v + '</span></div>').join('');
  } catch { document.getElementById('configList').innerHTML = 'خطا'; }
}

// Backups
async function loadBackups() {
  try {
    const d = await apiGet('/api/backups');
    const c = document.getElementById('backupsList');
    if (!d.length) { c.innerHTML = 'بکاپی موجود نیست'; return; }
    c.innerHTML = d.map(b => '<div style="display:flex;justify-content:space-between;padding:12px;background:rgba(0,0,0,0.3);border:1px solid #333;margin-bottom:5px"><span>' + b.name + '</span><span style="color:#ccc">' + new Date(b.created).toLocaleDateString('fa-IR') + '</span></div>').join('');
  } catch { document.getElementById('backupsList').innerHTML = 'خطا'; }
}

async function createBackup() {
  try { await api('/api/server/backup', {}); toast('بکاپ ایجاد شد', 'success'); loadBackups(); } catch { toast('خطا', 'error'); }
}

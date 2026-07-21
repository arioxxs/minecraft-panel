let token = localStorage.getItem('mc_token');
let currentUser = null;
const API = '';

function toast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  setTimeout(() => t.className = 'toast hidden', 3000);
}

function showEl(id, show) {
  document.getElementById(id).classList.toggle('hidden', !show);
}

window.addEventListener('load', () => {
  let p = 0;
  const bar = document.getElementById('loadBar');
  const iv = setInterval(() => {
    p += Math.random() * 35;
    if (p > 100) p = 100;
    bar.style.width = p + '%';
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

function showTab(tab) {
  ['login', 'register'].forEach(t => showEl('tab-' + t, t === tab));
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

async function api(path, body, method) {
  const m = method || (body ? 'POST' : 'GET');
  const opts = { method: m, headers: {} };
  if (body && !(body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
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
    if (d.user) { currentUser = d.user; enterApp(); }
    else showEl('loginScreen', true);
  } catch { showEl('loginScreen', true); }
}

async function doLogin() {
  const u = document.getElementById('loginUser').value;
  const p = document.getElementById('loginPass').value;
  if (!u || !p) return showAuthErr('همه فیلدها رو پر کن');
  try {
    const d = await api('/api/auth/login', { username: u, password: p });
    if (d.error) return showAuthErr(d.error);
    token = d.token; localStorage.setItem('mc_token', token);
    currentUser = d.user; enterApp();
  } catch { showAuthErr('خطا در اتصال'); }
}

async function doRegister() {
  const u = document.getElementById('regUser').value;
  const p = document.getElementById('regPass').value;
  const p2 = document.getElementById('regPass2').value;
  if (!u || !p) return showAuthErr('نام و رمز الزامیه');
  if (p !== p2) return showAuthErr('رمزها مطابقت ندارن');
  if (p.length < 6) return showAuthErr('رمز حداقل 6 کاراکتر');
  try {
    const d = await api('/api/auth/register', { username: u, password: p, display_name: u });
    if (d.error) return showAuthErr(d.error);
    token = d.token; localStorage.setItem('mc_token', token);
    currentUser = d.user; enterApp();
  } catch { showAuthErr('خطا در اتصال'); }
}

function enterApp() {
  showEl('loginScreen', false);
  showEl('mainApp', true);
  document.getElementById('dispName').textContent = currentUser.display_name || currentUser.username;
  document.getElementById('dispRole').textContent = currentUser.role;
  
  const r = currentUser.role;
  const isAdmin = ['owner', 'admin'].includes(r);
  const isMod = ['owner', 'admin', 'moderator'].includes(r);
  
  if (isAdmin) {
    document.getElementById('secUsers').style.display = '';
    document.getElementById('cardUsers').style.display = '';
    loadUsers();
  }
  
  document.querySelectorAll('.control-buttons .mc-btn').forEach(btn => {
    if (!isAdmin) btn.style.display = 'none';
    else btn.style.display = '';
  });
  
  document.querySelectorAll('.quick-commands .mc-btn').forEach(btn => {
    if (!isMod) btn.style.display = 'none';
    else btn.style.display = '';
  });
  
  document.querySelectorAll('.player-actions button').forEach(btn => {
    if (!isMod) btn.style.display = 'none';
    else btn.style.display = '';
  });

  initSocket();
  loadDashboard();
  loadLogs();
}

function doLogout() {
  token = null; currentUser = null;
  localStorage.removeItem('mc_token');
  showEl('mainApp', false);
  showEl('loginScreen', true);
}

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
  document.getElementById('topPlayers').textContent = s.players.length + ' بازیکن';
  document.getElementById('topTps').textContent = 'TPS: ' + (s.tps ? s.tps.toFixed(1) : '--');
  const plHtml = s.players.length
    ? s.players.map(p => '<div class="player-tag" onclick="document.getElementById(\'targetPlayer\').value=\'' + p + '\'">' + p + '</div>').join('')
    : '<span style="color:#666">هیچ بازیکنی آنلاین نیست</span>';
  document.getElementById('onlinePlayers').innerHTML = plHtml;
}

function togglePass(id, btn) {
  const inp = document.getElementById(id);
  const icon = btn.querySelector('i');
  if (inp.type === 'password') { inp.type = 'text'; icon.className = 'fas fa-eye-slash'; }
  else { inp.type = 'password'; icon.className = 'fas fa-eye'; }
}

async function loadDashboard() {
  try { const s = await apiGet('/api/status'); updateStatus(s); } catch {}
}

async function srvAction(action) {
  try {
    const d = await api('/api/server/' + action, {});
    toast(d.success ? 'انجام شد' : (d.error || 'خطا'), d.success ? 'success' : 'error');
    if (d.success) setTimeout(loadDashboard, 3000);
  } catch { toast('خطا', 'error'); }
}

function quickCmd(cmd) {
  api('/api/command', { command: cmd }).then(d => {
    if (d.success) toast('انجام شد: ' + cmd, 'success');
    else toast('خطا: ' + (d.error || 'RCON قطعه'), 'error');
  });
}

function plrCmd(action) {
  const p = document.getElementById('targetPlayer').value;
  if (!p) return toast('نام بازیکن رو وارد کن', 'error');
  const ep = action === 'pardon' ? 'player/pardon' : 'player/' + action;
  api('/api/' + ep, { player: p, reason: 'By admin' }).then(d => {
    toast(d.success ? 'انجام شد' : 'خطا', d.success ? 'success' : 'error');
  });
}

function plrGm(mode) {
  const p = document.getElementById('targetPlayer').value;
  if (!p) return toast('نام بازیکن رو وارد کن', 'error');
  api('/api/player/gamemode', { player: p, mode }).then(d => toast(d.success ? 'انجام شد' : 'خطا', d.success ? 'success' : 'error'));
}

function addConsole(text) {
  const c = document.getElementById('consoleOut');
  c.innerHTML += '<div class="console-line">' + text + '</div>';
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

async function loadUsers() {
  try {
    const [users, stats] = await Promise.all([apiGet('/api/users'), apiGet('/api/users/stats/overview')]);
    document.getElementById('uTotal').textContent = stats.total || 0;
    document.getElementById('uActive').textContent = stats.active || 0;
    document.getElementById('uBanned').textContent = stats.banned || 0;
    const c = document.getElementById('usersList');
    if (!users.length) { c.innerHTML = 'کاربری نیست'; return; }
    const r = currentUser.role;
    const isAdmin = ['owner', 'admin'].includes(r);
    c.innerHTML = users.map(u => {
      let btns = '';
      if (isAdmin && u.status === 'active') btns += '<button onclick="warnUser(\'' + u.id + '\')" class="mc-btn mc-btn-gold" style="width:auto;padding:4px 8px;font-size:12px">⚠</button>';
      if (isAdmin && u.status === 'active') btns += '<button onclick="banUser(\'' + u.id + '\')" class="mc-btn mc-btn-danger" style="width:auto;padding:4px 8px;font-size:12px">🚫</button>';
      if (isAdmin && u.status === 'banned') btns += '<button onclick="unbanUser(\'' + u.id + '\')" class="mc-btn" style="width:auto;padding:4px 8px;font-size:12px">✅</button>';
      if (r === 'owner' && u.role !== 'owner' && u.id !== currentUser.id) btns += '<button onclick="deleteUser(\'' + u.id + '\')" class="mc-btn mc-btn-danger" style="width:auto;padding:4px 8px;font-size:12px">✕</button>';
      return '<div class="user-card"><div class="user-card-left"><div class="user-card-name">' + (u.display_name || u.username) + '</div><div class="user-card-role">' + u.role + ' | @' + u.username + '</div></div><div style="display:flex;align-items:center;gap:10px"><span class="user-card-status status-' + u.status + '">' + u.status + '</span>' + btns + '</div></div>';
    }).join('');
  } catch { document.getElementById('usersList').innerHTML = 'خطا'; }
}

async function warnUser(id) {
  const reason = prompt('دلیل هشدار:');
  if (!reason) return;
  try { await api('/api/users/' + id + '/warn', { reason, severity: 'medium' }); loadUsers(); toast('هشدار صادر شد', 'success'); } catch { toast('خطا', 'error'); }
}
async function banUser(id) {
  const reason = prompt('دلیل بن:');
  if (!reason) return;
  try { await api('/api/users/' + id + '/ban', { reason }); loadUsers(); toast('مسدود شد', 'success'); } catch { toast('خطا', 'error'); }
}
async function unbanUser(id) {
  try { await api('/api/users/' + id + '/unban', {}); loadUsers(); toast('رفع بن شد', 'success'); } catch { toast('خطا', 'error'); }
}
async function deleteUser(id) {
  if (!confirm('حذف کاربر؟')) return;
  try { await api('/api/users/' + id, null, 'DELETE'); loadUsers(); toast('حذف شد', 'success'); } catch { toast('خطا', 'error'); }
}

async function loadLogs() {
  try {
    const d = await apiGet('/api/logs?limit=50');
    const c = document.getElementById('logsList');
    if (!d.logs || !d.logs.length) { c.innerHTML = '<span style="color:#666">لاگی نیست</span>'; return; }
    c.innerHTML = d.logs.map(l => '<div class="console-line"><span style="color:#3498db">' + (l.created_at || '') + '</span> | <span style="color:#FFD700">' + (l.username || 'sys') + '</span> | ' + l.action + (l.details ? ' - ' + l.details : '') + '</div>').join('');
  } catch { document.getElementById('logsList').innerHTML = '<span style="color:#ef4444">خطا</span>'; }
}

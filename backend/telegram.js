const TelegramBot = require('node-telegram-bot-api');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8681026339:AAE6syaKTqfJGe8pN_51ey65YQ-SZZIJ7Fc';
const JWT_SECRET = process.env.JWT_SECRET || 'mc-panel-secret-key';

let bot = null;
let db = null;
let rconSend = null;
let getStatus = null;
let logAct = null;

function initBot(database, executeCommandFn, getStatusFn, logActivityFn) {
  if (!BOT_TOKEN) { console.log('No TELEGRAM_BOT_TOKEN set, bot disabled'); return; }
  db = database;
  rconSend = executeCommandFn;
  getStatus = getStatusFn;
  logAct = logActivityFn;

  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('Telegram bot started');

  const auth = {};
  const sess = {};
  const lastMsg = {};

  function dbGet(sql, p = []) { const s = db.prepare(sql); if (p.length) s.bind(p); let r = null; if (s.step()) r = s.getAsObject(); s.free(); return r; }
  function dbRun(sql, p = []) { db.run(sql, p); }
  function ok(c) { const u = auth[c]; return u && ['owner','admin','moderator'].includes(u.role); }

  function edit(c, txt, markup) {
    const mid = lastMsg[c];
    if (mid) {
      bot.editMessageText(txt, { chat_id: c, message_id: mid, parse_mode: 'HTML', reply_markup: markup }).catch(() => {
        bot.sendMessage(c, txt, { parse_mode: 'HTML', reply_markup: markup }).then(m => { lastMsg[c] = m.message_id; });
      });
    } else {
      bot.sendMessage(c, txt, { parse_mode: 'HTML', reply_markup: markup }).then(m => { lastMsg[c] = m.message_id; });
    }
  }

  function mainMenu(c, txt) {
    const u = auth[c];
    edit(c, txt || `سلام <b>${u.display_name || u.username}</b>!\nنقش: ${u.role}`, {
      inline_keyboard: [
        [{ text: '📊 وضعیت', callback_data: 'm_status' }, { text: '👥 بازیکنان', callback_data: 'm_players' }],
        [{ text: '🎮 کنترل سرور', callback_data: 'm_server' }, { text: '⚡ دستورات سریع', callback_data: 'm_quick' }],
        [{ text: '🛠 مدیریت', callback_data: 'm_admin' }],
        [{ text: '🚪 خروج', callback_data: 'm_logout' }]
      ]
    });
  }

  function guestMenu(c, txt) {
    edit(c, txt || '🎮 <b>MC Panel</b>\n\nبه پنل مدیریت خوش اومدی!', {
      inline_keyboard: [
        [{ text: '🔑 ورود', callback_data: 's_login' }, { text: '📝 ثبت‌نام', callback_data: 's_register' }],
        [{ text: '🔄 بازیابی رمز', callback_data: 's_reset' }]
      ]
    });
  }

  // /start
  bot.onText(/\/start/, (msg) => {
    const c = msg.chat.id;
    if (auth[c]) mainMenu(c);
    else guestMenu(c);
  });

  // === MESSAGE HANDLER ===
  bot.on('message', (msg) => {
    const c = msg.chat.id;
    const s = sess[c];
    if (!s || msg.text?.startsWith('/')) return;
    const t = msg.text;

    if (s.step === 'login_user') {
      s.username = t; s.step = 'login_pass';
      return edit(c, `✅ نام: <code>${t}</code>\n\n📝 <b>مرحله ۲ از ۲</b>\n🔑 رمز عبور:`, { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] });
    }
    if (s.step === 'login_pass') {
      const u = dbGet('SELECT id,username,password,display_name,role,status FROM users WHERE username = ?', [s.username]);
      if (!u) { delete sess[c]; return guestMenu(c, '❌ کاربر یافت نشد!'); }
      if (u.status === 'banned') { delete sess[c]; return guestMenu(c, '❌ مسدود شدی!'); }
      if (!bcrypt.compareSync(t, u.password)) { delete sess[c]; return guestMenu(c, '❌ رمز اشتباه!'); }
      auth[c] = { id: u.id, username: u.username, role: u.role, display_name: u.display_name };
      logAct(u.id, 'login', 'Telegram', 'telegram');
      delete sess[c];
      return mainMenu(c, `✅ ورود موفق!\n\nسلام <b>${u.display_name || u.username}</b>\nنقش: ${u.role}`);
    }

    if (s.step === 'reg_user') {
      if (t.length < 3 || t.length > 20) return edit(c, '❌ ۳ تا ۲۰ کاراکتر\n\n📝 <b>مرحله ۱ از ۳</b>:', { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] });
      if (dbGet('SELECT id FROM users WHERE username = ?', [t])) { delete sess[c]; return guestMenu(c, '❌ تکراری!'); }
      s.username = t; s.step = 'reg_pass';
      return edit(c, `✅ نام: <code>${t}</code>\n\n📝 <b>مرحله ۲ از ۳</b>\n🔑 رمز (حداقل ۶):`, { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] });
    }
    if (s.step === 'reg_pass') {
      if (t.length < 6) return edit(c, '❌ حداقل ۶ کاراکتر\n\n📝 <b>مرحله ۲ از ۳</b>:', { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] });
      s.password = t; s.step = 'reg_confirm';
      return edit(c, `✅ نام: <code>${s.username}</code>\n\n📝 <b>مرحله ۳ از ۳</b>\n🔑 تکرار رمز:`, { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] });
    }
    if (s.step === 'reg_confirm') {
      if (t !== s.password) { delete sess[c]; return edit(c, '❌ مطابقت نداره!', { inline_keyboard: [[{ text: '▶️ شروع', callback_data: 's_register' }]] }); }
      const id = uuidv4();
      dbRun('INSERT INTO users (id,username,password,display_name,role,status) VALUES (?,?,?,?,?,?)', [id, s.username, bcrypt.hashSync(s.password, 10), s.username, 'user', 'active']);
      auth[c] = { id, username: s.username, role: 'user', display_name: s.username };
      logAct(id, 'register', 'Telegram', 'telegram');
      delete sess[c];
      return mainMenu(c, `✅ ثبت‌نام موفق!\n\nنام: <code>${s.username}</code>\nنقش: user`);
    }

    if (s.step === 'reset_user') {
      const u = dbGet('SELECT id FROM users WHERE username = ?', [t]);
      if (!u) return edit(c, '❌ کاربر یافت نشد!', { inline_keyboard: [[{ text: '▶️ دوباره', callback_data: 's_reset' }, { text: '❌ لغو', callback_data: 'step_cancel' }]] });
      s.username = t; s.step = 'reset_pass';
      return edit(c, `✅ نام: <code>${t}</code>\n\n📝 <b>مرحله ۲ از ۳</b>\n🔑 رمز جدید:`, { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] });
    }
    if (s.step === 'reset_pass') {
      if (t.length < 6) return edit(c, '❌ حداقل ۶ کاراکتر\n\n📝 <b>مرحله ۲ از ۳</b>:', { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] });
      s.password = t; s.step = 'reset_confirm';
      return edit(c, `✅ نام: <code>${s.username}</code>\n\n📝 <b>مرحله ۳ از ۳</b>\n🔑 تکرار رمز:`, { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] });
    }
    if (s.step === 'reset_confirm') {
      if (t !== s.password) { delete sess[c]; return edit(c, '❌ مطابقت نداره!', { inline_keyboard: [[{ text: '▶️ دوباره', callback_data: 's_reset' }, { text: '❌ لغو', callback_data: 'step_cancel' }]] }); }
      const u = dbGet('SELECT id FROM users WHERE username = ?', [s.username]);
      dbRun('UPDATE users SET password = ? WHERE id = ?', [bcrypt.hashSync(s.password, 10), u.id]);
      logAct(u.id, 'reset_password', 'Telegram', 'telegram');
      delete sess[c];
      return mainMenu(c, `✅ رمز تغییر کرد!\n\nنام: <code>${s.username}</code>`);
    }

    if (s.step === 'warn_user') { s.target = t; s.step = 'warn_reason'; return edit(c, `⚠️ هشدار به <code>${t}</code>\n\n📝 دلیل:`, { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }); }
    if (s.step === 'warn_reason') { const u = dbGet('SELECT id FROM users WHERE username = ?', [s.target]); if (u) { dbRun('INSERT INTO warnings (id,user_id,warned_by,reason,severity) VALUES (?,?,?,?,?)', [uuidv4(), u.id, auth[c]?.id, t, 'medium']); } delete sess[c]; return mainMenu(c, `⚠️ هشدار به ${s.target} صادر شد.`); }

    if (s.step === 'ban_user') { s.target = t; s.step = 'ban_reason'; return edit(c, `🚫 بن <code>${t}</code>\n\n📝 دلیل:`, { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }); }
    if (s.step === 'ban_reason') {
      dbRun('UPDATE users SET status = ? WHERE username = ?', ['banned', s.target]);
      rconSend(`ban ${s.target} ${t}`).catch(() => {});
      logAct(auth[c]?.id, 'ban_user', `Banned ${s.target}: ${t}`, 'telegram');
      delete sess[c]; return mainMenu(c, `🚫 <code>${s.target}</code> بن شد.\n\nاز پنل و سرور ماینکرفت.`);
    }

    if (s.step === 'unban_user') {
      dbRun('UPDATE users SET status = ? WHERE username = ?', ['active', t]);
      rconSend(`pardon ${t}`).catch(() => {});
      logAct(auth[c]?.id, 'unban_user', `Unbanned ${t}`, 'telegram');
      delete sess[c]; return mainMenu(c, `✅ بن <code>${t}</code> رفع شد.`);
    }
    if (s.step === 'kick_user') {
      rconSend(`kick ${t} Kicked by admin`).then(() => {
        logAct(auth[c]?.id, 'kick_player', `Kicked ${t}`, 'telegram');
        mainMenu(c, `👢 <code>${t}</code> اخراج شد.`);
      }).catch(e => mainMenu(c, '❌ ' + e.message));
      delete sess[c]; return;
    }
    if (s.step === 'op_user') { rconSend(`op ${t}`).then(() => mainMenu(c, `👑 OP → ${t}`)).catch(e => mainMenu(c, '❌ ' + e.message)); delete sess[c]; return; }
    if (s.step === 'deop_user') { rconSend(`deop ${t}`).then(() => mainMenu(c, `🚫 DeOP → ${t}`)).catch(e => mainMenu(c, '❌ ' + e.message)); delete sess[c]; return; }
    if (s.step === 'gm_user') { rconSend(`gamemode ${s.mode} ${t}`).then(() => mainMenu(c, `🎮 ${t} → ${s.mode}`)).catch(e => mainMenu(c, '❌ ' + e.message)); delete sess[c]; return; }
    if (s.step === 'cmd_exec') { rconSend(t).then(r => mainMenu(c, `📤 <code>${(r || 'بدون خروجی').substring(0, 1500)}</code>`)).catch(e => mainMenu(c, '❌ ' + e.message)); delete sess[c]; return; }
  });

  // === CALLBACK HANDLER ===
  bot.on('callback_query', (q) => {
    const c = q.message.chat.id;
    const d = q.data;
    const mid = q.message.message_id;
    bot.answerCallbackQuery(q.id);

    lastMsg[c] = mid;

    if (d === 'step_cancel') { delete sess[c]; return auth[c] ? mainMenu(c) : guestMenu(c); }

    // GUEST
    if (d === 's_login') { sess[c] = { step: 'login_user' }; return edit(c, '📝 <b>مرحله ۱ از ۲</b>\n\nنام کاربری:', { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }); }
    if (d === 's_register') { sess[c] = { step: 'reg_user' }; return edit(c, '📝 <b>مرحله ۱ از ۳</b>\n\nنام کاربری (۳-۲۰):', { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }); }
    if (d === 's_reset') { sess[c] = { step: 'reset_user' }; return edit(c, '🔄 <b>بازیابی رمز</b>\n\n📝 <b>مرحله ۱ از ۳</b>\n\nنام کاربری:', { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }); }

    if (!auth[c]) return guestMenu(c);

    if (d === 'm_logout') { delete auth[c]; return guestMenu(c, '✅ خروج موفق!'); }
    if (d === 'm_back') return mainMenu(c);

    if (d === 'm_help') return edit(c, '<b>راهنما</b>\n\nاز دکمه‌ها استفاده کن!', { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_back' }]] });

    if (d === 'm_status' || d === 'm_status_refresh') {
      const s = getStatus();
      const on = s.online;
      const statusIcon = on ? '🟢' : '🔴';
      const statusText = on ? 'آنلاین' : 'آفلاین';
      const playersText = s.players.length > 0 ? s.players.join('\n') : 'هیچکی';
      const memText = s.memory.used > 0 ? `${s.memory.used}MB / ${s.memory.max}MB` : '--';
      return edit(c, `<b>${statusIcon} وضعیت سرور</b>\n\nوضعیت: ${statusText}\nبازیکنان: ${s.players.length}/20\nTPS: ${s.tps ? s.tps.toFixed(1) : '--'}\nحافظه: ${memText}\nورژن: ${s.version}\n\n<b>بازیکنان آنلاین:</b>\n${playersText}`, {
        inline_keyboard: [
          [{ text: '🔄 تازه‌سازی', callback_data: 'm_status_refresh' }],
          [{ text: '◀️ بازگشت', callback_data: 'm_back' }]
        ]
      });
    }

    if (d === 'm_players') {
      const s = getStatus();
      const list = s.players.length > 0
        ? s.players.map((p, i) => `${i+1}. ${p}`).join('\n')
        : 'هیچ بازیکنی آنلاین نیست.';
      return edit(c, `<b>👥 بازیکنان (${s.players.length}/20)</b>\n\n${list}`, {
        inline_keyboard: [
          [{ text: '🔄 تازه‌سازی', callback_data: 'm_players' }],
          [{ text: '◀️ بازگشت', callback_data: 'm_back' }]
        ]
      });
    }

    // SERVER
    if (d === 'm_server') {
      const s = getStatus();
      const on = s.online;
      return edit(c, `🎮 <b>کنترل سرور</b>\n\n${on ? '🟢 آنلاین' : '🔴 آفلاین'} | بازیکنان: ${s.players.length}`, {
        inline_keyboard: [
          [on ? { text: '⏹ توقف', callback_data: 'srv_stop' } : { text: '▶️ شروع', callback_data: 'srv_start' }],
          [{ text: '🔄 ریستارت', callback_data: 'srv_restart' }, { text: '💾 ذخیره', callback_data: 'srv_save' }],
          [{ text: '◀️ بازگشت', callback_data: 'm_back' }]
        ]
      });
    }

    if (d === 'srv_start') {
      if (!ok(c)) return edit(c, '❌ دسترسی نداری!', { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_server' }]] });
      const fs = require('fs-extra'); const path = require('path'); const DIR = process.env.MC_SERVER_DIR || '/data';
      (async () => {
        try {
          const flag = path.join(DIR, 'STOPPED');
          if (await fs.pathExists(flag)) await fs.remove(flag);
          const { spawn } = require('child_process');
          const files = await fs.readdir(DIR);
          const jar = files.find(f => (f.startsWith('forge-') && f.endsWith('-universal.jar')) || f === 'server.jar');
          const jp = jar ? path.join(DIR, jar) : path.join(DIR, 'server.jar');
          if (!await fs.pathExists(jp)) return edit(c, '❌ فایل سرور نیست!', { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_server' }]] });
          spawn('java', ['-Xms200M', '-Xmx256M', '-jar', jp, '--nogui'], { cwd: DIR, stdio: 'ignore', detached: true }).unref();
          edit(c, '▶️ <b>در حال راه‌اندازی...</b>\n\nمنتظر ۳۰ ثانیه باش.', { inline_keyboard: [[{ text: '📊 وضعیت', callback_data: 'm_status' }, { text: '◀️ بازگشت', callback_data: 'm_server' }]] });
        } catch (e) { edit(c, '❌ ' + e.message, { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_server' }]] }); }
      })();
      return;
    }

    if (d === 'srv_stop') {
      if (!ok(c)) return edit(c, '❌ دسترسی نداری!', { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_server' }]] });
      const fs = require('fs-extra'); const DIR = process.env.MC_SERVER_DIR || '/data';
      (async () => {
        try {
          await fs.writeFile(require('path').join(DIR, 'STOPPED'), 'stopped');
          const s = getStatus();
          if (s.online) await rconSend('stop');
          edit(c, '⏹ <b>سرور خاموش شد.</b>', { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_server' }]] });
        } catch (e) { edit(c, '❌ ' + e.message, { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_server' }]] }); }
      })();
      return;
    }

    if (d === 'srv_restart') {
      if (!ok(c)) return edit(c, '❌ دسترسی نداری!', { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_server' }]] });
      const fs = require('fs-extra'); const DIR = process.env.MC_SERVER_DIR || '/data';
      (async () => {
        try {
          const flag = require('path').join(DIR, 'STOPPED');
          if (await fs.pathExists(flag)) await fs.remove(flag);
          const s = getStatus();
          if (s.online) await rconSend('restart');
          else {
            const { spawn } = require('child_process');
            const files = await fs.readdir(DIR);
            const jar = files.find(f => (f.startsWith('forge-') && f.endsWith('-universal.jar')) || f === 'server.jar');
            const jp = jar ? require('path').join(DIR, jar) : require('path').join(DIR, 'server.jar');
            spawn('java', ['-Xms200M', '-Xmx256M', '-jar', jp, '--nogui'], { cwd: DIR, stdio: 'ignore', detached: true }).unref();
          }
          edit(c, '🔄 <b>ریستارت شد.</b>', { inline_keyboard: [[{ text: '📊 وضعیت', callback_data: 'm_status' }, { text: '◀️ بازگشت', callback_data: 'm_server' }]] });
        } catch (e) { edit(c, '❌ ' + e.message, { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_server' }]] }); }
      })();
      return;
    }

    if (d === 'srv_save') {
      if (!ok(c)) return;
      rconSend('save-all').then(() => edit(c, '💾 <b>ذخیره شد!</b>', { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_server' }]] })).catch(e => edit(c, '❌ ' + e.message, { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_server' }]] }));
      return;
    }

    // QUICK
    if (d === 'm_quick') {
      return edit(c, '⚡ <b>دستورات سریع</b>', {
        inline_keyboard: [
          [{ text: '☀️ روز', callback_data: 'q_day' }, { text: '🌙 شب', callback_data: 'q_night' }],
          [{ text: '🌤 آفتابی', callback_data: 'q_sun' }, { text: '🌧 باران', callback_data: 'q_rain' }],
          [{ text: '😊 آرام', callback_data: 'q_peaceful' }, { text: '💀 سخت', callback_data: 'q_hard' }],
          [{ text: '◀️ بازگشت', callback_data: 'm_back' }]
        ]
      });
    }
    if (d === 'q_day') { if (!ok(c)) return; rconSend('time set day').then(() => edit(c, '☀️ <b>روز شد!</b>', { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_quick' }]] })).catch(e => edit(c, '❌ ' + e.message, { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_quick' }]] })); return; }
    if (d === 'q_night') { if (!ok(c)) return; rconSend('time set night').then(() => edit(c, '🌙 <b>شب شد!</b>', { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_quick' }]] })).catch(e => edit(c, '❌ ' + e.message, { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_quick' }]] })); return; }
    if (d === 'q_sun') { if (!ok(c)) return; rconSend('weather clear').then(() => edit(c, '🌤 <b>آفتابی!</b>', { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_quick' }]] })).catch(e => edit(c, '❌ ' + e.message, { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_quick' }]] })); return; }
    if (d === 'q_rain') { if (!ok(c)) return; rconSend('weather rain').then(() => edit(c, '🌧 <b>باران!</b>', { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_quick' }]] })).catch(e => edit(c, '❌ ' + e.message, { inline_keyboard: [[{ text: '◀ی بازگشت', callback_data: 'm_quick' }]] })); return; }
    if (d === 'q_peaceful') { if (!ok(c)) return; rconSend('difficulty peaceful').then(() => edit(c, '😊 <b>آرام!</b>', { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_quick' }]] })).catch(e => edit(c, '❌ ' + e.message, { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_quick' }]] })); return; }
    if (d === 'q_hard') { if (!ok(c)) return; rconSend('difficulty hard').then(() => edit(c, '💀 <b>سخت!</b>', { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_quick' }]] })).catch(e => edit(c, '❌ ' + e.message, { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_quick' }]] })); return; }

    // ADMIN
    if (d === 'm_admin') {
      if (!ok(c)) return edit(c, '❌ دسترسی نداری!', { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_back' }]] });
      return edit(c, '🛠 <b>مدیریت</b>', {
        inline_keyboard: [
          [{ text: '⚠️ هشدار', callback_data: 'a_warn' }, { text: '🚫 بن', callback_data: 'a_ban' }, { text: '✅ رفع بن', callback_data: 'a_unban' }],
          [{ text: '👢 اخراج', callback_data: 'a_kick' }, { text: '👑 OP', callback_data: 'a_op' }, { text: '🚫 DeOP', callback_data: 'a_deop' }],
          [{ text: '🎮 گیم‌مود', callback_data: 'a_gm' }, { text: '💻 کنسول', callback_data: 'a_cmd' }],
          [{ text: '◀️ بازگشت', callback_data: 'm_back' }]
        ]
      });
    }
    if (d === 'a_warn') { sess[c] = { step: 'warn_user' }; return edit(c, '⚠️ <b>هشدار</b>\n\n📝 نام بازیکن:', { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }); }
    if (d === 'a_ban') { sess[c] = { step: 'ban_user' }; return edit(c, '🚫 <b>بن</b>\n\n📝 نام بازیکن:', { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }); }
    if (d === 'a_unban') { sess[c] = { step: 'unban_user' }; return edit(c, '✅ <b>رفع بن</b>\n\n📝 نام بازیکن:', { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }); }
    if (d === 'a_kick') { sess[c] = { step: 'kick_user' }; return edit(c, '👢 <b>اخراج</b>\n\n📝 نام بازیکن:', { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }); }
    if (d === 'a_op') { sess[c] = { step: 'op_user' }; return edit(c, '👑 <b>OP</b>\n\n📝 نام بازیکن:', { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }); }
    if (d === 'a_deop') { sess[c] = { step: 'deop_user' }; return edit(c, '🚫 <b>DeOP</b>\n\n📝 نام بازیکن:', { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }); }
    if (d === 'a_cmd') { sess[c] = { step: 'cmd_exec' }; return edit(c, '💻 <b>کنسول</b>\n\n📝 دستور:', { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }); }
    if (d === 'a_gm') { return edit(c, '🎮 <b>گیم‌مود</b>', { inline_keyboard: [[{ text: '生存', callback_data: 'gm_survival' }, { text: 'خلاقیت', callback_data: 'gm_creative' }], [{ text: 'ماجراجویی', callback_data: 'gm_adventure' }, { text: 'تماشاگر', callback_data: 'gm_spectator' }], [{ text: '❌ لغو', callback_data: 'step_cancel' }]] }); }
    if (d.startsWith('gm_')) { sess[c] = { step: 'gm_user', mode: d.replace('gm_', '') }; return edit(c, `📝 نام بازیکن (${sess[c].mode}):`, { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }); }
  });
}

module.exports = { initBot };

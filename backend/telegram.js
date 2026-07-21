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

  function dbGet(sql, p = []) { const s = db.prepare(sql); if (p.length) s.bind(p); let r = null; if (s.step()) r = s.getAsObject(); s.free(); return r; }
  function dbRun(sql, p = []) { db.run(sql, p); }
  function ok(c) { const u = auth[c]; return u && ['owner','admin','moderator'].includes(u.role); }

  function mainMenu(c, txt) {
    const u = auth[c];
    if (!u) return;
    bot.sendMessage(c, txt || 'منوی اصلی:', {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📊 وضعیت سرور', callback_data: 'm_status' }, { text: '👥 بازیکنان', callback_data: 'm_players' }],
          [{ text: '🎮 کنترل سرور', callback_data: 'm_server' }, { text: '⚡ دستورات سریع', callback_data: 'm_quick' }],
          [{ text: '🛠 مدیریت', callback_data: 'm_admin' }],
          [{ text: '🚪 خروج', callback_data: 'm_logout' }]
        ]
      }
    });
  }

  function guestMenu(c) {
    bot.sendMessage(c, '🎮 <b>MC Panel</b>\n\nبه پنل مدیریت سرور ماینکرفت خوش اومدی!\n\nبرای شروع وارد شو:', {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔑 ورود', callback_data: 's_login' }, { text: '📝 ثبت‌نام', callback_data: 's_register' }],
          [{ text: '🔄 بازیابی رمز', callback_data: 's_reset' }],
          [{ text: '❓ راهنما', callback_data: 'm_help' }]
        ]
      }
    });
  }

  bot.onText(/\/start/, (msg) => {
    const c = msg.chat.id;
    if (auth[c]) mainMenu(c, `سلام <b>${auth[c].display_name || auth[c].username}</b>!\nنقش: ${auth[c].role}`);
    else guestMenu(c);
  });

  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, `<b>راهنما</b>\n\nاز دکمه‌ها استفاده کن!\n\n/start - منوی اصلی\n/logout - خروج`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_back' }]] }
    });
  });

  // === MESSAGE HANDLER ===
  bot.on('message', (msg) => {
    const c = msg.chat.id;
    const s = sess[c];
    if (!s || msg.text?.startsWith('/')) return;
    const t = msg.text;

    // LOGIN
    if (s.step === 'login_user') {
      s.username = t;
      s.step = 'login_pass';
      return bot.sendMessage(c, `✅ نام: <code>${t}</code>\n\n📝 <b>مرحله ۲ از ۲</b>\n\n🔑 رمز عبور رو بفرست:`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
      });
    }
    if (s.step === 'login_pass') {
      const u = dbGet('SELECT id,username,password,display_name,role,status FROM users WHERE username = ?', [s.username]);
      if (!u) { delete sess[c]; return guestMenu(c); bot.sendMessage(c, '❌ کاربر یافت نشد!'); }
      if (u.status === 'banned') { delete sess[c]; return bot.sendMessage(c, '❌ مسدود شدی!'); }
      if (!bcrypt.compareSync(t, u.password)) { delete sess[c]; return bot.sendMessage(c, '❌ رمز اشتباه!'); }
      auth[c] = { id: u.id, username: u.username, role: u.role, display_name: u.display_name };
      logAct(u.id, 'login', 'Logged in via Telegram', 'telegram');
      delete sess[c];
      return mainMenu(c, `✅ ورود موفق!\n\nسلام <b>${u.display_name || u.username}</b>\nنقش: ${u.role}`);
    }

    // REGISTER
    if (s.step === 'reg_user') {
      if (t.length < 3 || t.length > 20) return bot.sendMessage(c, '❌ ۳ تا ۲۰ کاراکتر\n\n📝 <b>مرحله ۱ از ۳</b>\nدوباره:', { parse_mode: 'HTML' });
      if (dbGet('SELECT id FROM users WHERE username = ?', [t])) { delete sess[c]; return bot.sendMessage(c, '❌ تکراری!'); }
      s.username = t; s.step = 'reg_pass';
      return bot.sendMessage(c, `✅ نام: <code>${t}</code>\n\n📝 <b>مرحله ۲ از ۳</b>\n\n🔑 رمز (حداقل ۶ کاراکتر):`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
      });
    }
    if (s.step === 'reg_pass') {
      if (t.length < 6) return bot.sendMessage(c, '❌ حداقل ۶ کاراکتر\n\n📝 <b>مرحله ۲ از ۳</b>\nدوباره:', { parse_mode: 'HTML' });
      s.password = t; s.step = 'reg_confirm';
      return bot.sendMessage(c, `✅ نام: <code>${s.username}</code>\n\n📝 <b>مرحله ۳ از ۳</b>\n\n🔑 تکرار رمز:`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
      });
    }
    if (s.step === 'reg_confirm') {
      if (t !== s.password) { delete sess[c]; return bot.sendMessage(c, '❌ مطابقت نداره! /start'); }
      const id = uuidv4();
      dbRun('INSERT INTO users (id,username,password,display_name,role,status) VALUES (?,?,?,?,?,?)', [id, s.username, bcrypt.hashSync(s.password, 10), s.username, 'user', 'active']);
      auth[c] = { id, username: s.username, role: 'user', display_name: s.username };
      logAct(id, 'register', 'Registered via Telegram', 'telegram');
      delete sess[c];
      return mainMenu(c, `✅ ثبت‌نام موفق!\n\nنام: <code>${s.username}</code>\nنقش: user`);
    }

    // RESET PASSWORD
    if (s.step === 'reset_user') {
      const u = dbGet('SELECT id FROM users WHERE username = ?', [t]);
      if (!u) { delete sess[c]; return bot.sendMessage(c, '❌ کاربر یافت نشد!'); }
      s.username = t; s.step = 'reset_pass';
      return bot.sendMessage(c, `✅ نام: <code>${t}</code>\n\n📝 <b>مرحله ۲ از ۳</b>\n\n🔑 رمز جدید:`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
      });
    }
    if (s.step === 'reset_pass') {
      if (t.length < 6) return bot.sendMessage(c, '❌ حداقل ۶ کاراکتر\n\n📝 <b>مرحله ۲ از ۳</b>\nدوباره:', { parse_mode: 'HTML' });
      s.password = t; s.step = 'reset_confirm';
      return bot.sendMessage(c, `✅ نام: <code>${s.username}</code>\n\n📝 <b>مرحله ۳ از ۳</b>\n\n🔑 تکرار رمز جدید:`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
      });
    }
    if (s.step === 'reset_confirm') {
      if (t !== s.password) { delete sess[c]; return bot.sendMessage(c, '❌ مطابقت نداره! /start'); }
      const u = dbGet('SELECT id FROM users WHERE username = ?', [s.username]);
      dbRun('UPDATE users SET password = ? WHERE id = ?', [bcrypt.hashSync(s.password, 10), u.id]);
      logAct(u.id, 'reset_password', 'Reset via Telegram', 'telegram');
      delete sess[c];
      return mainMenu(c, `✅ رمز تغییر کرد!\n\nنام: <code>${s.username}</code>\nبا رمز جدید وارد شو.`);
    }

    // ADMIN STEPS
    if (s.step === 'warn_user') { s.target = t; s.step = 'warn_reason'; return bot.sendMessage(c, '📝 دلیل هشدار:', { reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] } }); }
    if (s.step === 'warn_reason') { const u = dbGet('SELECT id FROM users WHERE username = ?', [s.target]); if (u) { dbRun('INSERT INTO warnings (id,user_id,warned_by,reason,severity) VALUES (?,?,?,?,?)', [uuidv4(), u.id, auth[c]?.id, t, 'medium']); logAct(auth[c]?.id, 'warn_user', `Warned ${s.target}`, 'telegram'); } delete sess[c]; return mainMenu(c, `⚠️ هشدار به ${s.target} صادر شد.`); }
    if (s.step === 'ban_user') { s.target = t; s.step = 'ban_reason'; return bot.sendMessage(c, '📝 دلیل بن:', { reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] } }); }
    if (s.step === 'ban_reason') { dbRun('UPDATE users SET status = ? WHERE username = ?', ['banned', s.target]); logAct(auth[c]?.id, 'ban_user', `Banned ${s.target}: ${t}`, 'telegram'); delete sess[c]; return mainMenu(c, `🚫 ${s.target} بن شد.`); }
    if (s.step === 'unban_user') { dbRun('UPDATE users SET status = ? WHERE username = ?', ['active', t]); logAct(auth[c]?.id, 'unban_user', `Unbanned ${t}`, 'telegram'); delete sess[c]; return mainMenu(c, `✅ بن ${t} رفع شد.`); }
    if (s.step === 'kick_user') { rconSend(`kick ${t} Kicked by admin`).then(() => { logAct(auth[c]?.id, 'kick_player', `Kicked ${t}`, 'telegram'); mainMenu(c, `👢 ${t} اخراج شد.`); }).catch(e => mainMenu(c, '❌ ' + e.message)); delete sess[c]; return; }
    if (s.step === 'op_user') { rconSend(`op ${t}`).then(() => { logAct(auth[c]?.id, 'op_player', `Opped ${t}`, 'telegram'); mainMenu(c, `👑 OP به ${t} داده شد.`); }).catch(e => mainMenu(c, '❌ ' + e.message)); delete sess[c]; return; }
    if (s.step === 'deop_user') { rconSend(`deop ${t}`).then(() => { logAct(auth[c]?.id, 'deop_player', `De-opped ${t}`, 'telegram'); mainMenu(c, `🚫 OP ${t} گرفته شد.`); }).catch(e => mainMenu(c, '❌ ' + e.message)); delete sess[c]; return; }
    if (s.step === 'gm_user') { rconSend(`gamemode ${s.mode} ${t}`).then(() => { logAct(auth[c]?.id, 'gamemode', `${t} → ${s.mode}`, 'telegram'); mainMenu(c, `🎮 گیم‌مود ${t} → ${s.mode}`); }).catch(e => mainMenu(c, '❌ ' + e.message)); delete sess[c]; return; }
    if (s.step === 'cmd_exec') { rconSend(t).then(r => mainMenu(c, `📤 خروج:\n<code>${(r || 'بدون خروجی').substring(0, 2000)}</code>`)).catch(e => mainMenu(c, '❌ ' + e.message)); delete sess[c]; return; }
  });

  // === CALLBACK HANDLER ===
  bot.on('callback_query', (q) => {
    const c = q.message.chat.id;
    const d = q.data;
    bot.answerCallbackQuery(q.id);

    if (d === 'step_cancel') { delete sess[c]; return mainMenu(c, '❌ لغو شد.'); }

    // GUEST
    if (d === 's_login') { sess[c] = { step: 'login_user' }; return bot.sendMessage(c, '📝 <b>مرحله ۱ از ۲</b>\n\nنام کاربری:', { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] } }); }
    if (d === 's_register') { sess[c] = { step: 'reg_user' }; return bot.sendMessage(c, '📝 <b>مرحله ۱ از ۳</b>\n\nنام کاربری (۳-۲۰):', { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] } }); }
    if (d === 's_reset') { sess[c] = { step: 'reset_user' }; return bot.sendMessage(c, '🔄 <b>بازیابی رمز</b>\n\n📝 <b>مرحله ۱ از ۳</b>\n\nنام کاربری:', { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] } }); }

    if (!auth[c]) return guestMenu(c);

    // MAIN MENU
    if (d === 'm_back' || d === 'm_logout') {
      if (d === 'm_logout') delete auth[c];
      return d === 'm_logout' ? guestMenu(c) : mainMenu(c);
    }

    if (d === 'm_help') return bot.sendMessage(c, '<b>راهنما</b>\n\nاز دکمه‌ها استفاده کن!\n/start - منوی اصلی', { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_back' }]] } });

    if (d === 'm_status') {
      const s = getStatus();
      const on = s.online ? '🟢 آنلاین' : '🔴 آفلاین';
      return bot.sendMessage(c, `<b>📊 وضعیت سرور</b>\n\n${on}\nبازیکنان: ${s.players.length}/20\nTPS: ${s.tps ? s.tps.toFixed(1) : '--'}\nحافظه: ${s.memory.used || 0}MB\nورژن: ${s.version}\n\nبازیکنان:\n${s.players.length ? s.players.join(', ') : 'هیچکی'}`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔄 تازه‌سازی', callback_data: 'm_status' }, { text: '◀️ بازگشت', callback_data: 'm_back' }]] } });
    }

    if (d === 'm_players') {
      const s = getStatus();
      const txt = s.players.length ? `<b>👥 بازیکنان (${s.players.length}):</b>\n\n${s.players.join('\n')}` : 'هیچ بازیکنی آنلاین نیست.';
      return bot.sendMessage(c, txt, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_back' }]] } });
    }

    // SERVER CONTROL
    if (d === 'm_server') {
      const s = getStatus();
      const on = s.online;
      return bot.sendMessage(c, `🎮 <b>کنترل سرور</b>\n\nوضعیت: ${on ? '🟢 آنلاین' : '🔴 آفلاین'}\nبازیکنان: ${s.players.length}`, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [on ? { text: '⏹ توقف', callback_data: 'srv_stop' } : { text: '▶️ شروع', callback_data: 'srv_start' }],
            [{ text: '🔄 ریستارت', callback_data: 'srv_restart' }, { text: '💾 ذخیره', callback_data: 'srv_save' }],
            [{ text: '◀️ بازگشت', callback_data: 'm_back' }]
          ]
        }
      });
    }

    if (d === 'srv_start') {
      if (!ok(c)) return bot.sendMessage(c, '❌ دسترسی نداری!');
      const fs = require('fs-extra');
      const path = require('path');
      const DIR = process.env.MC_SERVER_DIR || '/data';
      (async () => {
        try {
          const flag = path.join(DIR, 'STOPPED');
          if (await fs.pathExists(flag)) await fs.remove(flag);
          const { spawn } = require('child_process');
          const files = await fs.readdir(DIR);
          const jar = files.find(f => (f.startsWith('forge-') && f.endsWith('-universal.jar')) || f === 'server.jar');
          const jp = jar ? path.join(DIR, jar) : path.join(DIR, 'server.jar');
          if (!await fs.pathExists(jp)) return bot.sendMessage(c, '❌ فایل سرور نیست!');
          const mc = spawn('java', ['-Xms200M', '-Xmx256M', '-jar', jp, '--nogui'], { cwd: DIR, stdio: 'ignore', detached: true });
          mc.unref();
          logAct(auth[c]?.id, 'server_start', 'Started via Telegram', 'telegram');
          bot.sendMessage(c, '▶️ سرور در حال راه‌اندازی...\nمنتظر ۳۰ ثانیه باش.');
        } catch (e) { bot.sendMessage(c, '❌ ' + e.message); }
      })();
      return;
    }

    if (d === 'srv_stop') {
      if (!ok(c)) return bot.sendMessage(c, '❌ دسترسی نداری!');
      const fs = require('fs-extra');
      const DIR = process.env.MC_SERVER_DIR || '/data';
      (async () => {
        try {
          await fs.writeFile(require('path').join(DIR, 'STOPPED'), 'stopped by telegram');
          const s = getStatus();
          if (s.online) await rconSend('stop');
          logAct(auth[c]?.id, 'server_stop', 'Stopped via Telegram', 'telegram');
          bot.sendMessage(c, '⏹ سرور خاموش شد.');
        } catch (e) { bot.sendMessage(c, '❌ ' + e.message); }
      })();
      return;
    }

    if (d === 'srv_restart') {
      if (!ok(c)) return bot.sendMessage(c, '❌ دسترسی نداری!');
      const fs = require('fs-extra');
      const DIR = process.env.MC_SERVER_DIR || '/data';
      (async () => {
        try {
          const flag = require('path').join(DIR, 'STOPPED');
          if (await fs.pathExists(flag)) await fs.remove(flag);
          const s = getStatus();
          if (s.online) { await rconSend('restart'); }
          else {
            const { spawn } = require('child_process');
            const files = await fs.readdir(DIR);
            const jar = files.find(f => (f.startsWith('forge-') && f.endsWith('-universal.jar')) || f === 'server.jar');
            const jp = jar ? require('path').join(DIR, jar) : require('path').join(DIR, 'server.jar');
            if (!await fs.pathExists(jp)) return bot.sendMessage(c, '❌ فایل سرور نیست!');
            const mc = spawn('java', ['-Xms200M', '-Xmx256M', '-jar', jp, '--nogui'], { cwd: DIR, stdio: 'ignore', detached: true });
            mc.unref();
          }
          logAct(auth[c]?.id, 'server_restart', 'Restarted via Telegram', 'telegram');
          bot.sendMessage(c, '🔄 سرور ریستارت شد.');
        } catch (e) { bot.sendMessage(c, '❌ ' + e.message); }
      })();
      return;
    }

    if (d === 'srv_save') {
      if (!ok(c)) return bot.sendMessage(c, '❌ دسترسی نداری!');
      rconSend('save-all').then(() => bot.sendMessage(c, '💾 ذخیره شد!')).catch(e => bot.sendMessage(c, '❌ ' + e.message));
      return;
    }

    // QUICK COMMANDS
    if (d === 'q_day') { if (!ok(c)) return; rconSend('time set day').then(() => bot.sendMessage(c, '☀️ روز شد!')).catch(e => bot.sendMessage(c, '❌ ' + e.message)); return; }
    if (d === 'q_night') { if (!ok(c)) return; rconSend('time set night').then(() => bot.sendMessage(c, '🌙 شب شد!')).catch(e => bot.sendMessage(c, '❌ ' + e.message)); return; }
    if (d === 'q_sun') { if (!ok(c)) return; rconSend('weather clear').then(() => bot.sendMessage(c, '🌤 آفتابی!')).catch(e => bot.sendMessage(c, '❌ ' + e.message)); return; }
    if (d === 'q_rain') { if (!ok(c)) return; rconSend('weather rain').then(() => bot.sendMessage(c, '🌧 باران!')).catch(e => bot.sendMessage(c, '❌ ' + e.message)); return; }
    if (d === 'q_peaceful') { if (!ok(c)) return; rconSend('difficulty peaceful').then(() => bot.sendMessage(c, '😊 آرام!')).catch(e => bot.sendMessage(c, '❌ ' + e.message)); return; }
    if (d === 'q_hard') { if (!ok(c)) return; rconSend('difficulty hard').then(() => bot.sendMessage(c, '💀 سخت!')).catch(e => bot.sendMessage(c, '❌ ' + e.message)); return; }

    if (d === 'm_quick') {
      return bot.sendMessage(c, '⚡ <b>دستورات سریع</b>', {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '☀️ روز', callback_data: 'q_day' }, { text: '🌙 شب', callback_data: 'q_night' }],
            [{ text: '🌤 آفتابی', callback_data: 'q_sun' }, { text: '🌧 باران', callback_data: 'q_rain' }],
            [{ text: '😊 آرام', callback_data: 'q_peaceful' }, { text: '💀 سخت', callback_data: 'q_hard' }],
            [{ text: '◀️ بازگشت', callback_data: 'm_back' }]
          ]
        }
      });
    }

    // ADMIN
    if (d === 'm_admin') {
      if (!ok(c)) return bot.sendMessage(c, '❌ دسترسی نداری!');
      return bot.sendMessage(c, '🛠 <b>مدیریت</b>', {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⚠️ هشدار', callback_data: 'a_warn' }, { text: '🚫 بن', callback_data: 'a_ban' }, { text: '✅ رفع بن', callback_data: 'a_unban' }],
            [{ text: '👢 اخراج', callback_data: 'a_kick' }, { text: '👑 OP', callback_data: 'a_op' }, { text: '🚫 DeOP', callback_data: 'a_deop' }],
            [{ text: '🎮 گیم‌مود', callback_data: 'a_gm' }, { text: '💻 کنسول', callback_data: 'a_cmd' }],
            [{ text: '◀️ بازگشت', callback_data: 'm_back' }]
          ]
        }
      });
    }

    if (d === 'a_warn') { sess[c] = { step: 'warn_user' }; return bot.sendMessage(c, '📝 نام بازیکن:', { reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] } }); }
    if (d === 'a_ban') { sess[c] = { step: 'ban_user' }; return bot.sendMessage(c, '📝 نام بازیکن:', { reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] } }); }
    if (d === 'a_unban') { sess[c] = { step: 'unban_user' }; return bot.sendMessage(c, '📝 نام بازیکن:', { reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] } }); }
    if (d === 'a_kick') { sess[c] = { step: 'kick_user' }; return bot.sendMessage(c, '📝 نام بازیکن:', { reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] } }); }
    if (d === 'a_op') { sess[c] = { step: 'op_user' }; return bot.sendMessage(c, '📝 نام بازیکن:', { reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] } }); }
    if (d === 'a_deop') { sess[c] = { step: 'deop_user' }; return bot.sendMessage(c, '📝 نام بازیکن:', { reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] } }); }
    if (d === 'a_cmd') { sess[c] = { step: 'cmd_exec' }; return bot.sendMessage(c, '💻 دستور رو بفرست:', { reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] } }); }
    if (d === 'a_gm') {
      return bot.sendMessage(c, '🎮 گیم‌مود:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '生存', callback_data: 'gm_survival' }, { text: 'خلاقیت', callback_data: 'gm_creative' }],
            [{ text: 'ماجراجویی', callback_data: 'gm_adventure' }, { text: 'تماشاگر', callback_data: 'gm_spectator' }],
            [{ text: '❌ لغو', callback_data: 'step_cancel' }]
          ]
        }
      });
    }
    if (d.startsWith('gm_')) {
      const mode = d.replace('gm_', '');
      sess[c] = { step: 'gm_user', mode };
      return bot.sendMessage(c, `📝 نام بازیکن (${mode}):`, { reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] } });
    }
  });
}

module.exports = { initBot };

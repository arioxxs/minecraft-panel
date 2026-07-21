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

  const authorizedUsers = {};
  const sessions = {};

  function dbGet(sql, params = []) {
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    let row = null;
    if (stmt.step()) row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  function dbRun(sql, params = []) { db.run(sql, params); }

  function isAdmin(chatId) {
    const u = authorizedUsers[chatId];
    return u && ['owner', 'admin', 'moderator'].includes(u.role);
  }
  function isLoggedIn(chatId) {
    return !!authorizedUsers[chatId];
  }

  function sendWelcome(chatId) {
    const u = authorizedUsers[chatId];
    if (u) {
      bot.sendMessage(chatId, `سلام ${u.display_name || u.username}!\nنقش: ${u.role}`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📊 وضعیت سرور', callback_data: 'm_status' }, { text: '👥 بازیکنان', callback_data: 'm_players' }],
            [{ text: '🎮 کنترل سرور', callback_data: 'm_server' }, { text: '⚡ دستورات سریع', callback_data: 'm_quick' }],
            [{ text: '🛠 مدیریت', callback_data: 'm_admin' }],
            [{ text: '🚪 خروج', callback_data: 'm_logout' }]
          ]
        }
      });
    } else {
      bot.sendMessage(chatId, '🎮 به MC Panel خوش اومدی!\n\nبرای استفاده از پنل وارد شو:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔑 ورود', callback_data: 'step_login' }, { text: '📝 ثبت‌نام', callback_data: 'step_register' }],
            [{ text: '❓ راهنما', callback_data: 'm_help' }]
          ]
        }
      });
    }
  }

  function sendMainMenu(chatId, text) {
    const u = authorizedUsers[chatId];
    if (u) {
      bot.sendMessage(chatId, text || 'منوی اصلی:', {
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
  }

  // /start
  bot.onText(/\/start/, (msg) => sendWelcome(msg.chat.id));

  // reply handler for step-by-step input
  bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const session = sessions[chatId];
    if (!session || msg.text?.startsWith('/')) return;

    const text = msg.text;

    switch (session.step) {
      case 'login_username': {
        session.username = text;
        session.step = 'login_password';
        bot.sendMessage(chatId, '🔑 رمز عبور رو بفرست:', {
          reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
        });
        break;
      }
      case 'login_password': {
        const user = dbGet('SELECT id,username,password,display_name,role,status FROM users WHERE username = ?', [session.username]);
        if (!user) {
          delete sessions[chatId];
          return sendMainMenu(chatId, '❌ کاربر یافت نشد!');
        }
        if (user.status === 'banned') {
          delete sessions[chatId];
          return sendMainMenu(chatId, '❌ اکانت شما مسدود شده!');
        }
        if (!bcrypt.compareSync(text, user.password)) {
          delete sessions[chatId];
          return sendMainMenu(chatId, '❌ رمز اشتباهه!');
        }
        authorizedUsers[chatId] = { id: user.id, username: user.username, role: user.role, display_name: user.display_name };
        logAct(user.id, 'login', 'Logged in via Telegram', 'telegram');
        delete sessions[chatId];
        sendMainMenu(chatId, `✅ ورود موفق!\nسلام ${user.display_name || user.username}\nنقش: ${user.role}`);
        break;
      }
      case 'register_username': {
        if (text.length < 3 || text.length > 20) {
          return bot.sendMessage(chatId, '❌ نام کاربری 3 تا 20 کاراکتر باشه.\nدوباره بفرست:');
        }
        if (dbGet('SELECT id FROM users WHERE username = ?', [text])) {
          delete sessions[chatId];
          return sendMainMenu(chatId, '❌ این نام قبلاً ثبت شده!');
        }
        session.username = text;
        session.step = 'register_password';
        bot.sendMessage(chatId, '🔑 رمز عبور رو بفرست (حداقل 6 کاراکتر):', {
          reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
        });
        break;
      }
      case 'register_password': {
        if (text.length < 6) {
          return bot.sendMessage(chatId, '❌ رمز باید حداقل 6 کاراکتر باشه.\nدوباره بفرست:');
        }
        session.password = text;
        session.step = 'register_confirm';
        bot.sendMessage(chatId, '🔑 رمز رو دوباره بفرست برای تأیید:', {
          reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
        });
        break;
      }
      case 'register_confirm': {
        if (text !== session.password) {
          delete sessions[chatId];
          return sendMainMenu(chatId, '❌ رمزها مطابقت ندارن!');
        }
        const id = uuidv4();
        const hash = bcrypt.hashSync(session.password, 10);
        dbRun('INSERT INTO users (id,username,password,display_name,role,status) VALUES (?,?,?,?,?,?)',
          [id, session.username, hash, session.username, 'user', 'active']);
        const token = jwt.sign({ id, username: session.username, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
        authorizedUsers[chatId] = { id, username: session.username, role: 'user', display_name: session.username };
        logAct(id, 'register', 'Registered via Telegram', 'telegram');
        delete sessions[chatId];
        sendMainMenu(chatId, `✅ ثبت‌نام موفق!\nنام: ${session.username}\nنقش: user`);
        break;
      }
      case 'warn_target': {
        session.target = text;
        session.step = 'warn_reason';
        bot.sendMessage(chatId, '📝 دلیل هشدار رو بفرست:', {
          reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
        });
        break;
      }
      case 'warn_reason': {
        const u = dbGet('SELECT id FROM users WHERE username = ?', [session.target]);
        if (!u) { delete sessions[chatId]; return sendMainMenu(chatId, '❌ کاربر یافت نشد!'); }
        dbRun('INSERT INTO warnings (id,user_id,warned_by,reason,severity) VALUES (?,?,?,?,?)',
          [uuidv4(), u.id, authorizedUsers[chatId]?.id, text, 'medium']);
        logAct(authorizedUsers[chatId]?.id, 'warn_user', `Warned ${session.target}: ${text}`, 'telegram');
        delete sessions[chatId];
        sendMainMenu(chatId, `⚠️ هشدار به ${session.target} صادر شد.`);
        break;
      }
      case 'ban_target': {
        session.target = text;
        session.step = 'ban_reason';
        bot.sendMessage(chatId, '📝 دلیل بن رو بفرست:', {
          reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
        });
        break;
      }
      case 'ban_reason': {
        dbRun('UPDATE users SET status = ? WHERE username = ?', ['banned', session.target]);
        logAct(authorizedUsers[chatId]?.id, 'ban_user', `Banned ${session.target}: ${text}`, 'telegram');
        delete sessions[chatId];
        sendMainMenu(chatId, `🚫 ${session.target} بن شد.`);
        break;
      }
      case 'cmd_input': {
        rconSend(text).then(r => {
          sendMainMenu(chatId, `📤 خروج:\n<code>${(r || 'بدون خروجی').substring(0, 1000)}</code>`);
        }).catch(e => sendMainMenu(chatId, '❌ ' + e.message));
        delete sessions[chatId];
        break;
      }
    }
  });

  // callback_query handler
  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    bot.answerCallbackQuery(query.id);

    // step cancel
    if (data === 'step_cancel') {
      delete sessions[chatId];
      return sendMainMenu(chatId, '❌ لغو شد.');
    }

    // login steps
    if (data === 'step_login') {
      sessions[chatId] = { step: 'login_username' };
      return bot.sendMessage(chatId, '📝 نام کاربری رو بفرست:', {
        reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
      });
    }

    // register steps
    if (data === 'step_register') {
      sessions[chatId] = { step: 'register_username' };
      return bot.sendMessage(chatId, '📝 نام کاربری رو بفرست (3-20 کاراکتر):', {
        reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
      });
    }

    // main menu
    if (data === 'm_status') {
      const s = getStatus();
      const status = s.online ? '🟢 آنلاین' : '🔴 آفلاین';
      return bot.sendMessage(chatId, `<b>وضعیت سرور</b>\n\n${status}\nبازیکنان: ${s.players.length}/20\nTPS: ${s.tps ? s.tps.toFixed(1) : '--'}\nحافظه: ${s.memory.used || 0}MB\nورژن: ${s.version}\n\nبازیکنان:\n${s.players.length ? s.players.join(', ') : 'هیچکی'}`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_back' }]] }
      });
    }

    if (data === 'm_players') {
      const s = getStatus();
      const text = s.players.length
        ? `<b>بازیکنان آنلاین (${s.players.length}):</b>\n\n${s.players.join('\n')}`
        : 'هیچ بازیکنی آنلاین نیست.';
      return bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_back' }]] }
      });
    }

    if (data === 'm_back') return sendMainMenu(chatId);

    if (data === 'm_server') {
      if (!isAdmin(chatId)) return bot.sendMessage(chatId, '❌ دسترسی نداری!');
      return bot.sendMessage(chatId, '🎮 کنترل سرور:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '▶️ شروع', callback_data: 'srv_start' }, { text: '⏹ توقف', callback_data: 'srv_stop' }, { text: '🔄 ریستارت', callback_data: 'srv_restart' }],
            [{ text: '💾 ذخیره همه', callback_data: 'srv_save' }],
            [{ text: '◀️ بازگشت', callback_data: 'm_back' }]
          ]
        }
      });
    }

    if (data === 'm_quick') {
      if (!isAdmin(chatId)) return bot.sendMessage(chatId, '❌ دسترسی نداری!');
      return bot.sendMessage(chatId, '⚡ دستورات سریع:', {
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

    if (data === 'm_admin') {
      if (!isAdmin(chatId)) return bot.sendMessage(chatId, '❌ دسترسی نداری!');
      return bot.sendMessage(chatId, '🛠 مدیریت:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⚠️ هشدار', callback_data: 'adm_warn' }, { text: '🚫 بن', callback_data: 'adm_ban' }, { text: '✅ رفع بن', callback_data: 'adm_unban' }],
            [{ text: '👢 اخراج', callback_data: 'adm_kick' }, { text: '👑 OP', callback_data: 'adm_op' }, { text: '🚫 DeOP', callback_data: 'adm_deop' }],
            [{ text: '🎮 گیم‌مود', callback_data: 'adm_gm' }, { text: '💻 کنسول', callback_data: 'adm_cmd' }],
            [{ text: '◀️ بازگشت', callback_data: 'm_back' }]
          ]
        }
      });
    }

    if (data === 'm_help') {
      return bot.sendMessage(chatId, `<b>راهنما</b>\n\nاز دکمه‌ها استفاده کن!\n\n/start - منوی اصلی\n/logout - خروج`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '◀️ بازگشت', callback_data: 'm_back' }]] }
      });
    }

    if (data === 'm_logout') {
      delete authorizedUsers[chatId];
      return sendWelcome(chatId);
    }

    // server actions
    if (data === 'srv_start') {
      if (!isAdmin(chatId)) return;
      const fs = require('fs-extra');
      const path = require('path');
      const MC_SERVER_DIR = process.env.MC_SERVER_DIR || '/data';
      (async () => {
        try {
          const stoppedFlag = path.join(MC_SERVER_DIR, 'STOPPED');
          if (await fs.pathExists(stoppedFlag)) await fs.remove(stoppedFlag);
          const { spawn } = require('child_process');
          const files = await fs.readdir(MC_SERVER_DIR);
          const jar = files.find(f => f.startsWith('forge-') && f.endsWith('-universal.jar'));
          const jarPath = jar ? path.join(MC_SERVER_DIR, jar) : path.join(MC_SERVER_DIR, 'server.jar');
          if (!await fs.pathExists(jarPath)) return bot.sendMessage(chatId, '❌ فایل سرور نیست!');
          const mc = spawn('java', ['-Xms200M', '-Xmx256M', '-jar', jarPath, '--nogui'], { cwd: MC_SERVER_DIR, stdio: 'ignore', detached: true });
          mc.unref();
          logAct(authorizedUsers[chatId]?.id, 'server_start', 'Started via Telegram', 'telegram');
          sendMainMenu(chatId, '▶️ سرور در حال راه‌اندازی...');
        } catch (err) { sendMainMenu(chatId, '❌ ' + err.message); }
      })();
      return;
    }

    if (data === 'srv_stop') {
      if (!isAdmin(chatId)) return;
      const fs = require('fs-extra');
      const MC_SERVER_DIR = process.env.MC_SERVER_DIR || '/data';
      (async () => {
        try {
          await fs.writeFile(require('path').join(MC_SERVER_DIR, 'STOPPED'), 'stopped by telegram');
          const s = getStatus();
          if (s.online) await rconSend('stop');
          logAct(authorizedUsers[chatId]?.id, 'server_stop', 'Stopped via Telegram', 'telegram');
          sendMainMenu(chatId, '⏹ سرور خاموش شد.');
        } catch (err) { sendMainMenu(chatId, '❌ ' + err.message); }
      })();
      return;
    }

    if (data === 'srv_restart') {
      if (!isAdmin(chatId)) return;
      const fs = require('fs-extra');
      const path = require('path');
      const MC_SERVER_DIR = process.env.MC_SERVER_DIR || '/data';
      (async () => {
        try {
          const stoppedFlag = path.join(MC_SERVER_DIR, 'STOPPED');
          if (await fs.pathExists(stoppedFlag)) await fs.remove(stoppedFlag);
          const s = getStatus();
          if (s.online) {
            await rconSend('restart');
          } else {
            const { spawn } = require('child_process');
            const files = await fs.readdir(MC_SERVER_DIR);
            const jar = files.find(f => f.startsWith('forge-') && f.endsWith('-universal.jar'));
            const jarPath = jar ? path.join(MC_SERVER_DIR, jar) : path.join(MC_SERVER_DIR, 'server.jar');
            if (!await fs.pathExists(jarPath)) return bot.sendMessage(chatId, '❌ فایل سرور نیست!');
            const mc = spawn('java', ['-Xms200M', '-Xmx256M', '-jar', jarPath, '--nogui'], { cwd: MC_SERVER_DIR, stdio: 'ignore', detached: true });
            mc.unref();
          }
          logAct(authorizedUsers[chatId]?.id, 'server_restart', 'Restarted via Telegram', 'telegram');
          sendMainMenu(chatId, '🔄 سرور ریستارت شد.');
        } catch (err) { sendMainMenu(chatId, '❌ ' + err.message); }
      })();
      return;
    }

    if (data === 'srv_save') {
      if (!isAdmin(chatId)) return;
      rconSend('save-all').then(() => sendMainMenu(chatId, '💾 ذخیره شد!')).catch(e => sendMainMenu(chatId, '❌ ' + e.message));
      return;
    }

    // quick commands
    if (data === 'q_day') { if (!isAdmin(chatId)) return; rconSend('time set day').then(() => sendMainMenu(chatId, '☀️ روز شد!')).catch(e => sendMainMenu(chatId, '❌ ' + e.message)); return; }
    if (data === 'q_night') { if (!isAdmin(chatId)) return; rconSend('time set night').then(() => sendMainMenu(chatId, '🌙 شب شد!')).catch(e => sendMainMenu(chatId, '❌ ' + e.message)); return; }
    if (data === 'q_sun') { if (!isAdmin(chatId)) return; rconSend('weather clear').then(() => sendMainMenu(chatId, '🌤 آفتابی!')).catch(e => sendMainMenu(chatId, '❌ ' + e.message)); return; }
    if (data === 'q_rain') { if (!isAdmin(chatId)) return; rconSend('weather rain').then(() => sendMainMenu(chatId, '🌧 باران!')).catch(e => sendMainMenu(chatId, '❌ ' + e.message)); return; }
    if (data === 'q_peaceful') { if (!isAdmin(chatId)) return; rconSend('difficulty peaceful').then(() => sendMainMenu(chatId, '😊 آرام!')).catch(e => sendMainMenu(chatId, '❌ ' + e.message)); return; }
    if (data === 'q_hard') { if (!isAdmin(chatId)) return; rconSend('difficulty hard').then(() => sendMainMenu(chatId, '💀 سخت!')).catch(e => sendMainMenu(chatId, '❌ ' + e.message)); return; }

    // admin actions - step by step
    if (data === 'adm_warn') {
      if (!isAdmin(chatId)) return;
      sessions[chatId] = { step: 'warn_target' };
      return bot.sendMessage(chatId, '📝 نام بازیکن رو بفرست:', {
        reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
      });
    }
    if (data === 'adm_ban') {
      if (!isAdmin(chatId)) return;
      sessions[chatId] = { step: 'ban_target' };
      return bot.sendMessage(chatId, '📝 نام بازیکن رو بفرست:', {
        reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
      });
    }
    if (data === 'adm_unban') {
      if (!isAdmin(chatId)) return;
      sessions[chatId] = { step: 'unban_target' };
      return bot.sendMessage(chatId, '📝 نام بازیکن رو بفرست:', {
        reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
      });
    }
    if (data === 'adm_kick') {
      if (!isAdmin(chatId)) return;
      sessions[chatId] = { step: 'kick_target' };
      return bot.sendMessage(chatId, '📝 نام بازیکن رو بفرست:', {
        reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
      });
    }
    if (data === 'adm_op') {
      if (!isAdmin(chatId)) return;
      sessions[chatId] = { step: 'op_target' };
      return bot.sendMessage(chatId, '📝 نام بازیکن رو بفرست:', {
        reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
      });
    }
    if (data === 'adm_deop') {
      if (!isAdmin(chatId)) return;
      sessions[chatId] = { step: 'deop_target' };
      return bot.sendMessage(chatId, '📝 نام بازیکن رو بفرست:', {
        reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
      });
    }
    if (data === 'adm_gm') {
      if (!isAdmin(chatId)) return;
      return bot.sendMessage(chatId, '🎮 گیم‌مود رو انتخاب کن:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '生存 Survival', callback_data: 'gm_survival' }, { text: 'خلاقیت Creative', callback_data: 'gm_creative' }],
            [{ text: 'ماجراجویی Adventure', callback_data: 'gm_adventure' }, { text: 'تماشاگر Spectator', callback_data: 'gm_spectator' }],
            [{ text: '❌ لغو', callback_data: 'step_cancel' }]
          ]
        }
      });
    }
    if (data === 'adm_cmd') {
      if (!isAdmin(chatId)) return;
      sessions[chatId] = { step: 'cmd_input' };
      return bot.sendMessage(chatId, '💻 دستور رو بفرست:\nمثال: time set day', {
        reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
      });
    }

    // gamemode sub-steps
    if (data.startsWith('gm_')) {
      if (!isAdmin(chatId)) return;
      const mode = data.replace('gm_', '');
      sessions[chatId] = { step: 'gm_target', mode };
      return bot.sendMessage(chatId, `📝 نام بازیکن رو بفرست (حالت: ${mode}):`, {
        reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'step_cancel' }]] }
      });
    }
  });

  // handle remaining step-based inputs (unban, kick, op, deop, gm_target)
  bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const session = sessions[chatId];
    if (!session || msg.text?.startsWith('/')) return;

    const text = msg.text;

    if (session.step === 'unban_target') {
      dbRun('UPDATE users SET status = ? WHERE username = ?', ['active', text]);
      logAct(authorizedUsers[chatId]?.id, 'unban_user', `Unbanned ${text}`, 'telegram');
      delete sessions[chatId];
      return sendMainMenu(chatId, `✅ بن ${text} رفع شد.`);
    }
    if (session.step === 'kick_target') {
      rconSend(`kick ${text} Kicked by admin`).then(() => {
        logAct(authorizedUsers[chatId]?.id, 'kick_player', `Kicked ${text}`, 'telegram');
        sendMainMenu(chatId, `👢 ${text} اخراج شد.`);
      }).catch(e => sendMainMenu(chatId, '❌ ' + e.message));
      delete sessions[chatId];
      return;
    }
    if (session.step === 'op_target') {
      rconSend(`op ${text}`).then(() => {
        logAct(authorizedUsers[chatId]?.id, 'op_player', `Opped ${text}`, 'telegram');
        sendMainMenu(chatId, `👑 OP به ${text} داده شد.`);
      }).catch(e => sendMainMenu(chatId, '❌ ' + e.message));
      delete sessions[chatId];
      return;
    }
    if (session.step === 'deop_target') {
      rconSend(`deop ${text}`).then(() => {
        logAct(authorizedUsers[chatId]?.id, 'deop_player', `De-opped ${text}`, 'telegram');
        sendMainMenu(chatId, `🚫 OP ${text} گرفته شد.`);
      }).catch(e => sendMainMenu(chatId, '❌ ' + e.message));
      delete sessions[chatId];
      return;
    }
    if (session.step === 'gm_target') {
      rconSend(`gamemode ${session.mode} ${text}`).then(() => {
        logAct(authorizedUsers[chatId]?.id, 'gamemode', `Changed ${text} to ${session.mode}`, 'telegram');
        sendMainMenu(chatId, `🎮 گیم‌مود ${text} → ${session.mode}`);
      }).catch(e => sendMainMenu(chatId, '❌ ' + e.message));
      delete sessions[chatId];
      return;
    }
  });
}

module.exports = { initBot };

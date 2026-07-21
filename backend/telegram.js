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
  if (!BOT_TOKEN) {
    console.log('No TELEGRAM_BOT_TOKEN set, bot disabled');
    return;
  }
  db = database;
  rconSend = executeCommandFn;
  getStatus = getStatusFn;
  logAct = logActivityFn;

  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('Telegram bot started');

  const authorizedUsers = {};

  function dbGet(sql, params = []) {
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    let row = null;
    if (stmt.step()) row = stmt.getAsObject();
    stmt.free();
    return row;
  }

  function dbRun(sql, params = []) {
    db.run(sql, params);
  }

  function isAdmin(chatId) {
    const user = authorizedUsers[chatId];
    return user && ['owner', 'admin', 'moderator'].includes(user.role);
  }

  function isOwner(chatId) {
    const user = authorizedUsers[chatId];
    return user && user.role === 'owner';
  }

  function userLabel(chatId) {
    const u = authorizedUsers[chatId];
    return u ? `${u.display_name || u.username} [${u.role}]` : 'Guest';
  }

  const btn = {
    main: {
      inline_keyboard: [
        [{ text: '📊 Status', callback_data: 'status' }, { text: '👥 Players', callback_data: 'players' }],
        [{ text: '🎮 Server', callback_data: 'server_menu' }, { text: '⚡ Quick', callback_data: 'quick_menu' }],
        [{ text: '👤 Account', callback_data: 'account_menu' }, { text: '❓ Help', callback_data: 'help' }]
      ]
    },
    server: {
      inline_keyboard: [
        [{ text: '▶️ Start', callback_data: 'srv_start' }, { text: '⏹ Stop', callback_data: 'srv_stop' }, { text: '🔄 Restart', callback_data: 'srv_restart' }],
        [{ text: '💾 Save All', callback_data: 'srv_save' }],
        [{ text: '◀️ Back', callback_data: 'main_menu' }]
      ]
    },
    quick: {
      inline_keyboard: [
        [{ text: '☀️ Day', callback_data: 'q_day' }, { text: '🌙 Night', callback_data: 'q_night' }],
        [{ text: '🌤 Sun', callback_data: 'q_sun' }, { text: '🌧 Rain', callback_data: 'q_rain' }],
        [{ text: '😊 Peaceful', callback_data: 'q_peaceful' }, { text: '💀 Hard', callback_data: 'q_hard' }],
        [{ text: '◀️ Back', callback_data: 'main_menu' }]
      ]
    },
    account: {
      inline_keyboard: [
        [{ text: '📝 Register', callback_data: 'acc_register' }, { text: '🔑 Login', callback_data: 'acc_login' }],
        [{ text: '🔄 Reset Pass', callback_data: 'acc_reset' }, { text: '🚪 Logout', callback_data: 'acc_logout' }],
        [{ text: '◀️ Back', callback_data: 'main_menu' }]
      ]
    },
    admin: {
      inline_keyboard: [
        [{ text: '🔨 Warn', callback_data: 'adm_warn' }, { text: '🚫 Ban', callback_data: 'adm_ban' }, { text: '✅ Unban', callback_data: 'adm_unban' }],
        [{ text: '👢 Kick', callback_data: 'adm_kick' }, { text: '👑 OP', callback_data: 'adm_op' }, { text: '🚫 DeOP', callback_data: 'adm_deop' }],
        [{ text: '🎮 Gamemode', callback_data: 'adm_gm' }, { text: '💻 Cmd', callback_data: 'adm_cmd' }],
        [{ text: '◀️ Back', callback_data: 'main_menu' }]
      ]
    },
    back_main: {
      inline_keyboard: [[{ text: '◀️ Back', callback_data: 'main_menu' }]]
    }
  };

  function showMenu(chatId, text, menuKey) {
    bot.sendMessage(chatId, text, { reply_markup: btn[menuKey], parse_mode: 'HTML' });
  }

  function askInput(chatId, text, expectKey) {
    bot.sendMessage(chatId, text, { reply_markup: { force_reply: true } });
    bot.once('reply_to_message', (reply) => {
      if (reply.chat.id !== chatId) return;
      const input = reply.text;
      handleInput(chatId, expectKey, input);
    });
  }

  function handleInput(chatId, key, input) {
    const user = authorizedUsers[chatId];
    const uid = user?.id;

    switch (key) {
      case 'register': {
        const parts = input.split(' ');
        if (parts.length < 2) return showMenu(chatId, '❌ ناقصه. فرمت: <code>نام رمز</code>', 'account');
        const [username, password] = parts;
        if (username.length < 3) return showMenu(chatId, '❌ نام 3-20 کاراکتر', 'account');
        if (password.length < 6) return showMenu(chatId, '❌ رمز حداقل 6 کاراکتر', 'account');
        if (dbGet('SELECT id FROM users WHERE username = ?', [username])) return showMenu(chatId, '❌ تکراری!', 'account');
        const id = uuidv4();
        const hash = bcrypt.hashSync(password, 10);
        dbRun('INSERT INTO users (id,username,password,display_name,role,status) VALUES (?,?,?,?,?,?)', [id, username, hash, username, 'user', 'active']);
        const token = jwt.sign({ id, username, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
        authorizedUsers[chatId] = { id, username, role: 'user', display_name: username };
        logAct(id, 'register', 'Registered via Telegram', 'telegram');
        showMenu(chatId, `✅ ثبت‌نام موفق!\nنام: <code>${username}</code>\nنقش: user`, 'main');
        break;
      }
      case 'login': {
        const parts = input.split(' ');
        if (parts.length < 2) return showMenu(chatId, '❌ فرمت: <code>نام رمز</code>', 'account');
        const [username, password] = parts;
        const u = dbGet('SELECT id,username,password,display_name,role,status FROM users WHERE username = ?', [username]);
        if (!u) return showMenu(chatId, '❌ کاربر یافت نشد!', 'account');
        if (u.status === 'banned') return showMenu(chatId, '❌ مسدود شدی!', 'account');
        if (!bcrypt.compareSync(password, u.password)) return showMenu(chatId, '❌ رمز اشتباه!', 'account');
        authorizedUsers[chatId] = { id: u.id, username: u.username, role: u.role, display_name: u.display_name };
        logAct(u.id, 'login', 'Logged in via Telegram', 'telegram');
        showMenu(chatId, `✅ ورود موفق!\nسلام ${u.display_name || u.username}\nنقش: ${u.role}`, 'main');
        break;
      }
      case 'reset': {
        const parts = input.split(' ');
        if (parts.length < 2) return showMenu(chatId, '❌ فرمت: <code>نام رمزجدید</code>', 'account');
        const [username, newPass] = parts;
        if (newPass.length < 6) return showMenu(chatId, '❌ رمز حداقل 6 کاراکتر', 'account');
        const u = dbGet('SELECT id FROM users WHERE username = ?', [username]);
        if (!u) return showMenu(chatId, '❌ کاربر یافت نشد!', 'account');
        dbRun('UPDATE users SET password = ? WHERE id = ?', [bcrypt.hashSync(newPass, 10), u.id]);
        logAct(u.id, 'reset_password', 'Reset via Telegram', 'telegram');
        showMenu(chatId, '✅ رمز تغییر کرد!', 'account');
        break;
      }
      case 'warn': {
        if (!isAdmin(chatId)) return showMenu(chatId, '❌ دسترسی نداری!', 'main');
        const parts = input.split(' ');
        if (parts.length < 2) return showMenu(chatId, '❌ فرمت: <code>نام دلیل</code>', 'admin');
        const [target, ...rp] = parts;
        const reason = rp.join(' ');
        const u = dbGet('SELECT id FROM users WHERE username = ?', [target]);
        if (!u) return showMenu(chatId, '❌ کاربر یافت نشد!', 'admin');
        dbRun('INSERT INTO warnings (id,user_id,warned_by,reason,severity) VALUES (?,?,?,?,?)', [uuidv4(), u.id, uid, reason, 'medium']);
        logAct(uid, 'warn_user', `Warned ${target}`, 'telegram');
        showMenu(chatId, `⚠️ هشدار به <code>${target}</code> صادر شد.`, 'admin');
        break;
      }
      case 'ban': {
        if (!isAdmin(chatId)) return showMenu(chatId, '❌ دسترسی نداری!', 'main');
        const parts = input.split(' ');
        if (parts.length < 2) return showMenu(chatId, '❌ فرمت: <code>نام دلیل</code>', 'admin');
        const [target, ...rp] = parts;
        const reason = rp.join(' ');
        dbRun('UPDATE users SET status = ? WHERE username = ?', ['banned', target]);
        logAct(uid, 'ban_user', `Banned ${target}: ${reason}`, 'telegram');
        showMenu(chatId, `🚫 <code>${target}</code> بن شد.`, 'admin');
        break;
      }
      case 'unban': {
        if (!isAdmin(chatId)) return showMenu(chatId, '❌ دسترسی نداری!', 'main');
        const target = input.trim();
        dbRun('UPDATE users SET status = ? WHERE username = ?', ['active', target]);
        logAct(uid, 'unban_user', `Unbanned ${target}`, 'telegram');
        showMenu(chatId, `✅ بن <code>${target}</code> رفع شد.`, 'admin');
        break;
      }
      case 'kick': {
        if (!isAdmin(chatId)) return showMenu(chatId, '❌ دسترسی نداری!', 'main');
        const target = input.trim();
        rconSend(`kick ${target} Kicked by admin`).then(() => {
          logAct(uid, 'kick_player', `Kicked ${target}`, 'telegram');
          showMenu(chatId, `👢 <code>${target}</code> اخراج شد.`, 'admin');
        }).catch(e => showMenu(chatId, '❌ ' + e.message, 'admin'));
        break;
      }
      case 'op': {
        if (!isAdmin(chatId)) return showMenu(chatId, '❌ دسترسی نداری!', 'main');
        const target = input.trim();
        rconSend(`op ${target}`).then(() => {
          logAct(uid, 'op_player', `Opped ${target}`, 'telegram');
          showMenu(chatId, `👑 OP به <code>${target}</code> داده شد.`, 'admin');
        }).catch(e => showMenu(chatId, '❌ ' + e.message, 'admin'));
        break;
      }
      case 'deop': {
        if (!isAdmin(chatId)) return showMenu(chatId, '❌ دسترسی نداری!', 'main');
        const target = input.trim();
        rconSend(`deop ${target}`).then(() => {
          logAct(uid, 'deop_player', `De-opped ${target}`, 'telegram');
          showMenu(chatId, `🚫 OP <code>${target}</code> گرفته شد.`, 'admin');
        }).catch(e => showMenu(chatId, '❌ ' + e.message, 'admin'));
        break;
      }
      case 'gm': {
        if (!isAdmin(chatId)) return showMenu(chatId, '❌ دسترسی نداری!', 'main');
        const parts = input.split(' ');
        if (parts.length < 2) return showMenu(chatId, '❌ فرمت: <code>نام حالت</code>\nsurvival/creative/adventure/spectator', 'admin');
        const [target, mode] = parts;
        rconSend(`gamemode ${mode} ${target}`).then(() => {
          logAct(uid, 'gamemode', `Changed ${target} to ${mode}`, 'telegram');
          showMenu(chatId, `🎮 گیم‌مود <code>${target}</code> → <code>${mode}</code>`, 'admin');
        }).catch(e => showMenu(chatId, '❌ ' + e.message, 'admin'));
        break;
      }
      case 'cmd': {
        if (!isAdmin(chatId)) return showMenu(chatId, '❌ دسترسی نداری!', 'main');
        rconSend(input).then(r => {
          showMenu(chatId, `📤 خروج:\n<code>${(r || 'بدون خروجی').substring(0, 1000)}</code>`, 'admin');
        }).catch(e => showMenu(chatId, '❌ ' + e.message, 'admin'));
        break;
      }
      default:
        showMenu(chatId, '❓ ناشناخته', 'main');
    }
  }

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const u = authorizedUsers[chatId];
    const label = u ? `${u.display_name || u.username} [${u.role}]` : 'Guest';
    let adminBtns = '';
    if (isAdmin(chatId)) {
      adminBtns = '\n\n<b>ادمین:</b> /admin - پنل مدیریت';
    }
    showMenu(chatId, `🎮 <b>MC Panel</b>\n\nسلام ${label}!${adminBtns}`, 'main');
  });

  bot.onText(/\/admin/, (msg) => {
    const chatId = msg.chat.id;
    if (!isAdmin(chatId)) return showMenu(chatId, '❌ دسترسی نداری!', 'main');
    showMenu(chatId, '🔨 <b>پنل ادمین</b>\nیکی از عملیات رو انتخاب کن:', 'admin');
  });

  bot.onText(/\/help/, (msg) => {
    showMenu(msg.chat.id, `<b>راهنما</b>\n\nاز دکمه‌ها استفاده کن یا دستورات:\n\n/start - منوی اصلی\n/admin - پنل ادمین\n/status - وضعیت سرور\n/logout - خروج`, 'back_main');
  });

  bot.onText(/\/status/, (msg) => {
    const s = getStatus();
    const status = s.online ? '🟢 آنلاین' : '🔴 آفلاین';
    const text = `<b>وضعیت سرور</b>\n\nوضعیت: ${status}\nبازیکنان: ${s.players.length}/20\nTPS: ${s.tps ? s.tps.toFixed(1) : '--'}\nحافظه: ${s.memory.used || 0}MB\nورژن: ${s.version}\n\nبازیکنان:\n${s.players.length ? s.players.join(', ') : 'هیچکی'}`;
    showMenu(msg.chat.id, text, 'back_main');
  });

  bot.onText(/\/logout/, (msg) => {
    const chatId = msg.chat.id;
    if (authorizedUsers[chatId]) {
      delete authorizedUsers[chatId];
    }
    showMenu(chatId, '✅ خروج موفق!', 'main');
  });

  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    bot.answerCallbackQuery(query.id);

    switch (data) {
      case 'main_menu': {
        const u = authorizedUsers[chatId];
        const label = u ? `${u.display_name || u.username} [${u.role}]` : 'Guest';
        showMenu(chatId, `🎮 <b>MC Panel</b>\n\nسلام ${label}!`, 'main');
        break;
      }
      case 'status': {
        const s = getStatus();
        const status = s.online ? '🟢 آنلاین' : '🔴 آفلاین';
        showMenu(chatId, `<b>وضعیت سرور</b>\n\n${status}\nبازیکنان: ${s.players.length}/20\nTPS: ${s.tps ? s.tps.toFixed(1) : '--'}\nحافظه: ${s.memory.used || 0}MB\nورژن: ${s.version}\n\nبازیکنان:\n${s.players.length ? s.players.join(', ') : 'هیچکی'}`, 'back_main');
        break;
      }
      case 'players': {
        const s = getStatus();
        const text = s.players.length
          ? `<b>بازیکنان آنلاین (${s.players.length}):</b>\n\n${s.players.join('\n')}`
          : 'هیچ بازیکنی آنلاین نیست.';
        showMenu(chatId, text, 'back_main');
        break;
      }
      case 'server_menu':
        if (!isAdmin(chatId)) return showMenu(chatId, '❌ دسترسی نداری!', 'main');
        showMenu(chatId, '🎮 <b>کنترل سرور</b>', 'server');
        break;
      case 'quick_menu':
        if (!isAdmin(chatId)) return showMenu(chatId, '❌ دسترسی نداری!', 'main');
        showMenu(chatId, '⚡ <b>دستورات سریع</b>', 'quick');
        break;
      case 'account_menu':
        showMenu(chatId, '👤 <b>حساب کاربری</b>', 'account');
        break;
      case 'help':
        showMenu(chatId, `<b>راهنما</b>\n\nاز دکمه‌ها استفاده کن!\n\n/start - منوی اصلی\n/admin - پنل ادمین\n/status - وضعیت سرور\n/logout - خروج`, 'back_main');
        break;
      case 'srv_start': {
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
            const forgeJar = files.find(f => f.startsWith('forge-') && f.endsWith('-universal.jar'));
            const jarPath = forgeJar ? path.join(MC_SERVER_DIR, forgeJar) : path.join(MC_SERVER_DIR, 'server.jar');
            if (!await fs.pathExists(jarPath)) return showMenu(chatId, '❌ فایل سرور یافت نشد!', 'server');
            const mc = spawn('java', ['-Xms200M', '-Xmx256M', '-jar', jarPath, '--nogui'], { cwd: MC_SERVER_DIR, stdio: 'ignore', detached: true });
            mc.unref();
            logAct(authorizedUsers[chatId]?.id, 'server_start', 'Started via Telegram', 'telegram');
            showMenu(chatId, '▶️ سرور در حال راه‌اندازی...', 'server');
          } catch (err) { showMenu(chatId, '❌ ' + err.message, 'server'); }
        })();
        break;
      }
      case 'srv_stop': {
        if (!isAdmin(chatId)) return;
        const fs = require('fs-extra');
        const path = require('path');
        const MC_SERVER_DIR = process.env.MC_SERVER_DIR || '/data';
        (async () => {
          try {
            await fs.writeFile(path.join(MC_SERVER_DIR, 'STOPPED'), 'stopped by telegram');
            const s = getStatus();
            if (s.online) await rconSend('stop');
            logAct(authorizedUsers[chatId]?.id, 'server_stop', 'Stopped via Telegram', 'telegram');
            showMenu(chatId, '⏹ سرور خاموش شد.', 'server');
          } catch (err) { showMenu(chatId, '❌ ' + err.message, 'server'); }
        })();
        break;
      }
      case 'srv_restart': {
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
              const forgeJar = files.find(f => f.startsWith('forge-') && f.endsWith('-universal.jar'));
              const jarPath = forgeJar ? path.join(MC_SERVER_DIR, forgeJar) : path.join(MC_SERVER_DIR, 'server.jar');
              if (!await fs.pathExists(jarPath)) return showMenu(chatId, '❌ فایل سرور یافت نشد!', 'server');
              const mc = spawn('java', ['-Xms200M', '-Xmx256M', '-jar', jarPath, '--nogui'], { cwd: MC_SERVER_DIR, stdio: 'ignore', detached: true });
              mc.unref();
            }
            logAct(authorizedUsers[chatId]?.id, 'server_restart', 'Restarted via Telegram', 'telegram');
            showMenu(chatId, '🔄 سرور ریستارت شد.', 'server');
          } catch (err) { showMenu(chatId, '❌ ' + err.message, 'server'); }
        })();
        break;
      }
      case 'srv_save': {
        if (!isAdmin(chatId)) return;
        rconSend('save-all').then(() => showMenu(chatId, '💾 ذخیره شد!', 'server')).catch(e => showMenu(chatId, '❌ ' + e.message, 'server'));
        break;
      }
      case 'q_day':
        if (!isAdmin(chatId)) return;
        rconSend('time set day').then(() => showMenu(chatId, '☀️ روز شد!', 'quick')).catch(e => showMenu(chatId, '❌ ' + e.message, 'quick'));
        break;
      case 'q_night':
        if (!isAdmin(chatId)) return;
        rconSend('time set night').then(() => showMenu(chatId, '🌙 شب شد!', 'quick')).catch(e => showMenu(chatId, '❌ ' + e.message, 'quick'));
        break;
      case 'q_sun':
        if (!isAdmin(chatId)) return;
        rconSend('weather clear').then(() => showMenu(chatId, '🌤 آفتابی!', 'quick')).catch(e => showMenu(chatId, '❌ ' + e.message, 'quick'));
        break;
      case 'q_rain':
        if (!isAdmin(chatId)) return;
        rconSend('weather rain').then(() => showMenu(chatId, '🌧 باران!', 'quick')).catch(e => showMenu(chatId, '❌ ' + e.message, 'quick'));
        break;
      case 'q_peaceful':
        if (!isAdmin(chatId)) return;
        rconSend('difficulty peaceful').then(() => showMenu(chatId, '😊 آرام!', 'quick')).catch(e => showMenu(chatId, '❌ ' + e.message, 'quick'));
        break;
      case 'q_hard':
        if (!isAdmin(chatId)) return;
        rconSend('difficulty hard').then(() => showMenu(chatId, '💀 سخت!', 'quick')).catch(e => showMenu(chatId, '❌ ' + e.message, 'quick'));
        break;
      case 'acc_register':
        if (authorizedUsers[chatId]) return showMenu(chatId, '✅ قبلاً وارد شدی!', 'main');
        askInput(chatId, '📝 نام کاربری و رمز رو بفرست:\n\nفرمت: <code>نام رمز</code>', 'register');
        break;
      case 'acc_login':
        if (authorizedUsers[chatId]) return showMenu(chatId, '✅ قبلاً وارد شدی!', 'main');
        askInput(chatId, '🔑 نام و رمز رو بفرست:\n\nفرمت: <code>نام رمز</code>', 'login');
        break;
      case 'acc_reset':
        askInput(chatId, '🔄 نام و رمز جدید رو بفرست:\n\nفرمت: <code>نام رمزجدید</code>', 'reset');
        break;
      case 'acc_logout':
        delete authorizedUsers[chatId];
        showMenu(chatId, '✅ خروج موفق!', 'main');
        break;
      case 'adm_warn':
        if (!isAdmin(chatId)) return;
        askInput(chatId, '⚠️ نام بازیکن و دلیل رو بفرست:\n\nفرمت: <code>نام دلیل</code>', 'warn');
        break;
      case 'adm_ban':
        if (!isAdmin(chatId)) return;
        askInput(chatId, '🚫 نام بازیکن و دلیل:\n\nفرمت: <code>نام دلیل</code>', 'ban');
        break;
      case 'adm_unban':
        if (!isAdmin(chatId)) return;
        askInput(chatId, '✅ نام بازیکن:\n\nفرمت: <code>نام</code>', 'unban');
        break;
      case 'adm_kick':
        if (!isAdmin(chatId)) return;
        askInput(chatId, '👢 نام بازیکن:\n\nفرمت: <code>نام</code>', 'kick');
        break;
      case 'adm_op':
        if (!isAdmin(chatId)) return;
        askInput(chatId, '👑 نام بازیکن:\n\nفرمت: <code>نام</code>', 'op');
        break;
      case 'adm_deop':
        if (!isAdmin(chatId)) return;
        askInput(chatId, '🚫 نام بازیکن:\n\nفرمت: <code>نام</code>', 'deop');
        break;
      case 'adm_gm':
        if (!isAdmin(chatId)) return;
        askInput(chatId, '🎮 نام و حالت:\n\nفرمت: <code>نام survival</code>\nحالت‌ها: survival, creative, adventure, spectator', 'gm');
        break;
      case 'adm_cmd':
        if (!isAdmin(chatId)) return;
        askInput(chatId, '💻 دستور رو بفرست:\n\nمثال: <code>time set day</code>', 'cmd');
        break;
    }
  });
}

module.exports = { initBot };

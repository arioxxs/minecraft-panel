const TelegramBot = require('node-telegram-bot-api');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const JWT_SECRET = process.env.JWT_SECRET || 'mc-panel-secret-key';
const PANEL_URL = process.env.PANEL_URL || '';

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

  function dbAll(sql, params = []) {
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

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
    if (!user) return false;
    return ['owner', 'admin', 'moderator'].includes(user.role);
  }

  function isOwner(chatId) {
    const user = authorizedUsers[chatId];
    return user && user.role === 'owner';
  }

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const user = authorizedUsers[chatId];
    if (user) {
      bot.sendMessage(chatId, `سلام ${user.display_name || user.username}!\nنقش: ${user.role}\n\nدستورات:\n/status - وضعیت سرور\n/server - کنترل سرور\n/cmd - دستورات سریع\n/players - بازیکنان\n/users - مدیریت کاربران\n/register - ثبت‌نام\n/login - ورود\n/reset - بازیابی رمز\n/help - راهنما`, { parse_mode: 'HTML' });
    } else {
      bot.sendMessage(chatId, 'به MC Panel خوش اومدی!\n\nبرای شروع:\n/register - ثبت‌نام\n/login - ورود\n/help - راهنما');
    }
  });

  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `<b>راهنمای ربات تلگرام</b>\n\n<b>احراز هویت:</b>\n/register - ثبت‌نام جدید\n/login - ورود\n/reset - بازیابی رمز\n\n<b>وضعیت:</b>\n/status - وضعیت سرور\n/players - لیست بازیکنان\n\n<b>کنترل سرور (ادمین):</b>\n/start_srv - روشن کردن سرور\n/stop_srv - خاموش کردن سرور\n/restart_srv - ریستارت سرور\n\n<b>دستورات سریع (ادمین):</b>\n/day - روز\n/night - شب\n/sun - آفتابی\n/rain - باران\n/peaceful - آرام\n/hard - سخت\n\n<b>دستور کنسول (ادمین):</b>\n/cmd دستور - اجرای دستور\n\n<b>مدیریت کاربران (ادمین):</b>\n/warn نام دلیل - هشدار\n/ban نام دلیل - بن\n/unban نام - رفع بن\n/kick نام - اخراج\n/op نام - دادن OP\n/deop نام - گرفتن OP\n/gm نام حالت - تغییر گیم‌مود\n\n<b>مدیریت پنل (مالک):</b>\n/createuser نام رمز ایمیل - ساخت کاربر\n/changepass نام رمز - تغییر رمز\n/deluser نام - حذف کاربر`, { parse_mode: 'HTML' });
  });

  bot.onText(/\/register(?:\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    if (authorizedUsers[chatId]) return bot.sendMessage(chatId, 'قبلاً وارد شدی!');

    const args = match[1] ? match[1].split(' ') : [];
    if (args.length < 2) {
      return bot.sendMessage(chatId, 'نحوه: /register نام رمز\n\nمثال: /register MyName pass123');
    }
    const username = args[0];
    const password = args[1];

    if (username.length < 3 || username.length > 20) return bot.sendMessage(chatId, 'نام کاربری باید 3-20 کاراکتر باشد');
    if (password.length < 6) return bot.sendMessage(chatId, 'رمز باید حداقل 6 کاراکتر باشد');

    const existing = dbGet('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) return bot.sendMessage(chatId, 'این نام کاربری قبلاً ثبت شده!');

    const hashedPass = bcrypt.hashSync(password, 10);
    const id = uuidv4();
    dbRun('INSERT INTO users (id, username, password, display_name, role, status) VALUES (?, ?, ?, ?, ?, ?)',
      [id, username, hashedPass, username, 'user', 'active']);

    const token = jwt.sign({ id, username, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
    authorizedUsers[chatId] = { id, username, role: 'user', display_name: username };

    logAct(id, 'register', 'Registered via Telegram', 'telegram');
    bot.sendMessage(chatId, `ثبت‌نام موفق!\nنام کاربری: ${username}\nنقش: user\n\nاکنون /status بزن تا وضعیت سرور رو ببینی.`);
  });

  bot.onText(/\/login(?:\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    if (authorizedUsers[chatId]) return bot.sendMessage(chatId, 'قبلاً وارد شدی!');

    const args = match[1] ? match[1].split(' ') : [];
    if (args.length < 2) {
      return bot.sendMessage(chatId, 'نحوه: /login نام رمز\n\nمثال: /login MyName pass123');
    }
    const username = args[0];
    const password = args[1];

    const user = dbGet('SELECT id, username, password, display_name, role, status FROM users WHERE username = ?', [username]);
    if (!user) return bot.sendMessage(chatId, 'کاربر یافت نشد!');
    if (user.status === 'banned') return bot.sendMessage(chatId, 'اکانت شما مسدود شده!');
    if (user.status === 'suspended') return bot.sendMessage(chatId, 'اکانت شما معلق شده!');

    if (!bcrypt.compareSync(password, user.password)) return bot.sendMessage(chatId, 'رمز اشتباه است!');

    authorizedUsers[chatId] = { id: user.id, username: user.username, role: user.role, display_name: user.display_name };
    logAct(user.id, 'login', 'Logged in via Telegram', 'telegram');
    bot.sendMessage(chatId, `ورود موفق!\nسلام ${user.display_name || user.username}\nنقش: ${user.role}\n\nدستور /help برای راهنما`);
  });

  bot.onText(/\/reset(?:\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const args = match[1] ? match[1].split(' ') : [];
    if (args.length < 2) {
      return bot.sendMessage(chatId, 'نحوه: /reset نام رمزجدید\n\nمثال: /reset MyName newpass123');
    }
    const username = args[0];
    const newPassword = args[1];

    if (newPassword.length < 6) return bot.sendMessage(chatId, 'رمز باید حداقل 6 کاراکتر باشد');

    const user = dbGet('SELECT id FROM users WHERE username = ?', [username]);
    if (!user) return bot.sendMessage(chatId, 'کاربر یافت نشد!');

    const hashedPass = bcrypt.hashSync(newPassword, 10);
    dbRun('UPDATE users SET password = ? WHERE id = ?', [hashedPass, user.id]);
    logAct(user.id, 'reset_password', 'Password reset via Telegram', 'telegram');
    bot.sendMessage(chatId, 'رمز با موفقیت تغییر کرد!');
  });

  bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const s = getStatus();
    const status = s.online ? 'آنلاین' : 'آفلاین';
    bot.sendMessage(chatId, `<b>وضعیت سرور</b>\n\nوضعیت: ${status}\nبازیکنان: ${s.players.length}/20\nTPS: ${s.tps ? s.tps.toFixed(1) : '--'}\nحافظه: ${s.memory.used || 0}MB\nورژن: ${s.version}\n\nبازیکنان آنلاین:\n${s.players.length ? s.players.join(', ') : 'هیچکی'}`, { parse_mode: 'HTML' });
  });

  bot.onText(/\/players/, (msg) => {
    const chatId = msg.chat.id;
    const s = getStatus();
    if (!s.players.length) return bot.sendMessage(chatId, 'هیچ بازیکنی آنلاین نیست.');
    bot.sendMessage(chatId, `<b>بازیکنان آنلاین (${s.players.length}):</b>\n\n${s.players.join('\n')}`, { parse_mode: 'HTML' });
  });

  bot.onText(/\/start_srv/, (msg) => {
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, 'دسترسی نداری!');
    const { spawn } = require('child_process');
    const fs = require('fs-extra');
    const MC_SERVER_DIR = process.env.MC_SERVER_DIR || '/data';
    (async () => {
      try {
        const stoppedFlag = require('path').join(MC_SERVER_DIR, 'STOPPED');
        if (await fs.pathExists(stoppedFlag)) await fs.remove(stoppedFlag);
        const files = await fs.readdir(MC_SERVER_DIR);
        const forgeJar = files.find(f => f.startsWith('forge-') && f.endsWith('-universal.jar'));
        const jarPath = forgeJar ? require('path').join(MC_SERVER_DIR, forgeJar) : require('path').join(MC_SERVER_DIR, 'server.jar');
        if (!await fs.pathExists(jarPath)) return bot.sendMessage(chatId, 'فایل سرور یافت نشد!');
        const mcProcess = spawn('java', ['-Xms256M', '-Xmx512M', '-jar', jarPath, '--nogui'], {
          cwd: MC_SERVER_DIR, stdio: 'ignore', detached: true
        });
        mcProcess.unref();
        logAct(authorizedUsers[chatId]?.id, 'server_start', 'Started via Telegram', 'telegram');
        bot.sendMessage(chatId, 'سرور در حال راه‌اندازی...');
      } catch (err) {
        bot.sendMessage(chatId, 'خطا: ' + err.message);
      }
    })();
  });

  bot.onText(/\/stop_srv/, (msg) => {
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, 'دسترسی نداری!');
    (async () => {
      try {
        const fs = require('fs-extra');
        const path = require('path');
        const MC_SERVER_DIR = process.env.MC_SERVER_DIR || '/data';
        const stoppedFlag = path.join(MC_SERVER_DIR, 'STOPPED');
        await fs.writeFile(stoppedFlag, 'stopped by telegram');
        const s = getStatus();
        if (s.online) await rconSend('stop');
        logAct(authorizedUsers[chatId]?.id, 'server_stop', 'Stopped via Telegram', 'telegram');
        bot.sendMessage(chatId, 'سرور خاموش شد.');
      } catch (err) {
        bot.sendMessage(chatId, 'خطا: ' + err.message);
      }
    })();
  });

  bot.onText(/\/restart_srv/, (msg) => {
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, 'دسترسی نداری!');
    (async () => {
      try {
        const fs = require('fs-extra');
        const path = require('path');
        const MC_SERVER_DIR = process.env.MC_SERVER_DIR || '/data';
        const stoppedFlag = path.join(MC_SERVER_DIR, 'STOPPED');
        if (await fs.pathExists(stoppedFlag)) await fs.remove(stoppedFlag);
        const s = getStatus();
        if (s.online) {
          await rconSend('restart');
        } else {
          const files = await fs.readdir(MC_SERVER_DIR);
          const forgeJar = files.find(f => f.startsWith('forge-') && f.endsWith('-universal.jar'));
          const jarPath = forgeJar ? path.join(MC_SERVER_DIR, forgeJar) : path.join(MC_SERVER_DIR, 'server.jar');
          if (!await fs.pathExists(jarPath)) return bot.sendMessage(chatId, 'فایل سرور یافت نشد!');
          const { spawn } = require('child_process');
          const mcProcess = spawn('java', ['-Xms256M', '-Xmx512M', '-jar', jarPath, '--nogui'], {
            cwd: MC_SERVER_DIR, stdio: 'ignore', detached: true
          });
          mcProcess.unref();
        }
        logAct(authorizedUsers[chatId]?.id, 'server_restart', 'Restarted via Telegram', 'telegram');
        bot.sendMessage(chatId, 'سرور ریستارت شد.');
      } catch (err) {
        bot.sendMessage(chatId, 'خطا: ' + err.message);
      }
    })();
  });

  bot.onText(/\/day/, (msg) => {
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, 'دسترسی نداری!');
    rconSend('time set day').then(() => bot.sendMessage(msg.chat.id, 'روز شد!')).catch(e => bot.sendMessage(msg.chat.id, 'خطا: ' + e.message));
  });

  bot.onText(/\/night/, (msg) => {
    if (!isAdmin(chatId)) return bot.sendMessage(msg.chat.id, 'دسترسی نداری!');
    rconSend('time set night').then(() => bot.sendMessage(msg.chat.id, 'شب شد!')).catch(e => bot.sendMessage(msg.chat.id, 'خطا: ' + e.message));
  });

  bot.onText(/\/sun/, (msg) => {
    if (!isAdmin(chatId)) return bot.sendMessage(msg.chat.id, 'دسترسی نداری!');
    rconSend('weather clear').then(() => bot.sendMessage(msg.chat.id, 'آفتابی شد!')).catch(e => bot.sendMessage(msg.chat.id, 'خطا: ' + e.message));
  });

  bot.onText(/\/rain/, (msg) => {
    if (!isAdmin(chatId)) return bot.sendMessage(msg.chat.id, 'دسترسی نداری!');
    rconSend('weather rain').then(() => bot.sendMessage(msg.chat.id, 'باران شروع شد!')).catch(e => bot.sendMessage(msg.chat.id, 'خطا: ' + e.message));
  });

  bot.onText(/\/peaceful/, (msg) => {
    if (!isAdmin(chatId)) return bot.sendMessage(msg.chat.id, 'دسترسی نداری!');
    rconSend('difficulty peaceful').then(() => bot.sendMessage(msg.chat.id, 'حالت آرام شد!')).catch(e => bot.sendMessage(msg.chat.id, 'خطا: ' + e.message));
  });

  bot.onText(/\/hard/, (msg) => {
    if (!isAdmin(chatId)) return bot.sendMessage(msg.chat.id, 'دسترسی نداری!');
    rconSend('difficulty hard').then(() => bot.sendMessage(msg.chat.id, 'حالت سخت شد!')).catch(e => bot.sendMessage(msg.chat.id, 'خطا: ' + e.message));
  });

  bot.onText(/\/cmd(?:\s+(.+))?/, (msg, match) => {
    if (!isAdmin(chatId)) return bot.sendMessage(msg.chat.id, 'دسترسی نداری!');
    const cmd = match[1];
    if (!cmd) return bot.sendMessage(msg.chat.id, 'نحوه: /cmd دستور\nمثال: /cmd time set day');
    rconSend(cmd).then(r => bot.sendMessage(msg.chat.id, 'نتیجه:\n' + (r || 'بدون خروجی'))).catch(e => bot.sendMessage(msg.chat.id, 'خطا: ' + e.message));
  });

  bot.onText(/\/warn(?:\s+(.+))?/, (msg, match) => {
    if (!isAdmin(chatId)) return bot.sendMessage(msg.chat.id, 'دسترسی نداری!');
    const args = match[1] ? match[1].split(' ') : [];
    if (args.length < 2) return bot.sendMessage(msg.chat.id, 'نحوه: /warn نام دلیل');
    const [target, ...reasonParts] = args;
    const reason = reasonParts.join(' ');
    const warned = dbGet('SELECT id FROM users WHERE username = ?', [target]);
    if (!warned) return bot.sendMessage(msg.chat.id, 'کاربر یافت نشد!');
    dbRun('INSERT INTO warnings (id, user_id, warned_by, reason, severity) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), warned.id, authorizedUsers[chatId]?.id, reason, 'medium']);
    logAct(authorizedUsers[chatId]?.id, 'warn_user', `Warned ${target}: ${reason}`, 'telegram');
    bot.sendMessage(msg.chat.id, `هشدار به ${target} صادر شد.`);
  });

  bot.onText(/\/ban(?:\s+(.+))?/, (msg, match) => {
    if (!isAdmin(chatId)) return bot.sendMessage(msg.chat.id, 'دسترسی نداری!');
    const args = match[1] ? match[1].split(' ') : [];
    if (args.length < 2) return bot.sendMessage(msg.chat.id, 'نحوه: /ban نام دلیل');
    const [target, ...reasonParts] = args;
    const reason = reasonParts.join(' ');
    dbRun('UPDATE users SET status = ? WHERE username = ?', ['banned', target]);
    logAct(authorizedUsers[chatId]?.id, 'ban_user', `Banned ${target}: ${reason}`, 'telegram');
    bot.sendMessage(msg.chat.id, `${target} بن شد.`);
  });

  bot.onText(/\/unban(?:\s+(.+))?/, (msg, match) => {
    if (!isAdmin(chatId)) return bot.sendMessage(msg.chat.id, 'دسترسی نداری!');
    const target = match[1];
    if (!target) return bot.sendMessage(msg.chat.id, 'نحوه: /unban نام');
    dbRun('UPDATE users SET status = ? WHERE username = ?', ['active', target]);
    logAct(authorizedUsers[chatId]?.id, 'unban_user', `Unbanned ${target}`, 'telegram');
    bot.sendMessage(msg.chat.id, `بن ${target} رفع شد.`);
  });

  bot.onText(/\/kick(?:\s+(.+))?/, (msg, match) => {
    if (!isAdmin(chatId)) return bot.sendMessage(msg.chat.id, 'دسترسی نداری!');
    const target = match[1];
    if (!target) return bot.sendMessage(msg.chat.id, 'نحوه: /kick نام');
    rconSend(`kick ${target} Kicked by admin`).then(() => {
      logAct(authorizedUsers[chatId]?.id, 'kick_player', `Kicked ${target}`, 'telegram');
      bot.sendMessage(msg.chat.id, `${target} اخراج شد.`);
    }).catch(e => bot.sendMessage(msg.chat.id, 'خطا: ' + e.message));
  });

  bot.onText(/\/op(?:\s+(.+))?/, (msg, match) => {
    if (!isAdmin(chatId)) return bot.sendMessage(msg.chat.id, 'دسترسی نداری!');
    const target = match[1];
    if (!target) return bot.sendMessage(msg.chat.id, 'نحوه: /op نام');
    rconSend(`op ${target}`).then(() => {
      logAct(authorizedUsers[chatId]?.id, 'op_player', `Opped ${target}`, 'telegram');
      bot.sendMessage(msg.chat.id, `OP به ${target} داده شد.`);
    }).catch(e => bot.sendMessage(msg.chat.id, 'خطا: ' + e.message));
  });

  bot.onText(/\/deop(?:\s+(.+))?/, (msg, match) => {
    if (!isAdmin(chatId)) return bot.sendMessage(msg.chat.id, 'دسترسی نداری!');
    const target = match[1];
    if (!target) return bot.sendMessage(msg.chat.id, 'نحوه: /deop نام');
    rconSend(`deop ${target}`).then(() => {
      logAct(authorizedUsers[chatId]?.id, 'deop_player', `De-opped ${target}`, 'telegram');
      bot.sendMessage(msg.chat.id, `OP ${target} گرفته شد.`);
    }).catch(e => bot.sendMessage(msg.chat.id, 'خطا: ' + e.message));
  });

  bot.onText(/\/gm(?:\s+(.+))?/, (msg, match) => {
    if (!isAdmin(chatId)) return bot.sendMessage(msg.chat.id, 'دسترسی نداری!');
    const args = match[1] ? match[1].split(' ') : [];
    if (args.length < 2) return bot.sendMessage(msg.chat.id, 'نحوه: /gm نام حالت\nحالت‌ها: survival, creative, adventure, spectator');
    const [target, mode] = args;
    rconSend(`gamemode ${mode} ${target}`).then(() => {
      logAct(authorizedUsers[chatId]?.id, 'gamemode', `Changed ${target} to ${mode}`, 'telegram');
      bot.sendMessage(msg.chat.id, `گیم‌مود ${target} به ${mode} تغییر کرد.`);
    }).catch(e => bot.sendMessage(msg.chat.id, 'خطا: ' + e.message));
  });

  bot.onText(/\/createuser(?:\s+(.+))?/, (msg, match) => {
    if (!isOwner(chatId)) return bot.sendMessage(msg.chat.id, 'فقط مالک میتواند کاربر بسازد!');
    const args = match[1] ? match[1].split(' ') : [];
    if (args.length < 3) return bot.sendMessage(msg.chat.id, 'نحوه: /createuser نام رمز ایمیل');
    const [username, password, email] = args;
    const existing = dbGet('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) return bot.sendMessage(msg.chat.id, 'نام تکراری!');
    const hashedPass = bcrypt.hashSync(password, 10);
    const id = uuidv4();
    dbRun('INSERT INTO users (id, username, password, email, display_name, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, username, hashedPass, email, username, 'user', 'active']);
    logAct(authorizedUsers[chatId]?.id, 'create_user', `Created user ${username}`, 'telegram');
    bot.sendMessage(msg.chat.id, `کاربر ${username} ساخته شد.`);
  });

  bot.onText(/\/changepass(?:\s+(.+))?/, (msg, match) => {
    if (!isOwner(chatId)) return bot.sendMessage(msg.chat.id, 'فقط مالک!');
    const args = match[1] ? match[1].split(' ') : [];
    if (args.length < 2) return bot.sendMessage(msg.chat.id, 'نحوه: /changepass نام رمزجدید');
    const [username, newPassword] = args;
    const user = dbGet('SELECT id FROM users WHERE username = ?', [username]);
    if (!user) return bot.sendMessage(msg.chat.id, 'کاربر یافت نشد!');
    const hashedPass = bcrypt.hashSync(newPassword, 10);
    dbRun('UPDATE users SET password = ? WHERE id = ?', [hashedPass, user.id]);
    logAct(authorizedUsers[chatId]?.id, 'change_password', `Changed password for ${username}`, 'telegram');
    bot.sendMessage(msg.chat.id, `رمز ${username} تغییر کرد.`);
  });

  bot.onText(/\/deluser(?:\s+(.+))?/, (msg, match) => {
    if (!isOwner(chatId)) return bot.sendMessage(msg.chat.id, 'فقط مالک!');
    const target = match[1];
    if (!target) return bot.sendMessage(msg.chat.id, 'نحوه: /deluser نام');
    const user = dbGet('SELECT id, role FROM users WHERE username = ?', [target]);
    if (!user) return bot.sendMessage(msg.chat.id, 'کاربر یافت نشد!');
    if (user.role === 'owner') return bot.sendMessage(msg.chat.id, 'نمیتوان مالک را حذف کرد!');
    dbRun('DELETE FROM users WHERE id = ?', [user.id]);
    logAct(authorizedUsers[chatId]?.id, 'delete_user', `Deleted user ${target}`, 'telegram');
    bot.sendMessage(msg.chat.id, `کاربر ${target} حذف شد.`);
  });

  bot.onText(/\/logout/, (msg) => {
    const chatId = msg.chat.id;
    if (authorizedUsers[chatId]) {
      delete authorizedUsers[chatId];
      bot.sendMessage(chatId, 'خروج موفق!');
    } else {
      bot.sendMessage(chatId, 'قبلاً خارج شدی!');
    }
  });
}

module.exports = { initBot };

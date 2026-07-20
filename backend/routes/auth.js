const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { generateToken, authenticate, logActivity } = require('../auth');
const { dbGet, dbRun, dbAll } = require('../dbHelper');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { username, email, password, display_name } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 characters' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const db = getDb();
    const existing = dbGet(db, 'SELECT id FROM users WHERE username = ?', [username]);
    if (existing) return res.status(400).json({ error: 'Username already taken' });

    if (email) {
      const existingEmail = dbGet(db, 'SELECT id FROM users WHERE email = ?', [email]);
      if (existingEmail) return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const userId = uuidv4();

    dbRun(db, 'INSERT INTO users (id, username, email, password, display_name, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, username, email || null, hashedPassword, display_name || username, 'user', 'active']);

    const user = dbGet(db, 'SELECT id, username, email, display_name, role, status FROM users WHERE id = ?', [userId]);
    const token = generateToken(user);

    logActivity(userId, 'register', `User ${username} registered`, req.ip);
    res.json({ success: true, token, user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const db = getDb();
    const user = dbGet(db, 'SELECT * FROM users WHERE username = ? OR email = ?', [username, username]);

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.status === 'banned') return res.status(403).json({ error: 'Account is banned' });
    if (user.status === 'suspended') return res.status(403).json({ error: 'Account is suspended' });
    if (!user.password) return res.status(400).json({ error: 'This account uses Google login' });

    const validPassword = bcrypt.compareSync(password, user.password);
    if (!validPassword) {
      logActivity(user.id, 'login_failed', 'Failed login attempt', req.ip);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    dbRun(db, 'UPDATE users SET last_login = datetime("now") WHERE id = ?', [user.id]);
    const token = generateToken(user);
    const { password: _, ...userWithoutPassword } = user;

    logActivity(user.id, 'login', 'Successful login', req.ip);
    res.json({ success: true, token, user: userWithoutPassword });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Google credential required' });

    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    const db = getDb();
    let user = dbGet(db, 'SELECT * FROM users WHERE google_id = ?', [googleId]);

    if (!user) {
      user = dbGet(db, 'SELECT * FROM users WHERE email = ?', [email]);
      if (user) {
        dbRun(db, 'UPDATE users SET google_id = ?, avatar = ? WHERE id = ?', [googleId, picture, user.id]);
      } else {
        const username = email.split('@')[0] + '_' + Math.random().toString(36).substr(2, 4);
        const userId = uuidv4();
        dbRun(db, 'INSERT INTO users (id, username, email, google_id, display_name, avatar, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [userId, username, email, googleId, name, picture, 'user', 'active']);
        user = dbGet(db, 'SELECT * FROM users WHERE id = ?', [userId]);
      }
    }

    if (user.status === 'banned') return res.status(403).json({ error: 'Account is banned' });

    dbRun(db, 'UPDATE users SET last_login = datetime("now") WHERE id = ?', [user.id]);
    const token = generateToken(user);
    const { password: _, ...userWithoutPassword } = user;

    logActivity(user.id, 'login_google', 'Google login', req.ip);
    res.json({ success: true, token, user: userWithoutPassword });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(500).json({ error: 'Google authentication failed' });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const db = getDb();
    const user = dbGet(db, 'SELECT id FROM users WHERE email = ?', [email]);
    if (!user) return res.json({ success: true, message: 'If email exists, reset link has been sent' });

    const resetToken = uuidv4();
    const expiry = Date.now() + 3600000;
    dbRun(db, 'UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?', [resetToken, expiry, user.id]);

    logActivity(user.id, 'password_reset_request', 'Password reset requested', req.ip);
    res.json({ success: true, message: 'Reset link sent to email', resetToken });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process request' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const db = getDb();
    const user = dbGet(db, 'SELECT id FROM users WHERE reset_token = ? AND reset_token_expiry > ?', [token, Date.now()]);
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    dbRun(db, 'UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?', [hashedPassword, user.id]);

    logActivity(user.id, 'password_reset', 'Password reset completed', req.ip);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

router.post('/logout', authenticate, (req, res) => {
  logActivity(req.user.id, 'logout', 'User logged out', req.ip);
  res.json({ success: true });
});

module.exports = router;

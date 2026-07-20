const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authenticate, requireRole, logActivity } = require('../auth');

const router = express.Router();

router.get('/', authenticate, requireRole('owner', 'admin'), (req, res) => {
  try {
    const db = getDb();
    const users = db.prepare(`
      SELECT id, username, email, display_name, role, status, warnings, last_login, created_at, avatar
      FROM users ORDER BY created_at DESC
    `).all();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticate, requireRole('owner', 'admin'), (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare(`
      SELECT id, username, email, display_name, role, status, warnings, last_login, created_at, avatar
      FROM users WHERE id = ?
    `).get(req.params.id);
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const warnings = db.prepare(`
      SELECT w.*, u.username as issued_by_name 
      FROM warnings w 
      LEFT JOIN users u ON w.issued_by = u.id 
      WHERE w.user_id = ? AND w.active = 1
      ORDER BY w.created_at DESC
    `).all(req.params.id);
    
    const bans = db.prepare(`
      SELECT b.*, u.username as banned_by_name 
      FROM ban_list b 
      LEFT JOIN users u ON b.banned_by = u.id 
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
    `).all(req.params.id);
    
    const loginHistory = db.prepare(`
      SELECT * FROM login_history WHERE user_id = ? 
      ORDER BY created_at DESC LIMIT 10
    `).all(req.params.id);
    
    res.json({ ...user, warnings, bans, loginHistory });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/role', authenticate, requireRole('owner'), (req, res) => {
  try {
    const { role } = req.body;
    if (!['owner', 'admin', 'moderator', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    
    const db = getDb();
    db.prepare('UPDATE users SET role = ?, updated_at = datetime("now") WHERE id = ?')
      .run(role, req.params.id);
    
    logActivity(req.user.id, 'role_change', `Changed user ${req.params.id} role to ${role}`, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/warn', authenticate, requireRole('owner', 'admin', 'moderator'), (req, res) => {
  try {
    const { reason, severity } = req.body;
    if (!reason) return res.status(400).json({ error: 'Reason required' });
    
    const db = getDb();
    const warningId = uuidv4();
    
    db.prepare(`
      INSERT INTO warnings (id, user_id, issued_by, reason, severity)
      VALUES (?, ?, ?, ?, ?)
    `).run(warningId, req.params.id, req.user.id, reason, severity || 'low');
    
    db.prepare('UPDATE users SET warnings = warnings + 1 WHERE id = ?').run(req.params.id);
    
    const user = db.prepare('SELECT warnings FROM users WHERE id = ?').get(req.params.id);
    
    if (user.warnings >= 5) {
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run('banned', req.params.id);
      logActivity(req.user.id, 'auto_ban', `User auto-banned after ${user.warnings} warnings`, req.ip);
    }
    
    logActivity(req.user.id, 'warn_user', `Warned user ${req.params.id}: ${reason}`, req.ip);
    res.json({ success: true, warningCount: user.warnings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/warn/:warnId', authenticate, requireRole('owner', 'admin'), (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE warnings SET active = 0 WHERE id = ? AND user_id = ?')
      .run(req.params.warnId, req.params.id);
    db.prepare('UPDATE users SET warnings = warnings - 1 WHERE id = ? AND warnings > 0')
      .run(req.params.id);
    
    logActivity(req.user.id, 'remove_warning', `Removed warning ${req.params.warnId}`, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/ban', authenticate, requireRole('owner', 'admin'), (req, res) => {
  try {
    const { reason, expires_at } = req.body;
    if (!reason) return res.status(400).json({ error: 'Reason required' });
    
    const db = getDb();
    const banId = uuidv4();
    
    db.prepare(`
      INSERT INTO ban_list (id, user_id, banned_by, reason, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(banId, req.params.id, req.user.id, reason, expires_at || null);
    
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run('banned', req.params.id);
    
    logActivity(req.user.id, 'ban_user', `Banned user ${req.params.id}: ${reason}`, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/unban', authenticate, requireRole('owner', 'admin'), (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run('active', req.params.id);
    db.prepare('DELETE FROM ban_list WHERE user_id = ?').run(req.params.id);
    
    logActivity(req.user.id, 'unban_user', `Unbanned user ${req.params.id}`, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/suspend', authenticate, requireRole('owner', 'admin'), (req, res) => {
  try {
    const { reason } = req.body;
    const db = getDb();
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run('suspended', req.params.id);
    
    logActivity(req.user.id, 'suspend_user', `Suspended user ${req.params.id}: ${reason}`, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticate, requireRole('owner'), (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    
    const db = getDb();
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    
    logActivity(req.user.id, 'delete_user', `Deleted user ${req.params.id}`, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats/overview', authenticate, requireRole('owner', 'admin'), (req, res) => {
  try {
    const db = getDb();
    const stats = {
      total: db.prepare('SELECT COUNT(*) as count FROM users').get().count,
      active: db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").get().count,
      banned: db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'banned'").get().count,
      suspended: db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'suspended'").get().count,
      owners: db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'owner'").get().count,
      admins: db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get().count,
      moderators: db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'moderator'").get().count,
      users: db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'user'").get().count,
      totalWarnings: db.prepare('SELECT COUNT(*) as count FROM warnings WHERE active = 1').get().count,
      totalBans: db.prepare('SELECT COUNT(*) as count FROM ban_list').get().count
    };
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { authenticate, requireRole, logActivity } = require('../auth');
const { dbGet, dbRun, dbAll } = require('../dbHelper');

const router = express.Router();

router.get('/', authenticate, requireRole('owner', 'admin'), (req, res) => {
  try {
    const db = getDb();
    const users = dbAll(db, 'SELECT id, username, email, display_name, role, status, warnings, last_login, created_at, avatar FROM users ORDER BY created_at DESC');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats/overview', authenticate, requireRole('owner', 'admin'), (req, res) => {
  try {
    const db = getDb();
    const stats = {
      total: (dbGet(db, 'SELECT COUNT(*) as count FROM users') || {}).count || 0,
      active: (dbGet(db, "SELECT COUNT(*) as count FROM users WHERE status = 'active'") || {}).count || 0,
      banned: (dbGet(db, "SELECT COUNT(*) as count FROM users WHERE status = 'banned'") || {}).count || 0,
      suspended: (dbGet(db, "SELECT COUNT(*) as count FROM users WHERE status = 'suspended'") || {}).count || 0,
      owners: (dbGet(db, "SELECT COUNT(*) as count FROM users WHERE role = 'owner'") || {}).count || 0,
      admins: (dbGet(db, "SELECT COUNT(*) as count FROM users WHERE role = 'admin'") || {}).count || 0,
      moderators: (dbGet(db, "SELECT COUNT(*) as count FROM users WHERE role = 'moderator'") || {}).count || 0,
      users: (dbGet(db, "SELECT COUNT(*) as count FROM users WHERE role = 'user'") || {}).count || 0,
      totalWarnings: (dbGet(db, 'SELECT COUNT(*) as count FROM warnings WHERE active = 1') || {}).count || 0,
      totalBans: (dbGet(db, 'SELECT COUNT(*) as count FROM ban_list') || {}).count || 0
    };
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticate, requireRole('owner', 'admin'), (req, res) => {
  try {
    const db = getDb();
    const user = dbGet(db, 'SELECT id, username, email, display_name, role, status, warnings, last_login, created_at, avatar FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const warnings = dbAll(db, 'SELECT w.*, u.username as issued_by_name FROM warnings w LEFT JOIN users u ON w.issued_by = u.id WHERE w.user_id = ? AND w.active = 1 ORDER BY w.created_at DESC', [req.params.id]);
    const bans = dbAll(db, 'SELECT b.*, u.username as banned_by_name FROM ban_list b LEFT JOIN users u ON b.banned_by = u.id WHERE b.user_id = ? ORDER BY b.created_at DESC', [req.params.id]);

    res.json({ ...user, warnings, bans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/role', authenticate, requireRole('owner'), (req, res) => {
  try {
    const { role } = req.body;
    if (!['owner', 'admin', 'moderator', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const db = getDb();
    dbRun(db, 'UPDATE users SET role = ?, updated_at = datetime("now") WHERE id = ?', [role, req.params.id]);
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
    dbRun(db, 'INSERT INTO warnings (id, user_id, issued_by, reason, severity) VALUES (?, ?, ?, ?, ?)',
      [warningId, req.params.id, req.user.id, reason, severity || 'low']);
    dbRun(db, 'UPDATE users SET warnings = warnings + 1 WHERE id = ?', [req.params.id]);
    const user = dbGet(db, 'SELECT warnings FROM users WHERE id = ?', [req.params.id]);
    if (user && user.warnings >= 5) {
      dbRun(db, "UPDATE users SET status = 'banned' WHERE id = ?", [req.params.id]);
    }
    logActivity(req.user.id, 'warn_user', `Warned user ${req.params.id}: ${reason}`, req.ip);
    res.json({ success: true, warningCount: user ? user.warnings : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/warn/:warnId', authenticate, requireRole('owner', 'admin'), (req, res) => {
  try {
    const db = getDb();
    dbRun(db, 'UPDATE warnings SET active = 0 WHERE id = ? AND user_id = ?', [req.params.warnId, req.params.id]);
    dbRun(db, 'UPDATE users SET warnings = warnings - 1 WHERE id = ? AND warnings > 0', [req.params.id]);
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
    dbRun(db, 'INSERT INTO ban_list (id, user_id, banned_by, reason, expires_at) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), req.params.id, req.user.id, reason, expires_at || null]);
    dbRun(db, "UPDATE users SET status = 'banned' WHERE id = ?", [req.params.id]);
    logActivity(req.user.id, 'ban_user', `Banned user ${req.params.id}: ${reason}`, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/unban', authenticate, requireRole('owner', 'admin'), (req, res) => {
  try {
    const db = getDb();
    dbRun(db, "UPDATE users SET status = 'active' WHERE id = ?", [req.params.id]);
    dbRun(db, 'DELETE FROM ban_list WHERE user_id = ?', [req.params.id]);
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
    dbRun(db, "UPDATE users SET status = 'suspended' WHERE id = ?", [req.params.id]);
    logActivity(req.user.id, 'suspend_user', `Suspended user ${req.params.id}: ${reason}`, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticate, requireRole('owner'), (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
    const db = getDb();
    dbRun(db, 'DELETE FROM users WHERE id = ?', [req.params.id]);
    logActivity(req.user.id, 'delete_user', `Deleted user ${req.params.id}`, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/permissions', authenticate, (req, res) => {
  try {
    const { getUserPermissions, hasPermission } = require('../auth');
    if (req.user.id !== req.params.id && !hasPermission(req.user.id, 'manage_roles')) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const perms = getUserPermissions(req.params.id);
    res.json(perms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/permissions', authenticate, requireRole('owner', 'admin'), (req, res) => {
  try {
    const { permission } = req.body;
    if (!permission) return res.status(400).json({ error: 'Permission required' });
    const { setUserPermission, hasPermission } = require('../auth');
    if (req.user.role !== 'owner' && !hasPermission(req.user.id, 'manage_roles')) {
      return res.status(403).json({ error: 'Access denied' });
    }
    setUserPermission(req.params.id, permission, req.user.id);
    logActivity(req.user.id, 'grant_permission', `Granted ${permission} to user ${req.params.id}`, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/permissions/:permission', authenticate, requireRole('owner', 'admin'), (req, res) => {
  try {
    const { removeUserPermission, hasPermission } = require('../auth');
    if (req.user.role !== 'owner' && !hasPermission(req.user.id, 'manage_roles')) {
      return res.status(403).json({ error: 'Access denied' });
    }
    removeUserPermission(req.params.id, req.params.permission);
    logActivity(req.user.id, 'revoke_permission', `Revoked ${req.params.permission} from user ${req.params.id}`, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

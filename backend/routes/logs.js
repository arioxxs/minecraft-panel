const express = require('express');
const { getDb } = require('../database');
const { authenticate, requireRole } = require('../auth');
const { dbAll, dbGet } = require('../dbHelper');

const router = express.Router();

router.get('/', authenticate, requireRole('owner', 'admin'), (req, res) => {
  try {
    const db = getDb();
    const { limit = 50, offset = 0 } = req.query;
    const logs = dbAll(db, 'SELECT a.*, u.username FROM activity_log a LEFT JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC LIMIT ? OFFSET ?', [parseInt(limit), parseInt(offset)]);
    const total = (dbGet(db, 'SELECT COUNT(*) as count FROM activity_log') || {}).count || 0;
    res.json({ logs, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const { getDb } = require('../database');
const { authenticate, requireRole } = require('../auth');

const router = express.Router();

router.get('/', authenticate, requireRole('owner', 'admin'), (req, res) => {
  try {
    const db = getDb();
    const { limit = 50, offset = 0, user_id, action } = req.query;
    
    let query = `
      SELECT a.*, u.username 
      FROM activity_log a 
      LEFT JOIN users u ON a.user_id = u.id 
    `;
    
    const conditions = [];
    const params = [];
    
    if (user_id) {
      conditions.push('a.user_id = ?');
      params.push(user_id);
    }
    if (action) {
      conditions.push('a.action = ?');
      params.push(action);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const logs = db.prepare(query).all(...params);
    const total = db.prepare('SELECT COUNT(*) as count FROM activity_log').get().count;
    
    res.json({ logs, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

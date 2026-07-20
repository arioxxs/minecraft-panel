const jwt = require('jsonwebtoken');
const { getDb } = require('./database');
const { dbGet } = require('./dbHelper');

const JWT_SECRET = process.env.JWT_SECRET || 'mc-panel-secret-key';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: process.env.SESSION_EXPIRY || '7d' }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') 
    ? authHeader.slice(7) 
    : req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const db = getDb();
  const user = dbGet(db, 'SELECT id, username, email, display_name, role, status, avatar FROM users WHERE id = ?', [decoded.id]);
  
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  if (user.status === 'banned') {
    return res.status(403).json({ error: 'Account is banned' });
  }

  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'Account is suspended' });
  }

  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const db = getDb();
    const hasPermission = db.prepare(
      'SELECT id FROM permissions WHERE role = ? AND permission = ?'
    ).get(req.user.role, permission);

    if (!hasPermission) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function logActivity(userId, action, details, ipAddress) {
  const db = getDb();
  const { v4: uuidv4 } = require('uuid');
  const { dbRun } = require('./dbHelper');
  dbRun(db, 'INSERT INTO activity_log (id, user_id, action, details, ip_address) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), userId, action, details, ipAddress]);
}

module.exports = { 
  generateToken, 
  verifyToken, 
  authenticate, 
  requireRole, 
  requirePermission,
  logActivity 
};

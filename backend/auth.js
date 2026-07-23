const jwt = require('jsonwebtoken');
const { getDb } = require('./database');
const { dbGet, dbRun, dbAll } = require('./dbHelper');

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

function getUserPermissions(userId) {
  const db = getDb();
  const user = dbGet(db, 'SELECT role FROM users WHERE id = ?', [userId]);
  if (!user) return [];

  const rolePerms = dbAll(db, 'SELECT permission FROM permissions WHERE role = ?', [user.role]) || [];
  const userPerms = dbAll(db, 'SELECT permission FROM user_permissions WHERE user_id = ?', [userId]) || [];

  const perms = new Set();
  rolePerms.forEach(p => perms.add(p.permission));
  userPerms.forEach(p => perms.add(p.permission));
  return [...perms];
}

function hasPermission(userId, permission) {
  const perms = getUserPermissions(userId);
  return perms.includes(permission);
}

function setUserPermission(userId, permission, grantedBy) {
  const db = getDb();
  const existing = dbGet(db, 'SELECT id FROM user_permissions WHERE user_id = ? AND permission = ?', [userId, permission]);
  if (existing) return;
  dbRun(db, 'INSERT INTO user_permissions (id, user_id, permission, granted_by) VALUES (?, ?, ?, ?)',
    [require('uuid').v4(), userId, permission, grantedBy]);
}

function removeUserPermission(userId, permission) {
  const db = getDb();
  dbRun(db, 'DELETE FROM user_permissions WHERE user_id = ? AND permission = ?', [userId, permission]);
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!hasPermission(req.user.id, permission)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function logActivity(userId, action, details, ipAddress) {
  const db = getDb();
  const { v4: uuidv4 } = require('uuid');
  dbRun(db, 'INSERT INTO activity_log (id, user_id, action, details, ip_address) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), userId, action, details, ipAddress]);
}

module.exports = { 
  generateToken, 
  verifyToken, 
  authenticate, 
  requireRole, 
  requirePermission,
  getUserPermissions,
  hasPermission,
  setUserPermission,
  removeUserPermission,
  logActivity 
};

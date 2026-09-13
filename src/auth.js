import jwt from 'jsonwebtoken';
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export function sign(user) {
  return jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '30d' });
}

export function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'auth required' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'invalid token' });
  }
}

export function adminOnly(req, res, next) {
  if (!req.user || !['admin', 'owner'].includes(req.user.role))
    return res.status(403).json({ error: 'admin only' });
  next();
}

export function ownerOnly(req, res, next) {
  if (!req.user || req.user.role !== 'owner')
    return res.status(403).json({ error: 'owner only' });
  next();
}

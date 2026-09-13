import express from 'express';
import bcrypt from 'bcryptjs';
import dns from 'dns/promises';
import db from '../db.js';
import { sign, auth } from '../auth.js';
import { sendVerifyCode } from '../mailer.js';

const r = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function hasMx(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    return Array.isArray(mx) && mx.length > 0;
  } catch { return false; }
}

function safeUser(u) {
  return { id: u.id, email: u.email, phone: u.phone, ign: u.ign,
    game_uid: u.game_uid, role: u.role, balance: u.balance };
}

r.post('/register', async (req, res) => {
  const { email, password, phone, ign, game_uid } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid email format' });
  if (password.length < 6) return res.status(400).json({ error: 'password must be 6+ chars' });
  if (!phone || !ign || !game_uid) return res.status(400).json({ error: 'phone, ign, game_uid required' });
  if (!/^\d{10,15}$/.test(String(phone).replace(/\D/g, '')))
    return res.status(400).json({ error: 'invalid phone number' });

  const domain = email.split('@')[1].toLowerCase();
  // Reject obvious fakes
  const BLOCKED = ['example.com', 'test.com', 'mailinator.com', 'tempmail.com', '10minutemail.com'];
  if (BLOCKED.includes(domain))
    return res.status(400).json({ error: 'disposable email not allowed' });
  if (!(await hasMx(domain)))
    return res.status(400).json({ error: 'email domain cannot receive mail' });

  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase()))
    return res.status(409).json({ error: 'email already registered' });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`INSERT INTO users (email,password_hash,phone,ign,game_uid,verify_code)
    VALUES (?,?,?,?,?,?)`).run(email.toLowerCase(), hash, phone, ign, game_uid, code);

  try { await sendVerifyCode(email, code); } catch (e) { console.error('[mail]', e.message); }

  const dev = !process.env.SMTP_HOST;
  res.json({ ok: true, user_id: info.lastInsertRowid, dev_mode: dev, ...(dev ? { code } : {}) });
});

r.post('/verify', (req, res) => {
  const { email, code } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!u) return res.status(404).json({ error: 'no such user' });
  if (u.email_verified) return res.json({ ok: true });
  if (u.verify_code !== String(code)) return res.status(400).json({ error: 'wrong code' });
  db.prepare('UPDATE users SET email_verified=1, verify_code=NULL WHERE id=?').run(u.id);
  res.json({ ok: true });
});

r.post('/resend', async (req, res) => {
  const { email } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!u) return res.status(404).json({ error: 'no such user' });
  if (u.email_verified) return res.json({ ok: true });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.prepare('UPDATE users SET verify_code=? WHERE id=?').run(code, u.id);
  try { await sendVerifyCode(email, code); } catch {}
  const dev = !process.env.SMTP_HOST;
  res.json({ ok: true, ...(dev ? { code } : {}) });
});

r.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!u) return res.status(401).json({ error: 'invalid credentials' });
  if (u.banned) return res.status(403).json({ error: 'account banned' });
  if (!bcrypt.compareSync(password, u.password_hash))
    return res.status(401).json({ error: 'invalid credentials' });
  if (!u.email_verified)
    return res.status(403).json({ error: 'email not verified', needs_verify: true });
  res.json({ ok: true, token: sign(u), user: safeUser(u) });
});

r.get('/me', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'no user' });
  res.json({ user: safeUser(u) });
});

export default r;

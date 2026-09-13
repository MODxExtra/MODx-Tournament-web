import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { auth, adminOnly, ownerOnly } from '../auth.js';

const r = express.Router();
r.use(auth, adminOnly);

const UPLOAD_DIR = path.resolve('public/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, f, cb) => cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + path.extname(f.originalname)),
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

// ---- Admins (owner only)
r.get('/admins', (req, res) => {
  res.json({ admins: db.prepare("SELECT id,email,ign,role,created_at FROM users WHERE role IN ('admin','owner') ORDER BY id ASC").all() });
});

r.post('/admins', ownerOnly, (req, res) => {
  const { email, password, ign } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase()))
    return res.status(409).json({ error: 'email already exists' });
  const info = db.prepare("INSERT INTO users (email,password_hash,ign,role,email_verified) VALUES (?,?,?,'admin',1)")
    .run(email.toLowerCase(), bcrypt.hashSync(password, 10), ign || 'Admin');
  res.json({ ok: true, id: info.lastInsertRowid });
});

r.delete('/admins/:id', ownerOnly, (req, res) => {
  const t = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  if (t.role === 'owner') return res.status(400).json({ error: 'cannot remove owner' });
  db.prepare("UPDATE users SET role='user' WHERE id=?").run(t.id);
  res.json({ ok: true });
});

// ---- Users
r.get('/users', (req, res) => {
  res.json({ users: db.prepare('SELECT id,email,phone,ign,game_uid,role,balance,banned,email_verified,created_at FROM users ORDER BY id DESC LIMIT 500').all() });
});

r.post('/users/:id/ban', (req, res) => {
  const t = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  if (t.role === 'owner') return res.status(403).json({ error: 'cannot ban owner' });
  db.prepare('UPDATE users SET banned=? WHERE id=?').run(req.body?.banned ? 1 : 0, t.id);
  res.json({ ok: true });
});

// ---- Tournaments
r.post('/tournaments', upload.single('thumbnail'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required' });
  let thumb = b.thumbnail_url || '';
  if (req.file) thumb = '/uploads/' + req.file.filename;
  const info = db.prepare(`INSERT INTO tournaments
    (name,thumbnail,prize,entry_fee,mode,map,slots,start_time,status,description,rules,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    b.name, thumb, b.prize || '', Number(b.entry_fee || 0), b.mode || '', b.map || '',
    Number(b.slots || 48), b.start_time || null, b.status || 'upcoming',
    b.description || '', b.rules || '', req.user.id);
  res.json({ ok: true, id: info.lastInsertRowid });
});

r.put('/tournaments/:id', upload.single('thumbnail'), (req, res) => {
  const t = db.prepare('SELECT * FROM tournaments WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  let thumb = t.thumbnail;
  if (req.file) thumb = '/uploads/' + req.file.filename;
  else if (b.thumbnail_url) thumb = b.thumbnail_url;
  db.prepare(`UPDATE tournaments SET name=?,thumbnail=?,prize=?,entry_fee=?,mode=?,map=?,
    slots=?,start_time=?,status=?,description=?,rules=? WHERE id=?`).run(
    b.name || t.name, thumb, b.prize ?? t.prize, Number(b.entry_fee ?? t.entry_fee),
    b.mode ?? t.mode, b.map ?? t.map, Number(b.slots ?? t.slots),
    b.start_time ?? t.start_time, b.status ?? t.status,
    b.description ?? t.description, b.rules ?? t.rules, t.id);
  res.json({ ok: true });
});

r.delete('/tournaments/:id', (req, res) => {
  db.prepare('DELETE FROM participants WHERE tournament_id=?').run(req.params.id);
  db.prepare('DELETE FROM tournaments WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Deposits
r.get('/deposits', (req, res) => {
  const s = req.query.status;
  const rows = s
    ? db.prepare('SELECT d.*,u.email,u.ign FROM deposits d JOIN users u ON u.id=d.user_id WHERE d.status=? ORDER BY d.id DESC LIMIT 500').all(s)
    : db.prepare('SELECT d.*,u.email,u.ign FROM deposits d JOIN users u ON u.id=d.user_id ORDER BY d.id DESC LIMIT 500').all();
  res.json({ deposits: rows });
});

r.post('/deposits/:id/approve', (req, res) => {
  const d = db.prepare('SELECT * FROM deposits WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'not found' });
  if (d.status !== 'pending') return res.status(400).json({ error: 'not pending' });
  db.transaction(() => {
    db.prepare("UPDATE deposits SET status='approved',reviewed_by=?,reviewed_at=datetime('now') WHERE id=?").run(req.user.id, d.id);
    db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(d.amount, d.user_id);
    db.prepare('INSERT INTO transactions (user_id,type,amount,note) VALUES (?,?,?,?)')
      .run(d.user_id, 'deposit', d.amount, 'Deposit approved #' + d.id);
  })();
  res.json({ ok: true });
});

r.post('/deposits/:id/reject', (req, res) => {
  const d = db.prepare('SELECT * FROM deposits WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'not found' });
  if (d.status !== 'pending') return res.status(400).json({ error: 'not pending' });
  db.prepare("UPDATE deposits SET status='rejected',note=?,reviewed_by=?,reviewed_at=datetime('now') WHERE id=?")
    .run(req.body?.note || '', req.user.id, d.id);
  res.json({ ok: true });
});

// ---- Redeem
r.get('/redeem', (req, res) => {
  res.json({ codes: db.prepare('SELECT * FROM redeem_codes ORDER BY id DESC LIMIT 200').all() });
});

r.post('/redeem', (req, res) => {
  const { code, amount, max_uses, expires_at } = req.body || {};
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'invalid amount' });
  const c = (code || '').trim().toUpperCase() || ('FF' + Math.random().toString(36).slice(2, 8).toUpperCase());
  try {
    const info = db.prepare('INSERT INTO redeem_codes (code,amount,max_uses,expires_at,created_by) VALUES (?,?,?,?,?)')
      .run(c, amt, Number(max_uses || 1), expires_at || null, req.user.id);
    res.json({ ok: true, id: info.lastInsertRowid, code: c });
  } catch {
    res.status(409).json({ error: 'code already exists' });
  }
});

r.delete('/redeem/:id', (req, res) => {
  db.prepare('DELETE FROM redeem_codes WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Tickets
r.get('/tickets', (req, res) => {
  res.json({ tickets: db.prepare('SELECT t.*,u.email,u.ign FROM tickets t JOIN users u ON u.id=t.user_id ORDER BY t.updated_at DESC LIMIT 500').all() });
});

r.get('/tickets/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json({ ticket: t, messages: db.prepare('SELECT * FROM ticket_messages WHERE ticket_id=? ORDER BY id ASC').all(t.id) });
});

r.post('/tickets/:id/message', (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });
  const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  db.prepare('INSERT INTO ticket_messages (ticket_id,sender_id,sender_role,message) VALUES (?,?,?,?)')
    .run(t.id, req.user.id, req.user.role, message);
  db.prepare("UPDATE tickets SET updated_at=datetime('now'),status='open' WHERE id=?").run(t.id);
  res.json({ ok: true });
});

r.post('/tickets/:id/close', (req, res) => {
  db.prepare("UPDATE tickets SET status='closed',updated_at=datetime('now') WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ---- Notices
r.get('/notices', (req, res) => {
  res.json({ notices: db.prepare('SELECT * FROM notices ORDER BY id DESC LIMIT 100').all() });
});

r.post('/notices', (req, res) => {
  const { title, body, type } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  const info = db.prepare('INSERT INTO notices (title,body,type,created_by) VALUES (?,?,?,?)')
    .run(title, body || '', type || 'info', req.user.id);
  res.json({ ok: true, id: info.lastInsertRowid });
});

r.delete('/notices/:id', (req, res) => {
  db.prepare('DELETE FROM notices WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Settings
r.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const out = {}; for (const x of rows) out[x.key] = x.value;
  res.json({ settings: out });
});

r.put('/settings', upload.single('qr_file'), (req, res) => {
  const b = req.body || {};
  const known = ['pay.upi_id', 'pay.name', 'pay.qr_url', 'pay.min_deposit', 'pay.instructions', 'site.name', 'site.tagline'];
  const updates = [];
  for (const k of known) if (b[k] !== undefined) updates.push([k, b[k]]);
  if (req.file) updates.push(['pay.qr_url', '/uploads/' + req.file.filename]);
  db.transaction(() => {
    for (const [k, v] of updates)
      db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);
  })();
  res.json({ ok: true });
});

export default r;

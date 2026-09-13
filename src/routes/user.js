import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db from '../db.js';
import { auth } from '../auth.js';

const r = express.Router();
r.use(auth);

const UPLOAD_DIR = path.resolve('public/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, f, cb) => cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + path.extname(f.originalname)),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

r.get('/wallet', (req, res) => {
  const u = db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id);
  res.json({ balance: u?.balance || 0 });
});

r.get('/transactions', (req, res) => {
  res.json({ transactions: db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id) });
});

r.get('/deposits', (req, res) => {
  res.json({ deposits: db.prepare('SELECT * FROM deposits WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id) });
});

r.post('/deposit', upload.single('screenshot'), (req, res) => {
  const { amount, utr } = req.body || {};
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'invalid amount' });
  if (!utr || String(utr).trim().length < 6) return res.status(400).json({ error: 'invalid UTR (min 6 chars)' });
  if (!req.file) return res.status(400).json({ error: 'screenshot required' });
  const info = db.prepare('INSERT INTO deposits (user_id,amount,utr,screenshot) VALUES (?,?,?,?)')
    .run(req.user.id, amt, String(utr).trim(), '/uploads/' + req.file.filename);
  res.json({ ok: true, id: info.lastInsertRowid });
});

r.post('/redeem', (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code required' });
  const c = db.prepare('SELECT * FROM redeem_codes WHERE code=? AND active=1').get(String(code).trim().toUpperCase());
  if (!c) return res.status(404).json({ error: 'invalid code' });
  if (c.expires_at && new Date(c.expires_at) < new Date()) return res.status(400).json({ error: 'code expired' });
  if (c.uses >= c.max_uses) return res.status(400).json({ error: 'code fully used' });
  if (db.prepare('SELECT id FROM redeem_uses WHERE code_id=? AND user_id=?').get(c.id, req.user.id))
    return res.status(400).json({ error: 'already used by you' });

  db.transaction(() => {
    db.prepare('UPDATE redeem_codes SET uses=uses+1 WHERE id=?').run(c.id);
    db.prepare('INSERT INTO redeem_uses (code_id,user_id,amount) VALUES (?,?,?)').run(c.id, req.user.id, c.amount);
    db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(c.amount, req.user.id);
    db.prepare('INSERT INTO transactions (user_id,type,amount,note) VALUES (?,?,?,?)')
      .run(req.user.id, 'redeem', c.amount, 'Redeem ' + c.code);
  })();
  res.json({ ok: true, amount: c.amount });
});

// Tickets
r.get('/tickets', (req, res) => {
  res.json({ tickets: db.prepare('SELECT * FROM tickets WHERE user_id=? ORDER BY updated_at DESC').all(req.user.id) });
});

r.post('/tickets', (req, res) => {
  const { subject, category, message } = req.body || {};
  if (!subject || !message) return res.status(400).json({ error: 'subject and message required' });
  const info = db.prepare('INSERT INTO tickets (user_id,subject,category) VALUES (?,?,?)')
    .run(req.user.id, subject, category || 'general');
  db.prepare('INSERT INTO ticket_messages (ticket_id,sender_id,sender_role,message) VALUES (?,?,?,?)')
    .run(info.lastInsertRowid, req.user.id, 'user', message);
  res.json({ ok: true, id: info.lastInsertRowid });
});

r.get('/tickets/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json({ ticket: t, messages: db.prepare('SELECT * FROM ticket_messages WHERE ticket_id=? ORDER BY id ASC').all(t.id) });
});

r.post('/tickets/:id/message', (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });
  const t = db.prepare('SELECT * FROM tickets WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  if (t.status === 'closed') return res.status(400).json({ error: 'ticket closed' });
  db.prepare('INSERT INTO ticket_messages (ticket_id,sender_id,sender_role,message) VALUES (?,?,?,?)')
    .run(t.id, req.user.id, 'user', message);
  db.prepare("UPDATE tickets SET updated_at=datetime('now') WHERE id=?").run(t.id);
  res.json({ ok: true });
});

// Tournaments join
r.get('/my-tournaments', (req, res) => {
  const rows = db.prepare(`SELECT t.*, p.joined_at FROM participants p
    JOIN tournaments t ON t.id=p.tournament_id
    WHERE p.user_id=? ORDER BY p.id DESC`).all(req.user.id);
  res.json({ tournaments: rows });
});

r.post('/tournaments/:id/join', (req, res) => {
  const { ign, game_uid } = req.body || {};
  const t = db.prepare('SELECT * FROM tournaments WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  if (!['upcoming', 'live'].includes(t.status)) return res.status(400).json({ error: 'not joinable' });
  if (db.prepare('SELECT id FROM participants WHERE tournament_id=? AND user_id=?').get(t.id, req.user.id))
    return res.status(400).json({ error: 'already joined' });
  const joined = db.prepare('SELECT COUNT(*) c FROM participants WHERE tournament_id=?').get(t.id).c;
  if (joined >= t.slots) return res.status(400).json({ error: 'slots full' });

  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const finalIgn = ign || u.ign;
  const finalUid = game_uid || u.game_uid;
  if (!finalIgn || !finalUid) return res.status(400).json({ error: 'ign and uid required' });

  try {
    db.transaction(() => {
      if (t.entry_fee > 0) {
        const fresh = db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id);
        if (fresh.balance < t.entry_fee) throw new Error('INSUFFICIENT');
        db.prepare('UPDATE users SET balance=balance-? WHERE id=?').run(t.entry_fee, req.user.id);
        db.prepare('INSERT INTO transactions (user_id,type,amount,note) VALUES (?,?,?,?)')
          .run(req.user.id, 'entry_fee', -t.entry_fee, 'Join ' + t.name);
      }
      db.prepare('INSERT INTO participants (tournament_id,user_id,ign,game_uid) VALUES (?,?,?,?)')
        .run(t.id, req.user.id, finalIgn, finalUid);
    })();
  } catch (e) {
    if (String(e.message).includes('INSUFFICIENT'))
      return res.status(400).json({ error: 'insufficient balance' });
    return res.status(500).json({ error: 'join failed' });
  }
  res.json({ ok: true });
});

export default r;

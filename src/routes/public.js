import express from 'express';
import db from '../db.js';
const r = express.Router();

r.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const out = {}; for (const x of rows) out[x.key] = x.value;
  res.json({ settings: out });
});

r.get('/notices', (req, res) => {
  res.json({ notices: db.prepare('SELECT * FROM notices ORDER BY id DESC LIMIT 30').all() });
});

r.get('/tournaments', (req, res) => {
  const rows = db.prepare(`SELECT t.*, 
    (SELECT COUNT(*) FROM participants p WHERE p.tournament_id=t.id) AS joined
    FROM tournaments t ORDER BY
    CASE t.status WHEN 'live' THEN 0 WHEN 'upcoming' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
    t.id DESC`).all();
  res.json({ tournaments: rows });
});

r.get('/tournaments/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const participants = db.prepare(`SELECT p.id,p.ign,p.game_uid,p.joined_at
    FROM participants p WHERE p.tournament_id = ? ORDER BY p.id ASC`).all(t.id);
  res.json({ tournament: t, participants });
});

export default r;

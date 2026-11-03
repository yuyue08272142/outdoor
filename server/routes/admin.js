'use strict';
// 管理后台接口：登录、活动/档期管理、报名处理、咨询答复、数据导出
const crypto = require('node:crypto');
const express = require('express');
const { toActivity, getSession, listSessions } = require('../models');
const {
  CATEGORY_KEYS, HttpError, DATE_RE, str, int, rateLimit,
} = require('../util');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const BOOKING_STATUSES = ['pending', 'confirmed', 'cancelled', 'completed'];
const INQUIRY_STATUSES = ['open', 'replied', 'closed'];

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function strList(v, max = 20) {
  if (typeof v === 'string') v = v.split('\n');
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x, 200)).filter(Boolean).slice(0, max);
}

function itineraryList(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((d) => ({ title: str(d && d.title, 100), content: str(d && d.content, 2000) }))
    .filter((d) => d.title || d.content)
    .slice(0, 30);
}

module.exports = function adminRoutes(db, config) {
  const r = express.Router();
  const tokens = new Map(); // token -> expiresAt

  // ---------- 认证 ----------
  r.post('/login', rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
    if (!safeEqual(req.body?.password ?? '', config.adminPassword)) {
      throw new HttpError(401, '密码错误');
    }
    const token = crypto.randomBytes(24).toString('hex');
    tokens.set(token, Date.now() + TOKEN_TTL_MS);
    res.json({ token, expires_in: TOKEN_TTL_MS / 1000 });
  });

  r.use((req, res, next) => {
    const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const exp = tokens.get(token);
    if (!exp || exp < Date.now()) {
      tokens.delete(token);
      throw new HttpError(401, '登录已失效，请重新登录');
    }
    next();
  });

  r.post('/logout', (req, res) => {
    tokens.delete((req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
    res.json({ ok: true });
  });

  // ---------- 概览 ----------
  r.get('/stats', (req, res) => {
    const one = (sql, ...p) => Object.values(db.prepare(sql).get(...p))[0] ?? 0;
    res.json({
      activities_published: one(`SELECT COUNT(*) FROM activities WHERE status = 'published'`),
      upcoming_sessions: one(`SELECT COUNT(*) FROM sessions WHERE status = 'open' AND start_date > date('now','localtime')`),
      bookings_pending: one(`SELECT COUNT(*) FROM bookings WHERE status = 'pending'`),
      bookings_30d: one(`SELECT COUNT(*) FROM bookings WHERE created_at >= datetime('now','localtime','-30 days')`),
      participants_30d: one(`SELECT COALESCE(SUM(headcount),0) FROM bookings
                             WHERE status IN ('confirmed','completed') AND created_at >= datetime('now','localtime','-30 days')`),
      revenue_30d: one(`SELECT COALESCE(SUM(total_price),0) FROM bookings
                        WHERE status IN ('confirmed','completed') AND created_at >= datetime('now','localtime','-30 days')`),
      inquiries_open: one(`SELECT COUNT(*) FROM inquiries WHERE status = 'open'`),
    });
  });

  // ---------- 活动 ----------
  function readActivity(body) {
    const a = {
      title: str(body.title, 100),
      category: str(body.category, 20),
      summary: str(body.summary, 300),
      description: str(body.description, 10000),
      cover_url: str(body.cover_url, 500),
      location: str(body.location, 100),
      duration_days: Math.max(1, int(body.duration_days, 1)),
      difficulty: Math.min(5, Math.max(1, int(body.difficulty, 2))),
      price: Math.max(0, Math.round(Number(body.price_yuan ?? 0) * 100)),
      min_age: Math.max(0, int(body.min_age, 0)),
      highlights: JSON.stringify(strList(body.highlights)),
      itinerary: JSON.stringify(itineraryList(body.itinerary)),
      includes: JSON.stringify(strList(body.includes)),
      excludes: JSON.stringify(strList(body.excludes)),
      notices: str(body.notices, 5000),
      status: ['draft', 'published', 'archived'].includes(body.status) ? body.status : 'draft',
      sort_order: int(body.sort_order, 0),
    };
    if (!a.title) throw new HttpError(400, '请填写活动标题');
    if (!CATEGORY_KEYS.includes(a.category)) throw new HttpError(400, '活动类型无效');
    if (a.cover_url && !/^(https?:\/\/|\/)/.test(a.cover_url)) throw new HttpError(400, '封面图地址需以 http(s):// 或 / 开头');
    return a;
  }

  r.get('/activities', (req, res) => {
    const rows = db.prepare(`
      SELECT a.id, a.title, a.category, a.location, a.price, a.difficulty, a.status, a.sort_order, a.updated_at,
             (SELECT COUNT(*) FROM sessions s WHERE s.activity_id = a.id AND s.start_date > date('now','localtime')
                AND s.status != 'cancelled') AS upcoming_sessions,
             (SELECT COUNT(*) FROM bookings b WHERE b.activity_id = a.id AND b.status = 'pending') AS pending_bookings
      FROM activities a ORDER BY a.status = 'archived', a.sort_order DESC, a.id DESC
    `).all();
    res.json({ items: rows });
  });

  r.get('/activities/:id', (req, res) => {
    const a = toActivity(db.prepare('SELECT * FROM activities WHERE id = ?').get(int(req.params.id)));
    if (!a) throw new HttpError(404, '活动不存在');
    res.json({ activity: a, sessions: listSessions(db, a.id) });
  });

  r.post('/activities', (req, res) => {
    const a = readActivity(req.body || {});
    const cols = Object.keys(a);
    const info = db.prepare(`INSERT INTO activities (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...Object.values(a));
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.put('/activities/:id', (req, res) => {
    const a = readActivity(req.body || {});
    const sets = Object.keys(a).map((k) => `${k} = ?`).join(', ');
    const info = db.prepare(`UPDATE activities SET ${sets}, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(...Object.values(a), int(req.params.id));
    if (!info.changes) throw new HttpError(404, '活动不存在');
    res.json({ ok: true });
  });

  r.delete('/activities/:id', (req, res) => {
    const id = int(req.params.id);
    if (db.prepare('SELECT 1 FROM bookings WHERE activity_id = ? LIMIT 1').get(id)) {
      throw new HttpError(409, '该活动已有报名记录，无法删除，请改为「已归档」');
    }
    db.prepare('DELETE FROM activities WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // ---------- 档期 ----------
  function readSession(body) {
    const s = {
      start_date: str(body.start_date, 10),
      end_date: str(body.end_date || body.start_date, 10),
      capacity: int(body.capacity, 0),
      price: body.price_yuan === '' || body.price_yuan == null ? null : Math.max(0, Math.round(Number(body.price_yuan) * 100)),
      meeting_point: str(body.meeting_point, 200),
      leader: str(body.leader, 50),
      status: ['open', 'closed', 'cancelled'].includes(body.status) ? body.status : 'open',
    };
    if (!DATE_RE.test(s.start_date) || !DATE_RE.test(s.end_date)) throw new HttpError(400, '日期格式应为 YYYY-MM-DD');
    if (s.end_date < s.start_date) throw new HttpError(400, '结束日期不能早于开始日期');
    if (s.capacity < 1) throw new HttpError(400, '名额至少为 1');
    if (Number.isNaN(s.price)) throw new HttpError(400, '价格无效');
    return s;
  }

  r.post('/activities/:id/sessions', (req, res) => {
    const activityId = int(req.params.id);
    if (!db.prepare('SELECT 1 FROM activities WHERE id = ?').get(activityId)) throw new HttpError(404, '活动不存在');
    const s = readSession(req.body || {});
    const info = db.prepare(`INSERT INTO sessions (activity_id, start_date, end_date, capacity, price, meeting_point, leader, status)
                             VALUES (?,?,?,?,?,?,?,?)`)
      .run(activityId, s.start_date, s.end_date, s.capacity, s.price, s.meeting_point, s.leader, s.status);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.put('/sessions/:id', (req, res) => {
    const id = int(req.params.id);
    const cur = getSession(db, id);
    if (!cur) throw new HttpError(404, '档期不存在');
    const s = readSession(req.body || {});
    if (s.capacity < cur.booked) throw new HttpError(400, `名额不能少于已报名人数（${cur.booked}）`);
    db.prepare(`UPDATE sessions SET start_date=?, end_date=?, capacity=?, price=?, meeting_point=?, leader=?, status=? WHERE id=?`)
      .run(s.start_date, s.end_date, s.capacity, s.price, s.meeting_point, s.leader, s.status, id);
    res.json({ ok: true });
  });

  r.delete('/sessions/:id', (req, res) => {
    const id = int(req.params.id);
    if (db.prepare('SELECT 1 FROM bookings WHERE session_id = ? LIMIT 1').get(id)) {
      throw new HttpError(409, '该档期已有报名记录，无法删除，可将状态改为「已取消」');
    }
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // ---------- 报名 ----------
  function bookingFilter(q) {
    const where = ['1=1'];
    const params = [];
    if (BOOKING_STATUSES.includes(q.status)) { where.push('b.status = ?'); params.push(q.status); }
    if (q.activity_id) { where.push('b.activity_id = ?'); params.push(int(q.activity_id)); }
    if (q.session_id) { where.push('b.session_id = ?'); params.push(int(q.session_id)); }
    if (q.q) {
      where.push('(b.code LIKE ? OR b.contact_name LIKE ? OR b.contact_phone LIKE ?)');
      const kw = `%${str(q.q, 50)}%`;
      params.push(kw, kw, kw);
    }
    return { where: where.join(' AND '), params };
  }

  const BOOKING_LIST_SQL = `
    SELECT b.*, a.title AS activity_title, s.start_date, s.end_date
    FROM bookings b JOIN activities a ON a.id = b.activity_id JOIN sessions s ON s.id = b.session_id`;

  r.get('/bookings', (req, res) => {
    const { where, params } = bookingFilter(req.query);
    const rows = db.prepare(`${BOOKING_LIST_SQL} WHERE ${where} ORDER BY b.id DESC LIMIT 500`).all(...params);
    res.json({ items: rows });
  });

  r.get('/bookings/:id', (req, res) => {
    const row = db.prepare(`${BOOKING_LIST_SQL} WHERE b.id = ?`).get(int(req.params.id));
    if (!row) throw new HttpError(404, '报名不存在');
    const participants = db.prepare('SELECT * FROM participants WHERE booking_id = ?').all(row.id);
    res.json({ booking: { ...row, participants } });
  });

  r.patch('/bookings/:id', (req, res) => {
    const id = int(req.params.id);
    const cur = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!cur) throw new HttpError(404, '报名不存在');
    const status = req.body?.status ?? cur.status;
    if (!BOOKING_STATUSES.includes(status)) throw new HttpError(400, '状态无效');
    // 从「已取消」恢复时需要重新校验余量
    if (cur.status === 'cancelled' && ['pending', 'confirmed'].includes(status)) {
      const s = getSession(db, cur.session_id);
      if (s.remaining < cur.headcount) throw new HttpError(409, `档期余量不足（剩 ${s.remaining}），无法恢复`);
    }
    const note = req.body?.admin_note !== undefined ? str(req.body.admin_note, 1000) : cur.admin_note;
    db.prepare(`UPDATE bookings SET status = ?, admin_note = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(status, note, id);
    res.json({ ok: true });
  });

  r.get('/bookings.csv', (req, res) => {
    const { where, params } = bookingFilter(req.query);
    const rows = db.prepare(`
      SELECT b.code, a.title, s.start_date, s.end_date, b.status, b.contact_name, b.contact_phone, b.headcount,
             b.total_price, p.name AS p_name, p.gender, p.phone AS p_phone, p.id_no, p.emergency_contact,
             b.remark, b.admin_note, b.created_at
      FROM bookings b JOIN activities a ON a.id = b.activity_id JOIN sessions s ON s.id = b.session_id
      LEFT JOIN participants p ON p.booking_id = b.id
      WHERE ${where} ORDER BY b.id DESC, p.id`).all(...params);
    const header = ['报名编号', '活动', '开始日期', '结束日期', '状态', '联系人', '联系电话', '人数', '总价(元)',
      '参与者', '性别', '参与者电话', '证件号', '紧急联系人', '备注', '后台备注', '报名时间'];
    const cell = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@]/.test(s)) s = `'${s}`; // 防止 CSV 公式注入
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((r0) => [r0.code, r0.title, r0.start_date, r0.end_date, r0.status, r0.contact_name,
      r0.contact_phone, r0.headcount, (r0.total_price / 100).toFixed(2), r0.p_name, r0.gender, r0.p_phone,
      r0.id_no, r0.emergency_contact, r0.remark, r0.admin_note, r0.created_at].map(cell).join(','));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="bookings-${Date.now()}.csv"`);
    res.send('﻿' + [header.join(','), ...lines].join('\r\n'));
  });

  // ---------- 咨询 ----------
  r.get('/inquiries', (req, res) => {
    const where = ['1=1'];
    const params = [];
    if (INQUIRY_STATUSES.includes(req.query.status)) { where.push('i.status = ?'); params.push(req.query.status); }
    const rows = db.prepare(`
      SELECT i.*, a.title AS activity_title FROM inquiries i LEFT JOIN activities a ON a.id = i.activity_id
      WHERE ${where.join(' AND ')} ORDER BY i.status = 'open' DESC, i.id DESC LIMIT 500`).all(...params);
    res.json({ items: rows });
  });

  r.patch('/inquiries/:id', (req, res) => {
    const id = int(req.params.id);
    const cur = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(id);
    if (!cur) throw new HttpError(404, '咨询不存在');
    const b = req.body || {};
    const reply = b.reply !== undefined ? str(b.reply, 3000) : cur.reply;
    let status = b.status ?? cur.status;
    if (!INQUIRY_STATUSES.includes(status)) throw new HttpError(400, '状态无效');
    if (reply && status === 'open') status = 'replied';
    const isPublic = b.is_public !== undefined ? (b.is_public ? 1 : 0) : cur.is_public;
    if (isPublic && !reply) throw new HttpError(400, '需要先回复才能设为公开问答');
    const repliedAt = reply && reply !== cur.reply ? new Date().toLocaleString('sv-SE') : cur.replied_at;
    db.prepare('UPDATE inquiries SET reply = ?, status = ?, is_public = ?, replied_at = ? WHERE id = ?')
      .run(reply, status, isPublic, repliedAt, id);
    res.json({ ok: true });
  });

  r.delete('/inquiries/:id', (req, res) => {
    db.prepare('DELETE FROM inquiries WHERE id = ?').run(int(req.params.id));
    res.json({ ok: true });
  });

  return r;
};

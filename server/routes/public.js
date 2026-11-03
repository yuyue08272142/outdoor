'use strict';
// 面向用户的公开接口：活动浏览、报名、报名查询/取消、咨询
const express = require('express');
const { tx } = require('../db');
const { toActivity, getSession, listSessions } = require('../models');
const {
  CATEGORIES, CATEGORY_KEYS, DIFFICULTIES, HttpError, PHONE_RE,
  genCode, today, str, int, maskIdNo, rateLimit,
} = require('../util');

const MAX_HEADCOUNT = 10;

module.exports = function publicRoutes(db, config) {
  const r = express.Router();
  const writeLimit = rateLimit({ windowMs: 60_000, max: config.writeRateLimit ?? 10 });

  // ---------- 站点信息 ----------
  r.get('/meta', (req, res) => {
    res.json({
      site: config.site,
      categories: CATEGORIES,
      difficulties: DIFFICULTIES,
    });
  });

  // ---------- 活动 ----------
  r.get('/activities', (req, res) => {
    const where = [`a.status = 'published'`];
    const params = [];
    if (req.query.category && CATEGORY_KEYS.includes(req.query.category)) {
      where.push('a.category = ?');
      params.push(req.query.category);
    }
    if (req.query.difficulty) {
      where.push('a.difficulty <= ?');
      params.push(int(req.query.difficulty, 5));
    }
    if (req.query.q) {
      where.push('(a.title LIKE ? OR a.summary LIKE ? OR a.location LIKE ?)');
      const kw = `%${str(req.query.q, 50)}%`;
      params.push(kw, kw, kw);
    }
    if (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) {
      where.push(`EXISTS (SELECT 1 FROM sessions s WHERE s.activity_id = a.id
                   AND s.status = 'open' AND substr(s.start_date,1,7) = ?)`);
      params.push(req.query.month);
    }
    const t = today();
    const rows = db.prepare(`
      SELECT a.id, a.title, a.category, a.summary, a.cover_url, a.location, a.duration_days,
             a.difficulty, a.price, a.sort_order,
             (SELECT MIN(s.start_date) FROM sessions s
               WHERE s.activity_id = a.id AND s.status = 'open' AND s.start_date > ?) AS next_date,
             (SELECT COUNT(*) FROM sessions s
               WHERE s.activity_id = a.id AND s.status = 'open' AND s.start_date > ?) AS open_sessions
      FROM activities a
      WHERE ${where.join(' AND ')}
      ORDER BY a.sort_order DESC, (next_date IS NULL), next_date, a.id DESC
    `).all(t, t, ...params);
    res.json({ items: rows });
  });

  r.get('/activities/:id', (req, res) => {
    const a = toActivity(db.prepare(`SELECT * FROM activities WHERE id = ? AND status = 'published'`)
      .get(int(req.params.id)));
    if (!a) throw new HttpError(404, '活动不存在或已下架');
    const sessions = listSessions(db, a.id, { upcomingOnly: true });
    const qa = db.prepare(`
      SELECT id, name, question, reply, created_at, replied_at FROM inquiries
      WHERE activity_id = ? AND is_public = 1 AND reply != '' ORDER BY replied_at DESC LIMIT 20
    `).all(a.id).map((q) => ({ ...q, name: q.name.slice(0, 1) + '**' }));
    res.json({ activity: a, sessions, qa });
  });

  // ---------- 报名 ----------
  r.post('/bookings', writeLimit, (req, res) => {
    const b = req.body || {};
    const sessionId = int(b.session_id);
    const contactName = str(b.contact_name, 30);
    const contactPhone = str(b.contact_phone, 20);
    const contactEmail = str(b.contact_email, 100);
    const remark = str(b.remark, 500);
    const participants = Array.isArray(b.participants) ? b.participants : [];

    if (!contactName) throw new HttpError(400, '请填写联系人姓名');
    if (!PHONE_RE.test(contactPhone)) throw new HttpError(400, '请填写正确的 11 位手机号');
    if (participants.length < 1) throw new HttpError(400, '至少需要 1 位参与者');
    if (participants.length > MAX_HEADCOUNT) throw new HttpError(400, `单次最多报名 ${MAX_HEADCOUNT} 人`);
    const people = participants.map((p, i) => {
      const person = {
        name: str(p && p.name, 30),
        gender: ['男', '女'].includes(p && p.gender) ? p.gender : '',
        phone: str(p && p.phone, 20),
        id_no: str(p && p.id_no, 30),
        emergency_contact: str(p && p.emergency_contact, 60),
      };
      if (!person.name) throw new HttpError(400, `请填写第 ${i + 1} 位参与者的姓名`);
      return person;
    });
    if (!b.agree) throw new HttpError(400, '请先阅读并同意《活动报名须知与免责声明》');

    const booking = tx(db, () => {
      // 在事务内重新计算余量，防止超卖
      const s = getSession(db, sessionId);
      if (!s) throw new HttpError(404, '档期不存在');
      const act = db.prepare(`SELECT id, status FROM activities WHERE id = ?`).get(s.activity_id);
      if (!act || act.status !== 'published') throw new HttpError(400, '该活动暂不可报名');
      if (!s.bookable) throw new HttpError(409, s.remaining <= 0 ? '该档期名额已满' : '该档期已停止报名');
      if (people.length > s.remaining) throw new HttpError(409, `名额不足，当前仅剩 ${s.remaining} 个名额`);

      const code = genCode('OB');
      const info = db.prepare(`
        INSERT INTO bookings (code, session_id, activity_id, contact_name, contact_phone, contact_email,
                              headcount, unit_price, total_price, remark)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(code, s.id, s.activity_id, contactName, contactPhone, contactEmail,
        people.length, s.price, s.price * people.length, remark);
      const ins = db.prepare(`
        INSERT INTO participants (booking_id, name, gender, phone, id_no, emergency_contact)
        VALUES (?,?,?,?,?,?)`);
      for (const p of people) ins.run(info.lastInsertRowid, p.name, p.gender, p.phone, p.id_no, p.emergency_contact);
      return { code, total_price: s.price * people.length, headcount: people.length };
    });

    res.status(201).json({ booking });
  });

  function findBooking(code, phone) {
    const row = db.prepare(`
      SELECT b.*, a.title AS activity_title, s.start_date, s.end_date, s.meeting_point, s.leader
      FROM bookings b JOIN activities a ON a.id = b.activity_id JOIN sessions s ON s.id = b.session_id
      WHERE b.code = ? AND b.contact_phone = ?
    `).get(str(code, 30).toUpperCase(), str(phone, 20));
    if (!row) throw new HttpError(404, '未找到报名记录，请核对报名编号与手机号');
    return row;
  }

  function publicBooking(row) {
    const participants = db.prepare(`SELECT name, gender, id_no FROM participants WHERE booking_id = ?`)
      .all(row.id).map((p) => ({ ...p, id_no: maskIdNo(p.id_no) }));
    const { id, admin_note, ...rest } = row;
    return { ...rest, participants, cancellable: canCancel(row) };
  }

  function canCancel(row) {
    return ['pending', 'confirmed'].includes(row.status) && row.start_date > today();
  }

  // 查询：按手机号列出全部报名，或按 编号+手机号 查看单条
  r.get('/bookings/lookup', writeLimit, (req, res) => {
    const phone = str(req.query.phone, 20);
    if (!PHONE_RE.test(phone)) throw new HttpError(400, '请输入正确的手机号');
    if (req.query.code) return res.json({ items: [publicBooking(findBooking(req.query.code, phone))] });
    throw new HttpError(400, '请输入报名编号');
  });

  r.post('/bookings/cancel', writeLimit, (req, res) => {
    const row = findBooking(req.body?.code, req.body?.phone);
    if (!canCancel(row)) throw new HttpError(400, '该报名当前状态不可取消，如有疑问请联系客服');
    db.prepare(`UPDATE bookings SET status = 'cancelled', updated_at = datetime('now','localtime'),
                remark = remark || ? WHERE id = ?`)
      .run(`\n[用户自助取消] ${str(req.body?.reason, 200)}`, row.id);
    res.json({ ok: true });
  });

  // ---------- 咨询 ----------
  r.post('/inquiries', writeLimit, (req, res) => {
    const b = req.body || {};
    const name = str(b.name, 30);
    const phone = str(b.phone, 20);
    const question = str(b.question, 1000);
    let activityId = b.activity_id ? int(b.activity_id) : null;
    if (!name) throw new HttpError(400, '请填写称呼');
    if (!PHONE_RE.test(phone)) throw new HttpError(400, '请填写正确的 11 位手机号');
    if (question.length < 5) throw new HttpError(400, '问题描述至少 5 个字');
    if (activityId && !db.prepare('SELECT 1 FROM activities WHERE id = ?').get(activityId)) activityId = null;
    const code = genCode('Q');
    db.prepare(`INSERT INTO inquiries (code, activity_id, name, phone, wechat, question) VALUES (?,?,?,?,?,?)`)
      .run(code, activityId, name, phone, str(b.wechat, 50), question);
    res.status(201).json({ inquiry: { code } });
  });

  r.get('/inquiries/lookup', writeLimit, (req, res) => {
    const phone = str(req.query.phone, 20);
    if (!PHONE_RE.test(phone)) throw new HttpError(400, '请输入正确的手机号');
    const code = str(req.query.code, 30).toUpperCase();
    if (!code) throw new HttpError(400, '请输入咨询编号');
    const row = db.prepare(`
      SELECT i.code, i.question, i.reply, i.status, i.created_at, i.replied_at, a.title AS activity_title
      FROM inquiries i LEFT JOIN activities a ON a.id = i.activity_id
      WHERE i.code = ? AND i.phone = ?`).get(code, phone);
    if (!row) throw new HttpError(404, '未找到咨询记录，请核对咨询编号与手机号');
    res.json({ items: [row] });
  });

  // 常见问题：公开的、非特定活动的问答
  r.get('/faq', (req, res) => {
    const items = db.prepare(`
      SELECT i.id, i.question, i.reply, i.replied_at, a.id AS activity_id, a.title AS activity_title
      FROM inquiries i LEFT JOIN activities a ON a.id = i.activity_id
      WHERE i.is_public = 1 AND i.reply != '' ORDER BY i.activity_id IS NOT NULL, i.replied_at DESC LIMIT 50
    `).all();
    res.json({ items });
  });

  return r;
};

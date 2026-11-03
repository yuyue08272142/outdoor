'use strict';
// 共享的查询与数据转换逻辑
const { parseJsonArray, today } = require('./util');

// 占用名额 = 待确认 + 已确认 的报名人数
const SESSION_SELECT = `
  SELECT s.*,
         COALESCE(s.price, a.price) AS effective_price,
         COALESCE((SELECT SUM(b.headcount) FROM bookings b
                   WHERE b.session_id = s.id AND b.status IN ('pending','confirmed')), 0) AS booked
  FROM sessions s JOIN activities a ON a.id = s.activity_id
`;

function toActivity(row) {
  if (!row) return null;
  return {
    ...row,
    highlights: parseJsonArray(row.highlights),
    itinerary: parseJsonArray(row.itinerary),
    includes: parseJsonArray(row.includes),
    excludes: parseJsonArray(row.excludes),
  };
}

function toSession(row) {
  if (!row) return null;
  const remaining = Math.max(0, row.capacity - row.booked);
  const started = row.start_date <= today();
  return {
    id: row.id,
    activity_id: row.activity_id,
    start_date: row.start_date,
    end_date: row.end_date,
    capacity: row.capacity,
    booked: row.booked,
    remaining,
    price: row.effective_price,
    custom_price: row.price,
    meeting_point: row.meeting_point,
    leader: row.leader,
    status: row.status,
    // 可报名：开放中、未开始、仍有名额
    bookable: row.status === 'open' && !started && remaining > 0,
  };
}

function getSession(db, id) {
  return toSession(db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(id));
}

function listSessions(db, activityId, { upcomingOnly = false } = {}) {
  const where = upcomingOnly ? `AND s.start_date > ? AND s.status != 'cancelled'` : '';
  const params = upcomingOnly ? [activityId, today()] : [activityId];
  return db
    .prepare(`${SESSION_SELECT} WHERE s.activity_id = ? ${where} ORDER BY s.start_date`)
    .all(...params)
    .map(toSession);
}

module.exports = { SESSION_SELECT, toActivity, toSession, getSession, listSessions };

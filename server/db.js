'use strict';
// 数据层：使用 Node.js 内置的 SQLite（node:sqlite），无需额外安装数据库。
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS activities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT    NOT NULL,
  category      TEXT    NOT NULL,              -- hiking / camping / climbing / cycling / water / family
  summary       TEXT    NOT NULL DEFAULT '',
  description   TEXT    NOT NULL DEFAULT '',
  cover_url     TEXT    NOT NULL DEFAULT '',
  location      TEXT    NOT NULL DEFAULT '',
  duration_days INTEGER NOT NULL DEFAULT 1,
  difficulty    INTEGER NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 5),
  price         INTEGER NOT NULL DEFAULT 0,    -- 单位：分
  min_age       INTEGER NOT NULL DEFAULT 0,
  highlights    TEXT    NOT NULL DEFAULT '[]', -- JSON: string[]
  itinerary     TEXT    NOT NULL DEFAULT '[]', -- JSON: {title, content}[]
  includes      TEXT    NOT NULL DEFAULT '[]', -- JSON: string[] 费用包含
  excludes      TEXT    NOT NULL DEFAULT '[]', -- JSON: string[] 费用不含
  notices       TEXT    NOT NULL DEFAULT '',   -- 注意事项 / 装备建议
  status        TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id   INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  start_date    TEXT    NOT NULL,              -- YYYY-MM-DD
  end_date      TEXT    NOT NULL,
  capacity      INTEGER NOT NULL CHECK (capacity > 0),
  price         INTEGER,                       -- 为空则使用活动价格
  meeting_point TEXT    NOT NULL DEFAULT '',
  leader        TEXT    NOT NULL DEFAULT '',   -- 领队
  status        TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_activity ON sessions(activity_id, start_date);

CREATE TABLE IF NOT EXISTS bookings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,       -- 报名编号，用户凭此查询
  session_id    INTEGER NOT NULL REFERENCES sessions(id),
  activity_id   INTEGER NOT NULL REFERENCES activities(id),
  contact_name  TEXT    NOT NULL,
  contact_phone TEXT    NOT NULL,
  contact_email TEXT    NOT NULL DEFAULT '',
  headcount     INTEGER NOT NULL CHECK (headcount > 0),
  unit_price    INTEGER NOT NULL,
  total_price   INTEGER NOT NULL,
  remark        TEXT    NOT NULL DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','confirmed','cancelled','completed')),
  admin_note    TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_session ON bookings(session_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings(contact_phone);

CREATE TABLE IF NOT EXISTS participants (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id        INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  name              TEXT    NOT NULL,
  gender            TEXT    NOT NULL DEFAULT '',
  phone             TEXT    NOT NULL DEFAULT '',
  id_no             TEXT    NOT NULL DEFAULT '',  -- 证件号（用于购买保险），对外接口脱敏
  emergency_contact TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS inquiries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,
  activity_id   INTEGER REFERENCES activities(id) ON DELETE SET NULL,
  name          TEXT    NOT NULL,
  phone         TEXT    NOT NULL,
  wechat        TEXT    NOT NULL DEFAULT '',
  question      TEXT    NOT NULL,
  reply         TEXT    NOT NULL DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','replied','closed')),
  is_public     INTEGER NOT NULL DEFAULT 0,     -- 1 = 作为公开问答展示
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  replied_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_inquiries_activity ON inquiries(activity_id, is_public);
`;

function openDb(file) {
  const target = file || process.env.DB_FILE || path.join(__dirname, '..', 'data', 'outdoor.db');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new DatabaseSync(target);
  db.exec('PRAGMA foreign_keys = ON;');
  if (target !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

/** 在事务中执行 fn，出错自动回滚 */
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDb, tx };

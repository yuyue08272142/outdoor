'use strict';
const crypto = require('node:crypto');

const CATEGORIES = [
  { key: 'hiking', name: '徒步', icon: '🥾' },
  { key: 'camping', name: '露营', icon: '⛺' },
  { key: 'climbing', name: '登山', icon: '🏔️' },
  { key: 'cycling', name: '骑行', icon: '🚴' },
  { key: 'water', name: '水上', icon: '🛶' },
  { key: 'family', name: '亲子', icon: '👨‍👩‍👧' },
];
const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

const DIFFICULTIES = [
  { level: 1, name: '休闲', desc: '无需经验，适合所有人' },
  { level: 2, name: '入门', desc: '日常有一定运动习惯即可' },
  { level: 3, name: '进阶', desc: '需要一定户外经验与体能' },
  { level: 4, name: '挑战', desc: '需要良好体能与相关经验' },
  { level: 5, name: '专业', desc: '需要专业技能与装备' },
];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const PHONE_RE = /^1\d{10}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 生成形如 OB2611031A2B3C 的编号 */
function genCode(prefix) {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return prefix + ymd + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function str(v, max = 2000) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}

function int(v, def = 0) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function parseJsonArray(text) {
  try {
    const v = JSON.parse(text || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function maskIdNo(id) {
  if (!id) return '';
  if (id.length <= 6) return '*'.repeat(id.length);
  return id.slice(0, 3) + '*'.repeat(id.length - 7) + id.slice(-4);
}

function maskPhone(p) {
  return p && p.length === 11 ? `${p.slice(0, 3)}****${p.slice(7)}` : p;
}

/** 简单的内存级限流：每个 IP 在 windowMs 内最多 max 次 */
function rateLimit({ windowMs = 60_000, max = 10 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      return res.status(429).json({ error: '操作太频繁，请稍后再试' });
    }
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 10_000) hits.clear();
    next();
  };
}

module.exports = {
  CATEGORIES,
  CATEGORY_KEYS,
  DIFFICULTIES,
  HttpError,
  PHONE_RE,
  DATE_RE,
  genCode,
  today,
  str,
  int,
  parseJsonArray,
  maskIdNo,
  maskPhone,
  rateLimit,
};

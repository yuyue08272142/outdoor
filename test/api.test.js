'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const { createApp } = require('../server/app');
const { seed } = require('../server/seed');

let server;
let base;

test.before(async () => {
  const db = openDb(':memory:');
  seed(db);
  server = createApp(db, { adminPassword: 'test-pass', writeRateLimit: 1000 }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function login() {
  const { data } = await call('/admin/login', { method: 'POST', body: { password: 'test-pass' } });
  return data.token;
}

test('活动列表与详情', async () => {
  const list = await call('/activities');
  assert.equal(list.status, 200);
  assert.ok(list.data.items.length >= 6);
  const camping = await call('/activities?category=camping');
  assert.ok(camping.data.items.every((a) => a.category === 'camping'));
  const detail = await call(`/activities/${list.data.items[0].id}`);
  assert.equal(detail.status, 200);
  assert.ok(Array.isArray(detail.data.activity.itinerary));
  assert.ok(detail.data.sessions.length > 0);
  assert.equal((await call('/activities/99999')).status, 404);
});

test('报名：校验、扣减余量、查询、取消', async () => {
  const { data } = await call('/activities/1');
  const s = data.sessions[0];
  const base0 = { session_id: s.id, contact_name: '张三', contact_phone: '13912345678', agree: true };

  const bad = await call('/bookings', { method: 'POST', body: { ...base0, contact_phone: '123', participants: [{ name: 'a' }] } });
  assert.equal(bad.status, 400);
  const noAgree = await call('/bookings', { method: 'POST', body: { ...base0, agree: false, participants: [{ name: 'a' }] } });
  assert.equal(noAgree.status, 400);

  const ok = await call('/bookings', {
    method: 'POST',
    body: { ...base0, participants: [{ name: '张三', id_no: '110101199001011234' }, { name: '李四' }] },
  });
  assert.equal(ok.status, 201);
  assert.match(ok.data.booking.code, /^OB\d{6}[0-9A-F]{6}$/);
  assert.equal(ok.data.booking.total_price, s.price * 2);

  const after = await call('/activities/1');
  assert.equal(after.data.sessions[0].remaining, s.remaining - 2);

  const wrongPhone = await call(`/bookings/lookup?code=${ok.data.booking.code}&phone=13900000000`);
  assert.equal(wrongPhone.status, 404);
  const look = await call(`/bookings/lookup?code=${ok.data.booking.code}&phone=13912345678`);
  assert.equal(look.status, 200);
  const b = look.data.items[0];
  assert.equal(b.participants[0].id_no, '110***********1234', '证件号需脱敏');
  assert.equal(b.admin_note, undefined, '不应暴露后台备注');
  assert.equal(b.cancellable, true);

  const cancel = await call('/bookings/cancel', { method: 'POST', body: { code: b.code, phone: '13912345678' } });
  assert.equal(cancel.status, 200);
  const restored = await call('/activities/1');
  assert.equal(restored.data.sessions[0].remaining, s.remaining);
  const again = await call('/bookings/cancel', { method: 'POST', body: { code: b.code, phone: '13912345678' } });
  assert.equal(again.status, 400);
});

test('报名：不能超过剩余名额', async () => {
  const token = await login();
  const { data } = await call('/admin/activities/2', { token });
  const created = await call('/admin/activities/2/sessions', {
    method: 'POST', token, body: { start_date: '2099-01-01', capacity: 2 },
  });
  assert.equal(created.status, 201);
  const sid = created.data.id;
  const people = (n) => Array.from({ length: n }, (_, i) => ({ name: `p${i}` }));
  const body = { session_id: sid, contact_name: '王五', contact_phone: '13700000000', agree: true };
  assert.equal((await call('/bookings', { method: 'POST', body: { ...body, participants: people(3) } })).status, 409);
  assert.equal((await call('/bookings', { method: 'POST', body: { ...body, participants: people(2) } })).status, 201);
  const full = await call('/bookings', { method: 'POST', body: { ...body, participants: people(1) } });
  assert.equal(full.status, 409);
  assert.match(full.data.error, /名额已满/);
  assert.ok(data.activity.title);
});

test('咨询：提交、后台回复、公开展示、用户查询', async () => {
  const sub = await call('/inquiries', {
    method: 'POST', body: { name: '小明', phone: '13811112222', question: '需要自带睡袋吗？', activity_id: 2 },
  });
  assert.equal(sub.status, 201);
  const code = sub.data.inquiry.code;

  const pending = await call(`/inquiries/lookup?code=${code}&phone=13811112222`);
  assert.equal(pending.data.items[0].status, 'open');

  const token = await login();
  const list = await call('/admin/inquiries?status=open', { token });
  const item = list.data.items.find((i) => i.code === code);
  assert.ok(item);

  const noReplyPublic = await call(`/admin/inquiries/${item.id}`, { method: 'PATCH', token, body: { is_public: true } });
  assert.equal(noReplyPublic.status, 400);
  const reply = await call(`/admin/inquiries/${item.id}`, { method: 'PATCH', token, body: { reply: '营地提供睡袋，无需自带。', is_public: true } });
  assert.equal(reply.status, 200);

  const done = await call(`/inquiries/lookup?code=${code}&phone=13811112222`);
  assert.equal(done.data.items[0].status, 'replied');
  assert.equal(done.data.items[0].reply, '营地提供睡袋，无需自带。');

  const detail = await call('/activities/2');
  const qa = detail.data.qa.find((q) => q.question === '需要自带睡袋吗？');
  assert.ok(qa, '公开问答应展示在活动页');
  assert.equal(qa.name, '小**', '提问人姓名需脱敏');
  assert.equal(qa.phone, undefined);
});

test('后台：鉴权、活动 CRUD、报名状态流转、CSV 导出', async () => {
  assert.equal((await call('/admin/stats')).status, 401);
  assert.equal((await call('/admin/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);
  const token = await login();

  const created = await call('/admin/activities', {
    method: 'POST', token,
    body: { title: '测试活动', category: 'hiking', price_yuan: '99.5', highlights: 'a\nb', itinerary: [{ title: 'D1', content: 'x' }], status: 'published' },
  });
  assert.equal(created.status, 201);
  const id = created.data.id;
  const got = await call(`/admin/activities/${id}`, { token });
  assert.equal(got.data.activity.price, 9950);
  assert.deepEqual(got.data.activity.highlights, ['a', 'b']);
  assert.equal((await call('/admin/activities', { method: 'POST', token, body: { title: 'x', category: 'nope' } })).status, 400);

  const sess = await call(`/admin/activities/${id}/sessions`, { method: 'POST', token, body: { start_date: '2099-05-01', capacity: 5, price_yuan: '' } });
  const bk = await call('/bookings', {
    method: 'POST',
    body: { session_id: sess.data.id, contact_name: '=cmd', contact_phone: '13600000000', agree: true, participants: [{ name: '赵六' }] },
  });
  assert.equal(bk.status, 201);
  assert.equal(bk.data.booking.total_price, 9950);

  // 已有报名的活动/档期不能删除，名额不能低于已报名人数
  assert.equal((await call(`/admin/activities/${id}`, { method: 'DELETE', token })).status, 409);
  assert.equal((await call(`/admin/sessions/${sess.data.id}`, { method: 'DELETE', token })).status, 409);
  assert.equal((await call(`/admin/sessions/${sess.data.id}`, { method: 'PUT', token, body: { start_date: '2099-05-01', capacity: 0 } })).status, 400);

  const bookings = await call(`/admin/bookings?activity_id=${id}`, { token });
  const bid = bookings.data.items[0].id;
  assert.equal((await call(`/admin/bookings/${bid}`, { method: 'PATCH', token, body: { status: 'confirmed', admin_note: '已付款' } })).status, 200);
  const detail = await call(`/admin/bookings/${bid}`, { token });
  assert.equal(detail.data.booking.status, 'confirmed');
  assert.equal(detail.data.booking.admin_note, '已付款');

  const csv = await call(`/admin/bookings.csv?activity_id=${id}`, { token });
  assert.equal(csv.status, 200);
  assert.match(csv.data, /测试活动/);
  assert.match(csv.data, /'=cmd/, 'CSV 需防公式注入');

  const stats = await call('/admin/stats', { token });
  assert.ok(stats.data.activities_published >= 7);
});

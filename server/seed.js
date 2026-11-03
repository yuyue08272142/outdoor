'use strict';
// 示例数据：首次启动且数据库为空时自动写入；`npm run seed` 可清空重建。
const { openDb, tx } = require('./db');

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ACTIVITIES = [
  {
    title: '武功山高山草甸 2 日徒步', category: 'hiking', location: '江西 · 萍乡', duration_days: 2, difficulty: 3,
    price: 69900, min_age: 14, sort_order: 10,
    summary: '穿越云海之上的万亩高山草甸，夜宿山顶看日出，适合有一定徒步基础的伙伴。',
    description: '武功山以高山草甸闻名，金顶海拔 1918 米。本线路从龙山村上山，沿经典东线穿越吊马桩、发云界，夜宿金顶附近营地/客栈，第二天看日出后下撤。\n\n全程约 25 公里，累计爬升约 1500 米。我们采用 1:8 的领队配比，配备专业领队与收队，确保每一位伙伴的安全与体验。',
    highlights: ['万亩高山草甸，秋季金黄成片', '山顶观日出、云海', '1:8 小团领队配比', '含户外意外险'],
    itinerary: [
      { title: 'D1 龙山村 → 吊马桩 → 金顶', content: '早上集合乘车至龙山村，开始登山。午餐路餐，下午穿越草甸至金顶附近住宿。徒步约 15 公里。' },
      { title: 'D2 金顶日出 → 沈子村下撤', content: '早起观日出，早餐后沿沈子村方向下撤，午后乘车返程。徒步约 10 公里。' },
    ],
    includes: ['往返大巴交通', '1 晚住宿（多人间/帐篷）', '领队服务费', '户外意外险'],
    excludes: ['行程中的餐饮', '个人装备', '个人消费'],
    notices: '装备建议：登山鞋、登山杖、冲锋衣、头灯、2L 以上饮用水。\n有心脏病、高血压等不适宜剧烈运动的疾病者请勿报名。\n如遇恶劣天气，领队有权调整或取消行程。',
    sessions: [[10, 11, 20], [24, 25, 20], [38, 39, 16]],
  },
  {
    title: '湖畔星空露营 · 周末轻奢', category: 'camping', location: '浙江 · 千岛湖', duration_days: 2, difficulty: 1,
    price: 89900, min_age: 0, sort_order: 9,
    summary: '拎包入住的湖畔营地，帐篷、睡袋、烧烤、咖啡全都备好，只需带上好心情。',
    description: '营地位于湖畔草坪，提供充气床垫帐篷、天幕和全套炊具。傍晚有烧烤晚餐，夜晚由领队带大家认识星座，第二天清晨可选湖边桨板体验。\n\n适合第一次露营的朋友、情侣及家庭。',
    highlights: ['拎包入住，装备全包', '湖畔烧烤晚宴', '星空讲解', '清晨桨板体验'],
    itinerary: [
      { title: 'D1 抵达营地', content: '下午抵达营地，领取帐篷，自由活动；傍晚烧烤晚宴，夜间星空讲解。' },
      { title: 'D2 晨间桨板 & 返程', content: '早餐后可选桨板体验，11:00 拔营，结束愉快的周末。' },
    ],
    includes: ['帐篷/睡袋/防潮垫', '1 次晚餐 + 1 次早餐', '桨板体验', '保险'],
    excludes: ['往返营地交通', '酒水'],
    notices: '营地夜间温差较大，请携带保暖外套。\n儿童需由监护人全程陪同。',
    sessions: [[5, 6, 30], [12, 13, 30], [19, 20, 30], [26, 27, 30]],
  },
  {
    title: '四姑娘山二峰 5276m 攀登', category: 'climbing', location: '四川 · 阿坝', duration_days: 4, difficulty: 5,
    price: 389900, min_age: 18, sort_order: 8,
    summary: '入门级雪山攀登，专业高山向导 1:2 配比，带你完成人生第一座 5000 米雪山。',
    description: '二峰是很多人的雪山入门之选。行程包含适应性训练、大本营休整与冲顶，全程由持证高山向导带队，提供冰爪、安全带等技术装备。\n\n报名需提交体检报告，并有 3 次以上高海拔徒步经验。',
    highlights: ['专业高山向导 1:2', '含技术装备租用', '行前体能训练指导', '冲顶证书'],
    itinerary: [
      { title: 'D1 成都 → 日隆镇', content: '乘车前往日隆镇（3200m），适应海拔，装备检查。' },
      { title: 'D2 日隆 → 大本营', content: '徒步至大本营（4400m），学习冰爪、安全带使用。' },
      { title: 'D3 冲顶日', content: '凌晨出发冲顶，登顶后下撤至大本营。' },
      { title: 'D4 下撤返程', content: '下撤至日隆镇，乘车返回成都。' },
    ],
    includes: ['成都往返交通', '3 晚住宿', '行程内餐食', '高山向导', '技术装备', '高海拔保险'],
    excludes: ['个人服装与登山鞋', '马匹（可选）'],
    notices: '需提交近 3 个月体检报告。\n出发前两周开始进行有氧训练。\n若向导判断身体状况不适合冲顶，须服从安排。',
    sessions: [[30, 33, 8], [58, 61, 8]],
  },
  {
    title: '环湖骑行 60km · 城市周末', category: 'cycling', location: '云南 · 大理', duration_days: 1, difficulty: 2,
    price: 29900, min_age: 12, sort_order: 6,
    summary: '洱海西岸生态廊道骑行，沿途村落、湿地与咖啡，节奏轻松。',
    description: '提供公路车/山地车租赁和头盔，配有保障车跟随。全程约 60 公里，以平路为主，途中安排三次休息补给。',
    highlights: ['生态廊道全程平坦', '保障车跟随', '含自行车与头盔', '沿途咖啡补给'],
    itinerary: [{ title: '全天行程', content: '08:30 集合 → 才村 → 喜洲（午餐）→ 双廊方向折返，约 17:00 结束。' }],
    includes: ['自行车与头盔', '保障车', '领骑', '保险'],
    excludes: ['午餐', '个人消费'],
    notices: '高原紫外线强，请做好防晒。\n需会骑自行车并能连续骑行 1 小时以上。',
    sessions: [[3, 3, 15], [7, 7, 15], [14, 14, 15], [21, 21, 15]],
  },
  {
    title: '溪谷皮划艇入门体验', category: 'water', location: '广东 · 清远', duration_days: 1, difficulty: 2,
    price: 39900, min_age: 10, sort_order: 5,
    summary: '教练一对一教学，2 小时陆上 + 水上课程后，顺流而下探索溪谷。',
    description: '课程分为陆上安全讲解、平水练习和顺流巡游三个部分，全程配救生衣与头盔，教练持救生员资质。',
    highlights: ['持证教练教学', '全套安全装备', '适合零基础'],
    itinerary: [{ title: '全天行程', content: '09:30 签到 → 安全讲解 → 平水练习 → 午餐 → 顺流巡游 → 16:00 结束。' }],
    includes: ['皮划艇及安全装备', '教练费', '午餐', '保险'],
    excludes: ['往返交通'],
    notices: '请携带一套换洗衣物、拖鞋。\n不会游泳也可参加，但需全程穿着救生衣。',
    sessions: [[6, 6, 12], [13, 13, 12], [20, 20, 12]],
  },
  {
    title: '森林自然课 · 亲子半日营', category: 'family', location: '北京 · 西山', duration_days: 1, difficulty: 1,
    price: 19900, min_age: 4, sort_order: 7,
    summary: '自然导师带孩子认识植物与昆虫，做一份属于自己的自然笔记。',
    description: '以“观察—记录—分享”为主线的半日自然课。孩子们将在导师的带领下完成树叶拓印、昆虫观察和自然笔记，家长全程陪同参与。\n\n价格为 1 大 1 小 /组，报名人数请按组计算。',
    highlights: ['专业自然导师', '小班 10 组以内', '赠送自然笔记本'],
    itinerary: [{ title: '半日行程', content: '09:00 集合 → 森林观察 → 树叶拓印 → 自然笔记分享 → 12:00 结束。' }],
    includes: ['导师费', '活动材料', '保险'],
    excludes: ['交通', '餐饮'],
    notices: '请为孩子穿着长袖长裤与运动鞋，做好防蚊。',
    sessions: [[4, 4, 10], [11, 11, 10], [18, 18, 10]],
  },
];

const FAQ = [
  ['小林', '第一次参加户外活动，体能一般，应该选什么难度？', '建议从难度 1~2（休闲/入门）的活动开始，例如露营、骑行或亲子活动。每个活动详情页都标注了难度说明，也可以直接在线咨询我们帮你推荐。', null],
  ['阿杰', '报名后如何付款？可以退款吗？', '提交报名后客服会在 24 小时内电话确认并发送付款方式。活动开始 7 天前取消可全额退款，3~7 天前取消退 50%，3 天内取消不退款（可转让名额）。', null],
  ['Momo', '活动会买保险吗？', '所有活动均包含户外意外险，报名时请填写参与者的证件号用于投保，我们会对证件信息加密保管。', null],
  ['大山', '金顶住宿是帐篷还是客栈？', '默认为客栈多人间，旺季若客栈满员会安排营地帐篷（含睡袋和防潮垫），均为领队统一安排。', 0],
];

function seed(db) {
  tx(db, () => {
    const insA = db.prepare(`INSERT INTO activities (title, category, summary, description, location, duration_days, difficulty,
      price, min_age, highlights, itinerary, includes, excludes, notices, status, sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'published',?)`);
    const insS = db.prepare(`INSERT INTO sessions (activity_id, start_date, end_date, capacity, meeting_point, leader)
      VALUES (?,?,?,?,?,?)`);
    const ids = [];
    for (const a of ACTIVITIES) {
      const { lastInsertRowid: id } = insA.run(a.title, a.category, a.summary, a.description, a.location, a.duration_days,
        a.difficulty, a.price, a.min_age, JSON.stringify(a.highlights), JSON.stringify(a.itinerary),
        JSON.stringify(a.includes), JSON.stringify(a.excludes), a.notices, a.sort_order);
      ids.push(id);
      for (const [s, e, cap] of a.sessions) insS.run(id, addDays(s), addDays(e), cap, '出发前一天群内通知', '阿山');
    }
    const insQ = db.prepare(`INSERT INTO inquiries (code, activity_id, name, phone, question, reply, status, is_public, replied_at)
      VALUES (?,?,?,?,?,?,'replied',1,datetime('now','localtime'))`);
    FAQ.forEach(([name, q, reply, idx], i) => {
      insQ.run(`QSEED${i}`, idx === null ? null : ids[idx], name, '13800000000', q, reply);
    });
  });
}

function seedIfEmpty(db) {
  if (!db.prepare('SELECT 1 FROM activities LIMIT 1').get()) {
    seed(db);
    console.log('已写入示例数据');
  }
}

if (require.main === module) {
  const db = openDb();
  if (process.argv.includes('--reset')) {
    db.exec('DELETE FROM participants; DELETE FROM bookings; DELETE FROM inquiries; DELETE FROM sessions; DELETE FROM activities;');
  }
  seedIfEmpty(db);
}

module.exports = { seed, seedIfEmpty };

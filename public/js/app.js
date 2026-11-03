/* 用户端单页应用：hash 路由 + 原生 JS，无需构建 */
(() => {
  'use strict';

  // ---------- 工具 ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const app = $('#app');

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yuan = (cents) => (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const paras = (text) => esc(text).split(/\n{2,}|\n/).filter(Boolean).map((p) => `<p>${p}</p>`).join('');
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  const fmtDate = (d) => { const dt = new Date(`${d}T00:00:00`); return `${dt.getMonth() + 1}月${dt.getDate()}日 周${WEEK[dt.getDay()]}`; };
  const dateRange = (s, e) => (s === e ? fmtDate(s) : `${fmtDate(s)} - ${fmtDate(e)}`);
  const STATUS_TEXT = { pending: '待确认', confirmed: '已确认', cancelled: '已取消', completed: '已完成', open: '待回复', replied: '已回复', closed: '已关闭' };
  const badge = (s) => `<span class="badge badge-${esc(s)}">${STATUS_TEXT[s] || esc(s)}</span>`;

  async function api(path, opts = {}) {
    const res = await fetch(`/api${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
    return data;
  }

  let toastTimer;
  function toast(msg, isError = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast show${isError ? ' error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 2800);
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  // 记住用户填写过的手机号，方便查询
  const store = {
    get(k) { try { return localStorage.getItem(`outdoor:${k}`) || ''; } catch { return ''; } },
    set(k, v) { try { localStorage.setItem(`outdoor:${k}`, v); } catch { /* ignore */ } },
  };

  // ---------- 元数据 ----------
  let META = { categories: [], difficulties: [], site: {} };
  const cat = (key) => META.categories.find((c) => c.key === key) || { name: key, icon: '🌲' };
  const diffDots = (n) => `<span class="diff" title="难度 ${n}/5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
  const diffName = (n) => (META.difficulties.find((d) => d.level === n) || {}).name || '';

  function cover(a, extraClass = '') {
    const c = cat(a.category);
    const style = a.cover_url ? ` style="background-image:url('${esc(encodeURI(a.cover_url).replace(/'/g, '%27'))}')"` : '';
    return `<div class="cover cover-${esc(a.category)} ${extraClass}"${style}>
      ${a.cover_url ? '' : `<span aria-hidden="true">${c.icon}</span>`}
      <span class="tag">${esc(c.name)}</span></div>`;
  }

  function activityCard(a) {
    return `<a class="card act-card" href="#/activity/${a.id}">
      ${cover(a)}
      <div class="act-body">
        <h3>${esc(a.title)}</h3>
        <div class="act-meta"><span>📍 ${esc(a.location)}</span><span>🕒 ${a.duration_days} 天</span><span>${diffDots(a.difficulty)} ${esc(diffName(a.difficulty))}</span></div>
        <p class="muted small" style="margin:0">${esc(a.summary)}</p>
        <div class="act-foot">
          <span class="small muted">${a.next_date ? `最近出发 ${fmtDate(a.next_date)}` : '暂无可报名档期'}</span>
          <span class="price">¥${yuan(a.price)}<small> 起/人</small></span>
        </div>
      </div></a>`;
  }

  // ---------- 页面 ----------
  async function pageHome() {
    const { items } = await api('/activities');
    const featured = items.slice(0, 6);
    app.innerHTML = `
      <section class="hero"><div class="container">
        <h1>${esc(META.site.slogan || '走进山野')}</h1>
        <p>精选徒步、露营、登山、骑行等户外活动，专业领队带队，小团出行，在线报名、实时余位、有问必答。</p>
        <form class="hero-search" id="heroSearch">
          <input name="q" placeholder="搜索目的地或活动，例如：露营、武功山" aria-label="搜索活动">
          <button class="btn btn-primary">搜索</button>
        </form>
        <div class="hero-stats">
          <div><b>${items.length}</b><span>条精选线路</span></div>
          <div><b>${items.reduce((n, a) => n + a.open_sessions, 0)}</b><span>个可报名档期</span></div>
          <div><b>1:8</b><span>领队配比</span></div>
        </div>
      </div></section>

      <section class="section"><div class="container">
        <div class="section-head"><h2>按类型探索</h2></div>
        <div class="cat-grid">
          ${META.categories.map((c) => `<a class="cat-item" href="#/activities?category=${c.key}"><span class="ic">${c.icon}</span>${esc(c.name)}</a>`).join('')}
        </div>
      </div></section>

      <section class="section" style="padding-top:0"><div class="container">
        <div class="section-head"><h2>近期热门活动</h2><a href="#/activities">查看全部 →</a></div>
        <div class="grid">${featured.map(activityCard).join('') || '<div class="empty">暂无活动</div>'}</div>
      </div></section>

      <section class="section" style="padding-top:0"><div class="container">
        <div class="section-head"><h2>为什么选择我们</h2></div>
        <div class="features">
          <div class="card feature"><div class="ic">🧭</div><h3>专业领队</h3><p>持证领队与收队，熟悉线路，全程安全保障。</p></div>
          <div class="card feature"><div class="ic">👥</div><h3>小团出行</h3><p>严格控制人数，体验更好，照顾到每一位伙伴。</p></div>
          <div class="card feature"><div class="ic">🛡️</div><h3>保险保障</h3><p>所有活动均含户外意外险，安心出发。</p></div>
          <div class="card feature"><div class="ic">💬</div><h3>有问必答</h3><p>在线咨询，工作时间内快速回复。</p></div>
        </div>
      </div></section>

      <section class="section" style="padding-top:0"><div class="container">
        <div class="section-head"><h2>报名流程</h2></div>
        <div class="steps">
          <div class="card step"><h3>选择活动与档期</h3><p>查看行程、难度与余位，选择合适的日期。</p></div>
          <div class="card step"><h3>在线提交报名</h3><p>填写联系人与参与者信息，获得报名编号。</p></div>
          <div class="card step"><h3>客服确认</h3><p>24 小时内电话确认并告知付款方式。</p></div>
          <div class="card step"><h3>出发！</h3><p>出发前一天收到集合通知，准时集合。</p></div>
        </div>
      </div></section>`;
    $('#heroSearch').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = e.target.q.value.trim();
      location.hash = `#/activities${q ? `?q=${encodeURIComponent(q)}` : ''}`;
    });
  }

  async function pageActivities(params) {
    const q = new URLSearchParams(params);
    const months = [];
    const now = new Date();
    for (let i = 0; i < 4; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const setParam = (k, v) => {
      const p = new URLSearchParams(q);
      if (v) p.set(k, v); else p.delete(k);
      const s = p.toString();
      location.hash = `#/activities${s ? `?${s}` : ''}`;
    };

    app.innerHTML = `<div class="container section">
      <div class="section-head"><h2>全部活动</h2></div>
      <div class="filters">
        <button class="chip ${!q.get('category') ? 'active' : ''}" data-cat="">全部</button>
        ${META.categories.map((c) => `<button class="chip ${q.get('category') === c.key ? 'active' : ''}" data-cat="${c.key}">${c.icon} ${esc(c.name)}</button>`).join('')}
        <select id="fDiff" aria-label="难度">
          <option value="">不限难度</option>
          ${META.difficulties.map((d) => `<option value="${d.level}" ${q.get('difficulty') === String(d.level) ? 'selected' : ''}>难度 ≤ ${d.level} ${esc(d.name)}</option>`).join('')}
        </select>
        <select id="fMonth" aria-label="出发月份">
          <option value="">不限月份</option>
          ${months.map((m) => `<option value="${m}" ${q.get('month') === m ? 'selected' : ''}>${Number(m.slice(5))} 月出发</option>`).join('')}
        </select>
        <form id="fSearch" style="display:flex;gap:6px"><input name="q" placeholder="搜索" value="${esc(q.get('q') || '')}"></form>
      </div>
      <div class="grid" id="list"><div class="loading">加载中…</div></div>
    </div>`;

    $$('.chip[data-cat]').forEach((b) => b.addEventListener('click', () => setParam('category', b.dataset.cat)));
    $('#fDiff').addEventListener('change', (e) => setParam('difficulty', e.target.value));
    $('#fMonth').addEventListener('change', (e) => setParam('month', e.target.value));
    $('#fSearch').addEventListener('submit', (e) => { e.preventDefault(); setParam('q', e.target.q.value.trim()); });

    const { items } = await api(`/activities?${q.toString()}`);
    $('#list').innerHTML = items.length
      ? items.map(activityCard).join('')
      : `<div class="empty" style="grid-column:1/-1">没有找到符合条件的活动，<a href="#/contact">告诉我们你想去哪里</a></div>`;
  }

  async function pageActivity(id) {
    const { activity: a, sessions, qa } = await api(`/activities/${encodeURIComponent(id)}`);
    document.title = `${a.title} · ${META.site.name}`;
    const firstBookable = sessions.find((s) => s.bookable);
    let selected = firstBookable ? firstBookable.id : null;

    app.innerHTML = `<div class="container">
      <div class="detail-hero">${cover(a)}</div>
      <div class="detail">
        <div>
          <p class="small muted" style="margin:0"><a href="#/activities">全部活动</a> / <a href="#/activities?category=${esc(a.category)}">${esc(cat(a.category).name)}</a></p>
          <h1>${esc(a.title)}</h1>
          <p class="muted">${esc(a.summary)}</p>
          <div class="facts">
            <div class="fact"><b>${esc(a.location) || '-'}</b><span>目的地</span></div>
            <div class="fact"><b>${a.duration_days} 天</b><span>行程天数</span></div>
            <div class="fact"><b>${diffDots(a.difficulty)}</b><span>难度 · ${esc(diffName(a.difficulty))}</span></div>
            <div class="fact"><b>${a.min_age ? `${a.min_age} 岁+` : '不限'}</b><span>年龄要求</span></div>
          </div>
          ${a.highlights.length ? `<div class="block"><h2>活动亮点</h2><ul class="ticks">${a.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
          <div class="block prose"><h2>活动介绍</h2>${paras(a.description)}</div>
          ${a.itinerary.length ? `<div class="block"><h2>行程安排</h2><div class="timeline">
            ${a.itinerary.map((d) => `<div class="tl-item"><h3>${esc(d.title)}</h3><p>${esc(d.content)}</p></div>`).join('')}</div></div>` : ''}
          ${a.includes.length || a.excludes.length ? `<div class="block"><h2>费用说明</h2><div class="two-col">
            <div><h3 style="font-size:15px">费用包含</h3><ul class="ticks">${a.includes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
            <div><h3 style="font-size:15px">费用不含</h3><ul class="ticks cross">${a.excludes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
          </div></div>` : ''}
          ${a.notices ? `<div class="block prose"><h2>注意事项</h2>${paras(a.notices)}</div>` : ''}
          <div class="block"><h2>问答</h2>
            ${qa.length ? qa.map((x) => `<div class="qa-item"><div class="qa-q">${esc(x.question)}</div><div class="qa-a">${esc(x.reply)}</div></div>`).join('') : '<p class="muted">还没有人提问，来问第一个问题吧。</p>'}
            <form id="askForm" style="margin-top:16px">
              <div class="row">
                <div class="field"><label>称呼 <span class="req">*</span></label><input name="name" required maxlength="30"></div>
                <div class="field"><label>手机号 <span class="req">*</span></label><input name="phone" required pattern="1\\d{10}" inputmode="numeric" maxlength="11" value="${esc(store.get('phone'))}"></div>
              </div>
              <div class="field"><label>你的问题 <span class="req">*</span></label><textarea name="question" required minlength="5" maxlength="1000" placeholder="关于行程、装备、体能要求等任何问题"></textarea></div>
              <button class="btn btn-green">提交咨询</button>
            </form>
          </div>
        </div>
        <aside class="card booking-box">
          <div class="price">¥${yuan(a.price)}<small> 起/人</small></div>
          <h3 style="margin:12px 0 0;font-size:16px">选择出发日期</h3>
          <div class="session-list" id="sessions">
            ${sessions.length ? sessions.map((s) => `
              <button type="button" class="session ${s.id === selected ? 'selected' : ''}" data-id="${s.id}" ${s.bookable ? '' : 'disabled'}>
                <span><span class="date">${dateRange(s.start_date, s.end_date)}</span><br>
                  <span class="left ${s.remaining > 0 && s.remaining <= 3 ? 'hot' : ''}">${s.status !== 'open' ? '已停止报名' : s.remaining > 0 ? `余 ${s.remaining} / ${s.capacity} 位` : '已满员'}</span></span>
                <b>¥${yuan(s.price)}</b>
              </button>`).join('') : '<p class="muted small">暂无可报名档期，可以先咨询我们了解后续安排。</p>'}
          </div>
          <button class="btn btn-primary btn-block" id="bookBtn" ${selected ? '' : 'disabled'}>立即报名</button>
          <a class="btn btn-ghost btn-block" style="margin-top:8px" href="#askForm" id="askLink">我有疑问</a>
          <p class="small muted" style="margin:12px 0 0">提交报名后无需立即付款，客服将在 24 小时内与你电话确认。</p>
        </aside>
      </div></div>
      <div class="mobile-cta"><span class="price">¥${yuan(a.price)}<small> 起/人</small></span>
        <button class="btn btn-primary" id="mobileBook">${sessions.some((s) => s.bookable) ? '选择日期报名' : '咨询档期'}</button></div>`;

    $$('#sessions .session').forEach((el) => el.addEventListener('click', () => {
      selected = Number(el.dataset.id);
      $$('#sessions .session').forEach((x) => x.classList.toggle('selected', x === el));
      $('#bookBtn').disabled = false;
    }));
    $('#bookBtn').addEventListener('click', () => { location.hash = `#/book/${a.id}?session=${selected}`; });
    $('#askLink').addEventListener('click', (e) => { e.preventDefault(); $('#askForm').scrollIntoView({ behavior: 'smooth' }); $('#askForm [name=name]').focus(); });
    $('#askForm').addEventListener('submit', (e) => submitInquiry(e, a.id));
    $('#mobileBook').addEventListener('click', () => {
      const target = sessions.some((s) => s.bookable) ? '.booking-box' : '#askForm';
      $(target).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  async function submitInquiry(e, activityId) {
    e.preventDefault();
    const form = e.target;
    const btn = $('button', form);
    btn.disabled = true;
    try {
      const body = { ...formData(form), activity_id: activityId || null };
      const { inquiry } = await api('/inquiries', { method: 'POST', body });
      store.set('phone', body.phone);
      store.set('inquiry', inquiry.code);
      form.outerHTML = `<div class="panel" style="text-align:center;box-shadow:none;background:var(--green-100)">
        <p style="margin:0">✅ 咨询已提交，我们会尽快回复。</p>
        <p style="margin:6px 0">咨询编号：<b class="code-box" style="font-size:16px;padding:4px 10px;margin:0">${esc(inquiry.code)}</b></p>
        <p class="small muted" style="margin:0">可在「<a href="#/my?tab=inquiry">我的报名 → 咨询记录</a>」中凭编号与手机号查看回复。</p></div>`;
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  }

  async function pageBook(id, params) {
    const { activity: a, sessions } = await api(`/activities/${encodeURIComponent(id)}`);
    const sid = Number(new URLSearchParams(params).get('session'));
    const s = sessions.find((x) => x.id === sid);
    if (!s || !s.bookable) {
      app.innerHTML = `<div class="container"><div class="panel result"><div class="ic">😕</div><h2>该档期暂不可报名</h2>
        <p class="muted">可能已满员或停止报名，请返回选择其他日期。</p><a class="btn btn-green" href="#/activity/${a.id}">返回活动</a></div></div>`;
      return;
    }
    const maxPeople = Math.min(10, s.remaining);
    document.title = `报名 · ${a.title}`;

    app.innerHTML = `<div class="container"><div class="form-layout">
      <form class="panel" id="bookForm" novalidate>
        <h2>填写报名信息</h2>
        <h3 style="font-size:16px;margin-top:20px">联系人</h3>
        <div class="row">
          <div class="field"><label>姓名 <span class="req">*</span></label><input name="contact_name" required maxlength="30"></div>
          <div class="field"><label>手机号 <span class="req">*</span></label><input name="contact_phone" required inputmode="numeric" maxlength="11" pattern="1\\d{10}" value="${esc(store.get('phone'))}"></div>
          <div class="field"><label>邮箱</label><input name="contact_email" type="email" maxlength="100"></div>
        </div>
        <h3 style="font-size:16px;margin-top:8px">参与者 <span class="small muted">（证件号用于购买保险）</span></h3>
        <div id="people"></div>
        <button type="button" class="btn btn-ghost" id="addPerson">＋ 添加参与者</button>
        <div class="field" style="margin-top:18px"><label>备注</label><textarea name="remark" maxlength="500" placeholder="如：需要拼房、素食、同行人要求等"></textarea></div>
        <label class="checkbox"><input type="checkbox" name="agree" id="agree"> 我已阅读并同意《活动报名须知与免责声明》，确认参与者身体状况适合本活动。</label>
        <details class="small muted" style="margin:8px 0 18px"><summary>查看报名须知</summary>
          <p>1. 户外活动存在不可预知的风险，参与者应如实告知身体状况，并自行承担因隐瞒造成的后果。<br>
          2. 活动中须服从领队安排，不得擅自离队。<br>
          3. 如遇恶劣天气等不可抗力，主办方有权调整或取消行程，并按规定退款。<br>
          4. 退改规则：出发 7 天前取消全额退款；3~7 天前退 50%；3 天内不退款，可转让名额。</p>
        </details>
        <button class="btn btn-primary btn-block" id="submitBtn">提交报名</button>
      </form>
      <aside class="panel" style="position:sticky;top:84px">
        <h3 style="font-size:17px">${esc(a.title)}</h3>
        <div class="summary-line"><span class="muted">出发日期</span><span>${dateRange(s.start_date, s.end_date)}</span></div>
        ${s.meeting_point ? `<div class="summary-line"><span class="muted">集合地点</span><span>${esc(s.meeting_point)}</span></div>` : ''}
        <div class="summary-line"><span class="muted">单价</span><span>¥${yuan(s.price)}</span></div>
        <div class="summary-line"><span class="muted">人数</span><span id="sumCount">1</span></div>
        <div class="summary-line summary-total"><span>合计</span><span class="price" id="sumTotal">¥${yuan(s.price)}</span></div>
        <p class="small muted">剩余名额 ${s.remaining} 个；单次最多报名 ${maxPeople} 人。</p>
      </aside>
    </div></div>`;

    const people = $('#people');
    const personHtml = (i) => `<div class="person">
      <div class="person-title">参与者 ${i + 1} ${i > 0 ? '<button type="button" class="person-remove">移除</button>' : ''}</div>
      <div class="row">
        <div class="field"><label>姓名 <span class="req">*</span></label><input data-k="name" required maxlength="30"></div>
        <div class="field"><label>性别</label><select data-k="gender"><option value="">请选择</option><option>男</option><option>女</option></select></div>
        <div class="field"><label>手机号</label><input data-k="phone" inputmode="numeric" maxlength="11"></div>
        <div class="field"><label>证件号</label><input data-k="id_no" maxlength="30"></div>
        <div class="field"><label>紧急联系人及电话</label><input data-k="emergency_contact" maxlength="60" placeholder="如：李四 139xxxx"></div>
      </div></div>`;
    const refresh = () => {
      $$('.person', people).forEach((el, i) => { $('.person-title', el).firstChild.textContent = `参与者 ${i + 1} `; });
      const n = $$('.person', people).length;
      $('#sumCount').textContent = n;
      $('#sumTotal').textContent = `¥${yuan(s.price * n)}`;
      $('#addPerson').disabled = n >= maxPeople;
    };
    const addPerson = () => {
      people.insertAdjacentHTML('beforeend', personHtml($$('.person', people).length));
      refresh();
    };
    people.addEventListener('click', (e) => {
      if (e.target.classList.contains('person-remove')) { e.target.closest('.person').remove(); refresh(); }
    });
    $('#addPerson').addEventListener('click', addPerson);
    addPerson();
    // 联系人姓名自动带入第一位参与者
    $('[name=contact_name]').addEventListener('input', (e) => {
      const first = $('.person [data-k=name]', people);
      if (first && (!first.value || first.dataset.auto)) { first.value = e.target.value; first.dataset.auto = '1'; }
    });

    $('#bookForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = formData(f);
      body.agree = $('#agree').checked;
      body.session_id = s.id;
      body.participants = $$('.person', people).map((el) => Object.fromEntries($$('[data-k]', el).map((i) => [i.dataset.k, i.value.trim()])));
      if (!body.contact_name.trim()) return toast('请填写联系人姓名', true);
      if (!/^1\d{10}$/.test(body.contact_phone.trim())) return toast('请填写正确的 11 位手机号', true);
      if (body.participants.some((p) => !p.name)) return toast('请填写所有参与者的姓名', true);
      if (!body.agree) return toast('请先阅读并同意报名须知', true);
      const btn = $('#submitBtn');
      btn.disabled = true;
      btn.textContent = '提交中…';
      try {
        const { booking } = await api('/bookings', { method: 'POST', body });
        store.set('phone', body.contact_phone.trim());
        store.set('booking', booking.code);
        renderBooked(a, s, booking);
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
        btn.textContent = '提交报名';
      }
    });
  }

  function renderBooked(a, s, booking) {
    window.scrollTo(0, 0);
    app.innerHTML = `<div class="container"><div class="panel result">
      <div class="ic">🎉</div>
      <h2>报名已提交！</h2>
      <p class="muted">${esc(a.title)} · ${dateRange(s.start_date, s.end_date)} · ${booking.headcount} 人 · 合计 ¥${yuan(booking.total_price)}</p>
      <p style="margin-bottom:0">你的报名编号</p>
      <div class="code-box">${esc(booking.code)}</div>
      <p class="small muted">请保存好报名编号。客服将在 24 小时内电话与你确认并告知付款方式，<br>你也可以随时在「我的报名」中凭编号和手机号查询状态。</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:20px;flex-wrap:wrap">
        <a class="btn btn-green" href="#/my?code=${encodeURIComponent(booking.code)}">查看报名</a>
        <a class="btn btn-ghost" href="#/activities">继续逛逛</a>
      </div></div></div>`;
  }

  async function pageMy(params) {
    const q = new URLSearchParams(params);
    const tab = q.get('tab') === 'inquiry' ? 'inquiry' : 'booking';
    app.innerHTML = `<div class="container section" style="max-width:760px">
      <div class="section-head"><h2>我的报名与咨询</h2></div>
      <div class="tabs">
        <button class="tab ${tab === 'booking' ? 'active' : ''}" data-tab="booking">报名查询</button>
        <button class="tab ${tab === 'inquiry' ? 'active' : ''}" data-tab="inquiry">咨询记录</button>
      </div>
      <form class="panel" id="lookupForm">
        <div class="row">
          <div class="field"><label>${tab === 'booking' ? '报名编号' : '咨询编号'}</label>
            <input name="code" required placeholder="${tab === 'booking' ? '如 OB2611031A2B3C' : '如 Q2611031A2B3C'}" value="${esc(q.get('code') || store.get(tab))}"></div>
          <div class="field"><label>手机号</label><input name="phone" required inputmode="numeric" maxlength="11" value="${esc(store.get('phone'))}"></div>
        </div>
        <button class="btn btn-green">查询</button>
      </form>
      <div id="lookupResult" style="margin-top:20px"></div>
    </div>`;
    $$('.tab').forEach((t) => t.addEventListener('click', () => { location.hash = `#/my?tab=${t.dataset.tab}`; }));
    const form = $('#lookupForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { code, phone } = formData(form);
      const out = $('#lookupResult');
      try {
        const path = tab === 'booking' ? '/bookings/lookup' : '/inquiries/lookup';
        const { items } = await api(`${path}?${new URLSearchParams({ code: code.trim(), phone: phone.trim() })}`);
        store.set('phone', phone.trim());
        out.innerHTML = items.map(tab === 'booking' ? bookingCard : inquiryCard).join('');
        bindCancel(out, phone.trim(), () => form.requestSubmit());
      } catch (err) {
        out.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
      }
    });
    if (form.code.value && form.phone.value) form.requestSubmit();
  }

  function bookingCard(b) {
    return `<div class="panel" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <h3 style="margin:0;font-size:18px"><a href="#/activity/${b.activity_id}">${esc(b.activity_title)}</a></h3>${badge(b.status)}</div>
      <div class="summary-line"><span class="muted">报名编号</span><span>${esc(b.code)}</span></div>
      <div class="summary-line"><span class="muted">出发日期</span><span>${dateRange(b.start_date, b.end_date)}</span></div>
      ${b.meeting_point ? `<div class="summary-line"><span class="muted">集合地点</span><span>${esc(b.meeting_point)}</span></div>` : ''}
      ${b.leader ? `<div class="summary-line"><span class="muted">领队</span><span>${esc(b.leader)}</span></div>` : ''}
      <div class="summary-line"><span class="muted">参与者</span><span>${b.participants.map((p) => esc(p.name)).join('、')}</span></div>
      <div class="summary-line"><span class="muted">费用</span><span>¥${yuan(b.total_price)}（${b.headcount} 人）</span></div>
      <div class="summary-line"><span class="muted">提交时间</span><span>${esc(b.created_at)}</span></div>
      ${b.cancellable ? `<div style="text-align:right;margin-top:10px"><button class="btn btn-ghost" data-cancel="${esc(b.code)}">取消报名</button></div>` : ''}
    </div>`;
  }

  function inquiryCard(i) {
    return `<div class="panel" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;gap:10px"><span class="small muted">${esc(i.code)} · ${esc(i.created_at)}${i.activity_title ? ` · ${esc(i.activity_title)}` : ''}</span>${badge(i.status)}</div>
      <div class="qa-item"><div class="qa-q">${esc(i.question)}</div>
      ${i.reply ? `<div class="qa-a">${esc(i.reply)}</div><div class="small muted" style="margin-top:6px">回复于 ${esc(i.replied_at)}</div>` : '<p class="muted small">客服正在处理，请耐心等待。</p>'}</div>
    </div>`;
  }

  function bindCancel(root, phone, reload) {
    $$('[data-cancel]', root).forEach((btn) => btn.addEventListener('click', async () => {
      const reason = prompt('确定要取消报名吗？可填写取消原因（选填）：');
      if (reason === null) return;
      try {
        await api('/bookings/cancel', { method: 'POST', body: { code: btn.dataset.cancel, phone, reason } });
        toast('已取消报名');
        reload();
      } catch (err) { toast(err.message, true); }
    }));
  }

  async function pageContact() {
    const { items } = await api('/faq');
    const s = META.site;
    app.innerHTML = `<div class="container"><div class="contact-grid">
      <div>
        <div class="panel">
          <h2>联系我们</h2>
          <ul class="contact-info" style="padding-left:18px">
            <li>客服电话：${esc(s.phone)}</li>
            <li>微信：${esc(s.wechat)}</li>
            <li>邮箱：${esc(s.email)}</li>
            <li>地址：${esc(s.address)}</li>
            <li>服务时间：每天 9:00 - 21:00</li>
          </ul>
        </div>
        <div class="panel" style="margin-top:18px">
          <h2>常见问题</h2>
          ${items.length ? items.map((x) => `<div class="qa-item"><div class="qa-q">${esc(x.question)}</div><div class="qa-a">${esc(x.reply)}</div>
            ${x.activity_title ? `<div class="small muted" style="margin-top:4px">相关活动：<a href="#/activity/${x.activity_id}">${esc(x.activity_title)}</a></div>` : ''}</div>`).join('') : '<p class="muted">暂无</p>'}
        </div>
      </div>
      <div class="panel">
        <h2>在线咨询</h2>
        <p class="muted small">留下你的问题，我们会在工作时间内尽快回复。也可以告诉我们你想去的地方，帮你定制行程。</p>
        <form id="contactForm">
          <div class="row">
            <div class="field"><label>称呼 <span class="req">*</span></label><input name="name" required maxlength="30"></div>
            <div class="field"><label>手机号 <span class="req">*</span></label><input name="phone" required inputmode="numeric" pattern="1\\d{10}" maxlength="11" value="${esc(store.get('phone'))}"></div>
          </div>
          <div class="field"><label>微信号</label><input name="wechat" maxlength="50" placeholder="方便我们添加你沟通（选填）"></div>
          <div class="field"><label>你的问题 <span class="req">*</span></label><textarea name="question" required minlength="5" maxlength="1000" placeholder="例如：想在 12 月带 6 岁孩子参加露营，有推荐吗？"></textarea></div>
          <button class="btn btn-primary">提交咨询</button>
        </form>
      </div>
    </div></div>`;
    $('#contactForm').addEventListener('submit', (e) => submitInquiry(e, null));
  }

  // ---------- 路由 ----------
  const routes = [
    [/^\/?$/, pageHome, 'home'],
    [/^\/activities$/, pageActivities, 'activities'],
    [/^\/activity\/(\d+)$/, pageActivity, 'activities'],
    [/^\/book\/(\d+)$/, pageBook, 'activities'],
    [/^\/my$/, pageMy, 'my'],
    [/^\/contact$/, pageContact, 'contact'],
  ];

  async function router() {
    const raw = location.hash.replace(/^#/, '') || '/';
    if (!raw.startsWith('/')) return; // 页面内锚点
    const [path, query = ''] = raw.split('?');
    $('#nav').classList.remove('open');
    for (const [re, fn, nav] of routes) {
      const m = path.match(re);
      if (!m) continue;
      $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
      document.title = `${META.site.name || '山野同行'} · 户外活动报名`;
      app.innerHTML = '<div class="loading">加载中…</div>';
      window.scrollTo(0, 0);
      try {
        await (m[1] ? fn(m[1], query) : fn(query));
      } catch (err) {
        app.innerHTML = `<div class="container"><div class="panel result"><div class="ic">🧭</div><h2>出错了</h2>
          <p class="muted">${esc(err.message)}</p><a class="btn btn-green" href="#/">返回首页</a></div></div>`;
      }
      return;
    }
    app.innerHTML = '<div class="container"><div class="panel result"><div class="ic">🗺️</div><h2>页面不存在</h2><a class="btn btn-green" href="#/">返回首页</a></div></div>';
  }

  async function init() {
    $('#year').textContent = new Date().getFullYear();
    $('#menuBtn').addEventListener('click', () => $('#nav').classList.toggle('open'));
    try {
      META = await api('/meta');
      $$('[data-site-name]').forEach((el) => { el.textContent = META.site.name; });
      $$('[data-site-slogan]').forEach((el) => { el.textContent = META.site.slogan; });
      $('#footerContact').innerHTML = `电话：${esc(META.site.phone)}<br>微信：${esc(META.site.wechat)}<br>邮箱：${esc(META.site.email)}`;
    } catch { /* 元数据失败时继续渲染 */ }
    window.addEventListener('hashchange', router);
    router();
  }

  init();
})();

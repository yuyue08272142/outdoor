/* 管理后台：活动/档期管理、报名处理、咨询答复 */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const view = $('#view');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yuan = (c) => (c / 100).toFixed(2).replace(/\.00$/, '');
  const STATUS = {
    pending: '待确认', confirmed: '已确认', cancelled: '已取消', completed: '已完成',
    open: '待回复', replied: '已回复', closed: '已关闭',
    draft: '草稿', published: '已发布', archived: '已归档',
  };
  const SESSION_STATUS = { open: '开放报名', closed: '停止报名', cancelled: '已取消' };
  const badge = (s) => `<span class="badge badge-${esc(s)}">${STATUS[s] || esc(s)}</span>`;
  let META = { categories: [], difficulties: [] };
  const catName = (k) => (META.categories.find((c) => c.key === k) || { name: k }).name;

  // ---------- API & 认证 ----------
  let token = sessionStorage.getItem('admin_token') || '';

  async function api(path, opts = {}) {
    const res = await fetch(`/api${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/admin/login') {
      logout();
      throw new Error(data.error || '请重新登录');
    }
    if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
    return data;
  }

  function showLogin() {
    $('#shell').classList.add('hidden');
    $('#login').classList.remove('hidden');
  }

  function logout() {
    token = '';
    sessionStorage.removeItem('admin_token');
    showLogin();
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await api('/admin/login', { method: 'POST', body: { password: e.target.password.value } });
      token = data.token;
      sessionStorage.setItem('admin_token', token);
      e.target.reset();
      start();
    } catch (err) { toast(err.message, true); }
  });
  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/admin/logout', { method: 'POST' }); } catch { /* ignore */ }
    logout();
  });

  let toastTimer;
  function toast(msg, isError = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast show${isError ? ' error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
  }

  function openModal(html) {
    $('#modalBody').innerHTML = html;
    $('#modal').classList.remove('hidden');
  }
  function closeModal() { $('#modal').classList.add('hidden'); }
  $('#modalClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

  async function refreshCounts() {
    try {
      const s = await api('/admin/stats');
      $('#cntBookings').textContent = s.bookings_pending || '';
      $('#cntInquiries').textContent = s.inquiries_open || '';
      return s;
    } catch { return null; }
  }

  // ---------- 概览 ----------
  async function pageDashboard() {
    const [s, recent] = await Promise.all([refreshCounts(), api('/admin/bookings?status=pending')]);
    view.innerHTML = `<h1>概览</h1>
      <div class="stats">
        <div class="stat warn"><b>${s.bookings_pending}</b><span>待确认报名</span></div>
        <div class="stat warn"><b>${s.inquiries_open}</b><span>待回复咨询</span></div>
        <div class="stat"><b>${s.activities_published}</b><span>已发布活动</span></div>
        <div class="stat"><b>${s.upcoming_sessions}</b><span>即将出发档期</span></div>
        <div class="stat"><b>${s.bookings_30d}</b><span>近 30 天报名单数</span></div>
        <div class="stat"><b>${s.participants_30d}</b><span>近 30 天确认人次</span></div>
        <div class="stat"><b>¥${yuan(s.revenue_30d)}</b><span>近 30 天确认金额</span></div>
      </div>
      <h2 style="font-size:18px">待确认的报名</h2>
      ${bookingTable(recent.items.slice(0, 10))}`;
    bindBookingRows();
  }

  // ---------- 活动 ----------
  async function pageActivities() {
    const { items } = await api('/admin/activities');
    view.innerHTML = `<div class="toolbar"><h1 style="margin:0">活动管理</h1><span class="spacer"></span>
      <a class="btn btn-primary" href="#/activity/new">＋ 新建活动</a></div>
      <div class="table-wrap"><table class="tbl"><thead><tr>
        <th>ID</th><th>活动</th><th>类型</th><th>价格</th><th>难度</th><th>即将出发档期</th><th>待确认报名</th><th>状态</th><th>更新时间</th><th></th>
      </tr></thead><tbody>
      ${items.map((a) => `<tr>
        <td>${a.id}</td><td><b>${esc(a.title)}</b><br><span class="small muted">${esc(a.location)}</span></td>
        <td>${esc(catName(a.category))}</td><td>¥${yuan(a.price)}</td><td>${a.difficulty}</td>
        <td>${a.upcoming_sessions}</td><td>${a.pending_bookings ? `<a href="#/bookings?activity_id=${a.id}&status=pending">${a.pending_bookings}</a>` : 0}</td>
        <td>${badge(a.status)}</td><td class="small">${esc(a.updated_at)}</td>
        <td class="actions"><a class="btn btn-ghost btn-sm" href="#/activity/${a.id}">编辑</a>
          ${a.status === 'published' ? `<a class="btn btn-ghost btn-sm" href="/#/activity/${a.id}" target="_blank">预览</a>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="10" class="muted">暂无活动</td></tr>'}
      </tbody></table></div>`;
  }

  async function pageActivityEdit(id) {
    const isNew = id === 'new';
    const data = isNew ? { activity: { category: 'hiking', difficulty: 2, duration_days: 1, price: 0, min_age: 0, status: 'draft', sort_order: 0, highlights: [], itinerary: [], includes: [], excludes: [] }, sessions: [] }
      : await api(`/admin/activities/${id}`);
    const a = data.activity;
    const lines = (arr) => esc(arr.join('\n'));

    view.innerHTML = `<div class="toolbar"><a href="#/activities">← 返回</a><h1 style="margin:0">${isNew ? '新建活动' : `编辑：${esc(a.title)}`}</h1></div>
      <form id="actForm">
        <div class="form-section"><h2>基本信息</h2>
          <div class="field"><label>活动标题 *</label><input name="title" required maxlength="100" value="${esc(a.title)}"></div>
          <div class="field"><label>一句话简介 <span class="hint">展示在列表卡片上</span></label><input name="summary" maxlength="300" value="${esc(a.summary)}"></div>
          <div class="form-grid">
            <div class="field"><label>类型 *</label><select name="category">${META.categories.map((c) => `<option value="${c.key}" ${c.key === a.category ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select></div>
            <div class="field"><label>目的地</label><input name="location" maxlength="100" value="${esc(a.location)}" placeholder="如：浙江 · 千岛湖"></div>
            <div class="field"><label>天数</label><input name="duration_days" type="number" min="1" value="${a.duration_days}"></div>
            <div class="field"><label>难度</label><select name="difficulty">${META.difficulties.map((d) => `<option value="${d.level}" ${d.level === a.difficulty ? 'selected' : ''}>${d.level} · ${esc(d.name)}（${esc(d.desc)}）</option>`).join('')}</select></div>
            <div class="field"><label>基础价格（元/人）</label><input name="price_yuan" type="number" min="0" step="0.01" value="${yuan(a.price)}"></div>
            <div class="field"><label>最低年龄</label><input name="min_age" type="number" min="0" value="${a.min_age}"></div>
            <div class="field"><label>状态</label><select name="status">${['draft', 'published', 'archived'].map((s) => `<option value="${s}" ${s === a.status ? 'selected' : ''}>${STATUS[s]}</option>`).join('')}</select></div>
            <div class="field"><label>排序权重 <span class="hint">越大越靠前</span></label><input name="sort_order" type="number" value="${a.sort_order}"></div>
          </div>
          <div class="field"><label>封面图地址 <span class="hint">可留空，使用默认插画；支持 https:// 或站内 /images/xxx.jpg</span></label><input name="cover_url" maxlength="500" value="${esc(a.cover_url)}"></div>
        </div>
        <div class="form-section"><h2>详细介绍</h2>
          <div class="field"><label>活动介绍 <span class="hint">空行分段</span></label><textarea name="description" style="min-height:160px">${esc(a.description)}</textarea></div>
          <div class="form-grid">
            <div class="field"><label>活动亮点 <span class="hint">每行一条</span></label><textarea name="highlights">${lines(a.highlights)}</textarea></div>
            <div class="field"><label>费用包含 <span class="hint">每行一条</span></label><textarea name="includes">${lines(a.includes)}</textarea></div>
            <div class="field"><label>费用不含 <span class="hint">每行一条</span></label><textarea name="excludes">${lines(a.excludes)}</textarea></div>
          </div>
          <div class="field"><label>注意事项 / 装备建议</label><textarea name="notices">${esc(a.notices)}</textarea></div>
        </div>
        <div class="form-section"><h2>行程安排</h2>
          <div id="itin"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="addItin">＋ 添加一段行程</button>
        </div>
        <div class="toolbar">
          <button class="btn btn-primary">保存活动</button>
          ${isNew ? '' : '<span class="spacer"></span><button type="button" class="btn btn-danger" id="delAct">删除活动</button>'}
        </div>
      </form>
      ${isNew ? '<p class="muted">保存活动后即可添加出发档期。</p>' : `
      <div class="form-section" style="margin-top:24px">
        <div class="toolbar"><h2 style="margin:0">出发档期</h2><span class="spacer"></span><button class="btn btn-green btn-sm" id="addSession">＋ 新增档期</button></div>
        <div class="table-wrap"><table class="tbl" style="box-shadow:none"><thead><tr><th>日期</th><th>名额</th><th>已报名</th><th>价格</th><th>集合地点</th><th>领队</th><th>状态</th><th></th></tr></thead><tbody>
        ${data.sessions.map((s) => `<tr>
          <td>${esc(s.start_date)}${s.end_date !== s.start_date ? ` ~ ${esc(s.end_date)}` : ''}</td>
          <td>${s.capacity}</td><td><a href="#/bookings?session_id=${s.id}">${s.booked}</a></td>
          <td>¥${yuan(s.price)}${s.custom_price == null ? ' <span class="hint">默认</span>' : ''}</td>
          <td>${esc(s.meeting_point)}</td><td>${esc(s.leader)}</td><td>${SESSION_STATUS[s.status]}</td>
          <td class="actions"><button class="btn btn-ghost btn-sm" data-edit-session="${s.id}">编辑</button><button class="btn btn-danger btn-sm" data-del-session="${s.id}">删除</button></td>
        </tr>`).join('') || '<tr><td colspan="8" class="muted">暂无档期</td></tr>'}
        </tbody></table></div>
      </div>`}`;

    const itin = $('#itin');
    const addItin = (d = { title: '', content: '' }) => {
      itin.insertAdjacentHTML('beforeend', `<div class="itin-row">
        <input data-k="title" placeholder="如：D1 集合 → 营地" value="${esc(d.title)}">
        <textarea data-k="content" placeholder="当天行程描述">${esc(d.content)}</textarea>
        <button type="button" class="btn btn-danger btn-sm" data-rm>删除</button></div>`);
    };
    a.itinerary.forEach(addItin);
    if (!a.itinerary.length) addItin();
    $('#addItin').addEventListener('click', () => addItin());
    itin.addEventListener('click', (e) => { if (e.target.dataset.rm !== undefined) e.target.closest('.itin-row').remove(); });

    $('#actForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      body.itinerary = $$('.itin-row', itin).map((r) => ({ title: $('[data-k=title]', r).value, content: $('[data-k=content]', r).value }));
      try {
        if (isNew) {
          const { id: newId } = await api('/admin/activities', { method: 'POST', body });
          toast('已创建，现在可以添加档期了');
          location.hash = `#/activity/${newId}`;
        } else {
          await api(`/admin/activities/${a.id}`, { method: 'PUT', body });
          toast('已保存');
          pageActivityEdit(a.id);
        }
      } catch (err) { toast(err.message, true); }
    });

    if (isNew) return;
    $('#delAct').addEventListener('click', async () => {
      if (!confirm('确定删除该活动？此操作不可恢复。')) return;
      try { await api(`/admin/activities/${a.id}`, { method: 'DELETE' }); toast('已删除'); location.hash = '#/activities'; } catch (err) { toast(err.message, true); }
    });
    $('#addSession').addEventListener('click', () => sessionModal(a, null));
    $$('[data-edit-session]').forEach((b) => b.addEventListener('click', () => sessionModal(a, data.sessions.find((s) => s.id === Number(b.dataset.editSession)))));
    $$('[data-del-session]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('确定删除该档期？')) return;
      try { await api(`/admin/sessions/${b.dataset.delSession}`, { method: 'DELETE' }); toast('已删除'); pageActivityEdit(a.id); } catch (err) { toast(err.message, true); }
    }));
  }

  function sessionModal(a, s) {
    const v = s || { start_date: '', end_date: '', capacity: 20, custom_price: null, meeting_point: '', leader: '', status: 'open' };
    openModal(`<h2>${s ? '编辑档期' : '新增档期'}</h2>
      <form id="sessForm"><div class="form-grid">
        <div class="field"><label>开始日期 *</label><input type="date" name="start_date" required value="${esc(v.start_date)}"></div>
        <div class="field"><label>结束日期 <span class="hint">留空 = 当天</span></label><input type="date" name="end_date" value="${esc(v.end_date)}"></div>
        <div class="field"><label>名额 *</label><input type="number" name="capacity" min="1" required value="${v.capacity}"></div>
        <div class="field"><label>价格（元） <span class="hint">留空使用活动价 ¥${yuan(a.price)}</span></label><input type="number" name="price_yuan" min="0" step="0.01" value="${v.custom_price == null ? '' : yuan(v.custom_price)}"></div>
        <div class="field"><label>集合地点</label><input name="meeting_point" value="${esc(v.meeting_point)}"></div>
        <div class="field"><label>领队</label><input name="leader" value="${esc(v.leader)}"></div>
        <div class="field"><label>状态</label><select name="status">${Object.entries(SESSION_STATUS).map(([k, n]) => `<option value="${k}" ${k === v.status ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      </div><button class="btn btn-primary">保存</button></form>`);
    $('#sessForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      try {
        if (s) await api(`/admin/sessions/${s.id}`, { method: 'PUT', body });
        else await api(`/admin/activities/${a.id}/sessions`, { method: 'POST', body });
        closeModal();
        toast('档期已保存');
        pageActivityEdit(a.id);
      } catch (err) { toast(err.message, true); }
    });
  }

  // ---------- 报名 ----------
  function bookingTable(items) {
    return `<div class="table-wrap"><table class="tbl"><thead><tr>
      <th>编号</th><th>活动 / 日期</th><th>联系人</th><th>人数</th><th>金额</th><th>状态</th><th>提交时间</th>
    </tr></thead><tbody>
    ${items.map((b) => `<tr class="clickable" data-booking="${b.id}">
      <td>${esc(b.code)}</td><td>${esc(b.activity_title)}<br><span class="small muted">${esc(b.start_date)}</span></td>
      <td>${esc(b.contact_name)}<br><span class="small muted">${esc(b.contact_phone)}</span></td>
      <td>${b.headcount}</td><td>¥${yuan(b.total_price)}</td><td>${badge(b.status)}</td><td class="small">${esc(b.created_at)}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">暂无数据</td></tr>'}
    </tbody></table></div>`;
  }

  function bindBookingRows(onChange) {
    $$('[data-booking]').forEach((tr) => tr.addEventListener('click', () => bookingModal(tr.dataset.booking, onChange)));
  }

  async function pageBookings(query) {
    const q = new URLSearchParams(query);
    const [{ items }, acts] = await Promise.all([api(`/admin/bookings?${q}`), api('/admin/activities')]);
    view.innerHTML = `<h1>报名管理</h1>
      <form class="toolbar" id="bFilter">
        <select name="status"><option value="">全部状态</option>${['pending', 'confirmed', 'cancelled', 'completed'].map((s) => `<option value="${s}" ${q.get('status') === s ? 'selected' : ''}>${STATUS[s]}</option>`).join('')}</select>
        <select name="activity_id"><option value="">全部活动</option>${acts.items.map((a) => `<option value="${a.id}" ${q.get('activity_id') === String(a.id) ? 'selected' : ''}>${esc(a.title)}</option>`).join('')}</select>
        <input name="q" placeholder="编号 / 姓名 / 手机号" value="${esc(q.get('q') || '')}">
        ${q.get('session_id') ? `<input type="hidden" name="session_id" value="${esc(q.get('session_id'))}"><span class="small muted">已按档期筛选</span>` : ''}
        <button class="btn btn-green btn-sm">筛选</button>
        <span class="spacer"></span>
        <button type="button" class="btn btn-ghost btn-sm" id="exportCsv">导出 CSV（含参与者）</button>
      </form>
      ${bookingTable(items)}`;
    const form = $('#bFilter');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const p = new URLSearchParams([...new FormData(form).entries()].filter(([, v]) => v));
      location.hash = `#/bookings?${p}`;
    });
    $$('select', form).forEach((s) => s.addEventListener('change', () => form.requestSubmit()));
    $('#exportCsv').addEventListener('click', async () => {
      const res = await fetch(`/api/admin/bookings.csv?${q}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return toast('导出失败', true);
      const url = URL.createObjectURL(await res.blob());
      const link = Object.assign(document.createElement('a'), { href: url, download: `报名名单-${new Date().toISOString().slice(0, 10)}.csv` });
      link.click();
      URL.revokeObjectURL(url);
    });
    bindBookingRows(() => pageBookings(query));
  }

  async function bookingModal(id, onChange) {
    const { booking: b } = await api(`/admin/bookings/${id}`);
    const actions = {
      pending: [['confirmed', '确认报名', 'btn-green'], ['cancelled', '取消报名', 'btn-danger']],
      confirmed: [['completed', '标记已完成', 'btn-green'], ['cancelled', '取消报名', 'btn-danger']],
      cancelled: [['pending', '恢复为待确认', 'btn-ghost']],
      completed: [],
    }[b.status];
    openModal(`<h2>报名详情 ${badge(b.status)}</h2>
      <dl class="kv">
        <dt>报名编号</dt><dd>${esc(b.code)}</dd>
        <dt>活动</dt><dd>${esc(b.activity_title)}</dd>
        <dt>日期</dt><dd>${esc(b.start_date)} ~ ${esc(b.end_date)}</dd>
        <dt>联系人</dt><dd>${esc(b.contact_name)} · <a href="tel:${esc(b.contact_phone)}">${esc(b.contact_phone)}</a>${b.contact_email ? ` · ${esc(b.contact_email)}` : ''}</dd>
        <dt>费用</dt><dd>¥${yuan(b.unit_price)} × ${b.headcount} = <b>¥${yuan(b.total_price)}</b></dd>
        <dt>用户备注</dt><dd>${esc(b.remark) || '-'}</dd>
        <dt>提交时间</dt><dd>${esc(b.created_at)}（更新 ${esc(b.updated_at)}）</dd>
      </dl>
      <h3 style="font-size:15px">参与者</h3>
      <div class="table-wrap"><table class="tbl" style="box-shadow:none"><thead><tr><th>姓名</th><th>性别</th><th>手机</th><th>证件号</th><th>紧急联系人</th></tr></thead><tbody>
      ${b.participants.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.gender)}</td><td>${esc(p.phone)}</td><td>${esc(p.id_no)}</td><td>${esc(p.emergency_contact)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="field" style="margin-top:16px"><label>后台备注 <span class="hint">仅内部可见，如付款情况、沟通记录</span></label><textarea id="adminNote">${esc(b.admin_note)}</textarea></div>
      <div class="actions">
        <button class="btn btn-ghost" data-status="${b.status}">保存备注</button>
        ${actions.map(([s, label, cls]) => `<button class="btn ${cls}" data-status="${s}">${label}</button>`).join('')}
      </div>`);
    $$('#modalBody [data-status]').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        await api(`/admin/bookings/${b.id}`, { method: 'PATCH', body: { status: btn.dataset.status, admin_note: $('#adminNote').value } });
        closeModal();
        toast('已更新');
        refreshCounts();
        (onChange || router)();
      } catch (err) { toast(err.message, true); }
    }));
  }

  // ---------- 咨询 ----------
  async function pageInquiries(query) {
    const q = new URLSearchParams(query);
    const status = q.get('status') ?? 'open';
    const { items } = await api(`/admin/inquiries?status=${encodeURIComponent(status)}`);
    view.innerHTML = `<h1>咨询答复</h1>
      <div class="toolbar">${[['open', '待回复'], ['replied', '已回复'], ['closed', '已关闭'], ['', '全部']].map(([k, n]) => `<a class="chip ${status === k ? 'active' : ''}" href="#/inquiries?status=${k}">${n}</a>`).join('')}</div>
      ${items.map((i) => `<div class="inq" data-id="${i.id}">
        <div class="inq-head"><span>${esc(i.name)} · <a href="tel:${esc(i.phone)}">${esc(i.phone)}</a>${i.wechat ? ` · 微信 ${esc(i.wechat)}` : ''} · ${esc(i.created_at)}${i.activity_title ? ` · 关于「${esc(i.activity_title)}」` : ''}</span>${badge(i.status)}</div>
        <div class="inq-q">${esc(i.question)}</div>
        <textarea placeholder="输入回复内容…">${esc(i.reply)}</textarea>
        <div class="toolbar" style="margin:10px 0 0">
          <label class="checkbox"><input type="checkbox" data-public ${i.is_public ? 'checked' : ''}> 设为公开问答（展示在${i.activity_title ? '活动详情页' : '咨询页常见问题'}）</label>
          <span class="spacer"></span>
          ${i.status !== 'closed' ? '<button class="btn btn-ghost btn-sm" data-close>关闭</button>' : ''}
          <button class="btn btn-danger btn-sm" data-del>删除</button>
          <button class="btn btn-green btn-sm" data-save>${i.reply ? '更新回复' : '回复'}</button>
        </div>
      </div>`).join('') || '<div class="empty">暂无咨询 🎉</div>'}`;

    const reload = () => { refreshCounts(); pageInquiries(query); };
    $$('.inq').forEach((el) => {
      const id = el.dataset.id;
      $('[data-save]', el).addEventListener('click', async () => {
        try {
          await api(`/admin/inquiries/${id}`, { method: 'PATCH', body: { reply: $('textarea', el).value, is_public: $('[data-public]', el).checked } });
          toast('已回复');
          reload();
        } catch (err) { toast(err.message, true); }
      });
      $('[data-close]', el)?.addEventListener('click', async () => {
        try { await api(`/admin/inquiries/${id}`, { method: 'PATCH', body: { status: 'closed' } }); reload(); } catch (err) { toast(err.message, true); }
      });
      $('[data-del]', el).addEventListener('click', async () => {
        if (!confirm('确定删除这条咨询？')) return;
        try { await api(`/admin/inquiries/${id}`, { method: 'DELETE' }); reload(); } catch (err) { toast(err.message, true); }
      });
    });
  }

  // ---------- 路由 ----------
  const routes = [
    [/^\/(dashboard)?$/, pageDashboard, 'dashboard'],
    [/^\/activities$/, pageActivities, 'activities'],
    [/^\/activity\/(new|\d+)$/, pageActivityEdit, 'activities'],
    [/^\/bookings$/, pageBookings, 'bookings'],
    [/^\/inquiries$/, pageInquiries, 'inquiries'],
  ];

  async function router() {
    if (!token) return showLogin();
    const [path, query = ''] = (location.hash.replace(/^#/, '') || '/').split('?');
    for (const [re, fn, nav] of routes) {
      const m = path.match(re);
      if (!m) continue;
      $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
      closeModal();
      try {
        await (nav === 'activities' && m[1] ? fn(m[1]) : fn(query));
      } catch (err) {
        if (token) view.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
      }
      return;
    }
    location.hash = '#/dashboard';
  }

  async function start() {
    $('#login').classList.add('hidden');
    $('#shell').classList.remove('hidden');
    try { META = await api('/meta'); } catch { /* ignore */ }
    refreshCounts();
    router();
  }

  window.addEventListener('hashchange', router);
  if (token) start(); else showLogin();
})();

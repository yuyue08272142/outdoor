# 户外活动网页服务 · 设计文档 v0.1

> 目标：为户外活动组织方（俱乐部 / 工作室 / 领队团队）提供一个**展示活动 → 在线报名 → 咨询答复 → 后台运营**的完整网页服务。
> 本版本为可运行的 MVP，后续可按「迭代路线」逐步扩展支付、通知、会员等能力。

---

## 1. 角色与核心场景

| 角色 | 核心诉求 | 对应功能 |
| --- | --- | --- |
| 访客 / 报名用户 | 了解有什么活动、难不难、哪天出发、还有没有名额；方便地报名和提问 | 活动展示、筛选、档期与余位、在线报名、报名查询/取消、在线咨询 |
| 运营 / 客服 | 发布与维护活动、处理报名、回复咨询、导出名单给领队/保险 | 管理后台：活动与档期管理、报名审核、咨询答复、CSV 导出 |
| 领队 | 拿到出行名单与紧急联系人 | 后台导出（按档期筛选） |

### 核心用户流程

```
浏览首页 / 列表 ──► 活动详情（行程、费用、注意事项、问答）
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
   选择档期 → 填写报名       提交咨询（获得咨询编号）
          │                     │
   获得报名编号（待确认）      客服后台回复（可设为公开问答）
          │                     │
   客服电话确认 → 已确认       用户凭「编号 + 手机号」查看回复
          │
   出行 → 已完成   （出发前用户可自助取消）
```

**设计取舍：免注册。** 户外报名多为低频行为，强制注册会明显降低转化。MVP 采用「报名编号 + 手机号」作为凭证查询报名与咨询，后续再接入短信验证码 / 微信登录。

---

## 2. 信息架构

### 用户端（`/`，单页应用，hash 路由）

| 页面 | 路由 | 内容 |
| --- | --- | --- |
| 首页 | `#/` | Hero + 搜索、按类型探索、近期热门活动、品牌卖点、报名流程 |
| 活动列表 | `#/activities` | 类型 / 难度 / 出发月份 / 关键词 筛选；卡片展示价格、难度、最近出发日 |
| 活动详情 | `#/activity/:id` | 基本信息（目的地、天数、难度、年龄）、亮点、介绍、行程时间线、费用包含/不含、注意事项、公开问答 + 提问表单；右侧档期选择与余位 |
| 报名表单 | `#/book/:id?session=` | 联系人、多位参与者（姓名/性别/电话/证件号/紧急联系人）、备注、报名须知勾选；右侧实时费用小结 |
| 我的报名 | `#/my` | 两个标签：报名查询（可取消）、咨询记录（查看回复） |
| 咨询 | `#/contact` | 联系方式、常见问题（公开问答）、通用咨询表单 |

### 管理后台（`/admin/`）

| 模块 | 功能 |
| --- | --- |
| 概览 | 待确认报名、待回复咨询、已发布活动、近 30 天报名/人次/金额；待确认报名列表 |
| 活动管理 | 新建/编辑活动（基础信息、介绍、亮点、费用、注意事项、行程分段）；草稿 / 发布 / 归档；排序权重 |
| 档期管理 | 在活动编辑页内增删改档期：日期、名额、单独定价、集合地点、领队、开放/停止/取消 |
| 报名管理 | 按状态 / 活动 / 档期 / 关键词筛选；详情弹窗查看参与者；确认、取消、完成、恢复；内部备注；**CSV 导出（含参与者明细）** |
| 咨询答复 | 按状态查看；回复、关闭、删除；一键设为公开问答（展示到活动页或常见问题） |

---

## 3. 数据模型

```
activities 1 ──< sessions 1 ──< bookings 1 ──< participants
     1
     └──< inquiries (activity_id 可为空 = 通用咨询)
```

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `activities` | title, category, summary, description, location, duration_days, difficulty(1-5), price(分), min_age, highlights/itinerary/includes/excludes(JSON), notices, status(draft/published/archived), sort_order | 活动本体 |
| `sessions` | activity_id, start_date, end_date, capacity, price(可空，空则用活动价), meeting_point, leader, status(open/closed/cancelled) | 出发档期 |
| `bookings` | code(唯一), session_id, contact_name/phone/email, headcount, unit_price, total_price, remark, status(pending/confirmed/cancelled/completed), admin_note | 报名单；**下单时快照单价** |
| `participants` | booking_id, name, gender, phone, id_no, emergency_contact | 参与者，证件号对外脱敏 |
| `inquiries` | code(唯一), activity_id?, name, phone, wechat, question, reply, status(open/replied/closed), is_public | 咨询与问答 |

**名额计算：** `剩余 = capacity − SUM(headcount where status in (pending, confirmed))`。
报名写入在 `BEGIN IMMEDIATE` 事务内重新计算余量，避免超卖；取消后名额自动释放；从「已取消」恢复时重新校验余量。

**金额：** 统一以「分」为整数存储，避免浮点误差。

### 状态机

```
报名：pending ──确认──► confirmed ──出行结束──► completed
         │                 │
         └──取消──► cancelled ◄──取消──┘     （cancelled 可恢复为 pending，需有余量）
用户自助取消：仅 pending / confirmed 且出发日在今天之后

咨询：open ──回复──► replied ──► closed
```

---

## 4. 接口设计（REST / JSON）

### 公开接口 `/api`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/meta` | 站点信息、活动类型、难度说明 |
| GET | `/activities?category=&difficulty=&month=YYYY-MM&q=` | 已发布活动列表（含最近出发日、可报名档期数） |
| GET | `/activities/:id` | 详情 + 未来档期（含余位、是否可报）+ 公开问答 |
| POST | `/bookings` | 提交报名 `{session_id, contact_name, contact_phone, contact_email?, participants[], remark?, agree}` → `{code, total_price}` |
| GET | `/bookings/lookup?code=&phone=` | 查询报名（证件号脱敏，不含后台备注） |
| POST | `/bookings/cancel` | 自助取消 `{code, phone, reason?}` |
| POST | `/inquiries` | 提交咨询 `{name, phone, wechat?, question, activity_id?}` → `{code}` |
| GET | `/inquiries/lookup?code=&phone=` | 查询咨询及回复 |
| GET | `/faq` | 公开问答列表 |

### 后台接口 `/api/admin`（`Authorization: Bearer <token>`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/login` / `/logout` | 密码登录，返回 12 小时有效 token |
| GET | `/stats` | 概览数据 |
| GET/POST | `/activities` | 列表 / 新建 |
| GET/PUT/DELETE | `/activities/:id` | 详情（含档期）/ 更新 / 删除（有报名则拒绝，建议归档） |
| POST | `/activities/:id/sessions` | 新增档期 |
| PUT/DELETE | `/sessions/:id` | 更新（名额不得低于已报名）/ 删除（有报名则拒绝） |
| GET | `/bookings?status=&activity_id=&session_id=&q=` | 报名列表 |
| GET/PATCH | `/bookings/:id` | 详情（含完整参与者信息）/ 改状态、备注 |
| GET | `/bookings.csv?…` | 导出 Excel 可直接打开的 CSV（UTF-8 BOM） |
| GET/PATCH/DELETE | `/inquiries[/:id]` | 咨询列表 / 回复、公开、关闭 / 删除 |

---

## 5. 安全与合规

- **隐私最小化**：用户端查询必须同时提供编号与手机号；证件号在用户端接口脱敏（`110***********1234`），公开问答隐藏提问人姓名与手机号。
- **防刷**：报名、咨询、查询、登录接口均有按 IP 的限流（默认 10 次/分钟）。
- **XSS**：前端所有动态内容统一 `esc()` 转义后再渲染；封面图仅允许 `http(s)://` 或站内路径。
- **CSV 注入**：导出时对以 `= + - @` 开头的单元格加前缀 `'`。
- **后台**：密码通过环境变量 `ADMIN_PASSWORD` 配置，常量时间比较；token 存于 `sessionStorage`，关闭浏览器即失效。
- **报名须知**：报名时必须勾选免责声明与退改规则。
- 上线前建议：HTTPS、ICP 备案、隐私政策页、证件号字段加密存储、数据库定期备份。

---

## 6. 技术方案

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 运行时 | Node.js ≥ 22.13 | 内置 SQLite 与测试框架，部署简单 |
| Web 框架 | Express 5 | 唯一的第三方依赖 |
| 数据库 | SQLite（`node:sqlite`，WAL 模式） | 零运维，单机足以支撑中小型俱乐部；数据量增长后可平滑迁移 PostgreSQL |
| 前端 | 原生 HTML/CSS/JS 单页应用 | 无构建步骤，加载快，移动端适配 |
| 测试 | `node:test` | 覆盖报名、名额、咨询、后台权限、导出等核心流程 |

目录结构：

```
server/
  index.js        启动入口（首次启动自动写入示例数据）
  app.js          Express 应用装配、错误处理
  db.js           表结构、事务工具
  models.js       档期余量计算等共享查询
  util.js         常量（类型/难度）、校验、限流、脱敏
  seed.js         示例数据
  routes/public.js  用户端接口
  routes/admin.js   后台接口
public/
  index.html, js/app.js, css/style.css   用户端
  admin/index.html, admin.js, admin.css  管理后台
test/api.test.js
```

---

## 7. 迭代路线（建议）

| 阶段 | 内容 |
| --- | --- |
| **v0.2 通知** | 报名/确认/回复时发送短信或邮件；企业微信/钉钉机器人提醒客服有新报名 |
| **v0.3 支付** | 微信支付 / 支付宝在线付定金或全款；超时未付自动释放名额；退款流程 |
| **v0.4 账号** | 手机验证码登录、常用出行人、历史订单、收藏 |
| **v0.5 运营** | 候补名单（满员后排队）、优惠券 / 早鸟价 / 团购价、活动相册与游记、用户评价 |
| **v0.6 多端** | 微信小程序（复用同一套 API）、分享海报、公众号菜单入口 |
| **v1.0 平台化** | 多领队/多俱乐部入驻、角色权限、财务对账、保险接口对接、数据看板 |

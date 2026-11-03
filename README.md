# 山野同行 · 户外活动网页服务

一个支持**户外活动展示介绍、在线预订报名、咨询答复**的网页服务，包含用户端与管理后台。

- 用户端：首页、活动列表（类型/难度/月份/关键词筛选）、活动详情（行程、费用、注意事项、问答）、档期与实时余位、在线报名（多位参与者）、报名查询与自助取消、在线咨询与回复查询
- 管理后台：数据概览、活动与档期管理、报名审核（确认/取消/完成、内部备注）、名单 CSV 导出、咨询回复与公开问答

完整的产品与技术设计见 [docs/DESIGN.md](docs/DESIGN.md)。

## 快速开始

需要 Node.js 22.13 或更高版本（使用内置 SQLite，无需安装数据库）。

```bash
npm install
```

```bash
ADMIN_PASSWORD=你的后台密码 npm start
```

- 用户端：http://localhost:3000
- 管理后台：http://localhost:3000/admin/ （未设置 `ADMIN_PASSWORD` 时默认密码为 `admin123`，仅限本地体验）

首次启动会自动写入 6 个示例活动及档期。重置示例数据：

```bash
npm run seed
```

运行测试：

```bash
npm test
```

## 配置项（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `ADMIN_PASSWORD` | `admin123` | 后台登录密码，**生产环境必须设置** |
| `DB_FILE` | `data/outdoor.db` | SQLite 数据库文件路径 |
| `SITE_NAME` | 山野同行 | 站点名称 |
| `SITE_SLOGAN` | 小团慢行，把周末交给山野 | 首页标语 |
| `SITE_PHONE` / `SITE_WECHAT` / `SITE_EMAIL` / `SITE_ADDRESS` | 示例值 | 联系方式 |

## 目录结构

```
server/        后端（Express 5 + node:sqlite）
public/        用户端单页应用
public/admin/  管理后台
docs/          设计文档
test/          接口测试
```

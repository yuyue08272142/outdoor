'use strict';
const { openDb } = require('./db');
const { createApp } = require('./app');
const { seedIfEmpty } = require('./seed');

const db = openDb();
seedIfEmpty(db);

if (!process.env.ADMIN_PASSWORD) {
  console.warn('[警告] 未设置 ADMIN_PASSWORD，管理后台使用默认密码 admin123，请勿在生产环境使用！');
}

const port = Number(process.env.PORT) || 3080;
const server = createApp(db).listen(port, () => {
  console.log(`户外活动服务已启动：http://localhost:${port}`);
  console.log(`管理后台：http://localhost:${port}/admin/`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[错误] 端口 ${port} 已被其他程序占用（例如 Grafana 默认也使用 3000）。`);
    console.error(`请换一个端口启动，例如：PORT=${port + 1} npm start`);
    process.exit(1);
  }
  throw err;
});

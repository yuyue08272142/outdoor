'use strict';
const path = require('node:path');
const express = require('express');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const { HttpError } = require('./util');

function createApp(db, options = {}) {
  const config = {
    adminPassword: options.adminPassword ?? process.env.ADMIN_PASSWORD ?? 'admin123',
    writeRateLimit: options.writeRateLimit,
    site: {
      name: process.env.SITE_NAME || '山野同行',
      slogan: process.env.SITE_SLOGAN || '小团慢行，把周末交给山野',
      phone: process.env.SITE_PHONE || '400-000-0000',
      wechat: process.env.SITE_WECHAT || 'shanye-outdoor',
      email: process.env.SITE_EMAIL || 'hello@example.com',
      address: process.env.SITE_ADDRESS || '（请在环境变量 SITE_ADDRESS 中配置）',
    },
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '200kb' }));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  app.use('/api', publicRoutes(db, config));
  app.use('/api/admin', adminRoutes(db, config));
  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '请求格式错误' });
    console.error(err);
    res.status(500).json({ error: '服务器开小差了，请稍后再试' });
  });

  return app;
}

module.exports = { createApp };

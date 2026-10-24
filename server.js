'use strict';
// WEN MC Launcher - 云端后端服务
// 版本清单 / 镜像下载(302) / 皮肤 / 登录 / 启动(仅本机) / 安装(仅本机)

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const mc = require('./lib/mc-core.js');

const ROOT = __dirname;
const CONFIG = require('./config.json');
const PORT = parseInt(process.env.PORT, 10) || CONFIG.port || 3000;
const DATA_DIR = path.join(ROOT, CONFIG.dataDir || './data');
const SKIN_DIR = path.join(ROOT, CONFIG.skinDir || './data/skins');
const PUBLIC_DIR = path.join(ROOT, CONFIG.publicDir || './public');

// 仅本机放行（EXE/APK 本地运行时可用；云端对 launch/install 一律 403）
function isLocal(req) {
  const ip = req.ip || req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === '::ffff:127.0.0.1';
}

fs.mkdirSync(SKIN_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/assets', express.static(PUBLIC_DIR, { maxAge: '1h' }));

// ---- 皮肤上传（multer 内存，限 8MB PNG） ----
const skinUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CONFIG.maxSkinBytes || 8388608 }
});

app.post('/api/skin', skinUpload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: '未收到文件' });
    const username = String(req.query.user || req.body.user || '').trim();
    if (!username) return res.status(400).json({ ok: false, error: '缺少用户名' });
    if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) {
      return res.status(400).json({ ok: false, error: '用户名只能含字母数字下划线，最多16位' });
    }
    const sig = req.file.buffer.slice(0, 8);
    if (!sig.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return res.status(400).json({ ok: false, error: '仅支持 PNG 皮肤' });
    }
    fs.writeFileSync(path.join(SKIN_DIR, username + '.png'), req.file.buffer);
    res.json({ ok: true, user: username, url: '/api/skin/' + encodeURIComponent(username) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

app.get('/api/skin/:user', (req, res) => {
  const f = path.join(SKIN_DIR, req.params.user + '.png');
  if (!fs.existsSync(f)) return res.status(404).json({ ok: false, error: '未找到皮肤' });
  res.set('Content-Type', 'image/png');
  res.sendFile(f);
});

// ---- 版本清单 / 详情 ----
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, name: 'WEN MC Launcher', ver: '1.0.0', mirror: CONFIG.mirror, local: isLocal(req) });
});

app.get('/api/versions', async (req, res) => {
  try {
    const manifest = await mc.fetchVersionManifest(CONFIG);
    const list = (manifest.versions || []).map(v => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
    res.json({ ok: true, mirror: CONFIG.mirror, count: list.length, versions: list });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e && e.message || e) });
  }
});

app.get('/api/version/:id', async (req, res) => {
  try {
    const vj = await mc.fetchVersionJson(CONFIG, req.params.id);
    res.json({
      ok: true,
      id: vj.id,
      type: vj.type,
      mainClass: vj.mainClass,
      assetIndex: vj.assetIndex && vj.assetIndex.id,
      libraries: (vj.libraries || []).length,
      clientUrl: mc.mirrorUrl(CONFIG, 'client', vj.id),
      serverUrl: mc.mirrorUrl(CONFIG, 'server', vj.id)
    });
  } catch (e) {
    res.status(404).json({ ok: false, error: String(e && e.message || e) });
  }
});

app.get('/api/version/:id/libraries', async (req, res) => {
  try {
    const vj = await mc.fetchVersionJson(CONFIG, req.params.id);
    const os = String(req.query.os || 'windows');
    const arch = String(req.query.arch || 'x64');
    const libs = mc.resolveLibraries(CONFIG, vj, { os, arch });
    res.json({ ok: true, count: libs.length, libraries: libs });
  } catch (e) {
    res.status(404).json({ ok: false, error: String(e && e.message || e) });
  }
});

// ---- 镜像下载（302 重定向，不占自身流量） ----
app.get('/api/dl/version/:id/client', (req, res) => {
  try { res.redirect(302, mc.mirrorUrl(CONFIG, 'client', req.params.id)); }
  catch (e) { res.status(400).json({ ok: false, error: String(e && e.message || e) }); }
});

app.get('/api/dl/version/:id/server', (req, res) => {
  try { res.redirect(302, mc.mirrorUrl(CONFIG, 'server', req.params.id)); }
  catch (e) { res.status(400).json({ ok: false, error: String(e && e.message || e) }); }
});

app.get('/api/dl/library', (req, res) => {
  try {
    const p = String(req.query.path || '');
    if (!p || p.includes('..') || p.includes('://')) return res.status(400).json({ ok: false, error: '非法路径' });
    res.redirect(302, mc.mavenUrl(CONFIG, p));
  } catch (e) { res.status(400).json({ ok: false, error: String(e && e.message || e) }); }
});

app.get('/api/dl/asset', (req, res) => {
  try {
    const p = String(req.query.path || '');
    if (!p || p.includes('..') || p.includes('://')) return res.status(400).json({ ok: false, error: '非法路径' });
    res.redirect(302, mc.assetUrl(CONFIG, p));
  } catch (e) { res.status(400).json({ ok: false, error: String(e && e.message || e) }); }
});

// ---- 登录（正版/离线） ----
app.post('/api/account/login', (req, res) => {
  try {
    const { username, accessToken, uuid, mode } = req.body || {};
    const name = String(username || '').trim();
    if (!name || !/^[A-Za-z0-9_]{1,16}$/.test(name)) {
      return res.status(400).json({ ok: false, error: '用户名不合法（字母数字下划线，≤16位）' });
    }
    if (mode === 'offline') {
      const offUuid = mc.offlineUuid(name);
      return res.json({ ok: true, mode: 'offline', username: name, uuid: offUuid, accessToken: 'offline-token' });
    }
    // 正版：校验必要字段（真实验证需 Mojang API，此处提供占位校验）
    if (!accessToken || !uuid) return res.status(400).json({ ok: false, error: '正版登录缺少凭证' });
    res.json({ ok: true, mode: 'online', username: name, uuid, accessToken });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

// ---- 仅本机：安装版本 / 启动 ----
app.post('/api/install/version', (req, res) => {
  if (!isLocal(req)) return res.status(403).json({ ok: false, error: '云端不允许安装操作' });
  res.json({ ok: true, hint: 'install 由客户端本地执行' });
});

app.post('/api/launch', (req, res) => {
  if (!isLocal(req)) return res.status(403).json({ ok: false, error: '云端不允许启动操作' });
  try {
    const { id, username, uuid, accessToken, gameDir, maxMem, javaArgs } = req.body || {};
    // 轻量校验 + 参数回显（真实启动由客户端本地完成）
    res.json({
      ok: true,
      launcherArgs: {
        version: id,
        username,
        uuid,
        gameDir,
        maxMem,
        nativesDir: javaArgs && javaArgs.nativesDir
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

// ---- 兜底路由：根路径 ----
app.get('/', (req, res) => {
  res.redirect('/assets/');
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: '接口不存在' });
  res.status(404).send('Not Found');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('[WEN-MC-Launcher] 服务已启动: http://0.0.0.0:' + PORT);
});

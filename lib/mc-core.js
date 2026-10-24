'use strict';
// WEN MC Launcher - Minecraft 核心工具库
// 版本清单 / 库解析 / 镜像地址构造 / 离线UUID / 启动参数

const crypto = require('crypto');

const DEFAULTS = {
  mirror: 'bmclapi',
  mirrors: {
    bmclapi: { base: 'https://bmclapi2.bangbang93.com', manifest: '/mc/game/version_manifest_v2.json' },
    mojang: { base: 'https://piston-meta.mojang.com', manifest: '/mc/game/version_manifest_v2.json' }
  },
  versionJsonPath: '/version/{id}/json',
  clientJarPath: '/version/{id}/client',
  serverJarPath: '/version/{id}/server',
  mavenPath: '/maven/',
  assetsPath: '/assets/',
  launcherMetaBase: 'https://launchermeta.mojang.com',
  launcherFilesBase: 'https://launcher.mojang.com',
  librariesNetBase: 'https://libraries.minecraft.net',
  cacheTtlMs: 600000
};

// ---- 版本清单 ----
async function fetchVersionManifest(cfg, force) {
  const m = (cfg.mirrors && cfg.mirrors[cfg.mirror]) || cfg.mirrors.bmclapi;
  const url = m.base + m.manifest;
  const cacheKey = 'manifest:' + cfg.mirror;
  if (!force && global.__mcCache && global.__mcCache[cacheKey] &&
      (Date.now() - global.__mcCache[cacheKey].t) < cfg.cacheTtlMs) {
    return global.__mcCache[cacheKey].data;
  }
  const resp = await fetch(url, { headers: { 'User-Agent': 'WEN-MC-Launcher/1.0' } });
  if (!resp.ok) throw new Error('版本清单拉取失败: HTTP ' + resp.status + ' ' + url);
  const data = await resp.json();
  if (!global.__mcCache) global.__mcCache = {};
  global.__mcCache[cacheKey] = { t: Date.now(), data };
  return data;
}

// ---- 版本 JSON ----
async function fetchVersionJson(cfg, id, force) {
  const m = (cfg.mirrors && cfg.mirrors[cfg.mirror]) || cfg.mirrors.bmclapi;
  const cacheKey = 'ver:' + cfg.mirror + ':' + id;
  if (!force && global.__mcCache && global.__mcCache[cacheKey] &&
      (Date.now() - global.__mcCache[cacheKey].t) < cfg.cacheTtlMs) {
    return global.__mcCache[cacheKey].data;
  }
  // 优先镜像站路径
  let url = m.base + cfg.versionJsonPath.replace('{id}', encodeURIComponent(id));
  let resp = await fetch(url, { headers: { 'User-Agent': 'WEN-MC-Launcher/1.0' } });
  if (!resp.ok) {
    // 回退 Mojang 官方 meta
    const metaUrl = cfg.launcherMetaBase + '/v1/packages/' + id + '/' + id + '.json';
    resp = await fetch(metaUrl, { headers: { 'User-Agent': 'WEN-MC-Launcher/1.0' } });
    if (!resp.ok) throw new Error('版本详情拉取失败: ' + id);
  }
  const data = await resp.json();
  if (!global.__mcCache) global.__mcCache = {};
  global.__mcCache[cacheKey] = { t: Date.now(), data };
  return data;
}

// ---- 下载地址构造（302 用） ----
function mirrorUrl(cfg, kind, id) {
  const m = (cfg.mirrors && cfg.mirrors[cfg.mirror]) || cfg.mirrors.bmclapi;
  switch (kind) {
    case 'client':
      return m.base + cfg.clientJarPath.replace('{id}', encodeURIComponent(id));
    case 'server':
      return m.base + cfg.serverJarPath.replace('{id}', encodeURIComponent(id));
    case 'json':
      return m.base + cfg.versionJsonPath.replace('{id}', encodeURIComponent(id));
    default:
      throw new Error('未知下载类型: ' + kind);
  }
}

function mavenUrl(cfg, path) {
  const m = (cfg.mirrors && cfg.mirrors[cfg.mirror]) || cfg.mirrors.bmclapi;
  return m.base + cfg.mavenPath + path;
}

function assetUrl(cfg, path) {
  const m = (cfg.mirrors && cfg.mirrors[cfg.mirror]) || cfg.mirrors.bmclapi;
  return m.base + cfg.assetsPath + path;
}

// ---- 库坐标 → 路径 ----
function libraryPath(lib) {
  if (typeof lib === 'string') return { name: lib, rules: undefined, url: null };
  return { name: lib.name, rules: lib.rules, url: lib.url || null };
}

function coordsToPath(name) {
  // group:artifact:version[:classifier]
  const parts = name.split(':');
  if (parts.length < 3) return null;
  const group = parts[0].replace(/\./g, '/');
  const artifact = parts[1];
  const version = parts[2];
  const classifier = parts.length > 3 ? '-' + parts[3] : '';
  const base = group + '/' + artifact + '/' + version + '/' + artifact + '-' + version + classifier;
  let ext = '.jar';
  if (name.includes('native') || classifier === '-sources' || classifier === '-javadoc') {
    const m = name.match(/-([a-z0-9_]+)$/);
    if (m && ['windows', 'linux', 'osx', 'macos'].some(k => m[1].toLowerCase().startsWith(k))) ext = '.jar';
  }
  return { path: base + ext, name };
}

function allowLibrary(lib, platform) {
  if (!lib.rules) return true;
  for (const rule of lib.rules) {
    let ok = true;
    if (rule.os) {
      const osName = (platform.os || 'windows').toLowerCase();
      const osMap = { windows: 'windows', linux: 'linux', osx: 'osx', mac: 'osx' };
      ok = (osMap[osName] || osName) === (rule.os.name || '').toLowerCase();
      if (rule.os.arch) ok = ok && (platform.arch || 'x64') === rule.os.arch;
    }
    if (rule.features && rule.features.is_demo_user !== undefined) ok = false;
    if (rule.action === 'disallow') ok = !ok;
    if (!ok) return false;
  }
  return true;
}

// ---- 解析版本库列表 ----
function resolveLibraries(cfg, versionJson, platform) {
  const libs = (versionJson.libraries || []).map(libraryPath)
    .filter(lib => allowLibrary(lib, platform || { os: 'windows', arch: 'x64' }))
    .map(lib => {
      const c = coordsToPath(lib.name);
      if (!c) return null;
      const path = c.path;
      const dl = lib.url ? lib.url + path : mavenUrl(cfg, path);
      return {
        name: lib.name,
        path,
        url: dl,
        natives: lib.natives || null
      };
    })
    .filter(Boolean);
  return libs;
}

// ---- 离线 UUID（UUID v3，兼容官方离线规则） ----
function offlineUuid(username) {
  const data = 'OfflinePlayer:' + username;
  const md5 = crypto.createHash('md5').update(data, 'utf8').digest();
  const bytes = Buffer.from(md5);
  bytes[6] = (bytes[6] & 0x0f) | 0x30; // version 3
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const hex = bytes.toString('hex');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}

// ---- 启动参数构造 ----
function buildLaunchArgs(cfg, opts) {
  const { id, versionJson, username, uuid, accessToken, gameDir, assetsDir, javaArgs } = opts;
  const args = [];
  const push = (a) => { if (a) args.push(a); };

  // JVM 基础
  push('-Xmx' + (opts.maxMem || '2G'));
  push('-XX:+UnlockExperimentalVMOptions');
  push('-XX:+UseG1GC');
  push('-Djava.library.path=' + javaArgs.nativesDir);
  push('-Dminecraft.launcher.brand=WEN-MC-Launcher');
  push('-Dminecraft.launcher.version=1.0.0');

  // 版本参数（1.13+ arguments.jvm / 老版本 minecraftArguments）
  const versionArgs = [];
  if (versionJson.arguments && versionJson.arguments.game) {
    versionJson.arguments.game.forEach(a => {
      if (typeof a === 'string') versionArgs.push(a);
    });
  } else if (versionJson.minecraftArguments) {
    versionArgs.push(versionJson.minecraftArguments);
  }
  versionArgs.forEach(a => {
    push(a
      .replace('${auth_player_name}', username)
      .replace('${version_name}', id)
      .replace('${game_directory}', gameDir)
      .replace('${assets_root}', assetsDir)
      .replace('${assets_index_name}', (versionJson.assetIndex && versionJson.assetIndex.id) || 'legacy')
      .replace('${auth_uuid}', uuid)
      .replace('${auth_access_token}', accessToken)
      .replace('${user_type}', 'legacy')
      .replace('${version_type}', versionJson.type || 'release')
      .replace('${auth_session}', 'token:' + accessToken + ':' + uuid));
  });

  return args.filter(Boolean);
}

module.exports = {
  DEFAULTS,
  fetchVersionManifest,
  fetchVersionJson,
  mirrorUrl,
  mavenUrl,
  assetUrl,
  resolveLibraries,
  offlineUuid,
  buildLaunchArgs
};

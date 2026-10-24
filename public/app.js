'use strict';
/* WEN MC Launcher - 前端逻辑（三态：EXE / APK / Web） */

(function () {
  const $ = (s) => document.querySelector(s);
  const NATIVE = window.mcNative;      // EXE 注入
  const ANDROID = window.MCAndroid;    // APK 注入
  const IS_EXE = !!NATIVE;
  const IS_APK = !!ANDROID;
  const MODE = IS_EXE ? 'exe' : (IS_APK ? 'apk' : 'web');

  const STATE = {
    user: '',
    uuid: '',
    accessToken: '',
    mode: 'offline',
    versions: [],
    selectedVer: ''
  };

  // 皮肤存储前缀（EXE/APK 在各自 .Minecraft 下）
  const SKIN_PREFIX = '.Minecraft/CustomSkinLoader/skins/';
  const VER_PREFIX = '.Minecraft/versions/';

  function setState(el, msg, cls) {
    const e = $(el);
    if (!e) return;
    e.textContent = msg;
    e.className = 'state ' + (cls || '');
  }

  // ---- 连接检查 ----
  async function checkConn() {
    const badge = $('#connBadge');
    try {
      const r = await fetch('/api/ping', { cache: 'no-store' });
      const j = await r.json();
      badge.textContent = (j.ok ? '● 已连接云端 / 本地服务' : '● 服务异常') + ' · ' + MODE.toUpperCase();
      badge.className = 'conn ' + (j.ok ? 'ok' : 'bad');
      return j.ok;
    } catch (e) {
      badge.textContent = '✕ 服务不可达（' + MODE.toUpperCase() + '）';
      badge.className = 'conn bad';
      return false;
    }
  }

  // ---- 版本列表 ----
  async function loadVersions() {
    setState('#loginState', '');
    $('#btnRefresh').disabled = true;
    try {
      const r = await fetch('/api/versions', { cache: 'no-store' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || '获取失败');
      STATE.versions = j.versions || [];
      $('#verCount').textContent = '共 ' + j.count + ' 个版本 · ' + j.mirror + ' 镜像';
      renderVersions();
    } catch (e) {
      setState('#loginState', '版本列表加载失败: ' + e.message, 'bad');
    } finally {
      $('#btnRefresh').disabled = false;
    }
  }

  function renderVersions() {
    const list = $('#verList');
    list.innerHTML = '';
    const top = ['release', 'snapshot', 'old_beta', 'old_alpha'];
    const sorted = STATE.versions.slice().sort((a, b) => {
      const ta = top.indexOf(a.type), tb = top.indexOf(b.type);
      if (ta !== tb) return (ta === -1 ? 99 : ta) - (tb === -1 ? 99 : tb);
      return (b.releaseTime || '').localeCompare(a.releaseTime || '');
    });
    sorted.slice(0, 60).forEach(v => {
      const item = document.createElement('div');
      item.className = 'ver-item ' + (v.type === 'release' ? 'release' : '');
      item.innerHTML =
        '<span class="vid">' + esc(v.id) + '</span>' +
        '<span class="vtype">' + esc(v.type) + '</span>' +
        '<span class="ops">' +
        '  <button class="mc-btn green small" data-act="play" data-id="' + esc(v.id) + '">启动</button>' +
        '  <button class="mc-btn blue small" data-act="dl" data-id="' + esc(v.id) + '">下载版本</button>' +
        '  <button class="mc-btn gray small" data-act="libs" data-id="' + esc(v.id) + '">库</button>' +
        '</span>';
      item.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button');
        if (!btn) return;
        const act = btn.dataset.act, id = btn.dataset.id;
        STATE.selectedVer = id;
        if (act === 'play') onPlay(id);
        else if (act === 'dl') onDownloadVersion(id);
        else if (act === 'libs') onShowLibs(id);
      });
      list.appendChild(item);
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---- 下载版本 jar（落盘 .Minecraft/versions/<id>/） ----
  async function onDownloadVersion(id) {
    setState('#loginState', '');
    if (!STATE.user) { setState('#loginState', '请先登录', 'bad'); return; }
    if (IS_EXE) {
      try {
        const name = VER_PREFIX + id + '/' + id + '.jar';
        await NATIVE.installFile('/api/dl/version/' + encodeURIComponent(id) + '/client', name);
        setState('#loginState', '✅ 客户端 jar 已下载到 ' + name, 'ok');
      } catch (e) { setState('#loginState', '下载失败: ' + e, 'bad'); }
    } else if (IS_APK) {
      try {
        await ANDROID.download('/api/dl/version/' + encodeURIComponent(id) + '/client',
          VER_PREFIX + id + '/' + id + '.jar');
        setState('#loginState', '✅ 客户端 jar 已下载到 ' + VER_PREFIX + id + '/', 'ok');
      } catch (e) { setState('#loginState', '下载失败: ' + e, 'bad'); }
    } else {
      window.open('/api/dl/version/' + encodeURIComponent(id) + '/client', '_blank');
      setState('#loginState', '网页版：已在浏览器打开下载直链（需配合本地启动器使用）', 'ok');
    }
  }

  // ---- 库列表 ----
  async function onShowLibs(id) {
    setState('#loginState', '');
    try {
      const r = await fetch('/api/version/' + encodeURIComponent(id) + '/libraries?os=windows&arch=x64');
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || '获取失败');
      const libs = (j.libraries || []).slice(0, 30)
        .map(l => '<div class="hint">· ' + esc(l.name) + '</div>').join('');
      setState('#loginState', '版本 ' + esc(id) + ' 库（前30条，共' + j.count + '条）：' + libs, 'ok');
    } catch (e) { setState('#loginState', '库获取失败: ' + e.message, 'bad'); }
  }

  // ---- 启动 ----
  async function onPlay(id) {
    setState('#loginState', '');
    if (!STATE.user) { setState('#loginState', '请先登录', 'bad'); return; }
    const payload = {
      id, username: STATE.user, uuid: STATE.uuid, accessToken: STATE.accessToken,
      mode: STATE.mode, gameDir: '.Minecraft'
    };
    if (IS_EXE) {
      try { await NATIVE.launch(payload); setState('#loginState', '✅ 已发起启动（Java 环境需已安装）', 'ok'); }
      catch (e) { setState('#loginState', '启动失败: ' + e, 'bad'); }
    } else if (IS_APK) {
      try { await ANDROID.launch(payload); setState('#loginState', '✅ 已发起启动', 'ok'); }
      catch (e) { setState('#loginState', '启动失败: ' + e, 'bad'); }
    } else {
      setState('#loginState', '网页版无法直接启动游戏，请使用 EXE/APK 客户端', 'ok');
    }
  }

  // ---- 登录 ----
  async function doLogin() {
    const name = $('#inpUser').value.trim();
    if (!name) { setState('#loginState', '请输入玩家名', 'bad'); return; }
    const mode = STATE.mode;
    try {
      const body = { username: name, mode };
      if (mode === 'online') {
        body.accessToken = $('#inpToken').value.trim();
        body.uuid = $('#inpUuid').value.trim();
      }
      const r = await fetch('/api/account/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || '登录失败');
      STATE.user = j.username; STATE.uuid = j.uuid; STATE.accessToken = j.accessToken;
      setState('#loginState', '✅ 已登录：' + j.username + '（' + j.mode + '）' + (j.uuid ? ' · ' + j.uuid : ''), 'ok');
      if (j.mode === 'offline') $('#inpToken').value = $('#inpUuid').value = '';
      refreshSkin();
    } catch (e) { setState('#loginState', '登录失败: ' + e.message, 'bad'); }
  }

  // ---- 皮肤 ----
  function refreshSkin() {
    const pv = $('#skinPreview');
    if (STATE.user) pv.innerHTML = '<img src="/api/skin/' + encodeURIComponent(STATE.user) + '?t=' + Date.now() + '" alt="skin">';
    else pv.textContent = '暂无皮肤';
  }

  async function uploadSkin(file) {
    setState('#skinState', '');
    if (!STATE.user) { setState('#skinState', '请先登录再上传皮肤', 'bad'); return; }
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setState('#skinState', '皮肤不能超过 8MB', 'bad'); return; }
    if (!/\.png$/i.test(file.name)) { setState('#skinState', '仅支持 PNG', 'bad'); return; }
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await fetch('/api/skin?user=' + encodeURIComponent(STATE.user), { method: 'POST', body: fd });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || '上传失败');
      setState('#skinState', '✅ 已上传，皮肤文件：' + SKIN_PREFIX + STATE.user + '.png', 'ok');
      refreshSkin();
    } catch (e) { setState('#skinState', '上传失败: ' + e.message, 'bad'); }
  }

  // ---- 外部下载源 ----
  function openHelper(url) {
    if (IS_EXE) { try { NATIVE.openExternal(url); } catch (e) { window.open(url, '_blank'); } }
    else window.open(url, '_blank');
  }

  // ---- 事件绑定 ----
  function bind() {
    document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      STATE.mode = b.dataset.mode;
      $('#onlineFields').style.display = STATE.mode === 'online' ? 'block' : 'none';
    }));
    $('#btnLogin').addEventListener('click', doLogin);
    $('#inpUser').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    $('#btnRefresh').addEventListener('click', loadVersions);
    $('#btnSkin').addEventListener('click', () => $('#inpSkin').click());
    $('#inpSkin').addEventListener('change', e => uploadSkin(e.target.files[0]));
    $('#btnModHelp').addEventListener('click', () => openHelper('https://modrinth.com/mods'));
    $('#btnShaderHelp').addEventListener('click', () => openHelper('https://www.curseforge.com/minecraft/shaders'));
    $('#btnTexHelp').addEventListener('click', () => openHelper('https://www.curseforge.com/minecraft/texture-packs'));
    $('#btnResHelp').addEventListener('click', () => openHelper('https://resourcepacks.curseforge.com/'));
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      document.querySelectorAll('.tab-body').forEach(x => x.style.display = 'none');
      $('#tab-' + t.dataset.tab).style.display = 'block';
    }));
  }

  async function init() {
    bind();
    await checkConn();
    loadVersions();
    const saved = localStorage.getItem('wenmc_user');
    if (saved) { STATE.user = saved; $('#inpUser').value = saved; refreshSkin(); }
    if (IS_EXE) setState('#loginState', 'EXE 客户端模式：数据落盘 ' + SKIN_PREFIX + ' / ' + VER_PREFIX, 'ok');
    else if (IS_APK) setState('#loginState', 'APK 客户端模式：数据落盘 .Minecraft 目录', 'ok');
  }
  init();
})();

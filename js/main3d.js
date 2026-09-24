/* LaserBeam 3D - game flow, input, UI, save data */
import * as C from './core3d.js';
import { BUDGET } from './budget3d.js';
import { R } from './render3d.js';
import * as GEAR from './gear.js';
import { openShop } from './shop.js';

const A = window.LB.Audio;
const $ = (id) => document.getElementById(id);
const N = C.STAGE_COUNT;
C.setBudget(BUDGET);

/* ------------------------------------------------------------------ save */
const SAVE_KEY = 'laserbeam_save_v1';
const save = { unlocked: 1, stars: [], best: [], seen: {}, settings: { sfx: true, music: true, vib: true, quality: 'high' } };
function loadSave() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (d) { Object.assign(save, d); save.settings = Object.assign({ sfx: true, music: true, vib: true, quality: 'high' }, d.settings || {}); }
  } catch (e) { /* storage unavailable */ }
  if (typeof save.pt !== 'number') save.pt = 300 + totalStars() * 20;
  save.owned = Array.from(new Set([...(save.owned || []), ...GEAR.FREE]));
  save.equip = Object.assign({}, GEAR.DEFAULT_EQUIP, save.equip || {});
  for (const k of Object.keys(save.equip)) if (!save.owned.includes(save.equip[k])) save.equip[k] = GEAR.DEFAULT_EQUIP[k];
}
function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }
const totalStars = () => save.stars.reduce((a, b) => a + (b || 0), 0);
const gearNow = () => GEAR.computeGear(save.equip);
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); }
function vib(ms) { if (save.settings.vib && navigator.vibrate) try { navigator.vibrate(ms); } catch (e) { /* ignore */ } }

/* ----------------------------------------------------------------- state */
const game = {
  mode: 'title', sim: null, stageN: 1, paused: false, acc: 0,
  slowT: 0, slowScale: 1, zoomT: 0,
  pointer: null, endT: -1, resultShown: false,
  demoNext: 0, demoClearT: -1, lastHud: {}, lastHit: null,
};

function stageHue(n) {
  const sec = Math.floor((n - 1) / 50);
  return sec === 19 ? (n * 47) % 360 : C.SECTORS[sec][1];
}
function setThemeHue(h) {
  R.setHue(h);
  document.documentElement.style.setProperty('--hue', Math.round(((h % 360) + 360) % 360));
}

/* --------------------------------------------------------------- screens */
function show(id) { for (const s of ['scrTitle', 'scrSelect', 'scrShop']) $(s).classList.toggle('hidden', s !== id); }
function toShop(back) {
  game.shopBack = back;
  if (game.mode === 'play') startDemo();
  game.mode = 'shop';
  closeModal(); hud(false); show('scrShop');
  openShop({ save, writeSave, A, toast });
}
function hud(on) { $('hud').classList.toggle('hidden', !on); }
function openModal(html, cls) {
  $('modalCard').innerHTML = html;
  $('modalCard').className = 'modal-card' + (cls ? ' ' + cls : '');
  $('modal').classList.remove('hidden');
}
function closeModal() { $('modal').classList.add('hidden'); }
const modalOpen = () => !$('modal').classList.contains('hidden');

function banner(b1, b2, b3, warn) {
  const el = $('banner');
  el.className = 'banner' + (warn ? ' warn' : '');
  el.innerHTML = `<div class="b1">${b1}</div><div class="b2">${b2}</div>${b3 ? `<div class="b3">${b3}</div>` : ''}`;
  void el.offsetWidth; el.classList.add('show');
}
function comboBanner(c) {
  const el = $('combo');
  const word = c >= 12 ? 'CYBER RAMPAGE' : c >= 8 ? 'OVERLOAD' : c >= 5 ? 'GREAT' : 'COMBO';
  el.innerHTML = `<small>${word}</small>${c} HITS!`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

/* ------------------------------------------------------------------ title */
function toTitle() {
  game.mode = 'title';
  closeModal(); hud(false); show('scrTitle');
  $('btnShop').innerHTML = `LASER SHOP<span class="sm">${save.pt.toLocaleString()} PT</span>`;
  $('btnStart').innerHTML = save.unlocked > 1 ? `CONTINUE<span class="sm">STAGE ${Math.min(save.unlocked, N)}</span>` : 'START';
  startDemo();
  A.startMusic(99, 0.8);
}
function startDemo() {
  const n = 1 + Math.floor(Math.random() * 120);
  const st = C.getStage(n);
  st.lasers = 999;
  game.sim = new C.Sim(st);
  game.demoNext = 2.2; game.demoClearT = -1;
  setThemeHue(stageHue(n));
  R.setStage(game.sim);
  R.zoom = 0;
}
function demoTick(dt) {
  const sim = game.sim;
  if (!sim) return;
  if (sim.state !== 'play') {
    if (game.demoClearT < 0) game.demoClearT = 2.4;
    game.demoClearT -= dt;
    if (game.demoClearT <= 0) startDemo();
    return;
  }
  if (sim.shots > 50) { startDemo(); return; }
  game.demoNext -= dt;
  if (game.demoNext > 0) return;
  game.demoNext = 1.0 + Math.random() * 0.8;
  let target = null;
  for (const s of sim.shields) if (s.active) { const g = s.gens.find((q) => q.lb.alive); if (g) target = g.position; }
  if (!target) {
    const alive = sim.targets.filter((b) => b.lb.alive && !b.lb.cleared && !sim.isPhased(b));
    if (!alive.length) return;
    target = alive[Math.floor(Math.random() * alive.length)].position;
  }
  const o = R.camera().position;
  const d = { x: target.x - o.x + (Math.random() - 0.5) * 0.5, y: target.y - o.y, z: target.z - o.z };
  const l = Math.hypot(d.x, d.y, d.z);
  sim.fire({ x: o.x, y: o.y, z: o.z }, { x: d.x / l, y: d.y / l, z: d.z / l });
}

/* ------------------------------------------------------------ stage flow */
function startStage(n) {
  n = Math.max(1, Math.min(N, n));
  game.stageN = n;
  const st = C.getStage(n);
  game.sim = new C.Sim(st, { gear: gearNow() });
  game.mode = 'play'; game.paused = false; game.acc = 0;
  game.endT = -1; game.resultShown = false; game.slowT = 0; game.zoomT = 0;
  R.zoom = 0; R.aimWorld = null; hideReticle();
  setThemeHue(stageHue(n));
  closeModal(); show(null); hud(true);
  R.setStage(game.sim);
  game.lastHud = {};
  $('hudStage').textContent = 'STAGE ' + n;
  $('hudSector').textContent = `Lv.${C.difficultyLevel(n)} // ${st.sectorName}`;
  A.startMusic(st.boss ? 90 + (st.bossKind === 'omega' ? 1 : 0) : st.sector, st.boss ? 1.5 : 1);
  A.play('start');
  if (st.intro && !save.seen[st.intro]) {
    game.paused = true;
    showIntro(st.intro, () => { save.seen[st.intro] = 1; writeSave(); game.paused = false; R.introT = 0; stageBanner(st); });
  } else stageBanner(st);
}
function diffMeter(n) {
  const lv = C.difficultyLevel(n);
  let bars = '';
  for (let i = 1; i <= 10; i++) bars += `<i class="${i <= lv ? 'on' : ''}" style="--lv:${i}"></i>`;
  return `<span class="diff">DIFFICULTY <span class="bars">${bars}</span> Lv.${lv}</span>`;
}
function stageBanner(st) {
  if (st.boss) banner(st.bossKind === 'omega' ? '⚠ SECTOR BOSS ⚠' : '⚠ WARNING ⚠', st.bossName, `STAGE ${st.n}<br>${diffMeter(st.n)}`, true);
  else banner(`SECTOR ${String(st.sector + 1).padStart(2, '0')} ─ ${st.sectorName}`, 'STAGE ' + st.n, `LASER × ${game.sim.lasers}${game.sim.gear.extra ? ` <span class="xtra">(+${game.sim.gear.extra})</span>` : ''}<br>${diffMeter(st.n)}`);
}
function showIntro(key, done) {
  const gm = C.GIMMICKS[key];
  const map = {
    star: ['star', 'box'], turntable: ['normal', 'round'], armor: ['armor', 'box'], orb: ['normal', 'orb'], bomb: ['bomb', 'box'],
    moving: ['normal', 'plank'], orbit: ['normal', 'box'], rotor: ['normal', 'box'], steel: ['steel', 'box'], spinner: ['steel', 'plank'],
    tether: ['normal', 'box'], float: ['normal', 'box'], rock: ['normal', 'plank'], shield: ['gen', 'gen'],
    bossGuardian: ['core', 'core'], bossTwin: ['core', 'core'], bossFortress: ['core', 'core'], bossShield: ['gen', 'gen'], bossOmega: ['core', 'core'],
    crystal: ['crystal', 'box'], phase: ['phase', 'box'], lowgrav: ['normal', 'orb'], elevator: ['normal', 'plank'],
  };
  const m = map[key] || ['normal', 'box'];
  openModal(`
    <div class="intro-badge">NEW GIMMICK</div>
    <canvas class="intro-ico" id="introIco"></canvas>
    <div class="intro-name">${gm.name}</div>
    <div class="intro-desc">${gm.desc}</div>
    <div class="btns"><button class="neon-btn" id="btnIntroOk">OK</button></div>`);
  const icon = R.iconCanvas(m[0], m[1], 96);
  const c = $('introIco'); c.width = icon.width; c.height = icon.height; c.getContext('2d').drawImage(icon, 0, 0);
  $('btnIntroOk').onclick = () => { A.play('ui'); closeModal(); done(); };
}

function onClear() {
  const sim = game.sim, n = game.stageN;
  const stars = sim.stars();
  const bonus = sim.lasers * 500;
  const total = sim.score + bonus;
  const prevBest = save.best[n - 1] || 0;
  const newRec = total > prevBest;
  const first = !(save.stars[n - 1] > 0);
  const pt = GEAR.ptReward(n, stars, total, first, sim.stage.boss, sim.gear.ptMul);
  save.pt += pt;
  save.stars[n - 1] = Math.max(save.stars[n - 1] || 0, stars);
  if (newRec) save.best[n - 1] = total;
  save.unlocked = Math.max(save.unlocked, Math.min(N, n + 1));
  writeSave();
  const starSvg = '<svg viewBox="0 0 24 24"><path d="M12 1.8l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.9l-6.4 3.5 1.4-7.1-5.3-5 7.2-.9z"/></svg>';
  openModal(`
    <h2>STAGE CLEAR</h2>
    <div class="sub">STAGE ${n} ─ ${sim.stage.sectorName}</div>
    <div class="res-stars">${[0, 1, 2].map(() => `<div class="res-star">${starSvg}</div>`).join('')}</div>
    <table class="res-table">
      <tr><td>DESTRUCTION</td><td>${sim.score.toLocaleString()}</td></tr>
      <tr><td>LASER BONUS (${sim.lasers} × 500)</td><td>${bonus.toLocaleString()}</td></tr>
      <tr class="total"><td>TOTAL</td><td>${total.toLocaleString()}</td></tr>
    </table>
    <div class="pt-gain">+${pt.toLocaleString()} PT${first ? '' : ' <small>(再クリア)</small>'}<span>所持 ${save.pt.toLocaleString()} PT</span></div>
    ${newRec && prevBest > 0 ? '<div class="newrec">NEW RECORD!</div>' : ''}
    <div class="btns">
      ${n < N ? '<button class="neon-btn big" id="btnNext">NEXT STAGE</button>' : '<button class="neon-btn gold big" id="btnNext">ALL CLEAR!</button>'}
      <div class="row"><button class="neon-btn ghost" id="btnRetry">RETRY</button><button class="neon-btn ghost" id="btnShopR">SHOP</button><button class="neon-btn ghost" id="btnMenu">STAGES</button></div>
    </div>`);
  $('btnShopR').onclick = () => { A.play('ui'); toShop(() => startStage(Math.min(N, n + 1))); };
  const els = document.querySelectorAll('.res-star');
  for (let i = 0; i < stars; i++) setTimeout(() => { els[i].classList.add('on'); A.play('star', { i }); vib(20); }, 350 + i * 320);
  $('btnNext').onclick = () => { A.play('ui'); if (n < N) startStage(n + 1); else toSelect(); };
  $('btnRetry').onclick = () => { A.play('ui'); startStage(n); };
  $('btnMenu').onclick = () => { A.play('ui'); toSelect(); };
}
function onFail() {
  const sim = game.sim;
  openModal(`
    <h2 class="fail">SYSTEM FAILURE</h2>
    <div class="sub fail">OUT OF LASER ENERGY</div>
    <div class="jp" style="font-size:13px;color:#cfe0f5;margin:6px 0 2px">残りターゲット <b style="color:#fff">${sim.targetsLeft}</b> / ${sim.targetsTotal}</div>
    <div class="jp" style="font-size:11px;color:var(--dim)">${sim.stage.boss ? 'ヒント：装甲や壁の隙間がコアの正面に来た瞬間を狙おう' : 'ヒント：支えている脚や柱を撃ち抜くと一気に崩れる'}</div>
    <div class="btns">
      <button class="neon-btn big" id="btnRetry">RETRY</button>
      <button class="neon-btn ghost" id="btnMenu">STAGES</button>
    </div>`);
  $('btnRetry').onclick = () => { A.play('ui'); startStage(game.stageN); };
  $('btnMenu').onclick = () => { A.play('ui'); toSelect(); };
}

function pause() {
  if (game.mode !== 'play' || modalOpen()) return;
  game.paused = true; hideReticle(); game.pointer = null;
  A.duckMusic(0.3);
  openModal(`
    <h2>PAUSE</h2>
    <div class="sub">STAGE ${game.stageN}</div>
    <div class="btns">
      <button class="neon-btn big" id="btnResume">RESUME</button>
      <div class="row"><button class="neon-btn ghost" id="btnRetry">RETRY</button><button class="neon-btn ghost" id="btnMenu">STAGES</button></div>
      <button class="neon-btn ghost" id="btnHow">HOW TO PLAY</button>
      <div class="row">
        <button class="neon-btn ghost sub" id="btnSfx">SFX: ${save.settings.sfx ? 'ON' : 'OFF'}</button>
        <button class="neon-btn ghost sub" id="btnBgm">BGM: ${save.settings.music ? 'ON' : 'OFF'}</button>
      </div>
    </div>`);
  $('btnResume').onclick = resume;
  $('btnRetry').onclick = () => { A.play('ui'); A.duckMusic(1); startStage(game.stageN); };
  $('btnMenu').onclick = () => { A.play('ui'); A.duckMusic(1); toSelect(); };
  $('btnHow').onclick = () => { A.play('ui'); howTo(pause); };
  $('btnSfx').onclick = () => { save.settings.sfx = !save.settings.sfx; A.setSfx(save.settings.sfx); writeSave(); closeModal(); pause(); };
  $('btnBgm').onclick = () => { save.settings.music = !save.settings.music; A.setMusic(save.settings.music); writeSave(); closeModal(); pause(); };
}
function resume() { A.play('ui'); closeModal(); game.paused = false; A.duckMusic(1); }

function howTo(back) {
  const wasPlay = game.mode === 'play';
  openModal(`
    <h2>HOW TO PLAY</h2>
    <div class="sub">ミッション</div>
    <ul class="help">
      <li>画面をタップ（指を離した位置）に向かってレーザーを撃ち込む。</li>
      <li>当たったブロックは破壊され、後ろのブロックは奥へ押し出される。着弾点の衝撃波で周囲も吹き飛ぶ。</li>
      <li>すべてのターゲットを<b>破壊するか台座から落とせば</b>クリア。</li>
      <li>支えの<b>脚や柱</b>を撃ち抜くと、上の塊ごと一気に崩れ落ちる。</li>
      <li>回転する台座は、狙いたい面がこちらを向いた瞬間に撃とう。</li>
      <li>残りレーザーが多いほど高スコア＆★が増える。連続破壊でコンボ！</li>
    </ul>
    <div class="btns"><button class="neon-btn" id="btnHowOk">OK</button></div>`);
  $('btnHowOk').onclick = () => { A.play('ui'); closeModal(); if (back && wasPlay) back(); };
}

function settings() {
  const s = save.settings;
  openModal(`
    <h2>SETTINGS</h2>
    <div class="sub">SYSTEM CONFIG</div>
    <div class="set-row"><div>SOUND FX<span class="jp">効果音</span></div><button class="toggle ${s.sfx ? 'on' : ''}" id="tSfx"></button></div>
    <div class="set-row"><div>MUSIC<span class="jp">BGM</span></div><button class="toggle ${s.music ? 'on' : ''}" id="tBgm"></button></div>
    <div class="set-row"><div>VIBRATION<span class="jp">振動（対応端末のみ）</span></div><button class="toggle ${s.vib ? 'on' : ''}" id="tVib"></button></div>
    <div class="set-row"><div>GRAPHICS<span class="jp">画質（LOWで軽量化）</span></div>
      <div class="seg"><button id="qHigh" class="${s.quality === 'high' ? 'on' : ''}">HIGH</button><button id="qLow" class="${s.quality === 'low' ? 'on' : ''}">LOW</button></div></div>
    <div class="btns">
      <button class="neon-btn ghost" id="btnHow2">HOW TO PLAY</button>
      <button class="neon-btn" id="btnSetOk">OK</button>
    </div>
    <button class="danger-link" id="btnReset">セーブデータをリセット</button>`);
  const tog = (id, key, fn) => { $(id).onclick = () => { s[key] = !s[key]; $(id).classList.toggle('on', s[key]); if (fn) fn(s[key]); writeSave(); A.play('ui'); }; };
  tog('tSfx', 'sfx', (v) => A.setSfx(v));
  tog('tBgm', 'music', (v) => A.setMusic(v));
  tog('tVib', 'vib', (v) => v && vib(30));
  const q = (v) => { s.quality = v; R.quality = v; R.resize(); writeSave(); $('qHigh').classList.toggle('on', v === 'high'); $('qLow').classList.toggle('on', v === 'low'); A.play('ui'); };
  $('qHigh').onclick = () => q('high'); $('qLow').onclick = () => q('low');
  $('btnHow2').onclick = () => { A.play('ui'); howTo(); };
  $('btnSetOk').onclick = () => { A.play('ui'); closeModal(); };
  $('btnReset').onclick = () => {
    openModal(`<h2 class="fail">RESET?</h2><div class="jp" style="margin:8px 0 4px;font-size:13px">すべての進行状況と★が消去されます。</div>
      <div class="btns"><div class="row"><button class="neon-btn ghost" id="rNo">CANCEL</button><button class="neon-btn" id="rYes" style="border-color:var(--danger)">RESET</button></div></div>`);
    $('rNo').onclick = () => { A.play('ui'); settings(); };
    $('rYes').onclick = () => { save.unlocked = 1; save.stars = []; save.best = []; save.seen = {}; writeSave(); A.play('fail'); closeModal(); toTitle(); };
  };
}

/* ---------------------------------------------------------- stage select */
let selSector = 0;
function toSelect() {
  const fromPlay = game.mode === 'play' || !game.sim;
  game.mode = 'select';
  game.paused = false; game.slowT = 0; game.zoomT = 0; hideReticle();
  closeModal(); hud(false); show('scrSelect');
  selSector = Math.floor((Math.min(save.unlocked, N) - 1) / 50);
  if (fromPlay) startDemo();
  buildSectorStrip(); buildGrid();
  A.duckMusic(1);
  A.startMusic(99, 0.8);
}
function buildSectorStrip() {
  const el = $('sectorStrip');
  let html = '';
  for (let s = 0; s < 20; s++) {
    const first = s * 50 + 1;
    const locked = first > save.unlocked;
    let st = 0;
    for (let i = first; i < first + 50; i++) st += save.stars[i - 1] || 0;
    const hue = s === 19 ? 300 : C.SECTORS[s][1];
    html += `<button class="sector-tab ${s === selSector ? 'active' : ''} ${locked ? 'locked' : ''}" data-s="${s}" style="--sh:${hue}">
      <div class="no">SECTOR ${String(s + 1).padStart(2, '0')}</div><div class="nm">${C.SECTORS[s][0]}</div>
      <div class="st">${locked ? '🔒' : '★ ' + st + '/150'}</div></button>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('.sector-tab').forEach((b) => {
    b.onclick = () => {
      const s = +b.dataset.s;
      if (s * 50 + 1 > save.unlocked) { A.play('empty'); return; }
      selSector = s; A.play('ui');
      el.querySelectorAll('.sector-tab').forEach((q) => q.classList.toggle('active', +q.dataset.s === s));
      buildGrid();
    };
  });
  const act = el.querySelector('.active');
  if (act) setTimeout(() => act.scrollIntoView({ inline: 'center', block: 'nearest' }), 0);
  $('selTotal').textContent = `★ ${totalStars()}  ・  ${save.pt.toLocaleString()} PT`;
}
function buildGrid() {
  const s = selSector;
  const hue = s === 19 ? 300 : C.SECTORS[s][1];
  setThemeHue(hue);
  $('sectorInfo').textContent = `SECTOR ${String(s + 1).padStart(2, '0')} ─ ${C.SECTORS[s][0]} ─ STAGE ${s * 50 + 1}-${s * 50 + 50}`;
  let html = '';
  for (let n = s * 50 + 1; n <= s * 50 + 50; n++) {
    const locked = n > save.unlocked;
    const st = save.stars[n - 1] || 0;
    const boss = C.isBoss(n), omega = n % 50 === 0;
    const intro = !boss && Object.values(C.GIMMICKS).some((g) => g.n === n);
    const cur = n === save.unlocked;
    html += `<button class="stage-tile ${locked ? 'locked' : ''} ${boss ? 'boss' : ''} ${cur ? 'current' : ''}" data-n="${n}" style="--sh:${s === 19 ? (n * 47) % 360 : hue}">
      ${boss ? `<span class="tag">${omega ? 'OMEGA' : 'BOSS'}</span>` : intro ? '<span class="tag">NEW</span>' : ''}
      <div class="num">${locked ? '🔒' : n}</div>
      <div class="stars">${locked ? '' : [0, 1, 2].map((i) => (i < st ? '<b>★</b>' : '★')).join('')}</div></button>`;
  }
  const g = $('stageGrid');
  g.innerHTML = html; g.scrollTop = 0;
  g.querySelectorAll('.stage-tile').forEach((b) => {
    b.onclick = () => {
      const n = +b.dataset.n;
      if (n > save.unlocked) { A.play('empty'); return; }
      A.play('ui'); startStage(n);
    };
  });
  const cur = g.querySelector('.current');
  if (cur) setTimeout(() => cur.scrollIntoView({ block: 'center' }), 0);
}

/* ------------------------------------------------------------------ input */
function canAim() { return game.mode === 'play' && !game.paused && !modalOpen() && game.sim && game.sim.state === 'play' && R.introT > 1.4; }
const reticle = () => $('reticle');
function showReticle(x, y) { const r = reticle(); r.style.transform = `translate(${x}px, ${y}px)`; r.classList.add('on'); }
function hideReticle() { reticle().classList.remove('on'); R.aimWorld = null; }
function nearTurret(y) { return y > window.innerHeight - 96; }
function aimAt(x, y) {
  showReticle(x, y);
  const ray = R.pickRay(x, y);
  const h = game.sim.raycast(ray.origin, ray.dir, 120);
  const t = h ? h.dist : 18;
  R.aimWorld = { x: ray.origin.x + ray.dir.x * t, y: ray.origin.y + ray.dir.y * t, z: ray.origin.z + ray.dir.z * t };
  R.aimWorld = new (R.camera().position.constructor)(R.aimWorld.x, R.aimWorld.y, R.aimWorld.z);
}
function onDown(e) {
  A.init();
  if (!canAim() || game.pointer !== null) return;
  if (nearTurret(e.clientY)) return;
  game.pointer = e.pointerId;
  aimAt(e.clientX, e.clientY);
  A.play('charge');
  e.preventDefault();
}
function onMove(e) { if (game.pointer === e.pointerId && canAim()) aimAt(e.clientX, e.clientY); }
function onUp(e) {
  if (game.pointer !== e.pointerId) return;
  game.pointer = null;
  reticle().classList.remove('on');
  if (!canAim() || nearTurret(e.clientY)) return;
  const sim = game.sim;
  if (sim.lasers <= 0) { A.play('empty'); return; }
  const ray = R.pickRay(e.clientX, e.clientY);
  sim.fire(ray.origin, ray.dir);
  const hl = $('hudLaser'); hl.classList.remove('bump'); void hl.offsetWidth; hl.classList.add('bump');
}

/* ----------------------------------------------------------------- events */
const WHITE = () => R.hsl(0, 0, 1);
function processEvents() {
  const sim = game.sim;
  if (!sim) return;
  const evs = sim.drainEvents();
  const demo = game.mode !== 'play';
  const hue = R.hue;
  const fx = R.fx;
  for (const e of evs) {
    switch (e.t) {
      case 'laser': {
        if (e.main !== false) game.beam = GEAR.beamHue(demo ? 'kSector' : save.equip.color, hue, R.t);
        const bc = game.beam || { h: hue, s: 1 };
        fx.beam(e, bc.h, bc.s);
        R.aimWorld = new (R.camera().position.constructor)(e.x, e.y, e.z);
        fx.flare(e, 1.1, 0.3, bc.h, true);
        fx.spark(e, bc.h, 12, 7, 0.4);
        fx.light(e, bc.h, 30);
        R.addShake(0.06);
        A.play('laser');
        if (!demo) vib(8);
        if (e.result === 'empty') {
          fx.ring(e, 0.2, C.BLAST_R, 0.38, bc.h, 0.06);
          fx.glows(e, bc.h, 6, 3, 0.35, 0.4);
          A.play('blast');
        }
        break;
      }
      case 'overload':
        R.addShake(0.25); R.addFlash(0.25, R.hsl(0, 1, 0.5));
        if (!demo) banner('', 'OVERLOAD!', '');
        A.play('bomb');
        break;
      case 'hit':
        fx.spark(e, R.blockHue(e.body.lb), 14, 9, 0.45);
        A.play('hit');
        break;
      case 'crack':
        fx.spark(e, 0, 10, 6, 0.4);
        fx.ring(e, 0.1, 1.2, 0.3, R.blockHue(e.body.lb), 0.05);
        A.play('crack');
        break;
      case 'impact': {
        const k = Math.min(1, (e.v - 5.5) / 8);
        fx.spark(e, R.blockHue(e.body.lb), 3 + Math.round(k * 7), 3 + k * 5, 0.35, 0.07);
        if (k > 0.5) R.addShake(0.03 + k * 0.05);
        A.play('impact', { v: k });
        break;
      }
      case 'destroy': {
        const L = e.body.lb, bh = R.blockHue(L);
        const pw = L.type === 'core' ? 2.4 : L.type === 'bomb' ? 1.7 : 1;
        fx.shards(e, L, e.body.quaternion, e.body.velocity, pw);
        fx.spark(e, bh, 18, 10 * pw, 0.55);
        fx.glows(e, bh, 7, 3, 0.45, 0.6);
        fx.pixels(e, bh, 8, Math.max(L.w, L.h));
        fx.flare(e, 1.4 * pw, 0.32, bh, true);
        fx.ring(e, 0.1, 1.9, 0.4, bh, 0.07);
        fx.light(e, bh, 45 * pw);
        R.addShake(L.type === 'core' ? 0 : 0.12);
        if (e.pts) R.pop(e, '+' + e.pts, bh, 18 + Math.min(e.combo, 10));
        A.play(L.type === 'crystal' ? 'crystal' : 'destroy', { combo: e.combo });
        if (L.type === 'crystal') fx.glows(e, 190, 12, 5, 0.2, 0.8);
        if (L.type === 'gen') { fx.ring(e, 0.2, 3, 0.6, 95, 0.05); A.play('bomb'); }
        if (!demo) { vib(L.type === 'core' ? 120 : 18); if (e.combo >= 3) comboBanner(e.combo); }
        game.lastHit = { x: e.x, y: e.y, z: e.z };
        break;
      }
      case 'bomb':
        fx.flare(e, 5, 0.55, 25, true);
        fx.ring(e, 0.2, 4.2, 0.55, 20, 0.1);
        fx.ring(e, 0.2, 6, 0.8, 45, 0.05);
        fx.spark(e, 30, 60, 18, 0.8, 0.12);
        fx.glows(e, 20, 22, 8, 0.8, 0.9);
        fx.light(e, 25, 160);
        R.addShake(0.5); R.addFlash(0.4, R.hsl(20, 1, 0.5)); R.addGlitch(0.25);
        slowmo(0.35, 0.35);
        A.play('bomb'); if (!demo) vib([40, 20, 60]);
        break;
      case 'coreDown':
        fx.flare(e, 9, 1.1, 330, true);
        for (let i = 0; i < 5; i++) fx.ring(e, 0.3, 4 + i * 2, 0.7 + i * 0.2, 330 + i * 20, 0.08);
        fx.spark(e, 330, 90, 26, 1.2, 0.14);
        fx.glows(e, 300, 40, 12, 1, 1.4);
        fx.light(e, 330, 300);
        R.addShake(0.9); R.addFlash(0.9); R.addGlitch(0.7);
        slowmo(1.3, 0.25);
        A.play('core'); if (!demo) vib([80, 40, 140]);
        if (!demo) banner('CORE DESTROYED', 'BREAK!!', '', true);
        break;
      case 'blast':
        if (e.kind === 'hit' || e.kind === 'deflect') fx.ring(e, 0.1, e.r, 0.32, hue, 0.05);
        break;
      case 'fall': {
        const L = e.body.lb, bh = R.blockHue(L);
        fx.shards(e, L, e.body.quaternion, e.body.velocity, 0.8);
        fx.flare(e, 1.3, 0.3, bh, true);
        fx.spark(e, bh, 10, 8, 0.45);
        fx.pixels(e, bh, 16, Math.max(L.w, L.h));
        fx.ring(e, 0.1, 1.3, 0.4, bh, 0.06);
        R.pop(e, '+' + e.pts, bh, 17 + Math.min(e.combo, 10));
        A.play('fall', { combo: e.combo });
        if (!demo && e.combo >= 3) comboBanner(e.combo);
        game.lastHit = { x: e.x, y: Math.max(e.y, sim.killY + 2), z: e.z };
        break;
      }
      case 'bonus':
        R.pop(e, e.refund ? 'RECHARGE +1' : `+${e.n} LASER`, e.refund ? 120 : 48, e.refund ? 18 : 24, 1.3);
        fx.glows(e, 48, 14, 6, 0.5, 0.8);
        fx.ring(e, 0.2, 2.6, 0.5, 48, 0.07);
        A.play('bonus');
        if (!demo) { const hl = $('hudLaser'); hl.classList.remove('gain'); void hl.offsetWidth; hl.classList.add('gain'); vib(30); }
        break;
      case 'release': fx.spark(e, hue + 60, 8, 5, 0.35); A.play('release'); break;
      case 'floatOff': fx.spark(e, 120, 14, 6, 0.5); R.pop(e, 'POWER DOWN', 120, 13, 0.8); break;
      case 'shieldHit':
        fx.spark(e, 175, 14, 6, 0.4);
        R.pop(e, 'BLOCKED', 175, 15, 0.7);
        A.play('shield');
        break;
      case 'shieldDown':
        fx.ring(e, e.r, e.r * 1.6, 0.6, 175, 0.08);
        fx.glows(e, 175, 30, e.r * 2, 0.4, 0.7);
        R.addGlitch(0.25); R.addShake(0.2);
        A.play('shieldDown');
        if (!demo) banner('', 'SHIELD DOWN', '');
        break;
      case 'deflect': fx.spark(e, 205, 16, 9, 0.35); R.pop(e, 'DEFLECT', 205, 14, 0.6); A.play('deflect'); break;
      case 'cut': fx.spark(e, 185, 22, 7, 0.45); fx.flare(e, 0.9, 0.3, 185, true); R.pop(e, 'CUT!', 185, 16, 0.7); A.play('cut'); break;
      case 'clear':
        if (!demo) {
          game.endT = 2.0;
          slowmo(0.9, 0.3);
          game.zoomT = 1.6;
          const lh = game.lastHit || { x: 0, y: 2, z: 0 };
          R.zoomAt.set(lh.x, lh.y, lh.z);
          R.addFlash(0.3); R.addGlitch(0.2);
          A.play('clear');
          banner('ALL TARGETS DESTROYED', 'CLEAR!', '');
          vib([30, 30, 60]);
          const b = C.stageBounds(sim.stage);
          for (let i = 0; i < 6; i++) setTimeout(() => {
            const p = { x: b.x0 + Math.random() * (b.x1 - b.x0), y: b.y0 + 1 + Math.random() * (b.y1 - b.y0), z: (b.z0 + b.z1) / 2 };
            const h = Math.random() * 360;
            fx.ring(p, 0.1, 2.6, 0.7, h, 0.06); fx.glows(p, h, 16, 8, 0.4, 1.1); fx.spark(p, h, 24, 12, 0.9);
            A.play('fall', { combo: 6 + i });
          }, 300 + i * 170);
        }
        break;
      case 'fail':
        if (!demo) { game.endT = 1.0; R.addGlitch(0.6); R.addFlash(0.3, R.hsl(350, 1, 0.4)); A.play('fail'); A.duckMusic(0.25); vib([60, 40, 60]); }
        break;
    }
  }
}
function slowmo(dur, scale) {
  game.slowScale = game.slowT > 0 ? Math.min(game.slowScale, scale) : scale;
  game.slowT = Math.max(game.slowT, dur);
}

/* -------------------------------------------------------------------- HUD */
function updateHud() {
  const sim = game.sim;
  if (!sim || game.mode !== 'play') return;
  const h = game.lastHud;
  if (h.lasers !== sim.lasers) { h.lasers = sim.lasers; $('hudLaserN').textContent = sim.lasers; $('hudLaser').classList.toggle('low', sim.lasers <= 3); }
  if (h.score !== sim.score) { h.score = sim.score; $('hudScore').textContent = sim.score.toLocaleString(); }
  const done = sim.targetsTotal - sim.targetsLeft;
  if (h.done !== done) {
    h.done = done;
    $('hudTargets').textContent = `${done} / ${sim.targetsTotal}`;
    $('hudBar').style.width = (100 * done) / Math.max(1, sim.targetsTotal) + '%';
  }
}

/* -------------------------------------------------------------- main loop */
let last = performance.now();
let fpsAcc = 0, fpsN = 0, lowFpsT = 0;
function frame(now) { frameBody(now); requestAnimationFrame(frame); }
function frameBody(now) {
  const rdt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  fpsAcc += rdt; fpsN++;
  if (fpsAcc > 2) {
    const fps = fpsN / fpsAcc;
    if (fps < 38 && R.quality === 'high' && save.settings.quality === 'high') { if (++lowFpsT >= 2) { R.quality = 'low'; R.resize(); } }
    else lowFpsT = 0;
    fpsAcc = 0; fpsN = 0;
  }
  let ts = 1;
  if (game.slowT > 0) { game.slowT -= rdt; ts = game.slowScale; }
  const dt = rdt * ts;
  const sim = game.sim;
  if (sim && !game.paused) {
    if (R.introT > 1.5) {
      game.acc += dt;
      let n = 0;
      while (game.acc >= 1 / 60 && n < 3) { sim.step(); game.acc -= 1 / 60; n++; }
      if (n >= 3) game.acc = 0;
    }
    if (game.mode === 'title' || game.mode === 'select' || game.mode === 'shop') demoTick(rdt);
    processEvents();
    if (game.mode === 'play' && game.endT > 0) {
      game.endT -= rdt;
      if (game.endT <= 0 && !game.resultShown) { game.resultShown = true; if (sim.state === 'clear') onClear(); else onFail(); }
    }
  }
  if (game.zoomT > 0) { game.zoomT -= rdt; R.zoom = Math.sin(Math.min(1, (1 - game.zoomT / 1.6) * 1.4) * Math.PI); } else R.zoom = 0;
  R.update(game.paused ? 0 : dt);
  R.render();
  updateHud();
}

/* ------------------------------------------------------------------- boot */
function boot() {
  loadSave();
  R.quality = save.settings.quality;
  A.sfxOn = save.settings.sfx; A.musicOn = save.settings.music;
  try { R.init($('cv')); } catch (err) {
    document.body.insertAdjacentHTML('beforeend', '<div class="nogl jp">この端末ではWebGLが使えないため、ゲームを表示できません。</div>');
    return;
  }
  const cv = $('cv');
  cv.addEventListener('pointerdown', onDown, { passive: false });
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', (e) => { if (game.pointer === e.pointerId) { game.pointer = null; hideReticle(); } });
  window.addEventListener('resize', () => R.resize());
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => R.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pause(); if (A.ctx) A.ctx.suspend(); } else if (A.ctx) A.ctx.resume();
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  const unlock = () => { A.init(); A.setSfx(save.settings.sfx); A.setMusic(save.settings.music); if (!A.music) A.startMusic(game.mode === 'play' ? game.sim.stage.sector : 99, 0.8); };
  window.addEventListener('pointerdown', unlock, { capture: true });
  $('btnStart').onclick = () => { A.init(); A.play('ui'); startStage(Math.min(save.unlocked, N)); };
  $('btnSelect').onclick = () => { A.init(); A.play('ui'); toSelect(); };
  $('btnSettings').onclick = () => { A.init(); A.play('ui'); settings(); };
  $('btnShop').onclick = () => { A.init(); A.play('ui'); toShop(toTitle); };
  $('btnSelShop').onclick = () => { A.play('ui'); toShop(toSelect); };
  $('btnShopBack').onclick = () => { A.play('ui'); (game.shopBack || toTitle)(); };
  $('btnSelBack').onclick = () => { A.play('ui'); toTitle(); };
  $('btnPause').onclick = () => { A.play('ui'); pause(); };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p') { if (game.mode === 'play') { if (game.paused && modalOpen()) resume(); else pause(); } }
    if (e.key === 'r' && game.mode === 'play') startStage(game.stageN);
  });
  const m = /stage=(\d+)/.exec(location.hash);
  toTitle();
  if (m) startStage(+m[1]);
  requestAnimationFrame(frame);
}
boot();

// debugging hooks
window.LB.Game = game;
window.LB.startStage = startStage;
window.LB.R = R;
window.LB.C = C;
window.LB.debugAdvance = function (sec) { for (let t = 0; t < sec; t += 1 / 60) { last -= 1000 / 60; frameBody(performance.now()); } };

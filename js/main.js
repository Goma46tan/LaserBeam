/* LaserBeam - game flow, input, UI, save data */
(function (G) {
  'use strict';
  const LB = G.LB, R = LB.Render, A = LB.Audio;
  const { TURRET } = LB;
  const $ = (id) => document.getElementById(id);
  const N = LB.STAGE_COUNT;

  /* ---------------------------------------------------------------- save */
  const SAVE_KEY = 'laserbeam_save_v1';
  const save = {
    unlocked: 1, stars: [], best: [], seen: {},
    settings: { sfx: true, music: true, vib: true, quality: 'high' },
  };
  function loadSave() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (d) {
        Object.assign(save, d);
        save.settings = Object.assign({ sfx: true, music: true, vib: true, quality: 'high' }, d.settings || {});
      }
    } catch (e) { /* storage unavailable */ }
  }
  function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }
  const totalStars = () => save.stars.reduce((a, b) => a + (b || 0), 0);

  function vib(ms) { if (save.settings.vib && navigator.vibrate) try { navigator.vibrate(ms); } catch (e) { /* ignore */ } }

  /* --------------------------------------------------------------- state */
  const game = {
    mode: 'title',    // title | select | play | result
    sim: null, stageN: 1, paused: false, acc: 0,
    slowT: 0, slowScale: 1, zoomT: 0,
    pointer: null, lastFire: 0, endT: -1, resultShown: false,
    demoNext: 0, demoClearT: -1,
    lastHud: {},
  };

  function stageHue(n) {
    const sec = Math.floor((n - 1) / 50);
    return sec === 19 ? (n * 47) % 360 : LB.SECTORS[sec][1];
  }
  function setThemeHue(h) {
    R.stageHue = h;
    document.documentElement.style.setProperty('--hue', Math.round(((h % 360) + 360) % 360));
  }

  /* ------------------------------------------------------------ screens */
  function show(id) {
    for (const s of ['scrTitle', 'scrSelect']) $(s).classList.toggle('hidden', s !== id);
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
  let comboTimer = 0;
  function comboBanner(c) {
    const el = $('combo');
    const word = c >= 12 ? 'CYBER RAMPAGE' : c >= 8 ? 'OVERLOAD' : c >= 5 ? 'GREAT' : 'COMBO';
    el.innerHTML = `<small>${word}</small>${c} HIT${c > 1 ? 'S' : ''}!`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(comboTimer);
  }

  /* --------------------------------------------------------------- title */
  function toTitle() {
    game.mode = 'title';
    closeModal(); hud(false); show('scrTitle');
    $('btnStart').innerHTML = save.unlocked > 1 ? `CONTINUE<span class="sm">STAGE ${Math.min(save.unlocked, N)}</span>` : 'START';
    startDemo();
    A.startMusic(99, 0.8);
  }
  function startDemo() {
    const n = 1 + Math.floor(Math.random() * 120);
    const st = LB.getStage(n);
    st.lasers = 999;
    game.sim = new LB.Sim(st);
    game.demoNext = 1.8; game.demoClearT = -1;
    setThemeHue(stageHue(n));
    R.clearFx(); R.introT = 0; R.zoom = 1;
    R.setFocus(R.focusFromSim(game.sim));
  }
  function demoTick(dt) {
    const sim = game.sim;
    if (!sim) return;
    if (sim.state !== 'play') {
      if (game.demoClearT < 0) game.demoClearT = 2.2;
      game.demoClearT -= dt;
      if (game.demoClearT <= 0) startDemo();
      return;
    }
    if (sim.shots > 60) { startDemo(); return; }
    game.demoNext -= dt;
    if (game.demoNext > 0) return;
    game.demoNext = 0.9 + Math.random() * 0.7;
    const alive = sim.targets.filter((b) => b.lb.alive && !b.lb.cleared && !sim.isPhased(b));
    for (const s of sim.shields) if (s.active) { const g = s.gens.find((q) => q.lb.alive); if (g) { fireAt(g.position.x, g.position.y); return; } }
    if (!alive.length) return;
    const b = alive[Math.floor(Math.random() * alive.length)];
    const off = (Math.random() - 0.5) * 50;
    fireAt(b.position.x + off, b.position.y + (Math.random() - 0.5) * 20);
  }

  /* ---------------------------------------------------------- stage flow */
  function startStage(n) {
    n = Math.max(1, Math.min(N, n));
    game.stageN = n;
    const st = LB.getStage(n);
    game.sim = new LB.Sim(st);
    game.mode = 'play'; game.paused = false; game.acc = 0;
    game.endT = -1; game.resultShown = false; game.slowT = 0; game.zoomT = 0;
    R.zoom = 1; R.aim = null; R.turretAngle = -Math.PI / 2;
    setThemeHue(stageHue(n));
    R.clearFx(); R.introT = 0;
    closeModal(); show(null); hud(true);
    R.setFocus(R.focusFromSim(game.sim));
    game.lastHud = {};
    $('hudStage').textContent = 'STAGE ' + n;
    $('hudSector').textContent = `SECTOR ${String(st.sector + 1).padStart(2, '0')} // ${st.sectorName}`;
    A.startMusic(st.sector, st.boss ? 1.4 : 1);
    A.play('start');
    if (st.intro && !save.seen[st.intro]) {
      game.paused = true;
      showIntro(st.intro, () => { save.seen[st.intro] = 1; writeSave(); game.paused = false; stageBanner(st); });
    } else {
      stageBanner(st);
    }
  }
  function stageBanner(st) {
    if (st.boss) banner('⚠ WARNING ⚠', 'CORE GUARDIAN', 'STAGE ' + st.n, true);
    else banner(`SECTOR ${String(st.sector + 1).padStart(2, '0')} ─ ${st.sectorName}`, 'STAGE ' + st.n, `LASER × ${st.lasers}`);
  }

  function showIntro(key, done) {
    const gm = LB.GIMMICKS[key];
    const icon = introIcon(key);
    openModal(`
      <div class="intro-badge">NEW GIMMICK</div>
      <canvas class="intro-ico" id="introIco"></canvas>
      <div class="intro-name">${gm.name}</div>
      <div class="intro-desc">${gm.desc}</div>
      <div class="btns"><button class="neon-btn" id="btnIntroOk">OK</button></div>`);
    const c = $('introIco');
    if (icon) { c.width = icon.width; c.height = icon.height; c.getContext('2d').drawImage(icon, 0, 0); } else c.remove();
    $('btnIntroOk').onclick = () => { A.play('ui'); closeModal(); done(); };
  }
  function introIcon(key) {
    const map = {
      star: ['star', 'box', 48], armor: ['armor', 'box', R.stageHue + 160], orb: ['normal', 'orb', R.stageHue], bomb: ['bomb', 'box', 2],
      moving: ['normal', 'plank', R.stageHue + 150], orbit: ['normal', 'box', R.stageHue], rotor: ['normal', 'box', R.stageHue + 48],
      steel: ['steel', 'box', 205], spinner: ['steel', 'plank', 205], tether: ['normal', 'box', 185], float: ['normal', 'box', 120],
      rock: ['normal', 'plank', R.stageHue + 150], boss: ['core', 'core', 330], shield: ['gen', 'gen', 95], crystal: ['crystal', 'box', 185],
      phase: ['phase', 'box', 285], lowgrav: ['normal', 'orb', 200], elevator: ['normal', 'plank', R.stageHue + 150],
    };
    const m = map[key];
    return m ? R.iconCanvas(m[0], m[1], m[2], 96) : null;
  }

  function onClear() {
    const sim = game.sim;
    const n = game.stageN;
    const stars = sim.stars();
    const bonus = sim.lasers * 500;
    const total = sim.score + bonus;
    const prevBest = save.best[n - 1] || 0;
    const newRec = total > prevBest;
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
      ${newRec && prevBest > 0 ? '<div class="newrec">NEW RECORD!</div>' : ''}
      <div class="btns">
        ${n < N ? '<button class="neon-btn big" id="btnNext">NEXT STAGE</button>' : '<button class="neon-btn gold big" id="btnNext">ALL CLEAR!</button>'}
        <div class="row"><button class="neon-btn ghost" id="btnRetry">RETRY</button><button class="neon-btn ghost" id="btnMenu">STAGES</button></div>
      </div>`);
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
      <div class="jp" style="font-size:11px;color:var(--dim)">ヒント：ブロックの横を撃つと衝撃波で押し出せる</div>
      <div class="btns">
        <button class="neon-btn big" id="btnRetry">RETRY</button>
        <button class="neon-btn ghost" id="btnMenu">STAGES</button>
      </div>`, 'fail-card');
    $('btnRetry').onclick = () => { A.play('ui'); startStage(game.stageN); };
    $('btnMenu').onclick = () => { A.play('ui'); toSelect(); };
  }

  function pause() {
    if (game.mode !== 'play' || modalOpen()) return;
    game.paused = true; R.aim = null; game.pointer = null;
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
        <li>画面をタップ（指を離した位置）にレーザーを発射。</li>
        <li>着弾点で<b>衝撃波</b>が発生し、周囲のブロックを吹き飛ばす。ブロックに直撃すると破壊できる。</li>
        <li>すべてのターゲットブロックを<b>破壊するか台座から落とせば</b>クリア。</li>
        <li>ブロックの<b>内側の横</b>を撃つと、外側へ押し出しやすい。</li>
        <li>残りレーザーが多いほど高スコア＆★が増える。</li>
        <li>連続で壊すとコンボ！スコアが倍増する。</li>
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
      <div class="set-row"><div>GRAPHICS<span class="jp">画質</span></div>
        <div class="seg"><button id="qHigh" class="${s.quality === 'high' ? 'on' : ''}">HIGH</button><button id="qLow" class="${s.quality === 'low' ? 'on' : ''}">LOW</button></div></div>
      <div class="btns">
        <button class="neon-btn ghost" id="btnHow2">HOW TO PLAY</button>
        <button class="neon-btn" id="btnSetOk">OK</button>
      </div>
      <button class="danger-link" id="btnReset">セーブデータをリセット</button>`);
    const tog = (id, key, fn) => { $(id).onclick = () => { s[key] = !s[key]; $(id).classList.toggle('on', s[key]); fn && fn(s[key]); writeSave(); A.play('ui'); }; };
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
      $('rYes').onclick = () => {
        save.unlocked = 1; save.stars = []; save.best = []; save.seen = {}; writeSave(); A.play('fail'); closeModal(); toTitle();
      };
    };
  }

  /* -------------------------------------------------------- stage select */
  let selSector = 0;
  function toSelect() {
    const fromPlay = game.mode === 'play' || !game.sim;
    game.mode = 'select';
    game.paused = false; game.slowT = 0; game.zoomT = 0; R.aim = null;
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
      const hue = s === 19 ? 300 : LB.SECTORS[s][1];
      html += `<button class="sector-tab ${s === selSector ? 'active' : ''} ${locked ? 'locked' : ''}" data-s="${s}" style="--sh:${hue}">
        <div class="no">SECTOR ${String(s + 1).padStart(2, '0')}</div><div class="nm">${LB.SECTORS[s][0]}</div>
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
    $('selTotal').textContent = `★ ${totalStars()} / ${N * 3}`;
  }
  function buildGrid() {
    const s = selSector;
    const hue = s === 19 ? 300 : LB.SECTORS[s][1];
    setThemeHue(hue);
    $('sectorInfo').textContent = `SECTOR ${String(s + 1).padStart(2, '0')} ─ ${LB.SECTORS[s][0]} ─ STAGE ${s * 50 + 1}-${s * 50 + 50}`;
    let html = '';
    for (let n = s * 50 + 1; n <= s * 50 + 50; n++) {
      const locked = n > save.unlocked;
      const st = save.stars[n - 1] || 0;
      const boss = n % 50 === 0;
      const intro = !boss && Object.values(LB.GIMMICKS).some((g) => g.n === n);
      const cur = n === save.unlocked;
      html += `<button class="stage-tile ${locked ? 'locked' : ''} ${boss ? 'boss' : ''} ${cur ? 'current' : ''}" data-n="${n}" style="--sh:${s === 19 ? (n * 47) % 360 : hue}">
        ${boss ? '<span class="tag">CORE</span>' : intro ? '<span class="tag">NEW</span>' : ''}
        <div class="num">${locked ? '🔒' : n}</div>
        <div class="stars">${locked ? '' : [0, 1, 2].map((i) => (i < st ? '<b>★</b>' : '★')).join('')}</div></button>`;
    }
    const g = $('stageGrid');
    g.innerHTML = html;
    g.scrollTop = 0;
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

  /* --------------------------------------------------------------- input */
  function canAim() { return game.mode === 'play' && !game.paused && !modalOpen() && game.sim && game.sim.state === 'play' && R.introT > 1.1; }

  function pointerPos(e) { return R.toWorld(e.clientX, e.clientY); }
  function nearTurret(p) { return p.y > TURRET.y - 50 * R.turretScale; }
  function onDown(e) {
    A.init();
    if (!canAim() || game.pointer !== null) return;
    const p = pointerPos(e);
    if (nearTurret(p)) return;
    game.pointer = e.pointerId;
    R.aim = p;
    A.play('charge');
    e.preventDefault();
  }
  function onMove(e) {
    if (game.pointer !== e.pointerId) return;
    R.aim = pointerPos(e);
  }
  function onUp(e) {
    if (game.pointer !== e.pointerId) return;
    game.pointer = null;
    const p = R.aim; R.aim = null;
    if (!p || !canAim()) return;
    if (nearTurret(p)) return;
    const sim = game.sim;
    if (sim.lasers <= 0) { A.play('empty'); return; }
    fireAt(p.x, p.y);
    const hl = $('hudLaser'); hl.classList.remove('bump'); void hl.offsetWidth; hl.classList.add('bump');
  }
  function fireAt(x, y) {
    const sim = game.sim;
    R.turretAngle = Math.atan2(y - TURRET.y, x - TURRET.x);
    sim.fire(x, y);
  }

  /* --------------------------------------------------------------- events */
  function processEvents() {
    const sim = game.sim;
    if (!sim) return;
    const evs = sim.drainEvents();
    const demo = game.mode !== 'play';
    const hue = R.stageHue;
    for (const e of evs) {
      switch (e.t) {
        case 'laser': {
          const a = Math.atan2(e.y - TURRET.y, e.x - TURRET.x);
          R.turretAngle = a;
          const mx = TURRET.x + Math.cos(a) * 76 * R.turretScale, my = TURRET.y + Math.sin(a) * 76 * R.turretScale;
          R.beam(mx, my, e.x, e.y, hue);
          R.recoil = 1;
          R.flare(mx, my, 34, 0.18, hue, false);
          R.flare(e.x, e.y, 46, 0.3, hue, true);
          R.spark(e.x, e.y, hue, 10, 380, 0.4);
          R.addShake(3);
          A.play('laser');
          if (!demo) vib(8);
          if (e.result === 'empty') {
            R.ring(e.x, e.y, 8, LB.BLAST_R, 0.38, hue, 3);
            R.ring(e.x, e.y, 4, 70, 0.3, hue + 40, 2);
            R.glows(e.x, e.y, hue, 6, 180, 14, 0.4);
            A.play('blast');
          }
          break;
        }
        case 'hit':
          R.spark(e.x, e.y, R.blockHue(e.body.lb), 12, 420, 0.45);
          A.play('hit');
          break;
        case 'impact': {
          const ih = R.blockHue(e.body.lb);
          const k = Math.min(1, (e.v - 3) / 6);
          R.spark(e.x, e.y, ih, 3 + Math.round(k * 6), 160 + k * 260, 0.35);
          if (k > 0.5) R.addShake(1.5 + k * 2.5);
          A.play('impact', { v: k });
          break;
        }
        case 'crack':
          R.spark(e.x, e.y, 0, 10, 300, 0.4);
          R.ring(e.x, e.y, 5, 60, 0.3, R.blockHue(e.body.lb), 2);
          A.play('crack');
          break;
        case 'destroy': {
          const L = e.body.lb, bh = R.blockHue(L);
          const pw = L.type === 'core' ? 2.4 : L.type === 'bomb' ? 1.7 : 1;
          R.shards(e.x, e.y, L.w, L.h, e.body.angle, bh, e.body.velocity.x, e.body.velocity.y, pw);
          R.spark(e.x, e.y, bh, 16, 520 * pw, 0.55);
          R.glows(e.x, e.y, bh, 7, 160, 18, 0.6);
          R.pixels(e.x, e.y, L.w, L.h, bh, 8);
          R.flare(e.x, e.y, 60 * pw, 0.32, bh, true);
          R.ring(e.x, e.y, 6, 88, 0.4, bh, 4);
          R.addShake(L.type === 'core' ? 0 : 6);
          if (e.pts) R.pop(e.x, e.y - 10, '+' + e.pts, bh, 20 + Math.min(e.combo, 10));
          A.play(L.type === 'crystal' ? 'crystal' : 'destroy', { combo: e.combo });
          if (L.type === 'crystal') R.glows(e.x, e.y, 190, 12, 260, 8, 0.8);
          if (L.type === 'gen') { R.ring(e.x, e.y, 10, 160, 0.6, 95, 5); A.play('bomb'); }
          if (!demo) { vib(L.type === 'core' ? 120 : 18); if (e.combo >= 3) comboBanner(e.combo); }
          game.lastHitX = e.x; game.lastHitY = e.y;
          break;
        }
        case 'bomb':
          R.flare(e.x, e.y, 210, 0.55, 25, true);
          R.ring(e.x, e.y, 10, 210, 0.55, 20, 8);
          R.ring(e.x, e.y, 10, 300, 0.8, 45, 4);
          R.spark(e.x, e.y, 30, 50, 900, 0.8);
          R.glows(e.x, e.y, 20, 22, 420, 30, 0.9);
          R.addShake(22); R.addFlash(0.45, 20); R.addGlitch(0.25);
          slowmo(0.35, 0.35);
          A.play('bomb'); if (!demo) vib([40, 20, 60]);
          break;
        case 'coreDown':
          R.flare(e.x, e.y, 380, 1.1, 330, true);
          for (let i = 0; i < 5; i++) R.ring(e.x, e.y, 10, 200 + i * 90, 0.7 + i * 0.2, 330 + i * 20, 8 - i);
          R.spark(e.x, e.y, 330, 90, 1300, 1.2);
          R.glows(e.x, e.y, 300, 40, 600, 40, 1.4);
          R.addShake(34); R.addFlash(0.95, 0, true); R.addGlitch(0.7);
          slowmo(1.3, 0.25);
          A.play('core'); if (!demo) vib([80, 40, 140]);
          if (!demo) banner('CORE DESTROYED', 'BREAK!!', '', true);
          break;
        case 'blast':
          if (e.kind === 'hit' || e.kind === 'deflect') R.ring(e.x, e.y, 6, e.r, 0.32, hue, 2);
          break;
        case 'fall': {
          const L = e.body.lb, bh = R.blockHue(L);
          const y = Math.min(e.y, sim.killY + 30);
          // blocks that drop off the stage burst apart as they leave
          R.shards(e.x, y, L.w, L.h, e.body.angle, bh, e.body.velocity.x * 0.5, -3, 0.9);
          R.flare(e.x, y, 55, 0.3, bh, true);
          R.spark(e.x, y, bh, 10, 420, 0.45);
          R.pixels(e.x, y, L.w, L.h, bh, 18);
          R.glows(e.x, y, bh, 4, 90, 16, 0.5);
          R.ring(e.x, y, 4, 50, 0.4, bh, 2);
          R.pop(e.x, y - 34, '+' + e.pts, bh, 18 + Math.min(e.combo, 10));
          A.play('fall', { combo: e.combo });
          if (!demo && e.combo >= 3) comboBanner(e.combo);
          game.lastHitX = e.x; game.lastHitY = Math.min(e.y, sim.killY - 60);
          break;
        }
        case 'bonus':
          R.pop(e.x, e.y - 30, `+${e.n} LASER`, 48, 26, 1.3);
          R.glows(e.x, e.y, 48, 14, 300, 20, 0.8);
          R.ring(e.x, e.y, 10, 120, 0.5, 48, 4);
          A.play('bonus');
          if (!demo) { const hl = $('hudLaser'); hl.classList.remove('gain'); void hl.offsetWidth; hl.classList.add('gain'); vib(30); }
          break;
        case 'release':
          R.spark(e.x, e.y, hue + 60, 8, 260, 0.35);
          A.play('release');
          break;
        case 'floatOff':
          R.spark(e.x, e.y, 120, 14, 300, 0.5);
          R.pop(e.x, e.y - 26, 'POWER DOWN', 120, 13, 0.8);
          break;
        case 'shieldHit':
          e.s.hitX = e.x; e.s.hitY = e.y;
          R.spark(e.x, e.y, 175, 14, 300, 0.4);
          R.pop(e.x, e.y - 26, 'BLOCKED', 175, 15, 0.7);
          A.play('shield');
          break;
        case 'shieldDown':
          R.ring(e.x, e.y, e.r, e.r * 1.6, 0.6, 175, 6);
          R.ring(e.x, e.y, e.r * 0.5, e.r * 1.2, 0.5, 175, 3);
          for (let i = 0; i < 40; i++) { const a = Math.random() * Math.PI * 2; R.spark(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r, 175, 1, 200, 0.6); }
          R.addGlitch(0.25); R.addShake(10);
          A.play('shieldDown');
          if (!demo) banner('', 'SHIELD DOWN', '');
          break;
        case 'deflect':
          R.spark(e.x, e.y, 205, 16, 450, 0.35);
          R.pop(e.x, e.y - 24, 'DEFLECT', 205, 14, 0.6);
          A.play('deflect');
          break;
        case 'cut':
          R.spark(e.x, e.y, 185, 22, 380, 0.45);
          R.flare(e.x, e.y, 40, 0.3, 185, true);
          R.pop(e.x, e.y - 24, 'CUT!', 185, 16, 0.7);
          A.play('cut');
          break;
        case 'clear':
          if (!demo) {
            game.endT = 1.9;
            slowmo(0.9, 0.3);
            game.zoomT = 1.6;
            R.zoomX = game.lastHitX || 300; R.zoomY = game.lastHitY || 500;
            R.addFlash(0.35, hue, true); R.addGlitch(0.2);
            A.play('clear');
            banner('ALL TARGETS DESTROYED', 'CLEAR!', '');
            vib([30, 30, 60]);
            for (let i = 0; i < 6; i++) setTimeout(() => {
              const x = 80 + Math.random() * 440, y = 250 + Math.random() * 350;
              const h = Math.random() * 360;
              R.ring(x, y, 5, 120, 0.7, h, 3); R.glows(x, y, h, 16, 380, 18, 1.1); R.spark(x, y, h, 24, 600, 0.9);
              A.play('fall', { combo: 6 + i });
            }, 300 + i * 170);
          }
          break;
        case 'fail':
          if (!demo) {
            game.endT = 1.0;
            R.addGlitch(0.6); R.addFlash(0.3, 350);
            A.play('fail'); A.duckMusic(0.25);
            vib([60, 40, 60]);
          }
          break;
      }
    }
  }

  function slowmo(dur, scale) {
    game.slowScale = game.slowT > 0 ? Math.min(game.slowScale, scale) : scale;
    game.slowT = Math.max(game.slowT, dur);
  }

  /* ------------------------------------------------------------------ HUD */
  function updateHud() {
    const sim = game.sim;
    if (!sim || game.mode !== 'play') return;
    const h = game.lastHud;
    if (h.lasers !== sim.lasers) {
      h.lasers = sim.lasers;
      $('hudLaserN').textContent = sim.lasers;
      $('hudLaser').classList.toggle('low', sim.lasers <= 3);
    }
    if (h.score !== sim.score) { h.score = sim.score; $('hudScore').textContent = sim.score.toLocaleString(); }
    const done = sim.targetsTotal - sim.targetsLeft;
    if (h.done !== done) {
      h.done = done;
      $('hudTargets').textContent = `${done} / ${sim.targetsTotal}`;
      $('hudBar').style.width = (100 * done / Math.max(1, sim.targetsTotal)) + '%';
    }
  }

  /* ------------------------------------------------------------ main loop */
  let last = performance.now();
  let fpsAcc = 0, fpsN = 0, lowFpsT = 0;
  function frame(now) { frameBody(now); requestAnimationFrame(frame); }
  function frameBody(now) {
    const rdt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    // auto quality fallback on slow devices
    fpsAcc += rdt; fpsN++;
    if (fpsAcc > 2) {
      const fps = fpsN / fpsAcc;
      if (fps < 40 && R.quality === 'high' && save.settings.quality === 'high') { lowFpsT++; if (lowFpsT >= 2) { R.quality = 'low'; R.resize(); } }
      else lowFpsT = 0;
      fpsAcc = 0; fpsN = 0;
    }
    let ts = 1;
    if (game.slowT > 0) { game.slowT -= rdt; ts = game.slowScale; }
    const dt = rdt * ts;
    const sim = game.sim;
    if (sim && !game.paused) {
      if (R.introT > 1.2) {
        game.acc += dt;
        let n = 0;
        while (game.acc >= 1 / 60 && n < 4) { sim.step(); game.acc -= 1 / 60; n++; }
        if (n >= 4) game.acc = 0;
      }
      if (game.mode === 'title' || game.mode === 'select') demoTick(rdt);
      processEvents();
      if (game.mode === 'play' && game.endT > 0) {
        game.endT -= rdt;
        if (game.endT <= 0 && !game.resultShown) {
          game.resultShown = true;
          if (sim.state === 'clear') onClear(); else onFail();
        }
      }
    }
    // zoom punch on clear
    if (game.zoomT > 0) {
      game.zoomT -= rdt;
      const f = game.zoomT / 1.6;
      R.zoom = 1 + 0.18 * Math.sin(Math.min(1, (1 - f) * 1.4) * Math.PI);
    } else R.zoom = 1;
    // idle turret sway
    if (!R.aim && game.mode === 'play') {
      // keep last aim
    } else if (R.aim) {
      const ta = Math.atan2(R.aim.y - TURRET.y, R.aim.x - TURRET.x);
      R.turretAngle += (ta - R.turretAngle) * Math.min(1, rdt * 20);
    }
    R.update(game.paused ? 0 : dt);
    R.draw(sim);
    updateHud();
  }

  /* ----------------------------------------------------------------- boot */
  function boot() {
    loadSave();
    R.quality = save.settings.quality;
    A.sfxOn = save.settings.sfx; A.musicOn = save.settings.music;
    R.init($('cv'));
    const cv = $('cv');
    cv.addEventListener('pointerdown', onDown, { passive: false });
    G.addEventListener('pointermove', onMove, { passive: true });
    G.addEventListener('pointerup', onUp);
    G.addEventListener('pointercancel', (e) => { if (game.pointer === e.pointerId) { game.pointer = null; R.aim = null; } });
    G.addEventListener('resize', () => R.resize());
    if (G.visualViewport) G.visualViewport.addEventListener('resize', () => R.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { pause(); if (A.ctx) A.ctx.suspend(); }
      else if (A.ctx) A.ctx.resume();
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    // first interaction unlocks audio
    const unlock = () => { A.init(); A.setSfx(save.settings.sfx); A.setMusic(save.settings.music); if (!A.music) A.startMusic(game.mode === 'play' ? game.sim.stage.sector : 99, 0.8); };
    G.addEventListener('pointerdown', unlock, { capture: true });

    $('btnStart').onclick = () => { A.init(); A.play('ui'); startStage(Math.min(save.unlocked, N)); };
    $('btnSelect').onclick = () => { A.init(); A.play('ui'); toSelect(); };
    $('btnSettings').onclick = () => { A.init(); A.play('ui'); settings(); };
    $('btnSelBack').onclick = () => { A.play('ui'); toTitle(); };
    $('btnPause').onclick = () => { A.play('ui'); pause(); };
    G.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'p') { if (game.mode === 'play') { if (game.paused && modalOpen()) resume(); else pause(); } }
      if (e.key === 'r' && game.mode === 'play') startStage(game.stageN);
    });
    // debug / direct link: #stage=123
    const m = /stage=(\d+)/.exec(location.hash);
    toTitle();
    if (m) startStage(+m[1]);
    requestAnimationFrame(frame);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  LB.Game = game;
  LB.startStage = startStage;
  // debug: advance the loop manually (e.g. when the tab is hidden and rAF is paused)
  LB.debugAdvance = function (sec) {
    for (let t = 0; t < sec; t += 1 / 60) { last -= 1000 / 60; frameBody(performance.now()); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

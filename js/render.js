/* LaserBeam - renderer: neon sprites, background, particles, beams, post effects */
(function (G) {
  'use strict';
  const LB = G.LB;
  const { W, H, U, TURRET } = LB;
  const clamp = LB.clamp;
  const TAU = Math.PI * 2;
  const HORIZON = 835;

  const R = (LB.Render = {
    quality: 'high', t: 0,
    shake: 0, flash: 0, flashHue: 0, flashWhite: 0, glitch: 0, zoom: 1, zoomX: 300, zoomY: 500,
    aim: null, turretAngle: -Math.PI / 2, recoil: 0,
    introT: 99, stageHue: 190,
  });

  let cv, ctx, dpr = 1, cw = 0, ch = 0, S = 1, offX = 0, offY = 0, K = 1;
  let bgCache = null, bgKey = '';
  const spriteCache = new Map();
  const glowCache = new Map();
  const colorCache = new Map();

  /* ------------------------------------------------------------- setup */
  R.init = function (canvas) {
    cv = canvas; ctx = cv.getContext('2d', { alpha: false });
    R.resize();
  };
  R.resize = function () {
    const vv = G.visualViewport;
    cw = Math.round(vv ? vv.width : G.innerWidth); ch = Math.round(vv ? vv.height : G.innerHeight);
    dpr = Math.min(G.devicePixelRatio || 1, R.quality === 'low' ? 1.25 : 2);
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    S = Math.min(cw / W, ch / H);
    offX = (cw - W * S) / 2;
    offY = (ch - H * S) * 0.62;
    K = S * dpr;
    spriteCache.clear(); bgKey = '';
  };
  R.toWorld = function (sx, sy) { return { x: (sx - offX) / S, y: (sy - offY) / S }; };
  R.toScreen = function (wx, wy) { return { x: wx * S + offX, y: wy * S + offY }; };
  R.scale = () => S;

  function col(h, s, l, a) {
    h = ((Math.round(h) % 360) + 360) % 360;
    const key = h * 1e6 + s * 1e4 + l * 10 + (a === undefined ? 1 : a);
    let c = colorCache.get(key);
    if (!c) { c = a === undefined ? `hsl(${h},${s}%,${l}%)` : `hsla(${h},${s}%,${l}%,${a})`; colorCache.set(key, c); }
    return c;
  }

  function glowSprite(hue, white) {
    const hb = ((Math.round(hue / 10) * 10) % 360 + 360) % 360;
    const key = hb + (white ? 'w' : '');
    let c = glowCache.get(key);
    if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, white ? 'rgba(255,255,255,1)' : col(hb, 100, 85, 1));
    gr.addColorStop(0.2, col(hb, 100, 65, 0.8));
    gr.addColorStop(0.5, col(hb, 100, 55, 0.25));
    gr.addColorStop(1, col(hb, 100, 50, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    glowCache.set(key, c);
    return c;
  }

  /* --------------------------------------------------------- transforms */
  let camX = 0, camY = 0, camS = 1; // device-space camera (with shake and zoom)
  function setWorld() { ctx.setTransform(camS, 0, 0, camS, camX, camY); }
  function setObj(x, y, a) {
    const c = Math.cos(a) * camS, s = Math.sin(a) * camS;
    ctx.setTransform(c, s, -s, c, camX + x * camS, camY + y * camS);
  }

  /* ------------------------------------------------------------ palette */
  R.blockHue = function (lb) {
    const h = R.stageHue;
    switch (lb.type) {
      case 'star': return 48;
      case 'bomb': return 2;
      case 'armor': return h + 160;
      case 'crystal': return 185;
      case 'phase': return 285;
      case 'gen': return 95;
      case 'core': return 330;
      case 'steel': return 205;
    }
    const siteOff = [0, 48, -42, 96, -90][((lb.site % 5) + 5) % 5];
    return h + siteOff + (Math.floor(lb.hueShift * 3) - 1) * 10;
  };

  /* ----------------------------------------------------------- sprites */
  function rr(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }
  function poly(g, n, r, rot) {
    g.beginPath();
    for (let i = 0; i < n; i++) { const a = rot + (i / n) * TAU; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath();
  }
  function starPath(g, r1, r2) {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * TAU, r = i % 2 ? r2 : r1; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath();
  }

  function shapePath(g, shape, w, h) {
    if (shape === 'orb') { g.beginPath(); g.arc(0, 0, w / 2, 0, TAU); return; }
    if (shape === 'gen') { poly(g, 6, w / 2, 0); return; }
    if (shape === 'core') { poly(g, 8, w / 2, Math.PI / 8); return; }
    const r = shape === 'cyl' ? Math.min(w, h) * 0.22 : shape === 'slab' || shape === 'post' ? 3 : 4.5;
    rr(g, -w / 2, -h / 2, w, h, r);
  }

  function blockSprite(lb) {
    const hue = Math.round(R.blockHue(lb));
    const key = lb.type + lb.shape + (lb.w | 0) + 'x' + (lb.h | 0) + '|' + hue;
    let sp = spriteCache.get(key);
    if (sp) return sp;
    const m = 12, w = lb.w, h = lb.h;
    const c = document.createElement('canvas');
    c.width = Math.ceil((w + m * 2) * K); c.height = Math.ceil((h + m * 2) * K);
    const g = c.getContext('2d');
    g.scale(K, K); g.translate(m + w / 2, m + h / 2);
    paintBlock(g, lb.type, lb.shape, w, h, hue);
    sp = { c, m };
    spriteCache.set(key, sp);
    return sp;
  }
  R.paintBlock = function (g, type, shape, w, h, hue) { paintBlock(g, type, shape, w, h, hue); };

  function paintBlock(g, type, shape, w, h, hue) {
    const steel = type === 'steel';
    const neon = col(hue, 100, 62), bright = col(hue, 100, 82);
    // halo
    g.save();
    g.shadowColor = steel ? 'rgba(120,180,255,0.35)' : col(hue, 100, 55, 0.95);
    g.shadowBlur = (steel ? 6 : 13) * K;
    g.fillStyle = steel ? '#556' : neon;
    shapePath(g, shape, w, h); g.fill();
    g.restore();
    // body
    let gr;
    if (steel) {
      gr = g.createLinearGradient(0, -h / 2, 0, h / 2);
      gr.addColorStop(0, '#8a96a6'); gr.addColorStop(0.45, '#4a5360'); gr.addColorStop(1, '#262b33');
    } else if (type === 'crystal') {
      gr = g.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
      gr.addColorStop(0, col(hue, 100, 85, 0.85)); gr.addColorStop(0.5, col(hue, 90, 45, 0.7)); gr.addColorStop(1, col(hue + 30, 100, 70, 0.85));
    } else if (shape === 'cyl' || shape === 'slab' || shape === 'post') {
      gr = g.createLinearGradient(-w / 2, 0, w / 2, 0);
      gr.addColorStop(0, col(hue, 80, 10, 0.97)); gr.addColorStop(0.35, col(hue, 90, 30, 0.97));
      gr.addColorStop(0.5, col(hue, 95, 40, 0.97)); gr.addColorStop(0.65, col(hue, 90, 26, 0.97)); gr.addColorStop(1, col(hue, 80, 9, 0.97));
    } else if (shape === 'orb' || shape === 'gen' || shape === 'core') {
      gr = g.createRadialGradient(-w * 0.15, -h * 0.2, 1, 0, 0, w / 2);
      gr.addColorStop(0, col(hue, 100, 55, 1)); gr.addColorStop(0.6, col(hue, 90, 22, 1)); gr.addColorStop(1, col(hue, 90, 10, 1));
    } else {
      gr = g.createLinearGradient(0, -h / 2, 0, h / 2);
      gr.addColorStop(0, col(hue, 85, type === 'armor' ? 20 : 28, 0.97)); gr.addColorStop(1, col(hue, 90, type === 'armor' ? 7 : 11, 0.97));
    }
    g.fillStyle = gr; shapePath(g, shape, w, h); g.fill();

    g.save(); shapePath(g, shape, w, h); g.clip();
    // details
    g.lineCap = 'round';
    if (steel) {
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(-w / 2, -h / 2, w, Math.max(2, h * 0.18));
      if (w > 16 && h > 16) {
        g.fillStyle = '#b8c4d4';
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.beginPath(); g.arc(sx * (w / 2 - 5), sy * (h / 2 - 5), 1.8, 0, TAU); g.fill(); }
        g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(-w / 2 + 3, 0); g.lineTo(w / 2 - 3, 0); g.stroke();
      } else {
        g.fillStyle = 'rgba(255,200,40,0.55)';
        for (let x = -w / 2 - h; x < w / 2; x += 14) { g.beginPath(); g.moveTo(x, h / 2); g.lineTo(x + 7, h / 2); g.lineTo(x + 7 + h, -h / 2); g.lineTo(x + h, -h / 2); g.fill(); }
      }
    } else if (type === 'crystal') {
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-w / 2, -h / 6); g.lineTo(-w / 8, -h / 2);
      g.moveTo(-w / 2, h / 3); g.lineTo(w / 6, -h / 2);
      g.moveTo(-w / 4, h / 2); g.lineTo(w / 2, -h / 5);
      g.moveTo(w / 5, h / 2); g.lineTo(w / 2, h / 5);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.beginPath(); g.moveTo(-w / 2, -h / 2); g.lineTo(w * 0.1, -h / 2); g.lineTo(-w / 2, h * 0.1); g.fill();
    } else if (type === 'star') {
      g.save(); g.shadowColor = '#fff6a0'; g.shadowBlur = 8 * K;
      g.fillStyle = '#fff3a8'; starPath(g, Math.min(w, h) * 0.36, Math.min(w, h) * 0.15); g.fill(); g.restore();
    } else if (type === 'bomb') {
      g.globalAlpha = 0.35; g.fillStyle = '#ffcc00';
      for (let x = -w / 2 - h; x < w / 2 + h; x += 12) { g.beginPath(); g.moveTo(x, h / 2); g.lineTo(x + 6, h / 2); g.lineTo(x + 6 + h, -h / 2); g.lineTo(x + h, -h / 2); g.fill(); }
      g.globalAlpha = 1;
      const r = Math.min(w, h) * 0.28;
      g.fillStyle = '#1a0004'; g.beginPath(); g.arc(0, 0, r + 2, 0, TAU); g.fill();
      g.save(); g.shadowColor = '#ff3030'; g.shadowBlur = 10 * K;
      g.fillStyle = '#ff5040'; g.beginPath(); g.arc(0, 0, r * 0.62, 0, TAU); g.fill(); g.restore();
      g.strokeStyle = '#ffd0c0'; g.lineWidth = 1.2; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke();
    } else if (type === 'armor') {
      g.strokeStyle = col(hue, 100, 70, 0.55); g.lineWidth = 1.2;
      rr(g, -w / 2 + 5, -h / 2 + 5, w - 10, h - 10, 2); g.stroke();
      // hex plating
      g.strokeStyle = col(hue, 100, 60, 0.22); g.lineWidth = 1;
      g.beginPath();
      for (let y = -h / 2 + 4; y < h / 2; y += 8) { g.moveTo(-w / 2, y); g.lineTo(w / 2, y + 4); }
      g.stroke();
      g.fillStyle = bright;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.fillRect(sx * (w / 2 - 6) - 1.5, sy * (h / 2 - 6) - 1.5, 3, 3);
    } else if (type === 'gen') {
      g.strokeStyle = bright; g.lineWidth = 1.5;
      poly(g, 6, w * 0.3, 0); g.stroke();
      g.save(); g.shadowColor = '#d8ff80'; g.shadowBlur = 8 * K; g.fillStyle = '#f0ffd0';
      g.beginPath(); g.arc(0, 0, w * 0.12, 0, TAU); g.fill(); g.restore();
    } else if (type === 'core') {
      g.strokeStyle = col(hue, 100, 70, 0.8); g.lineWidth = 2;
      for (const k of [0.36, 0.26]) { g.beginPath(); g.arc(0, 0, w * k, 0, TAU); g.stroke(); }
      g.lineWidth = 1; g.strokeStyle = col(hue, 100, 70, 0.4);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; g.beginPath(); g.moveTo(Math.cos(a) * w * 0.36, Math.sin(a) * w * 0.36); g.lineTo(Math.cos(a) * w * 0.48, Math.sin(a) * w * 0.48); g.stroke(); }
    } else if (shape === 'orb') {
      g.strokeStyle = col(hue, 100, 75, 0.6); g.lineWidth = 1.2;
      g.beginPath(); g.arc(0, 0, w * 0.3, 0, TAU); g.stroke();
      g.beginPath(); g.ellipse(0, 0, w * 0.5, w * 0.16, 0.5, 0, TAU); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(-w * 0.16, -w * 0.18, w * 0.09, 0, TAU); g.fill();
    } else {
      // circuit panel
      g.strokeStyle = col(hue, 100, 70, 0.4); g.lineWidth = 1;
      if (w > 14 && h > 14) { rr(g, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 2.5); g.stroke(); }
      g.strokeStyle = col(hue, 100, 72, 0.55); g.lineWidth = 1.2;
      g.beginPath();
      if (shape === 'plank') {
        g.moveTo(-w / 2 + 6, 0); g.lineTo(w / 2 - 6, 0);
      } else if (shape === 'slab') {
        g.moveTo(0, -h / 2 + 5); g.lineTo(0, h / 2 - 5);
      } else if (shape === 'brick') {
        g.moveTo(0, -h / 2); g.lineTo(0, h / 2);
        g.moveTo(-w / 2 + 6, -h / 4); g.lineTo(-w / 4, -h / 4); g.lineTo(-w / 4 + 4, 0);
        g.moveTo(w / 2 - 6, h / 4); g.lineTo(w / 4, h / 4); g.lineTo(w / 4 - 4, 0);
      } else if (shape === 'cyl') {
        g.moveTo(-w / 2 + 3, -h / 2 + 6); g.quadraticCurveTo(0, -h / 2 + 11, w / 2 - 3, -h / 2 + 6);
        g.moveTo(-w / 2 + 3, h / 2 - 6); g.quadraticCurveTo(0, h / 2 - 1, w / 2 - 3, h / 2 - 6);
      } else {
        g.moveTo(-w / 2 + 4, -h * 0.18); g.lineTo(-w * 0.18, -h * 0.18); g.lineTo(-w * 0.1, -h * 0.1);
        g.moveTo(w / 2 - 4, h * 0.2); g.lineTo(w * 0.2, h * 0.2); g.lineTo(w * 0.1, h * 0.1);
        g.moveTo(w * 0.12, -h / 2 + 4); g.lineTo(w * 0.12, -h * 0.12);
      }
      g.stroke();
      // core chip
      if (shape !== 'plank' && shape !== 'slab' && shape !== 'post') {
        const cs = Math.min(w, h) * 0.17;
        g.fillStyle = bright; g.fillRect(-cs / 2, -cs / 2, cs, cs);
      } else if (shape === 'plank') {
        g.fillStyle = bright;
        for (let x = -w / 2 + 10; x < w / 2 - 6; x += 16) g.fillRect(x - 1.5, -1.5, 3, 3);
      }
    }
    // top sheen
    if (!steel && shape !== 'orb') {
      const sh = g.createLinearGradient(0, -h / 2, 0, 0);
      sh.addColorStop(0, 'rgba(255,255,255,0.22)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sh; g.fillRect(-w / 2, -h / 2, w, h / 2);
    }
    g.restore();
    // border
    g.lineWidth = type === 'armor' ? 3 : steel ? 1.5 : 2;
    g.strokeStyle = steel ? '#aebbd0' : type === 'crystal' ? 'rgba(235,255,255,0.95)' : neon;
    shapePath(g, shape, w, h); g.stroke();
    if (!steel) {
      g.lineWidth = 1; g.strokeStyle = col(hue, 100, 90, 0.6);
      g.save(); g.translate(0, 0.5); shapePath(g, shape, w - 1, h - 1); g.restore();
    }
  }

  /* -------------------------------------------------------- background */
  function buildBackground(hue) {
    const c = document.createElement('canvas');
    c.width = cv.width; c.height = cv.height;
    const g = c.getContext('2d');
    const h2 = hue + 150;
    const gr = g.createLinearGradient(0, 0, 0, c.height);
    gr.addColorStop(0, col(hue + 20, 70, 3));
    gr.addColorStop(0.45, col(hue - 10, 70, 7));
    const hy = (HORIZON * S + offY) * dpr;
    gr.addColorStop(clamp(hy / c.height, 0.1, 0.95), col(h2, 70, 16));
    gr.addColorStop(1, col(hue, 60, 3));
    g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
    // stars
    const rnd = LB.makeRng(1234 + Math.round(hue));
    for (let i = 0; i < 160; i++) {
      const x = rnd.f() * c.width, y = rnd.f() * hy * 0.9;
      g.fillStyle = `rgba(255,255,255,${0.2 + rnd.f() * 0.6})`;
      const s = (rnd.f() < 0.1 ? 2 : 1) * dpr;
      g.fillRect(x, y, s, s);
    }
    // sun
    const sx = c.width / 2, sr = Math.min(170 * S, c.width * 0.32) * dpr, sy = hy - sr * 0.35;
    g.save();
    g.beginPath(); g.rect(0, 0, c.width, hy); g.clip();
    const sg = g.createLinearGradient(0, sy - sr, 0, sy + sr);
    sg.addColorStop(0, col(h2 + 40, 100, 70, 0.85)); sg.addColorStop(0.55, col(h2, 100, 58, 0.75)); sg.addColorStop(1, col(h2 - 40, 100, 45, 0.6));
    g.shadowColor = col(h2, 100, 60); g.shadowBlur = 60 * dpr;
    g.fillStyle = sg; g.beginPath(); g.arc(sx, sy, sr, 0, TAU); g.fill();
    g.shadowBlur = 0;
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 9; i++) {
      const yy = sy + sr * (0.05 + i * 0.11), hh = (1.5 + i * 1.1) * dpr * S * 1.6;
      g.fillRect(sx - sr, yy, sr * 2, hh);
    }
    g.restore();
    // city skyline (two layers)
    for (let layer = 0; layer < 2; layer++) {
      const base = hy;
      let x = -10;
      const light = layer === 0 ? 9 : 5;
      while (x < c.width) {
        const bw = (18 + rnd.f() * 40) * dpr * S * 1.4;
        const bh = (layer === 0 ? 60 + rnd.f() * 230 : 30 + rnd.f() * 140) * dpr * S * 1.3;
        g.fillStyle = col(hue + (layer ? 10 : -10), 60, light);
        g.fillRect(x, base - bh, bw, bh);
        // antenna
        if (rnd.f() < 0.25) { g.fillRect(x + bw / 2 - dpr, base - bh - 14 * dpr * S, 2 * dpr, 14 * dpr * S); g.fillStyle = col(0, 100, 60); g.fillRect(x + bw / 2 - 1.5 * dpr, base - bh - 16 * dpr * S, 3 * dpr, 3 * dpr); }
        // windows
        if (layer === 1) {
          for (let wy = base - bh + 6 * dpr; wy < base - 4 * dpr; wy += 7 * dpr * S * 1.3) {
            for (let wx = x + 4 * dpr; wx < x + bw - 4 * dpr; wx += 6 * dpr * S * 1.3) {
              if (rnd.f() < 0.28) { g.fillStyle = rnd.f() < 0.7 ? col(hue, 100, 70, 0.55) : col(h2, 100, 70, 0.55); g.fillRect(wx, wy, 2 * dpr * S * 1.3, 2.5 * dpr * S * 1.3); }
            }
          }
        } else {
          g.fillStyle = col(hue, 100, 60, 0.35);
          g.fillRect(x, base - bh, bw, 1.5 * dpr);
        }
        x += bw + (layer ? 2 : 6) * dpr;
      }
    }
    // horizon glow line
    const hg = g.createLinearGradient(0, hy - 40 * dpr, 0, hy + 30 * dpr);
    hg.addColorStop(0, col(h2, 100, 60, 0)); hg.addColorStop(0.6, col(h2, 100, 65, 0.35)); hg.addColorStop(1, col(hue, 100, 60, 0));
    g.fillStyle = hg; g.fillRect(0, hy - 40 * dpr, c.width, 70 * dpr);
    // floor base
    const fg = g.createLinearGradient(0, hy, 0, c.height);
    fg.addColorStop(0, col(hue, 80, 8, 0.95)); fg.addColorStop(1, col(hue, 70, 3, 1));
    g.fillStyle = fg; g.fillRect(0, hy, c.width, c.height - hy);
    return c;
  }

  let vignette = null, scan = null;
  function buildOverlays() {
    vignette = document.createElement('canvas'); vignette.width = cv.width; vignette.height = cv.height;
    const g = vignette.getContext('2d');
    const gr = g.createRadialGradient(cv.width / 2, cv.height / 2, Math.min(cv.width, cv.height) * 0.35, cv.width / 2, cv.height / 2, Math.max(cv.width, cv.height) * 0.75);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = gr; g.fillRect(0, 0, cv.width, cv.height);
    scan = document.createElement('canvas'); scan.width = 4; scan.height = 4;
    const s = scan.getContext('2d'); s.fillStyle = 'rgba(0,0,0,0.18)'; s.fillRect(0, 0, 4, 1);
  }

  function drawBackground(hue) {
    const key = hue + '|' + cv.width + 'x' + cv.height;
    if (key !== bgKey) { bgCache = buildBackground(hue); bgKey = key; buildOverlays(); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(bgCache, 0, 0);
    // perspective grid floor
    const hy = (HORIZON * S + offY) * dpr;
    const bottom = cv.height;
    const cx = cv.width / 2;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = Math.max(1, dpr);
    const t = R.t;
    const rows = 14;
    for (let i = 0; i < rows; i++) {
      const f = ((i + (t * 0.6) % 1) / rows);
      const p = f * f * f;
      const y = hy + (bottom - hy) * p * 1.05;
      if (y > bottom) continue;
      ctx.strokeStyle = col(R.stageHue, 100, 60, 0.08 + p * 0.5);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cv.width, y); ctx.stroke();
    }
    const spread = cv.width * 2.2;
    for (let i = -12; i <= 12; i++) {
      const xb = cx + (i / 12) * spread;
      ctx.strokeStyle = col(R.stageHue, 100, 60, 0.3 - Math.abs(i) * 0.012);
      ctx.beginPath(); ctx.moveTo(cx + (i / 12) * cv.width * 0.12, hy); ctx.lineTo(xb, bottom); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ------------------------------------------------------- particles & fx */
  const parts = [];
  const rings = [];
  const beams = [];
  const flares = [];
  const pops = [];
  const MAXP = () => (R.quality === 'low' ? 380 : 1100);

  function P(o) {
    if (parts.length >= MAXP()) parts.splice(0, 20);
    parts.push(o);
    return o;
  }
  R.clearFx = function () { parts.length = 0; rings.length = 0; beams.length = 0; flares.length = 0; pops.length = 0; };

  R.spark = function (x, y, hue, n, speed, life) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = speed * (0.3 + Math.random());
      P({ k: 0, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 500, drag: 2.2, t: 0, life: life * (0.5 + Math.random() * 0.8), s: 1.5 + Math.random() * 1.5, h: hue + (Math.random() - 0.5) * 30 });
    }
  };
  R.shards = function (x, y, w, h, angle, hue, vx, vy, power) {
    const n = Math.min(26, 6 + Math.round((w * h) / 110));
    const c = Math.cos(angle), s = Math.sin(angle);
    for (let i = 0; i < n; i++) {
      const lx = (Math.random() - 0.5) * w, ly = (Math.random() - 0.5) * h;
      const px = x + lx * c - ly * s, py = y + lx * s + ly * c;
      const dx = px - x, dy = py - y, d = Math.hypot(dx, dy) || 1;
      const sp = (140 + Math.random() * 300) * power;
      const sz = 3 + Math.random() * Math.min(w, h) * 0.28;
      P({ k: 1, x: px, y: py, vx: (dx / d) * sp + vx * 40, vy: (dy / d) * sp - 120 * power + vy * 40, g: 900, drag: 0.6, t: 0, life: 0.7 + Math.random() * 0.8, s: sz, h: hue + (Math.random() - 0.5) * 20, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 18, v: Math.random() });
    }
  };
  R.glows = function (x, y, hue, n, speed, size, life) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = speed * Math.random();
      P({ k: 2, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: -20, drag: 2.5, t: 0, life: life * (0.6 + Math.random() * 0.6), s: size * (0.5 + Math.random()), h: hue });
    }
  };
  R.pixels = function (x, y, w, h, hue, n) {
    for (let i = 0; i < n; i++) {
      P({ k: 3, x: x + (Math.random() - 0.5) * w, y: y + (Math.random() - 0.5) * h, vx: (Math.random() - 0.5) * 60, vy: -40 - Math.random() * 160, g: -60, drag: 1.2, t: 0, life: 0.6 + Math.random() * 0.9, s: 2 + Math.random() * 4, h: hue + (Math.random() - 0.5) * 40 });
    }
  };
  R.ring = function (x, y, r0, r1, life, hue, width) { rings.push({ x, y, r0, r1, t: 0, life, h: hue, w: width || 3 }); };
  R.flare = function (x, y, size, life, hue, streak) { flares.push({ x, y, s: size, t: 0, life, h: hue, streak: !!streak }); };
  R.pop = function (x, y, text, hue, size, life) {
    if (pops.length > 40) pops.shift();
    pops.push({ x, y, text, h: hue, s: size || 22, t: 0, life: life || 0.9 });
  };
  R.beam = function (x0, y0, x1, y1, hue) { beams.push({ x0, y0, x1, y1, t: 0, life: 0.34, h: hue }); };
  R.addShake = function (v) { R.shake = Math.min(34, Math.max(R.shake, v)); };
  R.addFlash = function (v, hue, white) { R.flash = Math.max(R.flash, v); R.flashHue = hue; R.flashWhite = white ? 1 : 0; };
  R.addGlitch = function (v) { R.glitch = Math.max(R.glitch, v); };

  function updateFx(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.t += dt;
      if (p.t >= p.life) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vy = p.vy * dr + p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.rot !== undefined) p.rot += p.vr * dt;
    }
    for (const arr of [rings, beams, flares, pops]) {
      for (let i = arr.length - 1; i >= 0; i--) { arr[i].t += dt; if (arr[i].t >= arr[i].life) arr.splice(i, 1); }
    }
    for (const p of pops) p.y -= 38 * dt;
  }

  function drawParticles() {
    ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      const f = 1 - p.t / p.life;
      if (p.k === 0) {
        ctx.globalAlpha = f;
        setWorld();
        ctx.strokeStyle = col(p.h, 100, 70);
        ctx.lineWidth = p.s;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); ctx.stroke();
      } else if (p.k === 1) {
        ctx.globalAlpha = Math.min(1, f * 1.6);
        setObj(p.x, p.y, p.rot);
        ctx.fillStyle = col(p.h, 100, 45 + p.v * 30);
        const s = p.s;
        ctx.beginPath(); ctx.moveTo(-s * 0.6, -s * 0.5); ctx.lineTo(s * 0.7, -s * 0.2); ctx.lineTo(-s * 0.1, s * 0.6); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = col(p.h, 100, 80); ctx.lineWidth = 0.8; ctx.stroke();
      } else if (p.k === 2) {
        ctx.globalAlpha = f;
        setWorld();
        const s = p.s * (0.6 + f * 0.6);
        ctx.drawImage(glowSprite(p.h), p.x - s, p.y - s, s * 2, s * 2);
      } else {
        ctx.globalAlpha = f * (Math.random() < 0.15 ? 0.3 : 1);
        setWorld();
        ctx.fillStyle = col(p.h, 100, 65);
        ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawRingsFlares() {
    ctx.globalCompositeOperation = 'lighter';
    setWorld();
    for (const r of rings) {
      const f = r.t / r.life, e = 1 - Math.pow(1 - f, 3);
      const rad = r.r0 + (r.r1 - r.r0) * e;
      ctx.globalAlpha = (1 - f) * 0.9;
      ctx.strokeStyle = col(r.h, 100, 65);
      ctx.lineWidth = r.w * (1 - f) + 0.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, TAU); ctx.stroke();
      ctx.globalAlpha = (1 - f) * 0.25;
      ctx.lineWidth = r.w * 4 * (1 - f) + 1;
      ctx.stroke();
    }
    for (const fl of flares) {
      const f = fl.t / fl.life;
      const a = 1 - f;
      const s = fl.s * (0.6 + 0.6 * Math.sqrt(f));
      ctx.globalAlpha = a;
      ctx.drawImage(glowSprite(fl.h), fl.x - s, fl.y - s, s * 2, s * 2);
      ctx.drawImage(glowSprite(fl.h, true), fl.x - s * 0.45, fl.y - s * 0.45, s * 0.9, s * 0.9);
      if (fl.streak) {
        ctx.strokeStyle = col(fl.h, 100, 80);
        ctx.lineWidth = 2 * a;
        const L = fl.s * 2.4 * (1 - f * 0.5);
        ctx.beginPath(); ctx.moveTo(fl.x - L, fl.y); ctx.lineTo(fl.x + L, fl.y);
        ctx.moveTo(fl.x, fl.y - L * 0.5); ctx.lineTo(fl.x, fl.y + L * 0.5); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawBeams() {
    if (!beams.length) return;
    ctx.globalCompositeOperation = 'lighter';
    setWorld();
    ctx.lineCap = 'round';
    for (const b of beams) {
      const f = b.t / b.life;
      const grow = clamp(b.t / 0.035, 0, 1);
      const x1 = b.x0 + (b.x1 - b.x0) * grow, y1 = b.y0 + (b.y1 - b.y0) * grow;
      const fade = f < 0.3 ? 1 : 1 - (f - 0.3) / 0.7;
      const wob = 1 + Math.sin(R.t * 90) * 0.12;
      const layers = [[30, 0.16, 55], [15, 0.4, 60], [7, 0.8, 70], [2.6, 1, 97]];
      for (const [w, a, l] of layers) {
        ctx.globalAlpha = a * fade;
        ctx.strokeStyle = l > 90 ? '#ffffff' : col(b.h, 100, l);
        ctx.lineWidth = w * wob * (0.4 + fade * 0.6);
        ctx.beginPath(); ctx.moveTo(b.x0, b.y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      // travelling energy knots
      ctx.globalAlpha = fade;
      const len = Math.hypot(b.x1 - b.x0, b.y1 - b.y0);
      for (let k = 0; k < 5; k++) {
        const q = ((R.t * 3.5 + k / 5) % 1) * grow;
        const x = b.x0 + (b.x1 - b.x0) * q, y = b.y0 + (b.y1 - b.y0) * q;
        const s = 10 + (len > 0 ? 6 : 0);
        ctx.drawImage(glowSprite(b.h, true), x - s, y - s, s * 2, s * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawPops() {
    setWorld();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of pops) {
      const f = p.t / p.life;
      const sc = f < 0.12 ? 0.6 + (f / 0.12) * 0.6 : 1.2 - Math.min(0.2, (f - 0.12));
      ctx.globalAlpha = f > 0.7 ? (1 - f) / 0.3 : 1;
      ctx.font = `900 ${Math.round(p.s * sc)}px Orbitron, "Arial Black", sans-serif`;
      ctx.lineWidth = 6; ctx.strokeStyle = col(p.h, 100, 45, 0.55);
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = col(p.h, 100, 88);
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  /* -------------------------------------------------------------- world */
  function drawPlatforms(sim) {
    for (const b of sim.bodies) {
      if (b.lb.kind !== 'platform') continue;
      const L = b.lb, x = b.position.x, y = b.position.y, w = L.w, h = L.h;
      const hue = R.stageHue + 150;
      // pedestal column
      setWorld();
      const pw = clamp(w * 0.34, 18, 70);
      const top = y + h / 2, bot = HORIZON + 40;
      const pg = ctx.createLinearGradient(0, top, 0, bot);
      pg.addColorStop(0, col(hue, 70, 20, 0.95)); pg.addColorStop(1, col(hue, 70, 8, 0));
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.moveTo(x - pw / 2, top); ctx.lineTo(x + pw / 2, top); ctx.lineTo(x + pw * 0.35, bot); ctx.lineTo(x - pw * 0.35, bot); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      const eg = ctx.createLinearGradient(0, top, 0, bot);
      eg.addColorStop(0, col(hue, 100, 65, 0.8)); eg.addColorStop(1, col(hue, 100, 60, 0));
      ctx.strokeStyle = eg; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - pw / 2, top); ctx.lineTo(x - pw * 0.35, bot); ctx.moveTo(x + pw / 2, top); ctx.lineTo(x + pw * 0.35, bot); ctx.stroke();
      // energy bands flowing up
      for (let i = 0; i < 3; i++) {
        const q = 1 - ((R.t * 0.5 + i / 3) % 1);
        const yy = top + (bot - top) * q;
        const ww = pw * (1 - q * 0.3);
        ctx.globalAlpha = (1 - q) * 0.7;
        ctx.fillStyle = col(hue, 100, 70);
        ctx.fillRect(x - ww / 2, yy, ww, 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      // slab
      setObj(x, y, b.angle);
      ctx.save();
      ctx.shadowColor = col(hue, 100, 55); ctx.shadowBlur = 16 * camS;
      const sg = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      sg.addColorStop(0, col(hue, 60, 40)); sg.addColorStop(0.3, col(hue, 60, 22)); sg.addColorStop(1, col(hue, 60, 10));
      ctx.fillStyle = sg;
      rr(ctx, -w / 2, -h / 2, w, h, 4); ctx.fill();
      ctx.restore();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = col(hue, 100, 70); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-w / 2 + 3, -h / 2 + 1); ctx.lineTo(w / 2 - 3, -h / 2 + 1); ctx.stroke();
      ctx.strokeStyle = col(hue, 100, 60, 0.5); ctx.lineWidth = 1;
      rr(ctx, -w / 2, -h / 2, w, h, 4); ctx.stroke();
      // running lights
      const n = Math.max(2, Math.floor(w / 26));
      for (let i = 0; i < n; i++) {
        const lx = -w / 2 + (i + 0.5) * (w / n);
        const on = (Math.floor(R.t * 6) + i) % n === 0;
        ctx.fillStyle = col(hue, 100, on ? 85 : 55, on ? 1 : 0.5);
        ctx.fillRect(lx - 2, h / 2 - 5, 4, 2);
      }
      if (L.kin) { // motion chevrons
        ctx.fillStyle = col(50, 100, 60, 0.7);
        const mode = L.kin.mode;
        if (mode === 'move' || mode === 'rock') {
          for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sgn * (w / 2 - 4), 1); ctx.lineTo(sgn * (w / 2 - 10), -3); ctx.lineTo(sgn * (w / 2 - 10), 5); ctx.fill(); }
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawOrbitPaths(sim) {
    const st = sim.stage;
    if (!st.orbits.length) return;
    ctx.globalCompositeOperation = 'lighter';
    setWorld();
    for (const o of st.orbits) {
      const rs = new Set(o.items.map((i) => Math.round(i.r)));
      ctx.strokeStyle = col(o.steel ? 0 : R.stageHue, 100, 60, 0.22);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 10]);
      ctx.lineDashOffset = -R.t * 30 * Math.sign(o.speed);
      for (const r of rs) { ctx.beginPath(); ctx.arc(o.cx, o.cy, r, 0, TAU); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.5;
      const s = 16;
      ctx.drawImage(glowSprite(R.stageHue), o.cx - s, o.cy - s, s * 2, s * 2);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawShieldBack(sim) {
    for (const s of sim.shields) {
      if (!s.active && !(s.downT !== undefined && R.t - s.downT < 0.6)) continue;
      setWorld();
      const hue = 175;
      const gr = ctx.createRadialGradient(s.x, s.y, s.r * 0.3, s.x, s.y, s.r);
      gr.addColorStop(0, col(hue, 100, 60, 0)); gr.addColorStop(0.85, col(hue, 100, 60, 0.07)); gr.addColorStop(1, col(hue, 100, 70, 0.22));
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
    }
  }

  function drawShieldFront(sim) {
    for (const s of sim.shields) {
      let alpha = 1;
      if (!s.active) {
        if (s.downT === undefined) s.downT = R.t;
        const f = (R.t - s.downT) / 0.6;
        if (f >= 1) continue;
        alpha = (1 - f) * (Math.random() < 0.5 ? 1 : 0.3);
      }
      ctx.globalCompositeOperation = 'lighter';
      setWorld();
      const hue = 175;
      // hex lattice
      ctx.save();
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.clip();
      ctx.strokeStyle = col(hue, 100, 65, 0.13 * alpha + 0.05 * Math.sin(R.t * 4));
      ctx.lineWidth = 1;
      const hs = 16;
      ctx.beginPath();
      for (let yy = s.y - s.r; yy < s.y + s.r + hs; yy += hs * 1.5) {
        for (let xx = s.x - s.r; xx < s.x + s.r + hs; xx += hs * 1.732) {
          const ox = (Math.round((yy - s.y) / (hs * 1.5)) & 1) ? hs * 0.866 : 0;
          const cx = xx + ox, cy = yy;
          for (let i = 0; i < 6; i++) {
            const a = Math.PI / 6 + (i / 6) * TAU;
            const px = cx + Math.cos(a) * hs, py = cy + Math.sin(a) * hs;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
        }
      }
      ctx.stroke();
      // hit ripple
      const ht = sim.t - s.hitT;
      if (ht < 0.6 && s.hitX !== undefined) {
        const f = ht / 0.6;
        ctx.globalAlpha = (1 - f) * alpha;
        ctx.strokeStyle = col(hue, 100, 80); ctx.lineWidth = 6 * (1 - f) + 1;
        ctx.beginPath(); ctx.arc(s.hitX, s.hitY, f * s.r * 1.4, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = col(hue, 100, 70, 0.85);
      ctx.lineWidth = 2 + Math.sin(R.t * 6) * 0.6;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = col(hue, 100, 70, 0.25); ctx.lineWidth = 8; ctx.stroke();
      // power links to generators
      ctx.setLineDash([4, 8]); ctx.lineDashOffset = -R.t * 60;
      for (const g of s.gens) {
        if (!g.lb.alive) continue;
        const dx = s.x - g.position.x, dy = s.y - g.position.y, d = Math.hypot(dx, dy);
        const ex = s.x - (dx / d) * s.r, ey = s.y - (dy / d) * s.r;
        ctx.strokeStyle = col(95, 100, 65, 0.7); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(g.position.x, g.position.y); ctx.lineTo(ex, ey); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawTethers(sim) {
    ctx.globalCompositeOperation = 'lighter';
    setWorld();
    for (const c of sim.tethers) {
      if (!c.lb.alive) continue;
      const [a, b] = sim.tetherPoints(c);
      const n = 9;
      for (const [w, al, l] of [[5, 0.25, 60], [1.6, 0.95, 85]]) {
        ctx.strokeStyle = col(185, 100, l, al); ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(a.x, a.y);
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        const nx = -dy / d, ny = dx / d;
        for (let i = 1; i < n; i++) {
          const q = i / n, j = (Math.random() - 0.5) * 5;
          ctx.lineTo(a.x + dx * q + nx * j, a.y + dy * q + ny * j);
        }
        ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      if (!c.bodyA) {
        ctx.fillStyle = col(185, 100, 70);
        ctx.beginPath(); ctx.moveTo(a.x, a.y - 7); ctx.lineTo(a.x + 7, a.y); ctx.lineTo(a.x, a.y + 7); ctx.lineTo(a.x - 7, a.y); ctx.fill();
        ctx.drawImage(glowSprite(185), a.x - 16, a.y - 16, 32, 32);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawBlocks(sim, layerFilter) {
    const t = R.t;
    const intro = R.introT;
    for (const b of sim.bodies) {
      const L = b.lb;
      if (L.removed || L.kind === 'platform') continue;
      if (layerFilter === 'front' ? !(L.kind === 'spinner' || L.kind === 'hub') : (L.kind === 'spinner' || L.kind === 'hub')) continue;
      const x = b.position.x, y = b.position.y, a = b.angle;
      if (L.kind === 'spinner') { drawSpinner(b); continue; }
      if (L.kind === 'hub') { drawHub(b); continue; }
      let alpha = 1;
      if (L.cleared) {
        alpha = clamp(1 - (y - sim.killY) / 110, 0, 1);
        if (L.fallT === undefined) L.fallT = t;
        alpha *= Math.random() < 0.2 ? 0.4 : 1;
        if (alpha <= 0.01) continue;
      }
      // materialize at stage start
      let build = 1;
      if (intro < 1.6) {
        const d = clamp((L.home.y - 180) / 620, 0, 1);
        build = clamp((intro - (1 - d) * 0.8) / 0.4, 0, 1);
        if (build <= 0) continue;
      }
      if (L.type === 'phase') alpha *= 1 - sim.phaseLevel(b) * 0.75;
      const sp = blockSprite(L);
      const hw = L.w / 2 + sp.m, hh = L.h / 2 + sp.m;
      setObj(x + (L.cleared ? (Math.random() - 0.5) * 6 : 0), y, a);
      ctx.globalAlpha = alpha * (build < 1 ? build * 0.8 : 1);
      if (build < 1) {
        const vis = (L.h + sp.m * 2) * build;
        const sy = (1 - build) * sp.c.height;
        ctx.drawImage(sp.c, 0, sy, sp.c.width, sp.c.height - sy, -hw, -hh + (hh * 2 - vis), hw * 2, vis);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#fff';
        ctx.fillRect(-hw + sp.m, -hh + (hh * 2 - vis) + sp.m * 0.2, L.w, 2);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.drawImage(sp.c, -hw, -hh, hw * 2, hh * 2);
      if (L.type === 'phase' && sim.phaseLevel(b) > 0.3) {
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([4, 4]); ctx.lineDashOffset = t * 20;
        ctx.strokeStyle = col(285, 100, 75); ctx.lineWidth = 1.5;
        ctx.strokeRect(-L.w / 2, -L.h / 2, L.w, L.h);
        ctx.setLineDash([]);
      }
      // dynamic light
      ctx.globalCompositeOperation = 'lighter';
      const hue = R.blockHue(L);
      if (L.type !== 'steel') {
        const pulse = 0.22 + 0.16 * Math.sin(t * 3 + L.id * 1.7);
        const wave = Math.exp(-Math.pow((y - (900 - ((t * 260) % 1400))) / 50, 2)) * 0.5;
        ctx.globalAlpha = alpha * (pulse + wave);
        const gs = Math.min(L.w, L.h) * 0.9 + 6;
        ctx.drawImage(glowSprite(hue), -gs, -gs, gs * 2, gs * 2);
      }
      if (L.type === 'bomb') {
        const p = 0.5 + 0.5 * Math.sin(t * 9);
        ctx.globalAlpha = alpha * (0.3 + 0.5 * p);
        const gs = L.w * 0.9;
        ctx.drawImage(glowSprite(0), -gs, -gs, gs * 2, gs * 2);
      }
      if (L.type === 'star') {
        ctx.globalAlpha = alpha * 0.8;
        ctx.strokeStyle = '#fff6b0'; ctx.lineWidth = 1.5;
        const r = L.w * 0.55 + Math.sin(t * 5) * 3, a2 = t * 2;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) { const q = a2 + (i * Math.PI) / 2; ctx.moveTo(Math.cos(q) * r * 0.7, Math.sin(q) * r * 0.7); ctx.lineTo(Math.cos(q) * r, Math.sin(q) * r); }
        ctx.stroke();
      }
      if (L.type === 'gen') {
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = col(95, 100, 70); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, L.w * 0.75, t * 3, t * 3 + 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, L.w * 0.75, t * 3 + 3.14, t * 3 + 5.14); ctx.stroke();
      }
      if (L.type === 'core') {
        const p = 0.5 + 0.5 * Math.sin(t * 4);
        ctx.globalAlpha = 0.5 + p * 0.5;
        const gs = L.w * (0.5 + p * 0.15);
        ctx.drawImage(glowSprite(330, true), -gs * 0.5, -gs * 0.5, gs, gs);
        ctx.drawImage(glowSprite(330), -gs * 1.4, -gs * 1.4, gs * 2.8, gs * 2.8);
      }
      if (L.float && L.float.on) {
        ctx.globalAlpha = 0.6 + Math.random() * 0.4;
        const fl = 10 + Math.random() * 8;
        for (const sx of [-L.w * 0.28, L.w * 0.28]) ctx.drawImage(glowSprite(120), sx - 6, L.h / 2 - 2, 12, fl);
      }
      if (L.hitT !== undefined && sim.t - L.hitT < 0.14) {
        ctx.globalAlpha = 1 - (sim.t - L.hitT) / 0.14;
        ctx.fillStyle = '#fff';
        ctx.fillRect(-L.w / 2, -L.h / 2, L.w, L.h);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha;
      // damage
      if (L.maxHp > 1 && L.alive) {
        const dmg = L.maxHp - L.hp;
        if (dmg > 0) {
          ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.2;
          ctx.beginPath();
          const seed = L.id * 13;
          for (let i = 0; i < dmg * 3; i++) {
            const q = seed + i * 2.3;
            ctx.moveTo(Math.sin(q) * L.w * 0.1, Math.cos(q) * L.h * 0.1);
            ctx.lineTo(Math.sin(q * 1.7) * L.w * 0.45, Math.cos(q * 1.3) * L.h * 0.45);
          }
          ctx.stroke();
        }
        // hp pips
        const n = L.maxHp;
        if (L.type !== 'core') {
          for (let i = 0; i < n; i++) {
            ctx.fillStyle = i < L.hp ? '#fff' : 'rgba(255,255,255,0.18)';
            ctx.fillRect(-n * 4 + i * 8 + 1, L.h / 2 - 6, 6, 3);
          }
        }
      }
      ctx.globalAlpha = 1;
      if (L.type === 'core' && L.alive) {
        setWorld();
        const bw = 90, bh = 7, bx = x - bw / 2, by = y - L.h / 2 - 22;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
        ctx.fillStyle = col(330, 100, 60);
        ctx.fillRect(bx, by, bw * (L.hp / L.maxHp), bh);
        ctx.strokeStyle = col(330, 100, 80); ctx.lineWidth = 1; ctx.strokeRect(bx - 2, by - 2, bw + 4, bh + 4);
      }
    }
  }

  function drawSpinner(b) {
    const L = b.lb;
    // motion trail
    ctx.globalCompositeOperation = 'lighter';
    setWorld();
    ctx.strokeStyle = col(50, 100, 60, 0.12); ctx.lineWidth = L.h;
    const sp = L.kin.speed;
    ctx.beginPath(); ctx.arc(b.position.x, b.position.y, L.w / 2 - L.h / 2, b.angle - sp * 0.25, b.angle, sp < 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(b.position.x, b.position.y, L.w / 2 - L.h / 2, b.angle + Math.PI - sp * 0.25, b.angle + Math.PI, sp < 0); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    setObj(b.position.x, b.position.y, b.angle);
    const w = L.w, h = L.h;
    const gr = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    gr.addColorStop(0, '#9aa6b8'); gr.addColorStop(0.5, '#4a5462'); gr.addColorStop(1, '#232830');
    ctx.fillStyle = gr; rr(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.fill();
    ctx.save(); rr(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.clip();
    ctx.fillStyle = 'rgba(255,200,30,0.75)';
    for (let x = -w / 2; x < w / 2; x += 16) { ctx.beginPath(); ctx.moveTo(x, h / 2); ctx.lineTo(x + 7, h / 2); ctx.lineTo(x + 7 + h, -h / 2); ctx.lineTo(x + h, -h / 2); ctx.fill(); }
    ctx.restore();
    ctx.strokeStyle = '#c8d4e4'; ctx.lineWidth = 1.2; rr(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glowSprite(50), -14, -14, 28, 28);
    for (const sx of [-1, 1]) { ctx.globalAlpha = 0.7; ctx.drawImage(glowSprite(0), sx * (w / 2 - 4) - 7, -7, 14, 14); }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#dde6f2'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill();
  }
  function drawHub(b) {
    setObj(b.position.x, b.position.y, R.t);
    const r = b.lb.w / 2;
    const gr = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r);
    gr.addColorStop(0, '#b0bccc'); gr.addColorStop(1, '#2a3038');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = col(R.stageHue, 100, 65); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.6, 0, 4); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glowSprite(R.stageHue), -r, -r, r * 2, r * 2);
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawTurret() {
    const x = TURRET.x, y = TURRET.y;
    const hue = R.stageHue;
    const a = R.turretAngle;
    setWorld();
    // base glow
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(glowSprite(hue), x - 110, y - 50, 220, 110);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // rings
    ctx.save();
    ctx.translate(x, y + 18); ctx.scale(1, 0.32);
    ctx.fillStyle = col(hue, 60, 8);
    ctx.beginPath(); ctx.arc(0, 0, 78, 0, TAU); ctx.fill();
    ctx.strokeStyle = col(hue, 100, 60); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 78, 0, TAU); ctx.stroke();
    ctx.setLineDash([10, 8]); ctx.lineDashOffset = R.t * 40; ctx.lineWidth = 2; ctx.strokeStyle = col(hue, 100, 70, 0.7);
    ctx.beginPath(); ctx.arc(0, 0, 60, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
    // barrel
    const rc = R.recoil * 12;
    setObj(x, y, a);
    const gr = ctx.createLinearGradient(0, -12, 0, 12);
    gr.addColorStop(0, '#aab6c8'); gr.addColorStop(0.5, '#3c4452'); gr.addColorStop(1, '#1c2028');
    ctx.fillStyle = gr;
    rr(ctx, 6 - rc, -11, 66, 22, 5); ctx.fill();
    ctx.fillStyle = '#12151b'; rr(ctx, 58 - rc, -8, 18, 16, 3); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = col(hue, 100, 65); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(14 - rc, -6); ctx.lineTo(56 - rc, -6); ctx.moveTo(14 - rc, 6); ctx.lineTo(56 - rc, 6); ctx.stroke();
    // charge coils
    for (let i = 0; i < 4; i++) {
      const on = (Math.floor(R.t * 10) + i) % 4 === 0;
      ctx.fillStyle = col(hue, 100, on ? 85 : 50);
      ctx.fillRect(22 + i * 9 - rc, -11, 4, 22);
    }
    const tipGlow = 0.6 + 0.4 * Math.sin(R.t * 8) + R.recoil * 2;
    ctx.globalAlpha = clamp(tipGlow, 0, 1);
    ctx.drawImage(glowSprite(hue, true), 70 - rc - 14, -14, 28, 28);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // body dome
    setWorld();
    const dg = ctx.createRadialGradient(x - 10, y - 14, 2, x, y, 36);
    dg.addColorStop(0, '#c6d2e2'); dg.addColorStop(0.5, '#4a5462'); dg.addColorStop(1, '#171a20');
    ctx.fillStyle = dg;
    ctx.beginPath(); ctx.arc(x, y, 32, Math.PI, 0); ctx.lineTo(x + 40, y + 18); ctx.lineTo(x - 40, y + 18); ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = col(hue, 100, 65); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 32, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = col(hue, 100, 70);
    ctx.fillRect(x - 12, y - 4, 24, 3);
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawAim() {
    const a = R.aim;
    if (!a) return;
    ctx.globalCompositeOperation = 'lighter';
    setWorld();
    const hue = R.stageHue;
    const mx = TURRET.x + Math.cos(R.turretAngle) * 76, my = TURRET.y + Math.sin(R.turretAngle) * 76;
    ctx.setLineDash([3, 9]); ctx.lineDashOffset = -R.t * 80;
    ctx.strokeStyle = col(hue, 100, 70, 0.55); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(a.x, a.y); ctx.stroke();
    ctx.setLineDash([]);
    // reticle
    const r = 22 + Math.sin(R.t * 10) * 2;
    ctx.strokeStyle = col(hue, 100, 75); ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const q = R.t * 2.5 + (i * Math.PI) / 2;
      ctx.beginPath(); ctx.arc(a.x, a.y, r, q, q + 0.9); ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(a.x - 34, a.y); ctx.lineTo(a.x - 12, a.y); ctx.moveTo(a.x + 12, a.y); ctx.lineTo(a.x + 34, a.y);
    ctx.moveTo(a.x, a.y - 34); ctx.lineTo(a.x, a.y - 12); ctx.moveTo(a.x, a.y + 12); ctx.lineTo(a.x, a.y + 34);
    ctx.stroke();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = col(hue, 100, 60);
    ctx.beginPath(); ctx.arc(a.x, a.y, 105, 0, TAU); ctx.fill();   // blast radius preview
    ctx.globalAlpha = 1;
    ctx.drawImage(glowSprite(hue, true), a.x - 6, a.y - 6, 12, 12);
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawVoidHaze(sim) {
    setWorld();
    const y0 = sim.killY - 40, y1 = HORIZON + 10;
    const gr = ctx.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, col(R.stageHue, 80, 5, 0)); gr.addColorStop(1, col(R.stageHue, 80, 5, 0.55));
    ctx.fillStyle = gr;
    ctx.fillRect(-400, y0, W + 800, y1 - y0);
  }

  /* -------------------------------------------------------------- frame */
  R.update = function (dt) {
    R.t += dt;
    R.introT += dt;
    updateFx(dt);
    R.shake *= Math.exp(-dt * 9);
    R.flash *= Math.exp(-dt * 7);
    R.glitch = Math.max(0, R.glitch - dt);
    R.recoil *= Math.exp(-dt * 14);
  };

  R.draw = function (sim) {
    const sh = R.shake;
    const sx = (Math.random() - 0.5) * sh * S * dpr, sy = (Math.random() - 0.5) * sh * S * dpr;
    drawBackground(R.stageHue);
    // camera
    const z = R.zoom;
    const zx = R.zoomX, zy = R.zoomY;
    camS = K * z;
    camX = offX * dpr + sx + zx * K * (1 - z);
    camY = offY * dpr + sy + zy * K * (1 - z);
    if (sim) {
      drawOrbitPaths(sim);
      drawShieldBack(sim);
      drawPlatforms(sim);
      drawVoidHaze(sim);
      drawBlocks(sim, 'back');
      drawBlocks(sim, 'front');
      drawTethers(sim);
      drawShieldFront(sim);
    }
    drawRingsFlares();
    drawParticles();
    drawBeams();
    drawTurret();
    drawAim();
    drawPops();
    // overlays
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (R.flash > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, R.flash);
      ctx.fillStyle = R.flashWhite ? '#ffffff' : col(R.flashHue, 100, 55);
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (R.glitch > 0) {
      const n = 3 + Math.floor(Math.random() * 5);
      for (let i = 0; i < n; i++) {
        const y = Math.random() * cv.height, h = (4 + Math.random() * 40) * dpr;
        const dx = (Math.random() - 0.5) * 60 * dpr * Math.min(1, R.glitch * 3);
        ctx.drawImage(cv, 0, y, cv.width, h, dx, y, cv.width, h);
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.25;
      ctx.drawImage(cv, 6 * dpr * Math.min(1, R.glitch * 3), 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (vignette) ctx.drawImage(vignette, 0, 0);
    if (scan && R.quality !== 'low') {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = ctx.createPattern(scan, 'repeat');
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.globalAlpha = 1;
    }
  };

  // Render a single block into a small canvas (for UI icons)
  R.iconCanvas = function (type, shape, hue, size) {
    const c = document.createElement('canvas');
    const px = size * 2;
    c.width = c.height = px;
    const g = c.getContext('2d');
    const saveK = K; K = 2;
    g.scale(2, 2); g.translate(size / 2, size / 2);
    const w = size * 0.55;
    const h = shape === 'plank' ? w * 0.4 : w;
    paintBlock(g, type, shape, w, h, hue);
    K = saveK;
    return c;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

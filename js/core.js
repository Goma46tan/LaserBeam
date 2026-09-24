/* LaserBeam - core: stage generation + physics simulation (runs in browser and Node) */
(function (G) {
  'use strict';
  const M = G.Matter;
  const { Engine, Composite, Bodies, Body, Constraint, Query, Events } = M;
  const LB = G.LB || (G.LB = {});

  const W = 600, H = 1100, U = 40;
  const TURRET = { x: 300, y: 1032 };
  const TOP_LIMIT = 185;           // structures never rise above this
  const REF_MASS = U * U * 0.0012;
  const BLAST_R = 130;            // radius of the shockwave when the laser hits empty space

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ramp = (t) => { const x = clamp(t / 2, 0, 1); return x * x * (3 - 2 * x); };

  /* ------------------------------------------------------------------ RNG */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(n) {
    n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n ^= n >>> 4;
    n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return n >>> 0;
  }
  function makeRng(seed) {
    const f = mulberry32(seed);
    return {
      f,
      range: (a, b) => a + (b - a) * f(),
      int: (a, b) => a + Math.floor(f() * (b - a + 1)),
      pick: (arr) => arr[Math.floor(f() * arr.length)],
      chance: (p) => f() < p,
      weighted(list) { // [[item, weight], ...]
        let s = 0; for (const e of list) s += e[1];
        let x = f() * s;
        for (const e of list) { x -= e[1]; if (x <= 0) return e[0]; }
        return list[list.length - 1][0];
      },
    };
  }

  /* ------------------------------------------------------------ Metadata */
  const SECTORS = [
    ['NEON CITY', 190], ['DATA STREAM', 150], ['SYNTH HORIZON', 300], ['CHROME SECTOR', 210],
    ['AMBER GRID', 38], ['VOID CORE', 270], ['PLASMA DISTRICT', 330], ['QUANTUM FIELD', 170],
    ['CRIMSON NET', 355], ['GHOST PROTOCOL', 200], ['ULTRAVIOLET', 285], ['SOLAR FLARE', 45],
    ['MATRIX DEPTHS', 125], ['HOLO CATHEDRAL', 250], ['ION STORM', 185], ['BLACK ICE', 215],
    ['NEURAL LINK', 315], ['OVERCLOCK', 15], ['SINGULARITY', 262], ['LASER HEAVEN', 180],
  ];

  const GIMMICKS = {
    star:     { n: 4,  name: 'STAR BLOCK',       desc: '破壊するか台座から落とすとレーザーが+2補充される。' },
    armor:    { n: 7,  name: 'ARMOR BLOCK',      desc: '装甲ブロック。重くて耐久力が高い。何発も撃ち込もう。' },
    orb:      { n: 10, name: 'ENERGY ORB',       desc: '転がりやすい球体ブロック。支えを崩せば一気に落ちる。' },
    bomb:     { n: 13, name: 'BOMB BLOCK',       desc: '撃つと大爆発！周囲のブロックもまとめて吹き飛ばす。' },
    moving:   { n: 17, name: 'SLIDE PLATFORM',   desc: '左右にスライドする台座。タイミングを見て狙え。' },
    orbit:    { n: 21, name: 'ORBIT BLOCKS',     desc: '円を描いて回転するブロック。撃つと軌道から外れて落下する。' },
    rotor:    { n: 26, name: 'ROTOR',            desc: '十字に組まれて回転するブロック群。' },
    steel:    { n: 30, name: 'STEEL',            desc: '破壊できない重い鉄塊。クリア対象外だが邪魔をする。' },
    spinner:  { n: 34, name: 'SPIN BAR',         desc: '回転する鉄のバー。レーザーを遮る。隙間を狙え。' },
    tether:   { n: 38, name: 'TETHER',           desc: '吊るされたブロック。光るワイヤーを撃てば切断できる。' },
    float:    { n: 42, name: 'HOVER BLOCK',      desc: '浮遊ブロック。撃つと推進装置が停止して落下する。' },
    rock:     { n: 46, name: 'ROCKING PLATFORM', desc: 'ゆっくり傾く台座。揺れを利用して落とせ。' },
    boss:     { n: 50, name: 'CORE GUARDIAN',    desc: '巨大コア出現！回転装甲の隙間からコアを撃ち抜け。' },
    shield:   { n: 55, name: 'SHIELD DOME',      desc: 'シールド内はレーザー無効。外のジェネレーターを破壊せよ。' },
    crystal:  { n: 60, name: 'CRYSTAL',          desc: '衝撃に弱いクリスタル。何かにぶつけるだけで砕ける。' },
    phase:    { n: 65, name: 'PHASE BLOCK',      desc: '実体化と透過を繰り返す。透過中はレーザーが効かない。' },
    lowgrav:  { n: 70, name: 'LOW GRAVITY',      desc: '低重力エリア。ブロックがふわりと遠くまで飛ぶ。' },
    elevator: { n: 75, name: 'ELEVATOR',         desc: '上下に動く台座。' },
  };
  const GIMMICK_ORDER = Object.keys(GIMMICKS);

  function introAt(n) {
    for (const k of GIMMICK_ORDER) if (GIMMICKS[k].n === n) return k;
    return null;
  }

  /* ---------------------------------------------------- Stage generation */
  function place(out, x, bottom, w, h, shape, extra) {
    const s = { x, y: bottom - h / 2, w, h, shape: shape || 'box', type: 'normal' };
    if (extra) Object.assign(s, extra);
    out.push(s);
    return bottom - h;
  }

  // Each template: (site {x, top, w, maxH}, r, d) -> array of block specs
  const T = {
    pyramid(s, r, d) {
      const out = [];
      const maxB = Math.floor(s.w / U), maxR = Math.floor(s.maxH / U);
      let b = clamp(r.int(3, 4 + Math.round(d * 4)), 1, maxB);
      b = Math.min(b, maxR);
      const shape = r.chance(0.3) ? 'cyl' : 'box';
      for (let i = 0; i < b; i++) {
        const cnt = b - i;
        for (let j = 0; j < cnt; j++) place(out, s.x - (cnt - 1) * U / 2 + j * U, s.top - i * U, U, U, shape);
      }
      return out;
    },
    wall(s, r, d) {
      const out = [];
      const maxB = Math.floor(s.w / U), maxR = Math.floor(s.maxH / U);
      const cols = clamp(r.int(2, 3 + Math.round(d * 3)), 1, maxB);
      const rows = clamp(r.int(2, 3 + Math.round(d * 5)), 1, maxR);
      const brick = cols >= 2 && r.chance(0.55);
      const shape = r.chance(0.25) ? 'cyl' : 'box';
      const x0 = s.x - (cols - 1) * U / 2;
      for (let i = 0; i < rows; i++) {
        const bottom = s.top - i * U;
        if (brick && i % 2 === 1) {
          let j = 0;
          for (; j + 1 < cols; j += 2) place(out, x0 + (j + 0.5) * U, bottom, U * 2, U, 'brick');
          if (j < cols) place(out, x0 + j * U, bottom, U, U, shape);
        } else {
          for (let j = 0; j < cols; j++) place(out, x0 + j * U, bottom, U, U, shape);
        }
      }
      return out;
    },
    tree(s, r, d) {
      const out = [];
      const maxB = Math.floor(s.w / U), maxR = Math.floor(s.maxH / U);
      if (maxB < 3 || maxR < 4) return T.wall(s, r, d);
      const b = clamp(r.int(3, 4 + Math.round(d * 3)), 3, maxB);
      const ph = r.int(1, 2);
      const pw = U * 0.8;
      const pxs = [s.x - (b * U / 2 - pw / 2), s.x + (b * U / 2 - pw / 2)];
      if (b >= 5) pxs.push(s.x);
      let top = s.top;
      for (const px of pxs) { let t = s.top; for (let k = 0; k < ph; k++) t = place(out, px, t, pw, U, 'cyl'); top = t; }
      top = place(out, s.x, top, b * U, U / 2, 'plank');
      const pr = Math.min(b, Math.floor((s.maxH - (s.top - top)) / U));
      for (let i = 0; i < pr; i++) {
        const cnt = b - i;
        for (let j = 0; j < cnt; j++) place(out, s.x - (cnt - 1) * U / 2 + j * U, top - i * U, U, U, 'box');
      }
      return out;
    },
    towers(s, r, d) {
      const out = [];
      const maxR = Math.floor(s.maxH / U);
      if (s.w < U * 2.4 || maxR < 3) return T.wall(s, r, d);
      const k = s.w >= U * 4.5 && r.chance(0.5) ? 3 : 2;
      const pw = U * 0.8;
      const sp = Math.min((s.w - pw) / (k - 1), U * 2.2);
      const m = clamp(r.int(2, 3 + Math.round(d * 2)), 1, maxR - 2);
      let top = s.top;
      for (let i = 0; i < k; i++) {
        const px = s.x - sp * (k - 1) / 2 + i * sp;
        let t = s.top;
        for (let q = 0; q < m; q++) t = place(out, px, t, pw, U, 'cyl');
        top = t;
      }
      const plankW = sp * (k - 1) + pw;
      top = place(out, s.x, top, plankW, U / 2, 'plank');
      const sub = { x: s.x, top, w: plankW, maxH: s.maxH - (s.top - top) };
      if (sub.maxH >= U) {
        const t2 = r.chance(0.5) ? T.pyramid(sub, r, d * 0.6) : T.wall(sub, r, d * 0.4);
        out.push(...t2);
      }
      return out;
    },
    castle(s, r, d) {
      const out = [];
      const maxB = Math.floor(s.w / U), maxR = Math.floor(s.maxH / U);
      if (maxB < 3 || maxR < 3) return T.pyramid(s, r, d);
      const cols = clamp(r.int(4, 5 + Math.round(d * 3)), 3, maxB);
      const rows = clamp(r.int(2, 3 + Math.round(d * 2)), 1, maxR - 2);
      const x0 = s.x - (cols - 1) * U / 2;
      for (let i = 0; i < rows; i++)
        for (let j = 0; j < cols; j++) place(out, x0 + j * U, s.top - i * U, U, U, 'box');
      const cy = s.top - rows * U;
      for (let j = 0; j < cols; j++) {
        if (j === 0 || j === cols - 1 || j % 2 === 0) place(out, x0 + j * U, cy, U, U, 'box');
      }
      if (maxR >= rows + 2) {
        const th = Math.min(r.int(1, 2), maxR - rows - 1);
        for (let q = 0; q < th; q++) {
          place(out, x0, cy - U - q * U, U, U, 'cyl');
          place(out, x0 + (cols - 1) * U, cy - U - q * U, U, U, 'cyl');
        }
      }
      return out;
    },
    stairs(s, r, d) {
      const out = [];
      const maxB = Math.floor(s.w / U), maxR = Math.floor(s.maxH / U);
      const cols = clamp(r.int(3, 4 + Math.round(d * 3)), 1, maxB);
      const mode = r.int(0, 3);
      const x0 = s.x - (cols - 1) * U / 2;
      const shape = r.chance(0.3) ? 'cyl' : 'box';
      for (let j = 0; j < cols; j++) {
        let h;
        if (mode === 0) h = j + 1;
        else if (mode === 1) h = cols - j;
        else if (mode === 2) h = Math.min(j, cols - 1 - j) + 1;
        else h = Math.max(j, cols - 1 - j) - Math.floor(cols / 2) + 2;
        h = clamp(h, 1, maxR);
        for (let i = 0; i < h; i++) place(out, x0 + j * U, s.top - i * U, U, U, shape);
      }
      return out;
    },
    domino(s, r, d) {
      const out = [];
      const maxR = Math.floor(s.maxH / U);
      if (maxR < 2) return T.wall(s, r, d);
      const sw = U * 0.34, sh = U * 2;
      const count = clamp(Math.floor((s.w - sw) / (U * 0.95)) + 1, 2, 8);
      const sp = Math.min((s.w - sw) / (count - 1), U * 1.1);
      const x0 = s.x - sp * (count - 1) / 2;
      for (let i = 0; i < count; i++) place(out, x0 + i * sp, s.top, sw, sh, 'slab');
      if (maxR >= 3 && count >= 2 && r.chance(0.6)) {
        for (let i = 0; i + 1 < count; i += 2) {
          const cx = x0 + (i + 0.5) * sp;
          const t = place(out, cx, s.top - sh, sp + sw, U / 2, 'plank');
          if (maxR >= 4) place(out, cx, t, U * 0.9, U * 0.9, 'box');
        }
      }
      return out;
    },
    jenga(s, r, d) {
      const out = [];
      const maxR = Math.floor(s.maxH / U);
      const w0 = Math.min(s.w, U * r.int(3, 6));
      const layers = clamp(r.int(3, 4 + Math.round(d * 3)), 1, Math.floor(maxR / 1.5));
      let top = s.top;
      for (let i = 0; i < layers; i++) {
        const wi = Math.max(U * 2, w0 - i * U * 0.5);
        const xs = [s.x - (wi / 2 - U / 2), s.x + (wi / 2 - U / 2)];
        if (wi >= U * 4) xs.push(s.x);
        let t = top;
        for (const px of xs) t = place(out, px, top, U, U, 'box');
        top = place(out, s.x, t, wi, U / 2, 'plank');
      }
      if (s.top - top + U <= s.maxH) place(out, s.x, top, U, U, 'box');
      return out;
    },
    orbPile(s, r, d) {
      const out = [];
      const maxB = Math.floor(s.w / U), maxR = Math.floor(s.maxH / U);
      if (maxB < 4 || maxR < 2) return T.pyramid(s, r, d);
      const n = clamp(r.int(2, 3 + Math.round(d * 2)), 2, maxB - 2);
      const rows = Math.min(n, Math.floor((s.maxH - U) / (U * 0.87)) + 1);
      place(out, s.x - (n * U / 2 + U / 2), s.top, U, U, 'box');
      place(out, s.x + (n * U / 2 + U / 2), s.top, U, U, 'box');
      for (let i = 0; i < rows; i++) {
        const cnt = n - i;
        const y = s.top - U / 2 - i * U * 0.866;
        for (let j = 0; j < cnt; j++) out.push({ x: s.x - (cnt - 1) * U / 2 + j * U, y, w: U, h: U, shape: 'orb', type: 'normal' });
      }
      return out;
    },
    skyline(s, r, d) {
      const out = [];
      const maxB = Math.floor(s.w / U), maxR = Math.floor(s.maxH / U);
      const cols = clamp(r.int(3, 5 + Math.round(d * 2)), 1, maxB);
      const x0 = s.x - (cols - 1) * U / 2;
      for (let j = 0; j < cols; j++) {
        const h = clamp(r.int(1, 2 + Math.round(d * 5)), 1, maxR);
        const shape = r.chance(0.35) ? 'cyl' : 'box';
        for (let i = 0; i < h; i++) place(out, x0 + j * U, s.top - i * U, U, U, shape);
      }
      return out;
    },
    spire(s, r, d) {
      const out = [];
      const maxB = Math.floor(s.w / U), maxR = Math.floor(s.maxH / U);
      let top = s.top;
      if (maxB >= 2 && maxR >= 4) top = place(out, s.x, top, U * 2, U, 'brick');
      const h = clamp(r.int(3, 4 + Math.round(d * 5)), 1, maxR - (top < s.top ? 1 : 0));
      for (let i = 0; i < h; i++) top = place(out, s.x, top, U * 0.9, U, 'cyl');
      return out;
    },

    /* ---- top-heavy, collapse-prone structures: knock out one support and it all comes down ---- */
    // a heavy block mass standing on thin legs
    stilts(s, r, d) {
      const out = [];
      const maxR = Math.floor(s.maxH / U);
      if (maxR < 4) return T.tallStack(s, r, d);
      const cols = clamp(r.int(3, 4 + Math.round(d * 2)), 3, Math.max(3, Math.floor(s.w / U)));
      const topW = cols * U;
      const thin = r.chance(0.55);
      const lw = thin ? U * 0.34 : U * 0.8, lh = thin ? U * 2 : U;
      const legs = topW >= U * 4 && r.chance(0.5) ? 3 : 2;
      const levels = maxR >= 7 && r.chance(0.45) ? 2 : 1;
      let top = s.top;
      for (let lv = 0; lv < levels; lv++) {
        const w = topW - lv * U;
        let t = top;
        for (let i = 0; i < legs; i++) {
          const lx = s.x + (i / (legs - 1) - 0.5) * (w - U * 0.9);
          t = top;
          const stack = thin ? 1 : 2;
          for (let q = 0; q < stack; q++) t = place(out, lx, t, lw, lh, thin ? 'slab' : 'cyl');
        }
        top = place(out, s.x, t, w, U / 2, 'plank');
      }
      const wTop = topW - (levels - 1) * U;
      const sub = { x: s.x, top, w: wTop, maxH: s.maxH - (s.top - top) };
      if (sub.maxH >= U) {
        const k = r.int(0, 2);
        const more = k === 0 ? T.wall(sub, r, 0.3 + d * 0.5) : k === 1 ? T.castle(sub, r, d) : T.tallStack(sub, r, d * 0.5);
        out.push(...more);
      }
      return out;
    },
    // a long beam balanced on a single column with loads on both ends
    tTower(s, r, d) {
      const out = [];
      const maxR = Math.floor(s.maxH / U);
      if (maxR < 4) return T.stilts(s, r, d);
      const m = clamp(r.int(2, 3 + Math.round(d)), 1, maxR - 2);
      let top = s.top;
      for (let i = 0; i < m; i++) top = place(out, s.x, top, U * 0.9, U, 'cyl');
      const bw = r.int(3, 5) * U;
      top = place(out, s.x, top, bw, U / 2, 'plank');
      const endH = clamp(r.int(1, 2 + Math.round(d)), 1, Math.floor((s.maxH - (s.top - top)) / U));
      for (const sgn of [-1, 1]) {
        let t = top;
        for (let i = 0; i < endH; i++) t = place(out, s.x + sgn * (bw / 2 - U / 2), t, U, U, i % 2 ? 'cyl' : 'box');
      }
      if (bw >= U * 5 && r.chance(0.6)) {
        let t = top;
        for (let i = 0; i < Math.min(endH + 1, Math.floor((s.maxH - (s.top - top)) / U)); i++) t = place(out, s.x, t, U, U, 'box');
      }
      return out;
    },
    // tall slender columns tied together with planks
    tallStack(s, r, d) {
      const out = [];
      const maxR = Math.floor(s.maxH / U);
      const cols = clamp(r.int(1, 3), 1, Math.max(1, Math.floor(s.w / U)));
      const h = clamp(r.int(5, 7 + Math.round(d * 3)), 2, maxR);
      const tieEvery = r.int(2, 3);
      const x0 = s.x - (cols - 1) * U / 2;
      const shape = r.chance(0.4) ? 'cyl' : 'box';
      let bottom = s.top;
      for (let row = 0; row < h; row++) {
        if (row > 0 && row % tieEvery === 0 && cols > 1 && s.top - bottom + U * 1.5 <= s.maxH) {
          bottom = place(out, s.x, bottom, cols * U, U / 2, 'plank');
        }
        if (s.top - bottom + U > s.maxH) break;
        for (let j = 0; j < cols; j++) place(out, x0 + j * U, bottom, U * 0.95, U, shape);
        bottom -= U;
      }
      return out;
    },
    // house of cards: slab pairs roofed with planks, stacked in tiers
    cards(s, r, d) {
      const out = [];
      const maxR = Math.floor(s.maxH / U);
      if (maxR < 3) return T.tallStack(s, r, d);
      const cw = U * 0.3, chh = U * 1.6, span = U * 1.25;
      let n = clamp(r.int(2, 3 + Math.round(d)), 1, Math.floor((s.w - cw) / span));
      let bottom = s.top;
      while (n >= 1 && s.top - bottom + chh + U / 2 <= s.maxH) {
        const x0 = s.x - (n * span) / 2;
        for (let i = 0; i <= n; i++) place(out, x0 + i * span, bottom, cw, chh, 'slab');
        bottom = place(out, s.x, bottom - chh, n * span + cw, U / 2, 'plank');
        n--;
      }
      if (s.top - bottom + U <= s.maxH) place(out, s.x, bottom, U, U, 'box');
      return out;
    },
    // dominoes carrying a long bridge with cargo
    dominoBridge(s, r, d) {
      const out = [];
      const maxR = Math.floor(s.maxH / U);
      if (maxR < 4) return T.domino(s, r, d);
      const sw = U * 0.32, sh = U * 2.2;
      const count = clamp(Math.floor(s.w / (U * 1.1)), 2, 6);
      const sp = Math.min((s.w - sw) / (count - 1), U * 1.2);
      const x0 = s.x - sp * (count - 1) / 2;
      for (let i = 0; i < count; i++) place(out, x0 + i * sp, s.top, sw, sh, 'slab');
      const bw = sp * (count - 1) + sw + U * 0.6;
      const top = place(out, s.x, s.top - sh, bw, U / 2, 'plank');
      const sub = { x: s.x, top, w: bw, maxH: s.maxH - (s.top - top) };
      out.push(...(r.chance(0.5) ? T.wall(sub, r, d * 0.5) : T.skyline(sub, r, d * 0.5)));
      return out;
    },
  };
  // pyramids and solid walls are stable (not fun to topple) so they're rare now
  const TEMPLATE_W = [
    ['stilts', 3.5], ['tTower', 2.6], ['tallStack', 2.4], ['cards', 2], ['dominoBridge', 1.8],
    ['jenga', 2.4], ['tree', 2.4], ['towers', 2.4], ['domino', 1.2], ['spire', 1.4],
    ['skyline', 0.8], ['castle', 0.5], ['wall', 0.5], ['pyramid', 0.3], ['stairs', 0.3], ['orbPile', 0],
  ];

  function structureBounds(blocks) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const b of blocks) {
      const hw = b.w / 2, hh = b.h / 2;
      x0 = Math.min(x0, b.x - hw); x1 = Math.max(x1, b.x + hw);
      y0 = Math.min(y0, b.y - hh); y1 = Math.max(y1, b.y + hh);
    }
    return { x0, x1, y0, y1 };
  }

  function rectsOverlap(a, b, m) {
    m = m || 0;
    return a.x0 - m < b.x1 && a.x1 + m > b.x0 && a.y0 - m < b.y1 && a.y1 + m > b.y0;
  }

  function Builder(n, variant) {
    this.n = n; this.variant = variant;
    this.r = makeRng(hash(n * 1009 + variant * 7919 + 77));
    this.d = clamp((n - 1) / 450, 0, 1);
    this.platforms = []; this.blocks = []; this.orbits = []; this.spinners = []; this.tethers = [];
    this.shields = []; this.occ = []; this.sites = [];
  }
  Builder.prototype.platform = function (x, top, w, extra) {
    const p = Object.assign({ x, y: top, w, h: 16 }, extra || {});
    this.platforms.push(p);
    this.occ.push({ x0: x - w / 2, x1: x + w / 2, y0: top, y1: top + 20 });
    return p;
  };
  Builder.prototype.build = function (site, tname, platform) {
    const blocks = T[tname](site, this.r, this.d);
    for (const b of blocks) b.site = this.sites.length;
    if (blocks.length && platform) this.fitPlatform(platform, blocks, site.top);
    if (blocks.length) {
      const bb = structureBounds(blocks);
      this.occ.push(bb);
      this.sites.push({ site, bounds: bb, platform, blocks });
      this.blocks.push(...blocks);
    }
    return blocks;
  };
  // shrink a platform down to the footprint of what stands on it, so toppled blocks fall off
  Builder.prototype.fitPlatform = function (p, blocks, top) {
    let x0 = Infinity, x1 = -Infinity;
    for (const b of blocks) {
      if (Math.abs(b.y + b.h / 2 - top) > 1) continue;
      x0 = Math.min(x0, b.x - b.w / 2); x1 = Math.max(x1, b.x + b.w / 2);
    }
    if (!isFinite(x0)) return;
    const margin = this.r.range(3, 10);
    const w = Math.max(U * 0.8, x1 - x0 + margin * 2);
    if (w >= p.w) return;
    const oldX0 = p.x - p.w / 2, oldX1 = p.x + p.w / 2;
    p.x = (x0 + x1) / 2; p.w = w;
    for (const o of this.occ) {
      if (o.x0 === oldX0 && o.x1 === oldX1 && o.y0 === top) { o.x0 = p.x - w / 2; o.x1 = p.x + w / 2; }
    }
  };
  Builder.prototype.pickTemplate = function (allowOrb, exclude) {
    const list = TEMPLATE_W.map(([k, w]) => [k, k === 'orbPile' ? (allowOrb ? 2 : 0) : (exclude && exclude.includes(k) ? 0 : w)]);
    return this.r.weighted(list);
  };
  // find a free circle; returns {x, y} or null
  Builder.prototype.freeSpot = function (rad, yMin, yMax, prefer) {
    const r = this.r;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 70; i++) {
      const x = r.range(rad + 14, W - rad - 14);
      const y = r.range(Math.max(yMin, TOP_LIMIT + rad), yMax - rad);
      if (y < TOP_LIMIT + rad - 1) continue;
      const box = { x0: x - rad, x1: x + rad, y0: y - rad, y1: y + rad };
      let ok = true;
      for (const o of this.occ) if (rectsOverlap(box, o, 12)) { ok = false; break; }
      if (!ok) continue;
      const score = prefer ? prefer(x, y) : r.f();
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
    if (best) this.occ.push({ x0: best.x - rad, x1: best.x + rad, y0: best.y - rad, y1: best.y + rad });
    return best;
  };

  function generate(n, variant) {
    variant = variant || 0;
    const B = new Builder(n, variant);
    const r = B.r, d = B.d;
    const boss = n % 50 === 0;
    const intro = introAt(n);

    /* ---- choose features ---- */
    const feats = new Set();
    if (intro) feats.add(intro);
    const typeish = ['star', 'armor', 'orb', 'bomb', 'crystal', 'phase', 'steel'];
    const air = ['orbit', 'rotor', 'spinner', 'tether', 'float', 'shield'];
    const plat = ['moving', 'rock', 'elevator'];
    for (const k of GIMMICK_ORDER) {
      if (k === 'boss' || GIMMICKS[k].n >= n) continue;
      let p;
      if (typeish.includes(k)) p = (k === 'star' ? 0.55 : 0.22) + 0.25 * d;
      else if (air.includes(k)) p = 0.14 + 0.16 * d;
      else if (plat.includes(k)) p = 0.1 + 0.08 * d;
      else p = 0.07; // lowgrav
      if (r.chance(p)) feats.add(k);
    }
    // limit air gimmicks
    const maxAir = boss ? 1 : 1 + Math.floor(d * 2.2);
    let airList = air.filter((k) => feats.has(k));
    while (airList.length > maxAir) {
      const drop = airList.filter((k) => k !== intro);
      const k = r.pick(drop); feats.delete(k); airList = air.filter((q) => feats.has(q));
    }
    // single platform modifier
    const platList = plat.filter((k) => feats.has(k));
    if (platList.length > 1) {
      const keep = platList.includes(intro) ? intro : r.pick(platList);
      for (const k of platList) if (k !== keep) feats.delete(k);
    }
    const airCount = air.filter((k) => feats.has(k)).length + (boss ? 1 : 0);

    /* ---- layout ---- */
    let layout;
    if (n <= 6) layout = ['single', 'single', 'single', 'single', 'double', 'bridge'][n - 1];
    else if (boss) layout = r.chance(0.5) ? 'double' : 'single';
    else layout = r.weighted([['single', 3.2], ['double', 2.4], ['bridge', 1.6], ['stepped', 1.4], ['scattered', 1.1 + d]]);
    if (feats.has('rock') && (layout === 'bridge')) layout = 'single';
    if ((feats.has('moving') || feats.has('elevator')) && layout === 'bridge') layout = 'double';

    const airRoom = boss ? 300 : airCount > 0 ? 150 + 40 * Math.min(airCount, 2) : 0;
    const maxHFor = (top) => Math.max(U, top - TOP_LIMIT - airRoom);
    const allowOrb = feats.has('orb') || (n > 10 && r.chance(0.15));
    const tpl = () => B.pickTemplate(allowOrb);

    if (layout === 'single') {
      const wu = n <= 3 ? [5, 4, 6][n - 1] : r.int(4, 6 + Math.round(d * 3));
      const w = wu * U + U * 0.4;
      const x = 300 + (wu <= 5 ? r.range(-40, 40) : 0);
      const top = r.range(650, 720);
      const p = B.platform(x, top, w);
      let tn = n === 1 ? 'stilts' : n === 2 ? 'tTower' : n === 3 ? 'tree' : tpl();
      if (feats.has('orb') && intro === 'orb') tn = 'orbPile';
      B.build({ x, top, w: w - 8, maxH: maxHFor(top) }, tn, p);
    } else if (layout === 'double') {
      const w1 = r.int(2, 4 + Math.round(d)) * U + U * 0.4;
      const w2 = r.int(2, 4 + Math.round(d)) * U + U * 0.4;
      const gap = r.range(40, Math.max(45, 540 - w1 - w2));
      const total = w1 + w2 + gap;
      const x1 = 300 - total / 2 + w1 / 2, x2 = 300 + total / 2 - w2 / 2;
      const t1 = r.range(640, 720), t2 = r.chance(0.5) ? t1 : r.range(620, 720);
      const p1 = B.platform(x1, t1, w1), p2 = B.platform(x2, t2, w2);
      B.build({ x: x1, top: t1, w: w1 - 8, maxH: maxHFor(t1) }, tpl(), p1);
      B.build({ x: x2, top: t2, w: w2 - 8, maxH: maxHFor(t2) }, tpl(), p2);
    } else if (layout === 'bridge') {
      const three = n === 6 ? true : r.chance(0.6);
      const sp = three ? r.range(2.2, 3.2) * U : r.range(3, 5) * U;
      const top = r.range(660, 730);
      const xs = three ? [300 - sp, 300, 300 + sp] : [300 - sp / 2, 300 + sp / 2];
      const pls = xs.map((x) => B.platform(x, top, U * 1.1));
      const out = [];
      const m = r.int(1, 2 + Math.round(d));
      let ptop = top;
      for (const x of xs) { let t = top; for (let q = 0; q < m; q++) t = place(out, x, t, U * 0.8, U, 'cyl'); ptop = t; }
      const span = xs[xs.length - 1] - xs[0] + U * 0.8;
      let top2;
      if (three && r.chance(0.6)) {
        const pw = sp + U * 0.4 - 1;
        place(out, xs[0] - U * 0.4 + pw / 2, ptop, pw, U / 2, 'plank');
        top2 = place(out, xs[2] + U * 0.4 - pw / 2, ptop, pw, U / 2, 'plank');
      } else {
        top2 = place(out, 300, ptop, span, U / 2, 'plank');
      }
      for (const b of out) b.site = 0;
      B.blocks.push(...out);
      const site = { x: 300, top: top2, w: span, maxH: maxHFor(top) - (top - top2) };
      if (site.maxH >= U) {
        const tn = r.pick(['wall', 'pyramid', 'castle', 'skyline', 'wall']);
        const more = T[tn](site, r, d);
        for (const b of more) b.site = 0;
        B.blocks.push(...more);
        out.push(...more);
      }
      const bb = structureBounds(out);
      B.occ.push(bb);
      B.sites.push({ site: { x: 300, top, w: span, maxH: 0 }, bounds: bb, platform: pls[1] || pls[0], blocks: out });
    } else if (layout === 'stepped') {
      const k = r.chance(0.5) ? 3 : 2;
      const wu = k === 3 ? r.int(2, 3) : r.int(3, 4);
      const w = wu * U + U * 0.4;
      const gap = (560 - k * w) / (k + 1);
      const tops = k === 3
        ? (r.chance(0.5) ? [720, 580, 720] : [580, 720, 580])
        : (r.chance(0.5) ? [720, 590] : [590, 720]);
      for (let i = 0; i < k; i++) {
        const x = 20 + gap * (i + 1) + w * i + w / 2;
        const top = tops[i] + r.range(-15, 10);
        const p = B.platform(x, top, w);
        B.build({ x, top, w: w - 8, maxH: Math.min(maxHFor(top), U * (4 + Math.round(d * 3))) }, B.pickTemplate(allowOrb, ['domino']), p);
      }
    } else { // scattered
      const k = r.int(3, 4);
      const colW = 560 / k;
      for (let i = 0; i < k; i++) {
        const wu = r.int(2, 3);
        const w = Math.min(wu * U + U * 0.3, colW - 16);
        const x = 20 + colW * (i + 0.5) + r.range(-8, 8);
        const top = r.range(430 + (airCount ? 120 : 0), 730);
        const p = B.platform(x, top, w);
        B.build({ x, top, w: w - 6, maxH: Math.min(maxHFor(top), U * r.int(2, 4 + Math.round(d * 2))) }, r.pick(['tallStack', 'spire', 'tTower', 'stilts', 'cards', 'jenga']), p);
      }
    }

    let killY = 0;
    for (const p of B.platforms) killY = Math.max(killY, p.y + p.h + 40);

    /* ---- boss ---- */
    if (boss) {
      const cy = r.range(330, 380);
      const core = { x: 300, y: cy, w: U * 1.9, h: U * 1.9, shape: 'core', type: 'core', hp: 5 + Math.floor(n / 100) * 2, kin: { mode: 'hover', hx: 300, hy: cy, amp: 8, ph: 0 } };
      B.blocks.push(core);
      const segs = r.int(3, 4 + Math.round(d * 2));
      const R = U * 2.3;
      const speed = r.range(0.6, 1.0) * (r.chance(0.5) ? 1 : -1) * (1 + d * 0.5);
      const items = [];
      for (let i = 0; i < segs; i++) items.push({ a: (i / segs) * Math.PI * 2, r: R, w: U * 1.1 + (d * U * 0.4), h: U * 0.42, type: 'steel', rot: Math.PI / 2 });
      B.orbits.push({ cx: 300, cy, speed, items, steel: true });
      B.occ.push({ x0: 300 - R - 30, x1: 300 + R + 30, y0: cy - R - 30, y1: cy + R + 30 });
    }

    /* ---- platform modifiers ---- */
    const movable = B.platforms.filter((p) => p.w > U * 1.5);
    if ((feats.has('moving') || feats.has('elevator')) && movable.length) {
      const p = r.pick(movable);
      if (feats.has('moving')) {
        let room = Math.min(p.x - p.w / 2 - 12, W - 12 - (p.x + p.w / 2));
        for (const q of B.platforms) if (q !== p) {
          const gapL = p.x - p.w / 2 - (q.x + q.w / 2), gapR = q.x - q.w / 2 - (p.x + p.w / 2);
          if (gapL > -1) room = Math.min(room, gapL - 50);
          if (gapR > -1) room = Math.min(room, gapR - 50);
        }
        const A = Math.min(r.range(40, 90), room);
        if (A >= 20) p.move = { ax: A, ay: 0, w: r.range(0.5, 0.9 + d * 0.4), ph: r.range(0, 6.28) };
      } else {
        p.move = { ax: 0, ay: r.range(25, 55), w: r.range(0.6, 1.1), ph: r.range(0, 6.28) };
      }
    }
    if (feats.has('rock')) {
      const p = r.pick(B.platforms.filter((q) => q.w > U * 2.5)) || B.platforms[0];
      if (!p.move) p.rock = { amp: r.range(0.05, 0.09), w: r.range(0.5, 0.8), ph: r.range(0, 6.28) };
    }

    /* ---- air gimmicks ---- */
    const yMaxAir = killY - 150;
    const nearTargets = (x, y) => {
      let best = 1e9;
      for (const b of B.blocks) best = Math.min(best, Math.hypot(b.x - x, b.y - y));
      return -Math.abs(best - 150) + r.f() * 30;
    };
    if (feats.has('orbit')) {
      const R = r.range(62, 95 + d * 20);
      const spot = B.freeSpot(R + U * 0.6, TOP_LIMIT, yMaxAir + 60);
      if (spot) {
        const cnt = clamp(Math.floor((2 * Math.PI * R) / (U * 1.45)), 4, 10);
        const speed = r.range(0.5, 1.0 + d * 0.6) * (r.chance(0.5) ? 1 : -1);
        const items = [];
        for (let i = 0; i < cnt; i++) items.push({ a: (i / cnt) * Math.PI * 2, r: R, w: U * 0.9, h: U * 0.9, type: 'normal', rot: 0 });
        B.orbits.push({ cx: spot.x, cy: spot.y, speed, items });
      }
    }
    if (feats.has('rotor')) {
      const armsLen = r.int(2, 2 + Math.round(d));
      const R = U * 0.5 + armsLen * U * 0.95 + 8;
      const spot = B.freeSpot(R, TOP_LIMIT, yMaxAir + 60);
      if (spot) {
        const arms = r.pick([2, 3, 4, 4]);
        const speed = r.range(0.5, 0.9 + d * 0.5) * (r.chance(0.5) ? 1 : -1);
        const items = [];
        for (let a = 0; a < arms; a++) for (let k = 0; k < armsLen; k++)
          items.push({ a: (a / arms) * Math.PI * 2, r: U * 0.62 + k * U * 0.95 + U * 0.45, w: U * 0.9, h: U * 0.9, type: 'normal', rot: 0 });
        B.orbits.push({ cx: spot.x, cy: spot.y, speed, items, hub: true });
      }
    }
    if (feats.has('spinner')) {
      const cnt = r.chance(0.3 + d * 0.3) ? 2 : 1;
      for (let i = 0; i < cnt; i++) {
        const len = r.range(2.6, 4.2) * U;
        const spot = B.freeSpot(len / 2 + 6, TOP_LIMIT, killY - 60, nearTargets);
        if (spot) B.spinners.push({ x: spot.x, y: spot.y, len, th: 14, speed: r.range(0.7, 1.5) * (r.chance(0.5) ? 1 : -1), a0: r.range(0, 3.14) });
      }
    }
    if (feats.has('tether')) {
      const cnt = r.int(1, 2 + Math.round(d));
      for (let i = 0; i < cnt; i++) {
        const chain = r.int(1, 2 + Math.round(d));
        const L = r.range(50, 140);
        const hgt = L + chain * (U + 12);
        const ax = r.range(60, 540), ay = r.range(TOP_LIMIT - 20, TOP_LIMIT + 30);
        const box = { x0: ax - U * 0.7, x1: ax + U * 0.7, y0: ay, y1: ay + hgt };
        if (box.y1 > killY - 40) continue;
        let ok = true;
        for (const o of B.occ) if (rectsOverlap(box, o, 12)) { ok = false; break; }
        if (!ok) continue;
        B.occ.push(box);
        const idx = [];
        let y = ay + L;
        for (let k = 0; k < chain; k++) {
          B.blocks.push({ x: ax, y: y + U / 2, w: U, h: U, shape: 'box', type: 'normal', tethered: true });
          idx.push(B.blocks.length - 1);
          y += U + 12;
        }
        B.tethers.push({ ax, ay, L, idx });
      }
    }
    if (feats.has('float')) {
      const cnt = r.int(2, 3 + Math.round(d * 2));
      const spanW = cnt * U * 1.3;
      const spot = B.freeSpot(Math.max(spanW / 2, U) + 10, TOP_LIMIT, yMaxAir + 40);
      if (spot) {
        const form = r.int(0, 2);
        for (let i = 0; i < cnt; i++) {
          const fx = spot.x - spanW / 2 + U * 0.65 + i * U * 1.3;
          const fy = spot.y + (form === 1 ? Math.abs(i - (cnt - 1) / 2) * 16 - 16 : form === 2 ? (i % 2) * 20 - 10 : 0);
          B.blocks.push({ x: fx, y: fy, w: U * 0.9, h: U * 0.9, shape: 'box', type: 'normal', float: true });
        }
      }
    }
    if (feats.has('shield') && B.sites.length) {
      const s = B.sites.reduce((a, b) => (b.blocks.length > a.blocks.length ? b : a));
      const bb = s.bounds;
      const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
      const rad = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2 * 1.08 + 26;
      const gens = [];
      const gcount = r.chance(0.35 + d * 0.3) ? 2 : 1;
      for (let i = 0; i < gcount; i++) {
        const spot = B.freeSpot(U * 0.6, TOP_LIMIT, yMaxAir + 80, (x, y) => Math.hypot(x - cx, y - cy) > rad + 40 ? r.f() : -1e6);
        if (spot && Math.hypot(spot.x - cx, spot.y - cy) > rad + 30) {
          B.blocks.push({ x: spot.x, y: spot.y, w: U * 0.8, h: U * 0.8, shape: 'gen', type: 'gen', kin: { mode: 'hover', hx: spot.x, hy: spot.y, amp: 6, ph: r.range(0, 6) } });
          gens.push(B.blocks.length - 1);
        }
      }
      if (gens.length) B.shields.push({ x: cx, y: cy, r: rad, gens });
    }

    /* ---- type conversions on structure blocks ---- */
    const structural = B.blocks.filter((b) => b.type === 'normal' && !b.kin && b.site !== undefined);
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r.f() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const pool = shuffle(structural.slice());
    const take = (cnt, filter) => {
      const got = [];
      for (let i = 0; i < pool.length && got.length < cnt; i++) {
        if (filter && !filter(pool[i])) continue;
        got.push(pool[i]); pool.splice(i, 1); i--;
      }
      return got;
    };
    const isCube = (b) => b.shape === 'box' || b.shape === 'cyl' || b.shape === 'brick';
    if (feats.has('star')) {
      const cnt = intro === 'star' ? 1 : r.int(1, 2);
      // prefer higher blocks
      pool.sort((a, b) => a.y - b.y + (r.f() - 0.5) * 120);
      for (const b of take(cnt, isCube)) b.type = 'star';
      shuffle(pool);
    }
    if (feats.has('bomb')) for (const b of take(intro === 'bomb' ? 1 : r.int(1, 2), isCube)) b.type = 'bomb';
    if (feats.has('armor')) {
      const frac = intro === 'armor' ? 0.3 : r.range(0.12, 0.25 + d * 0.2);
      for (const b of take(Math.max(1, Math.round(structural.length * frac)))) { b.type = 'armor'; b.hp = d > 0.55 && r.chance(0.5) ? 3 : 2; }
    }
    if (feats.has('crystal')) {
      const frac = intro === 'crystal' ? 0.45 : r.range(0.15, 0.35);
      for (const b of take(Math.max(1, Math.round(structural.length * frac)), (q) => q.shape !== 'orb')) b.type = 'crystal';
    }
    if (feats.has('phase')) {
      const frac = intro === 'phase' ? 0.4 : r.range(0.12, 0.3);
      for (const b of take(Math.max(1, Math.round(structural.length * frac)))) { b.type = 'phase'; b.phOff = r.range(0, 4); }
    }
    if (feats.has('steel')) {
      // steel caps on top of the highest blocks of each site
      const caps = [];
      for (const s of B.sites) {
        const cands = s.blocks.filter((b) => b.type === 'normal' && isCube(b));
        cands.sort((a, b) => a.y - b.y);
        const k = intro === 'steel' ? 2 : r.int(1, 2);
        caps.push(...cands.slice(0, k));
      }
      for (const b of caps) b.type = 'steel';
      // fences at platform edges
      if (r.chance(0.35 + d * 0.3)) {
        for (const p of B.platforms) {
          if (p.w < U * 3 || r.chance(0.4)) continue;
          const siteBlocks = B.blocks.filter((b) => Math.abs(b.x - p.x) < p.w / 2 && b.y < p.y && b.y > p.y - U);
          const fl = p.x - p.w / 2 + U * 0.14, fr = p.x + p.w / 2 - U * 0.14;
          const clearL = !siteBlocks.some((b) => b.x - b.w / 2 < fl + U * 0.2);
          const clearR = !siteBlocks.some((b) => b.x + b.w / 2 > fr - U * 0.2);
          if (clearL) B.blocks.push({ x: fl, y: p.y - U * 0.4, w: U * 0.26, h: U * 0.8, shape: 'post', type: 'steel' });
          if (clearR) B.blocks.push({ x: fr, y: p.y - U * 0.4, w: U * 0.26, h: U * 0.8, shape: 'post', type: 'steel' });
        }
      }
    }
    // ensure at least one target exists
    let targets = B.blocks.filter((b) => b.type !== 'steel').length;
    for (const o of B.orbits) if (!o.steel) targets += o.items.length;
    if (targets === 0) {
      for (const b of B.blocks) if (b.type === 'steel') { b.type = 'normal'; break; }
    }

    const gravity = feats.has('lowgrav') ? r.range(0.42, 0.55) : 1;
    const sector = Math.floor((n - 1) / 50);
    return {
      n, variant, sector, sectorName: SECTORS[sector][0], hue: SECTORS[sector][1],
      gravity, boss, intro, feats: [...feats],
      platforms: B.platforms, blocks: B.blocks, orbits: B.orbits, spinners: B.spinners,
      tethers: B.tethers, shields: B.shields, killY,
      lasers: 10,
    };
  }

  /* ------------------------------------------------------------ Simulation */
  const LAYER = { platform: 0, block: 1, hub: 2, steel: 2, spinner: 3 };

  function Sim(stage, opts) {
    opts = opts || {};
    this.stage = stage;
    this.rand = opts.rand || Math.random;
    const engine = (this.engine = Engine.create());
    engine.gravity.y = stage.gravity;
    engine.positionIterations = 10;
    engine.velocityIterations = 8;
    this.world = engine.world;
    this.t = 0; this.stepN = 0;
    this.events = [];
    this.lasers = stage.lasers; this.shots = 0;
    this.score = 0; this.combo = 0; this.lastScoreT = -10;
    this.bodies = []; this.targets = []; this.kin = []; this.floats = [];
    this.tethers = []; this.shields = [];
    this.lastShotStep = -9999; this.calm = 0;
    this.killY = stage.killY;
    this.state = 'play';
    this._queue = []; this._crystalBreak = [];
    this._nextId = 1;
    this._build();
    Events.on(engine, 'collisionStart', (e) => this._onCollide(e));
  }

  Sim.prototype._meta = function (body, lb) {
    lb.id = this._nextId++;
    lb.alive = true; lb.cleared = false; lb.removed = false;
    body.lb = lb;
    this.bodies.push(body);
    if (lb.target) this.targets.push(body);
    Composite.add(this.world, body);
    return body;
  };

  Sim.prototype._makeBlock = function (s) {
    const dmul = { normal: 1, star: 1, bomb: 1.1, armor: 2.4, steel: 3.5, crystal: 0.8, phase: 1, gen: 1, core: 3 }[s.type] || 1;
    const opt = {
      friction: 0.55, frictionStatic: 0.9, restitution: 0.06, frictionAir: s.float ? 0.03 : 0.006,
      density: 0.0012 * dmul, angle: s.angle || 0, slop: 0.03,
    };
    let b;
    if (s.shape === 'orb') b = Bodies.circle(s.x, s.y, s.w / 2, opt, 22);
    else if (s.shape === 'gen') b = Bodies.polygon(s.x, s.y, 6, s.w / 2, opt);
    else if (s.shape === 'core') b = Bodies.polygon(s.x, s.y, 8, s.w / 2, opt);
    else b = Bodies.rectangle(s.x, s.y, s.w, s.h, opt);
    const hp = s.hp || (s.type === 'armor' ? 2 : 1);
    const lb = {
      kind: s.type === 'steel' ? 'steel' : 'block', type: s.type, shape: s.shape, w: s.w, h: s.h,
      target: s.type !== 'steel', hp, maxHp: hp, hueShift: this.rand(), site: s.site === undefined ? -1 : s.site,
      home: { x: s.x, y: s.y },
    };
    if (s.type === 'phase') lb.phOff = s.phOff || 0;
    this._meta(b, lb);
    if (s.float) {
      lb.float = { on: true, hx: s.x, hy: s.y, ph: this.rand() * 6.28 };
      this.floats.push(b);
    }
    if (s.kin) {
      Body.setStatic(b, true);
      lb.kin = Object.assign({}, s.kin);
      this.kin.push(b);
    }
    return b;
  };

  Sim.prototype._build = function () {
    const st = this.stage;
    for (const p of st.platforms) {
      const b = Bodies.rectangle(p.x, p.y + p.h / 2, p.w, p.h, { isStatic: true, friction: 0.7, frictionStatic: 1, restitution: 0 });
      this._meta(b, { kind: 'platform', type: 'platform', w: p.w, h: p.h, target: false, spec: p });
      if (p.move || p.rock) {
        b.lb.kin = { mode: p.move ? 'move' : 'rock', x0: p.x, y0: p.y + p.h / 2, spec: p.move || p.rock };
        this.kin.push(b);
      }
    }
    const created = st.blocks.map((s) => this._makeBlock(s));
    for (const o of st.orbits) {
      if (o.hub) {
        const hub = Bodies.circle(o.cx, o.cy, U * 0.42, { isStatic: true });
        this._meta(hub, { kind: 'hub', type: 'hub', w: U * 0.84, h: U * 0.84, target: false, orbit: o });
      }
      for (const it of o.items) {
        const a = it.a;
        const s = { x: o.cx + Math.cos(a) * it.r, y: o.cy + Math.sin(a) * it.r, w: it.w, h: it.h, shape: it.type === 'steel' ? 'bar' : 'box', type: it.type, angle: a + it.rot };
        s.kin = { mode: 'orbit', cx: o.cx, cy: o.cy, r: it.r, a0: a, speed: o.speed, rot: it.rot, release: !o.steel };
        this._makeBlock(s);
      }
    }
    for (const s of st.spinners) {
      const b = Bodies.rectangle(s.x, s.y, s.len, s.th, { isStatic: true, angle: s.a0, friction: 0.5 });
      this._meta(b, { kind: 'spinner', type: 'spinner', w: s.len, h: s.th, target: false, kin: { mode: 'spin', a0: s.a0, speed: s.speed } });
      this.kin.push(b);
    }
    for (const t of st.tethers) {
      let prev = null;
      for (const i of t.idx) {
        const b = created[i];
        let c;
        if (!prev) c = Constraint.create({ pointA: { x: t.ax, y: t.ay }, bodyB: b, pointB: { x: 0, y: -b.lb.h / 2 }, length: t.L, stiffness: 0.7, damping: 0.05 });
        else c = Constraint.create({ bodyA: prev, pointA: { x: 0, y: prev.lb.h / 2 }, bodyB: b, pointB: { x: 0, y: -b.lb.h / 2 }, length: 12, stiffness: 0.7, damping: 0.05 });
        c.lb = { id: this._nextId++, alive: true };
        Composite.add(this.world, c);
        this.tethers.push(c);
        prev = b;
      }
    }
    for (const s of st.shields) {
      this.shields.push({ x: s.x, y: s.y, r: s.r, gens: s.gens.map((i) => created[i]), active: true, hitT: -10 });
    }
    this.targetsTotal = this.targets.length;
    this.targetsLeft = this.targets.length;
  };

  Sim.prototype.isPhased = function (b) {
    if (b.lb.type !== 'phase') return false;
    const p = ((this.t + b.lb.phOff) % 3.4) / 3.4;
    return p > 0.55;
  };
  Sim.prototype.phaseLevel = function (b) { // 0 = solid ... 1 = phased (for rendering)
    const p = ((this.t + b.lb.phOff) % 3.4) / 3.4;
    if (p < 0.5) return 0;
    if (p < 0.55) return (p - 0.5) / 0.05;
    if (p < 0.95) return 1;
    return 1 - (p - 0.95) / 0.05;
  };
  Sim.prototype.inShield = function (x, y) {
    for (const s of this.shields) if (s.active && (x - s.x) * (x - s.x) + (y - s.y) * (y - s.y) < s.r * s.r) return s;
    return null;
  };

  Sim.prototype._kinUpdate = function () {
    const t = this.t;
    for (const b of this.kin) {
      const k = b.lb.kin;
      if (!k || !b.lb.alive || !b.isStatic) continue;
      if (k.mode === 'orbit') {
        const a = k.a0 + k.speed * t;
        Body.setPosition(b, { x: k.cx + Math.cos(a) * k.r, y: k.cy + Math.sin(a) * k.r }, true);
        Body.setAngle(b, a + k.rot, true);
      } else if (k.mode === 'hover') {
        Body.setPosition(b, { x: k.hx, y: k.hy + Math.sin(t * 1.7 + k.ph) * k.amp }, true);
        Body.setAngle(b, Math.sin(t * 0.9 + k.ph) * 0.15, true);
      } else if (k.mode === 'spin') {
        Body.setAngle(b, k.a0 + k.speed * t, true);
      } else if (k.mode === 'move') {
        // starts centred and eases in so resting blocks are carried along
        const s = k.spec, v = Math.sin(t * s.w) * ramp(t);
        Body.setPosition(b, { x: k.x0 + s.ax * v, y: k.y0 + s.ay * v }, true);
      } else if (k.mode === 'rock') {
        const s = k.spec;
        Body.setAngle(b, s.amp * Math.sin(t * s.w) * ramp(t), true);
      }
    }
    const g = this.engine.gravity;
    for (const b of this.floats) {
      const f = b.lb.float;
      if (!f.on || !b.lb.alive) continue;
      const hy = f.hy + Math.sin(t * 1.8 + f.ph) * 6;
      const ax = -(b.position.x - f.hx) * 0.004 - b.velocity.x * 0.05;
      const ay = -(b.position.y - hy) * 0.004 - b.velocity.y * 0.05;
      const k = b.mass / 277.78;
      Body.applyForce(b, b.position, { x: ax * k, y: ay * k - b.mass * g.y * g.scale });
      Body.setAngularVelocity(b, b.angularVelocity * 0.92 - b.angle * 0.01);
    }
  };

  Sim.prototype._onCollide = function (e) {
    if (this.stepN < 50) return;
    let impacts = 0;
    for (const pr of e.pairs) {
      const a = pr.bodyA, b = pr.bodyB;
      // hard knocks while a structure collapses -> sparks + thud (for feedback only)
      if (impacts < 4 && a.lb && b.lb) {
        const rv = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
        if (rv > 3.2) {
          const sp = pr.collision && pr.collision.supports && pr.collision.supports[0];
          const src = a.isStatic ? b : a;
          this.events.push({ t: 'impact', x: sp ? sp.x : src.position.x, y: sp ? sp.y : src.position.y, v: rv, body: src });
          impacts++;
        }
      }
      for (const [c, o] of [[a, b], [b, a]]) {
        const L = c.lb;
        if (!L || !L.alive || !L.target || c.isStatic) continue;
        const rv = Math.hypot(c.velocity.x - o.velocity.x, c.velocity.y - o.velocity.y);
        // crystals are fragile; everything else shatters when it slams into something hard enough
        const limit = L.type === 'crystal' ? 4.2 : L.type === 'armor' ? 11 : L.type === 'core' || L.type === 'gen' ? 1e9 : 8;
        if (rv > limit) this._crystalBreak.push(c);
      }
    }
  };

  Sim.prototype.step = function () {
    this.t += 1 / 60; this.stepN++;
    this._kinUpdate();
    Engine.update(this.engine, 1000 / 60);
    if (this._crystalBreak.length) {
      const list = this._crystalBreak; this._crystalBreak = [];
      for (const c of list) this.damage(c, c.lb.type === 'crystal' ? 99 : 1, c.lb.type === 'crystal' ? 'crystal' : 'impact');
      this._flush();
    }
    // shields
    for (const s of this.shields) {
      if (s.active && !s.gens.some((g) => g.lb.alive)) { s.active = false; this.events.push({ t: 'shieldDown', x: s.x, y: s.y, r: s.r }); }
    }
    // clears & removal
    let maxV = 0;
    for (const b of this.bodies) {
      const L = b.lb;
      if (L.removed) continue;
      const p = b.position;
      if (L.target && L.alive && !L.cleared && (p.y > this.killY || p.x < -40 || p.x > W + 40)) {
        L.cleared = true; this.targetsLeft--;
        const pts = this._addScore(150);
        this.events.push({ t: 'fall', body: b, x: clamp(p.x, 10, W - 10), y: Math.min(p.y, H), pts, combo: this.combo });
        if (L.type === 'star') this._bonus(b, 2);
        this._detachTethers(b);
      }
      if (p.y > H + 250 || p.x < -350 || p.x > W + 350) {
        L.removed = true; L.alive = false;
        Composite.remove(this.world, b);
        continue;
      }
      if (!b.isStatic && L.alive && !L.cleared) {
        const v = Math.abs(b.velocity.x) + Math.abs(b.velocity.y) + Math.abs(b.angularVelocity) * 20;
        if (v > maxV) maxV = v;
      }
    }
    this.calm = maxV < 0.3 ? this.calm + 1 : 0;

    if (this.state === 'play') {
      if (this.targetsLeft <= 0) {
        this.state = 'clear';
        this.events.push({ t: 'clear' });
      } else if (this.lasers <= 0) {
        const since = this.stepN - this.lastShotStep;
        if (since > 45 && (this.calm > 50 || since > 330)) {
          this.state = 'fail';
          this.events.push({ t: 'fail' });
        }
      }
    }
  };

  Sim.prototype._addScore = function (base) {
    if (this.t - this.lastScoreT < 1.1) this.combo = Math.min(this.combo + 1, 99); else this.combo = 1;
    this.lastScoreT = this.t;
    const pts = base * this.combo;
    this.score += pts;
    return pts;
  };
  Sim.prototype._bonus = function (b, n) {
    this.lasers += n;
    this.events.push({ t: 'bonus', n, x: b.position.x, y: b.position.y });
  };
  Sim.prototype._detachTethers = function (b) {
    for (const c of this.tethers) {
      if (!c.lb.alive) continue;
      if (c.bodyA === b || c.bodyB === b) {
        c.lb.alive = false; Composite.remove(this.world, c);
      }
    }
  };
  Sim.prototype.tetherPoints = function (c) {
    const a = c.bodyA ? { x: c.bodyA.position.x + c.pointA.x, y: c.bodyA.position.y + c.pointA.y } : c.pointA;
    const b = c.bodyB ? { x: c.bodyB.position.x + c.pointB.x, y: c.bodyB.position.y + c.pointB.y } : c.pointB;
    return [a, b];
  };

  Sim.prototype._release = function (b) {
    const k = b.lb.kin;
    if (!b.isStatic || !k || !k.release) return;
    Body.setStatic(b, false);
    const a = k.a0 + k.speed * this.t;
    const vt = (k.speed * k.r) / 60;
    Body.setVelocity(b, { x: -Math.sin(a) * vt, y: Math.cos(a) * vt });
    Body.setAngularVelocity(b, k.speed / 60);
    b.lb.kin = null;
    this.events.push({ t: 'release', x: b.position.x, y: b.position.y });
  };

  Sim.prototype.damage = function (b, amt, cause) {
    const L = b.lb;
    if (!L.alive || !L.target) return;
    L.hp -= amt;
    L.hitT = this.t;
    if (L.hp <= 0) { if (!L.dying) { L.dying = true; this._queue.push([b, cause]); } }
    else this.events.push({ t: 'crack', body: b, x: b.position.x, y: b.position.y });
  };
  Sim.prototype._flush = function () {
    let guard = 0;
    while (this._queue.length && guard++ < 400) {
      const [b, cause] = this._queue.shift();
      this._destroy(b, cause);
    }
  };
  Sim.prototype._destroy = function (b, cause) {
    const L = b.lb;
    if (!L.alive) return;
    L.alive = false; L.removed = true;
    const wasCounted = L.cleared;
    if (L.target && !L.cleared) { L.cleared = true; this.targetsLeft--; }
    this._detachTethers(b);
    Composite.remove(this.world, b);
    const pos = { x: b.position.x, y: b.position.y };
    const pts = wasCounted ? 0 : this._addScore(L.type === 'core' ? 3000 : L.type === 'bomb' ? 300 : L.type === 'gen' ? 500 : 100);
    this.events.push({ t: 'destroy', body: b, x: pos.x, y: pos.y, cause, pts, combo: this.combo });
    if (L.type === 'star' && !wasCounted) this._bonus(b, 2);
    if (L.type === 'bomb') {
      this.events.push({ t: 'bomb', x: pos.x, y: pos.y });
      this.blast(pos, 200, 15, b, 'bomb');
      for (const o of this.bodies) {
        if (!o.lb.alive || !o.lb.target || o === b) continue;
        if (Math.hypot(o.position.x - pos.x, o.position.y - pos.y) < 105 && !this.isPhased(o)) this.damage(o, 1, 'bomb');
      }
    } else if (L.type === 'core') {
      this.events.push({ t: 'coreDown', x: pos.x, y: pos.y });
      this.blast(pos, 420, 17, b, 'core');
      // shatter the guard ring
      for (const o of this.bodies) {
        if (o.lb.alive && o.lb.kin && o.lb.kin.mode === 'orbit' && o.lb.type === 'steel' && Math.hypot(o.position.x - pos.x, o.position.y - pos.y) < 200) {
          o.lb.kin.release = true; this._release(o);
        }
      }
    } else if (L.type === 'gen') {
      this.blast(pos, 90, 5, b, 'gen');
    } else {
      if (cause === 'impact') this.blast(pos, 80, 5.5, b, 'destroy');
      else this.blast(pos, 110, 9.5, b, 'destroy');
    }
  };

  Sim.prototype.blast = function (p, R, K, exclude, kind) {
    this.events.push({ t: 'blast', x: p.x, y: p.y, r: R, kind });
    for (const b of this.bodies) {
      const L = b.lb;
      if (!L.alive || b === exclude) continue;
      if (L.kind === 'platform' || L.kind === 'spinner' || L.kind === 'hub') continue;
      if (this.isPhased(b)) continue;
      if (this.inShield(b.position.x, b.position.y) && !this.inShield(p.x, p.y)) continue;
      const dx = b.position.x - p.x, dy = b.position.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= R) continue;
      const f = 1 - dist / R;
      if (b.isStatic) {
        if (L.kin && L.kin.release && dist < R * 0.75) this._release(b);
        else continue;
      }
      const nx = dist < 1 ? 0 : dx / dist, ny = dist < 1 ? -1 : dy / dist;
      const mf = clamp(Math.sqrt(REF_MASS / b.mass), 0.3, 1.25);
      const s = K * f * mf;
      Body.setVelocity(b, { x: b.velocity.x + nx * s, y: b.velocity.y + ny * s - 2.2 * f * mf });
      // tumble: spin away from the blast so blocks cartwheel instead of sliding
      Body.setAngularVelocity(b, b.angularVelocity + (nx >= 0 ? 1 : -1) * (0.12 + this.rand() * 0.25) * f * mf);
    }
  };

  Sim.prototype.pick = function (p) {
    const cands = [];
    for (const b of this.bodies) if (b.lb.alive && !b.lb.removed && !this.isPhased(b)) cands.push(b);
    const hits = Query.point(cands, p);
    let best = null;
    for (const b of hits) if (!best || LAYER[b.lb.kind] > LAYER[best.lb.kind]) best = b;
    if (best) return best;
    // near-miss assist for small targets
    let bd = 15;
    for (const b of cands) {
      if (!b.lb.target) continue;
      const bb = b.bounds;
      const dx = Math.max(bb.min.x - p.x, 0, p.x - bb.max.x), dy = Math.max(bb.min.y - p.y, 0, p.y - bb.max.y);
      const dd = Math.hypot(dx, dy);
      if (dd < bd) { bd = dd; best = b; }
    }
    return best;
  };
  Sim.prototype.pickTether = function (p) {
    let best = null, bd = 16;
    for (const c of this.tethers) {
      if (!c.lb.alive) continue;
      const [a, b] = this.tetherPoints(c);
      const vx = b.x - a.x, vy = b.y - a.y;
      const l2 = vx * vx + vy * vy || 1;
      const t = clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / l2, 0, 1);
      const d = Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };

  // Fire the laser at world point (x, y). Returns false if unable.
  Sim.prototype.fire = function (x, y) {
    if (this.lasers <= 0 || this.state !== 'play') return false;
    this.lasers--; this.shots++; this.lastShotStep = this.stepN;
    const p = { x, y };
    const sh = this.inShield(x, y);
    if (sh) {
      sh.hitT = this.t;
      this.events.push({ t: 'laser', x, y, result: 'shield' });
      this.events.push({ t: 'shieldHit', x, y, s: sh });
      return true;
    }
    const hit = this.pick(p);
    if (hit) {
      const L = hit.lb;
      if (!L.target) {
        this.events.push({ t: 'laser', x, y, result: 'deflect' });
        this.events.push({ t: 'deflect', x, y });
        this.blast(p, 70, 4, null, 'deflect');
        return true;
      }
      this.events.push({ t: 'laser', x, y, result: 'hit' });
      if (L.kin && L.kin.release) this._release(hit);
      if (L.float && L.float.on) { L.float.on = false; this.events.push({ t: 'floatOff', x: hit.position.x, y: hit.position.y }); Body.setVelocity(hit, { x: hit.velocity.x, y: hit.velocity.y + 1 }); }
      this.events.push({ t: 'hit', x, y, body: hit });
      this.damage(hit, 1, 'laser');
      this._flush();
      if (L.alive) this.blast(p, 105, 9, null, 'hit');
      return true;
    }
    const tc = this.pickTether(p);
    if (tc) {
      const [a, b] = this.tetherPoints(tc);
      tc.lb.alive = false; Composite.remove(this.world, tc);
      this.events.push({ t: 'laser', x, y, result: 'cut' });
      this.events.push({ t: 'cut', x, y, a, b });
      return true;
    }
    this.events.push({ t: 'laser', x, y, result: 'empty' });
    this.blast(p, BLAST_R, 12.5, null, 'empty');
    return true;
  };

  Sim.prototype.drainEvents = function () { const e = this.events; this.events = []; return e; };

  Sim.prototype.stars = function () {
    const ratio = this.lasers / Math.max(1, this.stage.lasers);
    return ratio >= 0.4 ? 3 : ratio >= 0.2 ? 2 : 1;
  };

  /* ---------------------------------------------------------- Stage table */
  // LB.BUDGET is filled by js/budget.js (precomputed with tools/precompute.js):
  // BUDGET[n-1] = [variant, lasers]
  function getStage(n) {
    const tab = LB.BUDGET && LB.BUDGET[n - 1];
    const st = generate(n, tab ? tab[0] : 0);
    st.lasers = tab ? tab[1] : 12;
    return st;
  }

  LB.BLAST_R = BLAST_R; LB.W = W; LB.H = H; LB.U = U; LB.TURRET = TURRET;
  LB.SECTORS = SECTORS; LB.GIMMICKS = GIMMICKS;
  LB.generate = generate; LB.getStage = getStage; LB.Sim = Sim;
  LB.makeRng = makeRng; LB.hash = hash; LB.clamp = clamp;
  LB.STAGE_COUNT = 1000;
  if (typeof module !== 'undefined' && module.exports) module.exports = LB;
})(typeof globalThis !== 'undefined' ? globalThis : this);

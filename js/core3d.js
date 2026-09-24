/* LaserBeam 3D - stage generation + physics simulation (cannon-es). Runs in the browser and in Node. */
import * as CANNON from '../lib/cannon-es.js';

export const U = 1;                 // one cube
export const GRAVITY = 22;
export const BLAST_R = 2.3;         // shockwave radius when the laser hits nothing
export const STAGE_COUNT = 1000;
const MAX_H = 8.6;                  // tallest a structure may stand above its pedestal
const SIDE = 5.2;                   // |x| limit for layouts (portrait screens)

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// 0 at stage 1 -> 1 at stage 1000
export function difficulty(n) { return Math.pow(clamp((n - 1) / 999, 0, 1), 0.85); }
// 1..10 for display
export function difficultyLevel(n) { return clamp(1 + Math.floor(difficulty(n) * 9.6 + (n % 10 === 0 ? 0.6 : 0)), 1, 10); }
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
export function hash(n) {
  n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return n >>> 0;
}
export function makeRng(seed) {
  const f = mulberry32(seed);
  return {
    f,
    range: (a, b) => a + (b - a) * f(),
    int: (a, b) => a + Math.floor(f() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(f() * arr.length)],
    chance: (p) => f() < p,
    weighted(list) {
      let s = 0; for (const e of list) s += e[1];
      let x = f() * s;
      for (const e of list) { x -= e[1]; if (x <= 0) return e[0]; }
      return list[list.length - 1][0];
    },
  };
}

/* ------------------------------------------------------------ Metadata */
export const SECTORS = [
  ['NEON CITY', 190], ['DATA STREAM', 150], ['SYNTH HORIZON', 300], ['CHROME SECTOR', 210],
  ['AMBER GRID', 38], ['VOID CORE', 270], ['PLASMA DISTRICT', 330], ['QUANTUM FIELD', 170],
  ['CRIMSON NET', 355], ['GHOST PROTOCOL', 200], ['ULTRAVIOLET', 285], ['SOLAR FLARE', 45],
  ['MATRIX DEPTHS', 125], ['HOLO CATHEDRAL', 250], ['ION STORM', 185], ['BLACK ICE', 215],
  ['NEURAL LINK', 315], ['OVERCLOCK', 15], ['SINGULARITY', 262], ['LASER HEAVEN', 180],
];

export const GIMMICKS = {
  star:      { n: 4,  name: 'STAR BLOCK',       desc: '破壊するか台座から落とすとレーザーが+2補充される。' },
  turntable: { n: 6,  name: 'TURNTABLE',        desc: '回転する台座！構造物ごとぐるぐる回る。狙いどころが来た瞬間に撃て。' },
  armor:     { n: 8,  name: 'ARMOR BLOCK',      desc: '装甲ブロック。重くて耐久力が高い。何発も撃ち込もう。' },
  orb:       { n: 11, name: 'ENERGY ORB',       desc: '転がりやすい球体ブロック。受け皿を崩せば一気に転がり落ちる。' },
  bomb:      { n: 13, name: 'BOMB BLOCK',       desc: '撃つと大爆発！周囲のブロックもまとめて吹き飛ばす。' },
  moving:    { n: 17, name: 'SLIDE PLATFORM',   desc: '左右にスライドする台座。' },
  orbit:     { n: 21, name: 'ORBIT BLOCKS',     desc: '構造物のまわりを周回するブロック。撃つと軌道から外れて落下する。' },
  rotor:     { n: 26, name: 'ROTOR',            desc: '十字に組まれて回転するブロック群。' },
  steel:     { n: 31, name: 'STEEL',            desc: '破壊できない重い鉄塊。クリア対象外だが邪魔をする。' },
  spinner:   { n: 34, name: 'SPIN BAR',         desc: '回転する鉄のバー。レーザーを遮る。隙間を狙え。' },
  tether:    { n: 38, name: 'TETHER',           desc: '吊るされたブロック。光るワイヤーを撃てば切断できる。' },
  float:     { n: 42, name: 'HOVER BLOCK',      desc: '浮遊ブロック。撃つと推進装置が停止して落下する。' },
  rock:      { n: 46, name: 'ROCKING PLATFORM', desc: 'ゆっくり傾く台座。揺れを利用して落とせ。' },
  shield:    { n: 55, name: 'SHIELD DOME',      desc: 'シールド内はレーザー無効。外のジェネレーターを破壊せよ。' },
  crystal:   { n: 61, name: 'CRYSTAL',          desc: '衝撃に弱いクリスタル。何かにぶつけるだけで砕ける。' },
  phase:     { n: 65, name: 'PHASE BLOCK',      desc: '実体化と透過を繰り返す。透過中はレーザーが効かない。' },
  lowgrav:   { n: 71, name: 'LOW GRAVITY',      desc: '低重力エリア。ブロックがふわりと遠くまで飛ぶ。' },
  elevator:  { n: 75, name: 'ELEVATOR',         desc: '上下に動く台座。' },
  // boss stages (every 10th stage); each type is introduced the first time it appears
  bossGuardian: { n: 10, name: 'BOSS: CORE GUARDIAN', desc: '10ステージごとにボス出現！周回する装甲の隙間から浮遊コアを撃ち抜け。コアとすべてのブロックを倒せばクリア。' },
  bossTwin:     { n: 20, name: 'BOSS: TWIN CORES',    desc: '左右2つのコア。それぞれの装甲をかいくぐり、両方とも破壊せよ。' },
  bossFortress: { n: 30, name: 'BOSS: FORTRESS',      desc: '回転する城壁の中にコアが潜む。壁を崩すか、隙間が正面に来た瞬間に撃ち抜け。' },
  bossShield:   { n: 40, name: 'BOSS: SHIELD CORE',   desc: 'コアはシールドに守られている。先にジェネレーターを破壊してからコアを撃て。' },
  bossOmega:    { n: 50, name: 'BOSS: OMEGA CORE',    desc: '50ステージごとの大ボス。二重の装甲リングに守られた巨大コアを破壊せよ。' },
};
export const BOSSES = {
  guardian: { key: 'bossGuardian', name: 'CORE GUARDIAN' },
  twin: { key: 'bossTwin', name: 'TWIN CORES' },
  fortress: { key: 'bossFortress', name: 'FORTRESS' },
  shield: { key: 'bossShield', name: 'SHIELD CORE' },
  omega: { key: 'bossOmega', name: 'OMEGA CORE' },
};
export const isBoss = (n) => n % 10 === 0;
export function bossKind(n) {
  if (n % 50 === 0) return 'omega';
  if (n <= 40) return ['guardian', 'twin', 'fortress', 'shield'][n / 10 - 1];
  return ['guardian', 'twin', 'fortress', 'shield'][hash(n * 31 + 7) % 4];
}
const GIMMICK_ORDER = Object.keys(GIMMICKS);
export function introAt(n) {
  for (const k of GIMMICK_ORDER) if (GIMMICKS[k].n === n) return k;
  return null;
}

/* ---------------------------------------------------- Stage generation */
// blocks are {x,y,z,w,h,d,shape,type}; y is the centre. place() returns the new top.
function place(out, x, z, bottom, w, h, d, shape, extra) {
  const s = { x, y: bottom + h / 2, z, w, h, d, shape: shape || 'box', type: 'normal' };
  if (extra) Object.assign(s, extra);
  out.push(s);
  return bottom + h;
}
const cols = (s) => Math.max(1, Math.floor(s.w / U + 1e-6));
const deps = (s) => Math.max(1, Math.floor(s.d / U + 1e-6));
const rowsOf = (s) => Math.floor(s.maxH / U + 1e-6);
function grid(n) { const a = []; for (let i = 0; i < n; i++) a.push((i - (n - 1) / 2) * U); return a; }

const T = {
  pyramid(s, r, d) {
    const out = [];
    const cz = Math.min(deps(s), 3);
    let b = clamp(r.int(2, 3 + Math.round(d * 2)), 1, cols(s));
    b = Math.min(b, rowsOf(s));
    const flat = cz < 2 || r.chance(0.3);
    for (let i = 0; i < b; i++) {
      const n = b - i;
      const nz = flat ? 1 : Math.max(1, Math.min(cz, n) - (cz >= n ? 0 : 0));
      for (const x of grid(n)) for (const z of grid(flat ? 1 : Math.min(nz, n))) place(out, s.x + x, s.z + z, s.top + i * U, U, U, U, 'box');
    }
    return out;
  },
  wall(s, r, d) {
    const out = [];
    const cx = clamp(r.int(2, 3 + Math.round(d * 2)), 1, cols(s));
    const cz = clamp(r.int(1, 2), 1, deps(s));
    const rows = clamp(r.int(2, 3 + Math.round(d * 4)), 1, rowsOf(s));
    const shape = r.chance(0.25) ? 'cyl' : 'box';
    for (let i = 0; i < rows; i++)
      for (const x of grid(cx)) for (const z of grid(cz)) place(out, s.x + x, s.z + z, s.top + i * U, U, U, U, shape);
    return out;
  },
  // heavy mass standing on thin legs
  stilts(s, r, d) {
    const out = [];
    if (rowsOf(s) < 4) return T.tallStack(s, r, d);
    const cx = clamp(r.int(2, 3 + Math.round(d)), 2, Math.max(2, cols(s)));
    const cz = clamp(r.int(1, 3), 1, deps(s));
    const w = cx * U, dd = cz * U;
    const thin = r.chance(0.55);
    const lw = thin ? 0.32 : 0.7, lh = thin ? 2 : 1;
    let top = s.top;
    const lx = [-(w / 2 - 0.45), w / 2 - 0.45];
    const lz = cz >= 2 ? [-(dd / 2 - 0.45), dd / 2 - 0.45] : [0];
    for (const x of lx) for (const z of lz) {
      let t = s.top;
      for (let q = 0; q < (thin ? 1 : 2); q++) t = place(out, s.x + x, s.z + z, t, lw, lh, thin ? Math.min(0.9, dd) : lw, thin ? 'slab' : 'cyl');
      top = t;
    }
    top = place(out, s.x, s.z, top, w, 0.4, dd, 'plank');
    const sub = { x: s.x, z: s.z, top, w, d: dd, maxH: s.maxH - (top - s.top) };
    if (sub.maxH >= U) {
      const k = r.int(0, 2);
      out.push(...(k === 0 ? T.wall(sub, r, 0.3 + d * 0.5) : k === 1 ? T.tallStack(sub, r, d * 0.5) : T.pyramid(sub, r, d)));
    }
    return out;
  },
  // a beam (or cross of beams) balanced on one column with loads at the ends
  tTower(s, r, d) {
    const out = [];
    if (rowsOf(s) < 4) return T.stilts(s, r, d);
    const m = clamp(r.int(2, 3 + Math.round(d)), 1, rowsOf(s) - 2);
    let top = s.top;
    for (let i = 0; i < m; i++) top = place(out, s.x, s.z, top, 0.9, U, 0.9, 'cyl');
    const bw = r.int(3, 4) * U;
    const topX = place(out, s.x, s.z, top, bw, 0.4, 1, 'plank');
    const cross = r.chance(0.5);
    const topZ = cross ? place(out, s.x, s.z, topX, 1, 0.4, bw, 'plank') : topX;
    top = topZ;
    const endH = clamp(r.int(1, 2 + Math.round(d)), 1, Math.floor((s.maxH - (top - s.top)) / U));
    const ends = [[-1, 0], [1, 0]];
    if (cross) ends.push([0, -1], [0, 1]);
    for (const [ex, ez] of ends) {
      let t = ez ? topZ : topX;   // x-end loads sit on the lower beam, z-end loads on the crossing one
      for (let i = 0; i < endH; i++) t = place(out, s.x + ex * (bw / 2 - 0.5), s.z + ez * (bw / 2 - 0.5), t, U, U, U, i % 2 ? 'cyl' : 'box');
    }
    return out;
  },
  // slender columns tied together with slabs
  tallStack(s, r, d) {
    const out = [];
    const cx = clamp(r.int(1, 3), 1, cols(s));
    const cz = clamp(r.int(1, 2), 1, deps(s));
    const h = clamp(r.int(4, 6 + Math.round(d * 3)), 2, rowsOf(s));
    const tie = r.int(2, 3);
    const shape = r.chance(0.4) ? 'cyl' : 'box';
    let y = s.top;
    for (let row = 0; row < h; row++) {
      if (row > 0 && row % tie === 0 && cx * cz > 1 && y - s.top + 1.4 <= s.maxH) y = place(out, s.x, s.z, y, cx * U, 0.4, cz * U, 'plank');
      if (y - s.top + U > s.maxH) break;
      for (const x of grid(cx)) for (const z of grid(cz)) place(out, s.x + x, s.z + z, y, 0.95, U, 0.95, shape);
      y += U;
    }
    return out;
  },
  // the classic: 3 beams per layer, alternating direction
  jenga(s, r, d) {
    const out = [];
    const layers = clamp(r.int(6, 9 + Math.round(d * 4)), 3, Math.floor(s.maxH / 0.6));
    const L = 3, th = 0.6;
    let y = s.top;
    for (let i = 0; i < layers; i++) {
      const alongX = i % 2 === 0;
      let skip = -1;
      if (i > 1 && r.chance(0.28)) skip = r.chance(0.5) ? 1 : r.pick([0, 2]);
      for (let k = 0; k < 3; k++) {
        if (k === skip) continue;
        const o = (k - 1) * U;
        if (alongX) place(out, s.x, s.z + o, y, L, th, 0.98, 'plank');
        else place(out, s.x + o, s.z, y, 0.98, th, L, 'plank');
      }
      y += th;
    }
    return out;
  },
  // house of cards (depth 1)
  cards(s, r, d) {
    const out = [];
    if (rowsOf(s) < 3) return T.tallStack(s, r, d);
    const cw = 0.3, chh = 1.6, span = 1.25;
    let n = clamp(r.int(2, 3 + Math.round(d)), 1, Math.floor((s.w - cw) / span));
    let y = s.top;
    const dd = Math.min(s.d, r.chance(0.5) ? 2 : 1);
    while (n >= 1 && y - s.top + chh + 0.4 <= s.maxH) {
      const x0 = s.x - (n * span) / 2;
      for (let i = 0; i <= n; i++) place(out, x0 + i * span, s.z, y, cw, chh, dd, 'slab');
      y = place(out, s.x, s.z, y + chh, n * span + cw, 0.4, dd, 'plank');
      n--;
    }
    if (y - s.top + U <= s.maxH) place(out, s.x, s.z, y, U, U, U, 'box');
    return out;
  },
  // dominoes carrying a bridge with cargo
  dominoBridge(s, r, d) {
    const out = [];
    if (rowsOf(s) < 4) return T.tallStack(s, r, d);
    const sw = 0.3, sh = 2.2;
    const count = clamp(Math.floor(s.w / 1.1), 2, 5);
    const sp = Math.min((s.w - sw) / (count - 1), 1.2);
    const dd = Math.min(s.d, 1.5);
    const x0 = s.x - sp * (count - 1) / 2;
    for (let i = 0; i < count; i++) place(out, x0 + i * sp, s.z, s.top, sw, sh, dd, 'slab');
    const bw = sp * (count - 1) + sw + 0.6;
    const top = place(out, s.x, s.z, s.top + sh, bw, 0.4, dd, 'plank');
    const sub = { x: s.x, z: s.z, top, w: bw, d: dd, maxH: s.maxH - (top - s.top) };
    out.push(...T.wall(sub, r, d * 0.5));
    return out;
  },
  // dominoes standing in a ring (great on turntables)
  dominoRing(s, r, d) {
    const out = [];
    const R = Math.min(s.w, s.d) / 2 - 0.3;
    if (R < 1.1 || rowsOf(s) < 3) return T.tallStack(s, r, d);
    const n = clamp(Math.floor((2 * Math.PI * R) / 0.75), 6, 16);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      place(out, s.x + Math.cos(a) * R, s.z + Math.sin(a) * R, s.top, 0.3, 2, 0.9, 'slab', { rotY: -(a + Math.PI / 2) });
    }
    if (rowsOf(s) >= 5 && R >= 1.3) {
      let t = s.top;
      for (let i = 0; i < clamp(r.int(3, 5), 1, rowsOf(s)); i++) t = place(out, s.x, s.z, t, 0.9, U, 0.9, 'cyl');
    }
    return out;
  },
  // reference-like: pillars, a slab, a pyramid on top
  tree(s, r, d) {
    const out = [];
    if (cols(s) < 2 || rowsOf(s) < 4) return T.stilts(s, r, d);
    const b = clamp(r.int(2, 3 + Math.round(d * 2)), 2, cols(s));
    const cz = clamp(r.int(1, 2), 1, deps(s));
    const w = b * U, dd = cz * U;
    const ph = r.int(1, 2);
    let top = s.top;
    const lz = cz >= 2 ? [-(dd / 2 - 0.4), dd / 2 - 0.4] : [0];
    for (const x of [-(w / 2 - 0.4), w / 2 - 0.4]) for (const z of lz) {
      let t = s.top; for (let k = 0; k < ph; k++) t = place(out, s.x + x, s.z + z, t, 0.8, U, 0.8, 'cyl'); top = t;
    }
    top = place(out, s.x, s.z, top, w, 0.4, dd, 'plank');
    const pr = Math.min(b, Math.floor((s.maxH - (top - s.top)) / U));
    for (let i = 0; i < pr; i++) {
      const n = b - i;
      for (const x of grid(n)) for (const z of grid(Math.min(cz, n))) place(out, s.x + x, s.z + z, top + i * U, U, U, U, 'box');
    }
    return out;
  },
  // a hollow square keep with corner towers
  castle(s, r, d) {
    const out = [];
    const cx = clamp(r.int(3, 4), 3, cols(s)), cz = clamp(3, 1, deps(s));
    if (cx < 3 || cz < 3 || rowsOf(s) < 3) return T.wall(s, r, d);
    const rows = clamp(r.int(2, 3), 1, rowsOf(s) - 1);
    const gx = grid(cx), gz = grid(cz);
    for (let i = 0; i < rows; i++)
      for (let a = 0; a < cx; a++) for (let b = 0; b < cz; b++) {
        if (a > 0 && a < cx - 1 && b > 0 && b < cz - 1) continue;
        place(out, s.x + gx[a], s.z + gz[b], s.top + i * U, U, U, U, 'box');
      }
    for (const [a, b] of [[0, 0], [cx - 1, 0], [0, cz - 1], [cx - 1, cz - 1]])
      place(out, s.x + gx[a], s.z + gz[b], s.top + rows * U, U, U, U, 'cyl');
    return out;
  },
  spire(s, r, d) {
    const out = [];
    let top = s.top;
    if (cols(s) >= 2 && deps(s) >= 2) top = place(out, s.x, s.z, top, 2, U, 2, 'brick');
    const h = clamp(r.int(3, 4 + Math.round(d * 4)), 1, rowsOf(s) - (top > s.top ? 1 : 0));
    for (let i = 0; i < h; i++) top = place(out, s.x, s.z, top, 0.9, U, 0.9, 'cyl');
    return out;
  },
  skyline(s, r, d) {
    const out = [];
    const cx = clamp(r.int(2, 3 + Math.round(d)), 1, cols(s)), cz = clamp(r.int(1, 2), 1, deps(s));
    for (const x of grid(cx)) for (const z of grid(cz)) {
      const h = clamp(r.int(1, 2 + Math.round(d * 4)), 1, rowsOf(s));
      const shape = r.chance(0.35) ? 'cyl' : 'box';
      for (let i = 0; i < h; i++) place(out, s.x + x, s.z + z, s.top + i * U, 0.95, U, 0.95, shape);
    }
    return out;
  },
  // spheres sitting in a tray of blocks
  orbPile(s, r, d) {
    const out = [];
    if (cols(s) < 3 || deps(s) < 3) return T.pyramid(s, r, d);
    const n = clamp(r.int(2, 3), 2, Math.min(cols(s), deps(s)) - 1);
    const half = (n * U) / 2 + 0.25;
    // tray walls
    for (const sgn of [-1, 1]) {
      place(out, s.x + sgn * half, s.z, s.top, 0.5, 0.6, n * U + 1, 'plank');
      place(out, s.x, s.z + sgn * half, s.top, n * U, 0.6, 0.5, 'plank');
    }
    const lv = Math.min(n, 3);
    for (let i = 0; i < lv; i++) {
      const k = n - i;
      for (const x of grid(k)) for (const z of grid(k)) out.push({ x: s.x + x, y: s.top + 0.5 + i * 0.707, z: s.z + z, w: U, h: U, d: U, shape: 'orb', type: 'normal' });
    }
    return out;
  },
};
const TEMPLATE_W = [
  ['stilts', 3.2], ['tTower', 2.4], ['tallStack', 2.2], ['jenga', 3.2], ['cards', 1.4], ['dominoBridge', 1.4],
  ['tree', 2.4], ['castle', 1.2], ['spire', 1.2], ['skyline', 0.8], ['wall', 0.5], ['pyramid', 0.4], ['orbPile', 0],
];

function bounds(blocks) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of blocks) {
    const hw = b.rotY ? Math.max(b.w, b.d) / 2 : b.w / 2, hd = b.rotY ? Math.max(b.w, b.d) / 2 : b.d / 2;
    x0 = Math.min(x0, b.x - hw); x1 = Math.max(x1, b.x + hw);
    y0 = Math.min(y0, b.y - b.h / 2); y1 = Math.max(y1, b.y + b.h / 2);
    z0 = Math.min(z0, b.z - hd); z1 = Math.max(z1, b.z + hd);
  }
  return { x0, x1, y0, y1, z0, z1 };
}
const overlapXY = (a, b, m) => a.x0 - m < b.x1 && a.x1 + m > b.x0 && a.y0 - m < b.y1 && a.y1 + m > b.y0;

class Builder {
  constructor(n, variant) {
    this.n = n;
    this.r = makeRng(hash(n * 1009 + variant * 7919 + 77));
    this.d = difficulty(n);
    this.pedestals = []; this.blocks = []; this.orbits = []; this.spinners = [];
    this.tethers = []; this.shields = []; this.occ = []; this.sites = [];
  }
  pedestal(x, z, top, w, d, round) {
    const p = { x, z, y: top, w, d, h: 0.5, round: !!round };
    this.pedestals.push(p);
    return p;
  }
  build(site, tname, ped) {
    const blocks = T[tname](site, this.r, this.d);
    for (const b of blocks) b.site = this.sites.length;
    if (!blocks.length) return blocks;
    if (ped) this.fitPedestal(ped, blocks, site.top);
    const bb = bounds(blocks);
    this.occ.push(bb);
    this.sites.push({ site, bounds: bb, ped, blocks, tname });
    this.blocks.push(...blocks);
    return blocks;
  }
  // shrink the pedestal to the footprint so toppled blocks fall off
  fitPedestal(p, blocks, top) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, rr = 0;
    for (const b of blocks) {
      if (Math.abs(b.y - b.h / 2 - top) > 0.01) continue;
      const hw = b.rotY ? Math.max(b.w, b.d) / 2 : b.w / 2, hd = b.rotY ? Math.max(b.w, b.d) / 2 : b.d / 2;
      x0 = Math.min(x0, b.x - hw); x1 = Math.max(x1, b.x + hw);
      z0 = Math.min(z0, b.z - hd); z1 = Math.max(z1, b.z + hd);
    }
    if (!isFinite(x0)) return;
    const m = this.r.range(0.08, 0.25);
    if (p.round) {
      for (const b of blocks) {
        if (Math.abs(b.y - b.h / 2 - top) > 0.01) continue;
        const hw = b.w / 2, hd = b.d / 2;
        for (const [cx, cz] of [[hw, hd], [-hw, hd], [hw, -hd], [-hw, -hd]]) rr = Math.max(rr, Math.hypot(b.x + cx - p.x, b.z + cz - p.z));
      }
      p.w = p.d = Math.max(1.2, rr * 2 + m * 2);
    } else {
      p.x = (x0 + x1) / 2; p.z = (z0 + z1) / 2;
      p.w = Math.max(0.9, x1 - x0 + m * 2); p.d = Math.max(0.9, z1 - z0 + m * 2);
    }
  }
  pickTemplate(allowOrb, exclude) {
    return this.r.weighted(TEMPLATE_W.map(([k, w]) => [k, k === 'orbPile' ? (allowOrb ? 2.5 : 0) : exclude && exclude.includes(k) ? 0 : w]));
  }
  // free spot in the x/y plane (z = 0); returns {x, y}
  freeSpot(rad, yMin, yMax, prefer) {
    const r = this.r;
    let best = null, bestS = -Infinity;
    for (let i = 0; i < 80; i++) {
      const x = r.range(-SIDE + rad, SIDE - rad);
      const y = r.range(yMin + rad, yMax - rad);
      if (yMax - rad < yMin + rad) break;
      const box = { x0: x - rad, x1: x + rad, y0: y - rad, y1: y + rad };
      let ok = true;
      for (const o of this.occ) if (overlapXY(box, o, 0.3)) { ok = false; break; }
      if (!ok) continue;
      const sc = prefer ? prefer(x, y) : r.f();
      if (sc > bestS) { bestS = sc; best = { x, y }; }
    }
    if (best) this.occ.push({ x0: best.x - rad, x1: best.x + rad, y0: best.y - rad, y1: best.y + rad });
    return best;
  }
}

// core HP grows slowly through the game
function bossHp(n, kind) {
  const base = clamp(3 + Math.floor(n / 90), 3, 10);
  if (kind === 'omega') return Math.min(14, base + 3);
  if (kind === 'twin') return Math.max(2, Math.round(base * 0.6));
  return base;
}
function addCore(B, x, y, z, size, hp) {
  B.blocks.push({ x, y, z, w: size, h: size, d: size, shape: 'core', type: 'core', hp, kin: { mode: 'hover', hx: x, hy: y, hz: z, amp: 0.2, ph: B.r.range(0, 6) } });
}
// steel plates orbiting a point: in a vertical plane facing the camera, or horizontally around it
function armorRing(B, cx, cy, cz, R, segs, speed, horizontal, plateH) {
  const items = [];
  for (let i = 0; i < segs; i++) items.push({ a: (i / segs) * Math.PI * 2, r: R, w: 0.3, h: plateH, d: 1.3, type: 'steel' });
  B.orbits.push({ cx, cy, cz, speed, items, steel: true, horizontal, tilt: horizontal ? 0 : B.r.range(-0.25, 0.25) });
}
function addBoss(B, kind, n, topY) {
  const r = B.r, d = B.d;
  const hp = bossHp(n, kind);
  const dir = () => (r.chance(0.5) ? 1 : -1);
  if (kind === 'fortress') { addCore(B, 0, B.fortressCore.y, 0, 1.3, hp); return; }
  if (kind === 'twin') {
    const cy = Math.max(topY + 2.1, 5.2), x = 2.2;
    for (const sx of [-1, 1]) {
      addCore(B, sx * x, cy, 0, 1.3, hp);
      armorRing(B, sx * x, cy, 0, 1.45, r.int(2, 3 + Math.round(d)), r.range(0.7, 1.1) * dir() * (1 + d * 0.4), false, 1 + d * 0.4);
    }
    B.occ.push({ x0: -x - 2.2, x1: x + 2.2, y0: cy - 1.8, y1: cy + 1.8 });
    return;
  }
  const big = kind === 'omega';
  const cy = Math.max(topY + (big ? 2.9 : 2.4), big ? 6 : 5.4);
  addCore(B, 0, cy, 0, big ? 2.3 : 1.8, hp);
  const R = big ? 2.5 : 2.1;
  if (kind === 'shield') {
    armorRing(B, 0, cy, 0, R, r.int(2, 3), r.range(0.5, 0.8) * dir(), false, 1.2);
    B.occ.push({ x0: -R - 0.8, x1: R + 0.8, y0: cy - R, y1: cy + R });
    const gens = [];
    for (let i = 0; i < 2; i++) {
      let spot = B.freeSpot(0.6, 0.5, MAX_H + 1.5, (x, y) => (Math.abs(x) > R + 1.2 ? r.f() - Math.abs(y - cy) * 0.1 : -1e6));
      if (!spot) spot = { x: (i ? 1 : -1) * (R + 1.6), y: cy - 1.2 };
      B.blocks.push({ x: spot.x, y: spot.y, z: 0.5, w: 0.8, h: 0.8, d: 0.8, shape: 'gen', type: 'gen', kin: { mode: 'hover', hx: spot.x, hy: spot.y, hz: 0.5, amp: 0.15, ph: r.range(0, 6) } });
      gens.push(B.blocks.length - 1);
    }
    B.shields.push({ x: 0, y: cy, z: 0, r: R + 0.45, gens });
    return;
  }
  armorRing(B, 0, cy, 0, R, r.int(3, 4 + Math.round(d * 2)), r.range(0.6, 1.0) * dir() * (1 + d * 0.5), false, 1.4 + d * 0.6);
  if (big) armorRing(B, 0, cy, 0, R + 0.9, r.int(4, 6), r.range(0.4, 0.7) * dir(), true, 1.3);
  B.occ.push({ x0: -R - 1.4, x1: R + 1.4, y0: cy - R, y1: cy + R });
}

export function generate(n, variant) {
  variant = variant || 0;
  const B = new Builder(n, variant);
  const r = B.r, d = B.d;
  const boss = isBoss(n);
  const bk = boss ? bossKind(n) : null;
  const intro = introAt(n);

  /* ---- features ---- */
  const feats = new Set();
  if (intro) feats.add(intro);
  const typeish = ['star', 'armor', 'orb', 'bomb', 'crystal', 'phase', 'steel'];
  const air = ['orbit', 'rotor', 'spinner', 'tether', 'float', 'shield'];
  const plat = ['turntable', 'moving', 'rock', 'elevator'];
  for (const k of GIMMICK_ORDER) {
    if (k.startsWith('boss') || GIMMICKS[k].n >= n) continue;
    let p;
    if (typeish.includes(k)) p = k === 'star' ? 0.6 - 0.25 * d : 0.15 + 0.4 * d;
    else if (air.includes(k)) p = 0.1 + 0.3 * d;
    else if (k === 'turntable') p = 0.3 + 0.2 * d;
    else if (plat.includes(k)) p = 0.07 + 0.15 * d;
    else p = 0.07;
    if (r.chance(p)) feats.add(k);
  }
  const maxAir = boss ? 1 : 1 + Math.floor(d * 2.6);
  let airList = air.filter((k) => feats.has(k));
  while (airList.length > maxAir) {
    const k = r.pick(airList.filter((q) => q !== intro)); feats.delete(k); airList = air.filter((q) => feats.has(q));
  }
  const platList = plat.filter((k) => feats.has(k));
  if (platList.length > 1) {
    const keep = platList.includes(intro) ? intro : r.pick(platList);
    for (const k of platList) if (k !== keep) feats.delete(k);
  }
  const spin = feats.has('turntable');
  const airCount = air.filter((k) => feats.has(k)).length + (boss ? 1 : 0);

  /* ---- layout ---- */
  let layout;
  if (n <= 6) layout = ['single', 'single', 'single', 'single', 'double', 'single'][n - 1];
  else if (bk === 'fortress') layout = 'fortress';
  else if (bk === 'twin') layout = 'single';
  else if (boss) layout = r.chance(0.5) ? 'double' : 'single';
  else layout = r.weighted([['single', 3.2], ['double', 2.4], ['bridge', 1.4], ['stepped', 1.3], ['scattered', 1.1 + d]]);
  if ((spin || feats.has('rock') || feats.has('moving') || feats.has('elevator')) && (layout === 'bridge')) layout = 'single';

  const airRoom = bk === 'omega' ? 4.4 : boss ? 3.8 : airCount ? 2.2 + 0.4 * Math.min(airCount, 2) : 0;
  const maxHFor = (top) => Math.max(U, MAX_H - airRoom - top);
  const allowOrb = feats.has('orb') || (n > 11 && r.chance(0.12));
  const tpl = (ex) => B.pickTemplate(allowOrb, ex);
  const forced = { 1: 'stilts', 2: 'jenga', 3: 'tree', 6: 'tTower' };

  if (layout === 'single') {
    const w = n <= 3 ? 3 : r.int(2, 3 + Math.round(d)), dd = r.int(2, 3);
    const p = B.pedestal(0, 0, 0, w + 0.4, dd + 0.4, spin);
    let tn = forced[n] || tpl();
    if (intro === 'orb') tn = 'orbPile';
    if (spin && r.chance(0.25)) tn = 'dominoRing';
    B.build({ x: 0, z: 0, top: 0, w, d: dd, maxH: maxHFor(0) }, tn, p);
  } else if (layout === 'fortress') {
    // a spinning round keep: a ring wall with gaps, the core hovering inside
    const R0 = r.range(1.55, 1.95), pr = R0 + 0.75;
    const p = B.pedestal(0, 0, 0, pr * 2, pr * 2, true);
    p.spin = { w: r.range(0.35, 0.55 + d * 0.3) * (r.chance(0.5) ? 1 : -1) };
    const cnt = Math.floor((2 * Math.PI * R0) / 0.98);
    const gapAt = r.int(0, cnt - 1), gap2 = d > 0.3 && r.chance(0.5) ? -1 : (gapAt + Math.floor(cnt / 2)) % cnt;
    const rows = 2 + (d > 0.5 && r.chance(0.5) ? 1 : 0);
    const out = [];
    for (let i = 0; i < cnt; i++) {
      if (i === gapAt || i === gap2) continue;
      const a = (i / cnt) * Math.PI * 2;
      for (let k = 0; k < rows; k++) place(out, Math.cos(a) * R0, Math.sin(a) * R0, k * U, 0.9, U, 0.9, k === rows - 1 && i % 2 ? 'cyl' : 'box', { rotY: -a });
    }
    for (const b of out) b.site = 0;
    B.blocks.push(...out);
    const bb = bounds(out); B.occ.push(bb);
    B.sites.push({ site: { x: 0, z: 0, top: 0, w: pr * 2, d: pr * 2, maxH: 3 }, bounds: bb, ped: p, blocks: out, tname: 'fortress' });
    B.fortressCore = { y: 1.05 };
  } else if (layout === 'double') {
    const w1 = r.int(2, 3), w2 = r.int(2, 3);
    const gap = r.range(1.2, 2.4);
    const total = w1 + w2 + gap;
    const x1 = -total / 2 + w1 / 2, x2 = total / 2 - w2 / 2;
    const t1 = 0, t2 = r.chance(0.5) ? 0 : r.range(-0.8, 0.8);
    const z2 = r.chance(0.35) ? r.range(-1.6, -0.6) : 0;
    const p1 = B.pedestal(x1, 0, t1, w1 + 0.4, 2.4, spin && r.chance(0.7));
    const p2 = B.pedestal(x2, z2, t2, w2 + 0.4, 2.4, spin && (!p1.round || r.chance(0.5)));
    B.build({ x: x1, z: 0, top: t1, w: w1, d: 2, maxH: maxHFor(t1) }, tpl(), p1);
    B.build({ x: x2, z: z2, top: t2, w: w2, d: 2, maxH: maxHFor(t2) }, tpl(), p2);
  } else if (layout === 'bridge') {
    const four = r.chance(0.35);
    const sp = r.range(1.9, 2.6);
    const pts = four ? [[-sp / 2, -sp / 2], [sp / 2, -sp / 2], [-sp / 2, sp / 2], [sp / 2, sp / 2]]
      : r.chance(0.5) ? [[-sp, 0], [0, 0], [sp, 0]] : [[-sp / 2, 0], [sp / 2, 0]];
    const out = [];
    const m = r.int(1, 2 + Math.round(d));
    let ptop = 0;
    for (const [x, z] of pts) {
      B.pedestal(x, z, 0, 1.1, 1.1, false);
      let t = 0; for (let q = 0; q < m; q++) t = place(out, x, z, t, 0.8, U, 0.8, 'cyl'); ptop = t;
    }
    let xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs) + 0.8, dd = Math.max(...zs) - Math.min(...zs) + 0.8;
    const top2 = place(out, 0, 0, ptop, w, 0.4, Math.max(dd, 1.2), 'plank');
    for (const b of out) b.site = 0;
    const site = { x: 0, z: 0, top: top2, w, d: Math.max(dd, 1.2), maxH: maxHFor(0) - top2 };
    if (site.maxH >= U) {
      const more = T[r.pick(['wall', 'pyramid', 'skyline', 'tallStack', 'castle'])](site, r, d);
      for (const b of more) b.site = 0;
      out.push(...more);
    }
    B.blocks.push(...out);
    const bb = bounds(out); B.occ.push(bb);
    B.sites.push({ site, bounds: bb, ped: B.pedestals[0], blocks: out });
  } else if (layout === 'stepped') {
    const k = r.chance(0.5) ? 3 : 2;
    const w = k === 3 ? 2 : r.int(2, 3);
    const gap = k === 3 ? r.range(0.8, 1.3) : r.range(1.2, 2);
    const tops = k === 3 ? (r.chance(0.5) ? [0, 2.4, 0] : [2.2, 0, 2.2]) : (r.chance(0.5) ? [0, 2.2] : [2.2, 0]);
    const total = k * w + (k - 1) * gap;
    for (let i = 0; i < k; i++) {
      const x = -total / 2 + w / 2 + i * (w + gap);
      const z = k === 3 && i === 1 ? r.range(-1.5, 0) : 0;
      const top = tops[i] + r.range(-0.2, 0.2);
      const p = B.pedestal(x, z, top, w + 0.4, 2.4, spin && i === 1);
      B.build({ x, z, top, w, d: 2, maxH: Math.min(maxHFor(top), 3 + d * 3) }, tpl(['jenga', 'castle']), p);
    }
  } else { // scattered, layered in depth
    const k = r.int(3, 5);
    for (let i = 0; i < k; i++) {
      const x = -SIDE + 1.2 + (i + 0.5) * ((SIDE * 2 - 2.4) / k) + r.range(-0.3, 0.3);
      const z = i % 2 ? r.range(-2.2, -1) : r.range(0, 1);
      const top = r.range(-0.6, 2.8 - (airCount ? 0.8 : 0));
      const p = B.pedestal(x, z, top, 1.5, 1.5, spin && r.chance(0.4));
      B.build({ x, z, top, w: 1.2, d: 1.2, maxH: Math.min(maxHFor(top), r.int(2, 4 + Math.round(d * 2))) }, r.pick(['tallStack', 'spire', 'tallStack', 'skyline']), p);
    }
  }

  let killY = Infinity;
  for (const p of B.pedestals) killY = Math.min(killY, p.y - 2.2);
  // pedestal columns occupy space below them
  for (const p of B.pedestals) B.occ.push({ x0: p.x - p.w / 2, x1: p.x + p.w / 2, y0: killY - 5, y1: p.y });

  /* ---- boss ---- */
  let topY = 0;
  for (const b of B.blocks) topY = Math.max(topY, b.y + b.h / 2);
  if (boss) addBoss(B, bk, n, topY);

  /* ---- platform modifiers ---- */
  const main = B.pedestals.filter((p) => p.w > 1.3);
  if (spin) {
    for (const p of B.pedestals) if (p.round) p.spin = { w: r.range(0.3 + d * 0.35, 0.5 + d * 0.7) * (r.chance(0.5) ? 1 : -1) };
    if (!B.pedestals.some((p) => p.spin) && main.length) { const p = main[0]; p.round = true; p.spin = { w: r.range(0.35, 0.8) }; }
  }
  if ((feats.has('moving') || feats.has('elevator')) && main.length) {
    const p = r.pick(main.filter((q) => !q.spin).length ? main.filter((q) => !q.spin) : main);
    if (feats.has('moving')) {
      let room = Math.min(SIDE + 1 - (p.x + p.w / 2), p.x - p.w / 2 + SIDE + 1);
      for (const q of B.pedestals) if (q !== p) {
        const gl = p.x - p.w / 2 - (q.x + q.w / 2), gr = q.x - q.w / 2 - (p.x + p.w / 2);
        if (gl > -0.01) room = Math.min(room, gl - 1.1);
        if (gr > -0.01) room = Math.min(room, gr - 1.1);
      }
      const A = Math.min(r.range(0.8, 1.8), room);
      if (A >= 0.4) p.move = { ax: A, ay: 0, w: r.range(0.5, 0.9 + d * 0.4) };
    } else {
      p.move = { ax: 0, ay: r.range(0.5, 1.1), w: r.range(0.6, 1.1) };
    }
  }
  if (feats.has('rock')) {
    const p = r.pick(main.filter((q) => !q.move && !q.spin)) || null;
    if (p) p.rock = { amp: r.range(0.05, 0.09), w: r.range(0.5, 0.8) };
  }

  /* ---- air gimmicks ---- */
  const yMaxAir = MAX_H + 0.6;
  if (feats.has('orbit') && B.sites.length) {
    // a ring of blocks circling around a structure (passes in front of it)
    const s = r.pick(B.sites);
    const bb = s.bounds;
    const cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2;
    const R = Math.hypot(bb.x1 - bb.x0, bb.z1 - bb.z0) / 2 + 0.9;
    const cy = r.range(bb.y0 + 0.8, Math.max(bb.y0 + 0.9, bb.y1 - 0.4));
    let ok = cx - R > -SIDE - 1.2 && cx + R < SIDE + 1.2;
    for (const o of B.sites) if (o !== s && Math.abs((o.bounds.x0 + o.bounds.x1) / 2 - cx) < R + 0.8) ok = false;
    if (ok) {
      const cnt = clamp(Math.floor((2 * Math.PI * R) / 1.7), 4, 10);
      const speed = r.range(0.4 + d * 0.3, 0.7 + d * 0.6) * (r.chance(0.5) ? 1 : -1);
      const items = [];
      for (let i = 0; i < cnt; i++) items.push({ a: (i / cnt) * Math.PI * 2, r: R, w: 0.85, h: 0.85, d: 0.85, type: 'normal' });
      B.orbits.push({ cx, cy, cz, speed, items, horizontal: true });
    }
  }
  if (feats.has('rotor')) {
    const armsLen = r.int(2, 2 + Math.round(d));
    const R = 0.5 + armsLen * 0.95 + 0.2;
    const spot = B.freeSpot(R, 0.4, yMaxAir + 0.8);
    if (spot) {
      const arms = r.pick([2, 3, 4, 4]);
      const speed = r.range(0.5, 0.9 + d * 0.5) * (r.chance(0.5) ? 1 : -1);
      const items = [];
      for (let a = 0; a < arms; a++) for (let k = 0; k < armsLen; k++)
        items.push({ a: (a / arms) * Math.PI * 2, r: 0.62 + k * 0.95 + 0.45, w: 0.9, h: 0.9, d: 0.9, type: 'normal' });
      B.orbits.push({ cx: spot.x, cy: spot.y, cz: 0, speed, items, hub: true });
    }
  }
  if (feats.has('spinner')) {
    const cnt = r.chance(0.3 + d * 0.3) ? 2 : 1;
    for (let i = 0; i < cnt; i++) {
      const len = r.range(2.4, 3.6);
      const spot = B.freeSpot(len / 2 + 0.1, 0, yMaxAir + 0.6, (x, y) => -Math.abs(y - 2.5) + r.f());
      if (spot) B.spinners.push({ x: spot.x, y: spot.y, z: 0.8, len, th: 0.3, speed: r.range(0.7, 1.4) * (r.chance(0.5) ? 1 : -1), a0: r.range(0, 3.14) });
    }
  }
  if (feats.has('tether')) {
    const cnt = r.int(1, 2 + Math.round(d));
    for (let i = 0; i < cnt; i++) {
      const chain = r.int(1, 2 + Math.round(d));
      const L = r.range(1, 2.4);
      const ay = yMaxAir + 0.6;
      const ax = r.range(-SIDE + 0.8, SIDE - 0.8);
      const box = { x0: ax - 0.7, x1: ax + 0.7, y0: ay - L - chain * 1.3, y1: ay };
      if (box.y0 < killY + 2) continue;
      if (B.occ.some((o) => overlapXY(box, o, 0.3))) continue;
      B.occ.push(box);
      const idx = [];
      let y = ay - L;
      for (let k = 0; k < chain; k++) {
        B.blocks.push({ x: ax, y: y - 0.5, z: 0, w: U, h: U, d: U, shape: 'box', type: 'normal', tethered: true });
        idx.push(B.blocks.length - 1);
        y -= 1.3;
      }
      B.tethers.push({ ax, ay, az: 0, L, idx });
    }
  }
  if (feats.has('float')) {
    const cnt = r.int(2, 3 + Math.round(d * 2));
    const span = cnt * 1.3;
    const spot = B.freeSpot(Math.max(span / 2, 1), 0.5, yMaxAir);
    if (spot) {
      const form = r.int(0, 2);
      for (let i = 0; i < cnt; i++) {
        const fx = spot.x - span / 2 + 0.65 + i * 1.3;
        const fy = spot.y + (form === 1 ? Math.abs(i - (cnt - 1) / 2) * 0.4 - 0.4 : form === 2 ? (i % 2) * 0.5 - 0.25 : 0);
        B.blocks.push({ x: fx, y: fy, z: r.range(-0.4, 0.6), w: 0.9, h: 0.9, d: 0.9, shape: 'box', type: 'normal', float: true });
      }
    }
  }
  if (feats.has('shield') && B.sites.length) {
    const s = B.sites.reduce((a, b) => (b.blocks.length > a.blocks.length ? b : a));
    const bb = s.bounds;
    const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2, cz = (bb.z0 + bb.z1) / 2;
    const rad = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0, bb.z1 - bb.z0) / 2 * 1.1 + 0.6;
    const gens = [];
    const gcount = r.chance(0.35 + d * 0.3) ? 2 : 1;
    for (let i = 0; i < gcount; i++) {
      const spot = B.freeSpot(0.6, 0, yMaxAir + 0.8, (x, y) => (Math.hypot(x - cx, y - cy) > rad + 0.9 ? r.f() : -1e6));
      if (spot && Math.hypot(spot.x - cx, spot.y - cy) > rad + 0.8) {
        B.blocks.push({ x: spot.x, y: spot.y, z: 0.5, w: 0.8, h: 0.8, d: 0.8, shape: 'gen', type: 'gen', kin: { mode: 'hover', hx: spot.x, hy: spot.y, hz: 0.5, amp: 0.15, ph: r.range(0, 6) } });
        gens.push(B.blocks.length - 1);
      }
    }
    if (gens.length) B.shields.push({ x: cx, y: cy, z: cz, r: rad, gens });
  }

  /* ---- type conversions ---- */
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
  const isCube = (b) => (b.shape === 'box' || b.shape === 'cyl') && b.w >= 0.8;
  if (feats.has('star')) {
    pool.sort((a, b) => b.y - a.y + (r.f() - 0.5) * 3);
    for (const b of take(intro === 'star' ? 1 : r.int(1, 2), isCube)) b.type = 'star';
    shuffle(pool);
  }
  if (feats.has('bomb')) for (const b of take(intro === 'bomb' ? 1 : r.int(1, 2), isCube)) b.type = 'bomb';
  if (feats.has('armor')) {
    const frac = intro === 'armor' ? 0.3 : r.range(0.08 + d * 0.15, 0.2 + d * 0.3);
    for (const b of take(Math.max(1, Math.round(structural.length * frac)))) { b.type = 'armor'; b.hp = r.chance(d * 0.7) ? 3 : 2; }
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
    for (const s of B.sites) {
      const cands = s.blocks.filter((b) => b.type === 'normal' && isCube(b)).sort((a, b) => b.y - a.y);
      for (const b of cands.slice(0, intro === 'steel' ? 2 : r.int(1, 2))) b.type = 'steel';
    }
  }
  let targets = B.blocks.filter((b) => b.type !== 'steel').length;
  for (const o of B.orbits) if (!o.steel) targets += o.items.length;
  if (targets === 0) for (const b of B.blocks) if (b.type === 'steel') { b.type = 'normal'; break; }

  const gravity = feats.has('lowgrav') ? r.range(0.42, 0.55) : 1;
  const sector = Math.floor((n - 1) / 50);
  return {
    n, variant, sector, sectorName: SECTORS[sector][0], hue: SECTORS[sector][1],
    gravity, boss, bossKind: bk, bossName: bk ? BOSSES[bk].name : null, intro, feats: [...feats],
    pedestals: B.pedestals, blocks: B.blocks, orbits: B.orbits, spinners: B.spinners,
    tethers: B.tethers, shields: B.shields, killY, lasers: 12, templates: B.sites.map((q) => q.tname || 'bridge'),
  };
}

/* ----------------------------------------------------------- Camera fit */
// Shared by the game and the validation bot so both "see" the stage the same way.
export function stageBounds(st) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const add = (a, b, c, d, e, f) => { x0 = Math.min(x0, a); x1 = Math.max(x1, b); y0 = Math.min(y0, c); y1 = Math.max(y1, d); z0 = Math.min(z0, e); z1 = Math.max(z1, f); };
  for (const b of st.blocks) { const m = Math.max(b.w, b.d) / 2; add(b.x - m, b.x + m, b.y - b.h / 2, b.y + b.h / 2, b.z - m, b.z + m); }
  for (const p of st.pedestals) {
    const ax = p.move ? p.move.ax : 0, ay = p.move ? p.move.ay : 0;
    add(p.x - p.w / 2 - ax, p.x + p.w / 2 + ax, p.y - 1.2, p.y + ay, p.z - p.d / 2, p.z + p.d / 2);
  }
  for (const o of st.orbits) {
    let rr = 0; for (const it of o.items) rr = Math.max(rr, it.r + Math.max(it.w, it.h) * 0.7);
    if (o.horizontal) add(o.cx - rr, o.cx + rr, o.cy - 0.6, o.cy + 0.6, o.cz - rr, o.cz + rr);
    else add(o.cx - rr, o.cx + rr, o.cy - rr, o.cy + rr, o.cz - 1, o.cz + 1);
  }
  for (const s of st.spinners) add(s.x - s.len / 2, s.x + s.len / 2, s.y - s.len / 2, s.y + s.len / 2, s.z - 0.3, s.z + 0.3);
  for (const t of st.tethers) add(t.ax - 0.5, t.ax + 0.5, t.ay - 0.2, t.ay + 0.2, -0.5, 0.5);
  for (const s of st.shields) add(s.x - s.r, s.x + s.r, s.y - s.r, s.y + s.r, s.z - s.r, s.z + s.r);
  return { x0, x1, y0, y1, z0, z1 };
}
// returns camera {pos, target, fov} framing the stage for a given aspect (w/h)
export function cameraFor(st, aspect) {
  const b = stageBounds(st);
  const fov = 42;
  const t = Math.tan((fov * Math.PI) / 360);
  const elev = 0.14;                                  // nearly head-on, just a little above (like the reference)
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const hw = (b.x1 - b.x0) / 2 + 0.6, hh = (b.y1 - b.y0) / 2 + 0.4;
  // leave room for the HUD on top and the turret at the bottom
  const distH = (hh * 1.55) / t;
  const distW = hw / (t * aspect);
  const dist = Math.max(distH, distW, 7) + (b.z1 - b.z0) / 2;
  const cy = (b.y0 + b.y1) / 2 - hh * 0.12;
  return {
    fov,
    target: { x: cx, y: cy, z: cz },
    pos: { x: cx, y: cy + Math.sin(elev) * dist, z: cz + Math.cos(elev) * dist },
  };
}

/* ------------------------------------------------------------ Simulation */
export const SIM_OPTS = { iter: 24, friction: 0.42, blastK: 2, pierce: 16, pierceDepth: 3.5, column: 2 };
const DENS = { normal: 1, star: 1, bomb: 1.1, armor: 2.4, steel: 3.5, crystal: 0.8, phase: 1, gen: 1, core: 3 };
const V = (x, y, z) => new CANNON.Vec3(x, y, z);

export class Sim {
  constructor(stage, opts) {
    opts = opts || {};
    this.stage = stage;
    this.rand = opts.rand || Math.random;
    const g = GRAVITY * stage.gravity;
    const world = (this.world = new CANNON.World({ gravity: V(0, -g, 0) }));
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.solver.iterations = SIM_OPTS.iter;
    world.defaultContactMaterial.friction = SIM_OPTS.friction;
    world.defaultContactMaterial.restitution = 0.06;
    world.defaultContactMaterial.contactEquationRelaxation = 3;
    const moving = stage.pedestals.some((p) => p.spin || p.move || p.rock) || stage.orbits.length || stage.blocks.some((b) => b.float);
    world.allowSleep = !moving;
    this.g = g;
    this.t = 0; this.stepN = 0;
    this.events = [];
    this.lasers = stage.lasers; this.shots = 0;
    this.score = 0; this.combo = 0; this.lastScoreT = -10;
    this.bodies = []; this.targets = []; this.kin = []; this.floats = [];
    this.tethers = []; this.shields = [];
    this.lastShotStep = -9999; this.calm = 0;
    this.killY = stage.killY;
    this.state = 'play';
    this._queue = []; this._breaks = [];
    this._nextId = 1;
    this._build();
  }

  _meta(body, lb) {
    lb.id = this._nextId++;
    lb.alive = true; lb.cleared = false; lb.removed = false;
    body.lb = lb;
    this.bodies.push(body);
    if (lb.target) this.targets.push(body);
    this.world.addBody(body);
    return body;
  }

  _shapeFor(s) {
    if (s.shape === 'orb') return new CANNON.Sphere(s.w / 2);
    // 'cyl' pillars use box physics: stacked cylinders jitter badly in cannon-es
    if (s.shape === 'gen') return new CANNON.Cylinder(s.w / 2, s.w / 2, s.h, 6);
    if (s.shape === 'core') return new CANNON.Sphere(s.w / 2);
    return new CANNON.Box(V(s.w / 2, s.h / 2, s.d / 2));
  }

  _makeBlock(s) {
    const vol = s.shape === 'orb' || s.shape === 'core' ? 0.52 * s.w * s.w * s.w : s.w * s.h * s.d;
    const mass = vol * (DENS[s.type] || 1);
    const b = new CANNON.Body({ mass, shape: this._shapeFor(s), position: V(s.x, s.y, s.z), linearDamping: s.float ? 0.4 : 0.02, angularDamping: 0.05 });
    b.sleepSpeedLimit = 0.12; b.sleepTimeLimit = 0.5;
    if (s.rotY) b.quaternion.setFromAxisAngle(V(0, 1, 0), s.rotY);
    const hp = s.hp || (s.type === 'armor' ? 2 : 1);
    const lb = {
      kind: s.type === 'steel' ? 'steel' : 'block', type: s.type, shape: s.shape, w: s.w, h: s.h, d: s.d,
      target: s.type !== 'steel', hp, maxHp: hp, hueShift: this.rand(), site: s.site === undefined ? -1 : s.site,
      home: { x: s.x, y: s.y, z: s.z }, mass,
    };
    if (s.type === 'phase') lb.phOff = s.phOff || 0;
    this._meta(b, lb);
    if (s.float) { lb.float = { on: true, hx: s.x, hy: s.y, hz: s.z, ph: this.rand() * 6.28 }; this.floats.push(b); }
    if (s.kin) {
      b.type = CANNON.Body.KINEMATIC; b.mass = 0; b.updateMassProperties();
      lb.kin = Object.assign({}, s.kin);
      this.kin.push(b);
    }
    b.addEventListener('collide', (e) => this._onCollide(b, e));
    return b;
  }

  _build() {
    const st = this.stage;
    for (const p of st.pedestals) {
      const shape = p.round ? new CANNON.Cylinder(p.w / 2, p.w / 2, p.h, 24) : new CANNON.Box(V(p.w / 2, p.h / 2, p.d / 2));
      const kinm = p.spin || p.move || p.rock;
      const b = new CANNON.Body({ mass: 0, shape, position: V(p.x, p.y - p.h / 2, p.z), type: kinm ? CANNON.Body.KINEMATIC : CANNON.Body.STATIC });
      b.updateMassProperties();
      this._meta(b, { kind: 'platform', type: 'platform', w: p.w, h: p.h, d: p.d, round: p.round, target: false, spec: p });
      if (kinm) {
        b.lb.kin = { mode: p.spin ? 'spin' : p.move ? 'move' : 'rock', x0: p.x, y0: p.y - p.h / 2, z0: p.z, spec: p.spin || p.move || p.rock, ang: 0 };
        this.kin.push(b);
      }
    }
    const created = st.blocks.map((s) => this._makeBlock(s));
    for (const o of st.orbits) {
      if (o.hub) {
        const hub = new CANNON.Body({ mass: 0, shape: new CANNON.Sphere(0.4), position: V(o.cx, o.cy, o.cz) });
        this._meta(hub, { kind: 'hub', type: 'hub', w: 0.8, h: 0.8, d: 0.8, target: false, orbit: o });
      }
      for (const it of o.items) {
        const p = this._orbitPos(o, it.a, it.r);
        const s = { x: p.x, y: p.y, z: p.z, w: it.w, h: it.h, d: it.d, shape: it.type === 'steel' ? 'bar' : 'box', type: it.type };
        s.kin = { mode: 'orbit', o, a0: it.a, r: it.r, release: !o.steel };
        const b = this._makeBlock(s);
        this._setOrbitPose(b, 0);
      }
    }
    for (const s of st.spinners) {
      const b = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, shape: new CANNON.Box(V(s.len / 2, s.th / 2, s.th / 2)), position: V(s.x, s.y, s.z) });
      b.quaternion.setFromAxisAngle(V(0, 0, 1), s.a0);
      b.angularVelocity.set(0, 0, s.speed);
      this._meta(b, { kind: 'spinner', type: 'spinner', w: s.len, h: s.th, d: s.th, target: false });
    }
    for (const t of st.tethers) {
      const anchor = new CANNON.Body({ mass: 0, position: V(t.ax, t.ay, t.az) });
      this.world.addBody(anchor);
      let prev = anchor, prevLen = t.L + 0.5;
      for (const i of t.idx) {
        const b = created[i];
        const c = new CANNON.DistanceConstraint(prev, b, prevLen, 1e4);
        c.lb = { id: this._nextId++, alive: true, a: prev, b, anchor: prev === anchor };
        this.world.addConstraint(c);
        this.tethers.push(c);
        prev = b; prevLen = 1.3;
      }
    }
    for (const s of st.shields) this.shields.push({ x: s.x, y: s.y, z: s.z, r: s.r, gens: s.gens.map((i) => created[i]), active: true, hitT: -10 });
    this.targetsTotal = this.targets.length;
    this.targetsLeft = this.targets.length;
  }

  _orbitPos(o, a, r) {
    if (o.horizontal) return { x: o.cx + Math.cos(a) * r, y: o.cy, z: o.cz + Math.sin(a) * r };
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    const tz = o.tilt || 0;
    return { x: o.cx + x * Math.cos(tz), y: o.cy + y, z: o.cz + x * Math.sin(tz) };
  }
  _setOrbitPose(b, t) {
    const k = b.lb.kin, o = k.o;
    const a = k.a0 + o.speed * t;
    const p = this._orbitPos(o, a, k.r);
    const pn = this._orbitPos(o, a + o.speed / 60, k.r);
    b.position.set(p.x, p.y, p.z);
    b.velocity.set((pn.x - p.x) * 60, (pn.y - p.y) * 60, (pn.z - p.z) * 60);
    if (o.horizontal) { b.quaternion.setFromAxisAngle(V(0, 1, 0), -a); b.angularVelocity.set(0, -o.speed, 0); }
    else { b.quaternion.setFromAxisAngle(V(0, 0, 1), a); b.angularVelocity.set(0, 0, o.speed); }
  }

  isPhased(b) {
    if (b.lb.type !== 'phase') return false;
    return ((this.t + b.lb.phOff) % 3.4) / 3.4 > 0.55;
  }
  phaseLevel(b) {
    const p = ((this.t + b.lb.phOff) % 3.4) / 3.4;
    if (p < 0.5) return 0;
    if (p < 0.55) return (p - 0.5) / 0.05;
    if (p < 0.95) return 1;
    return 1 - (p - 0.95) / 0.05;
  }
  inShield(p) {
    for (const s of this.shields) if (s.active && (p.x - s.x) ** 2 + (p.y - s.y) ** 2 + (p.z - s.z) ** 2 < s.r * s.r) return s;
    return null;
  }

  _kinUpdate() {
    const t = this.t, dt = 1 / 60;
    for (const b of this.kin) {
      const k = b.lb.kin;
      if (!k || !b.lb.alive || b.type !== CANNON.Body.KINEMATIC) continue;
      if (k.mode === 'orbit') this._setOrbitPose(b, t);
      else if (k.mode === 'hover') {
        const y = k.hy + Math.sin(t * 1.7 + k.ph) * k.amp;
        const yn = k.hy + Math.sin((t + dt) * 1.7 + k.ph) * k.amp;
        b.position.set(k.hx, y, k.hz); b.velocity.set(0, (yn - y) / dt, 0);
        b.angularVelocity.set(0, 0.8, 0);
      } else if (k.mode === 'spin') {
        b.angularVelocity.set(0, k.spec.w * ramp(t), 0);
      } else if (k.mode === 'move') {
        const s = k.spec;
        const f = (tt) => Math.sin(tt * s.w) * ramp(tt);
        const v0 = f(t), v1 = f(t + dt);
        b.position.set(k.x0 + s.ax * v0, k.y0 + s.ay * v0, k.z0);
        b.velocity.set((s.ax * (v1 - v0)) / dt, (s.ay * (v1 - v0)) / dt, 0);
      } else if (k.mode === 'rock') {
        const s = k.spec;
        const f = (tt) => s.amp * Math.sin(tt * s.w) * ramp(tt);
        const a0 = f(t), a1 = f(t + dt);
        b.quaternion.setFromAxisAngle(V(0, 0, 1), a0);
        b.angularVelocity.set(0, 0, (a1 - a0) / dt);
      }
    }
    for (const b of this.floats) {
      const f = b.lb.float;
      if (!f.on || !b.lb.alive) continue;
      const hy = f.hy + Math.sin(t * 1.8 + f.ph) * 0.15;
      const v = b.velocity, p = b.position;
      v.x += (-(p.x - f.hx) * 14 - v.x * 3) * dt;
      v.y += (-(p.y - hy) * 14 - v.y * 3) * dt + this.g * dt;
      v.z += (-(p.z - f.hz) * 14 - v.z * 3) * dt;
      b.angularVelocity.scale(0.92, b.angularVelocity);
    }
  }

  _onCollide(b, e) {
    if (this.stepN < 45) return;
    const L = b.lb;
    if (!L || !L.alive) return;
    const other = e.body;
    const iv = Math.abs(e.contact.getImpactVelocityAlongNormal());
    if (iv > 5.5 && other && other.lb && this._impactsThisStep < 5) {
      const ri = e.contact.bi === b ? e.contact.ri : e.contact.rj;
      this.events.push({ t: 'impact', x: b.position.x + ri.x, y: b.position.y + ri.y, z: b.position.z + ri.z, v: iv, body: b });
      this._impactsThisStep++;
    }
    if (!L.target || b.type !== CANNON.Body.DYNAMIC) return;
    const limit = L.type === 'crystal' ? 5 : L.type === 'armor' ? 15 : L.type === 'core' || L.type === 'gen' ? 1e9 : 10.5;
    if (iv > limit) this._breaks.push(b);
  }

  step() {
    this.t += 1 / 60; this.stepN++;
    this._impactsThisStep = 0;
    this._kinUpdate();
    this.world.step(1 / 60);
    if (this._breaks.length) {
      const list = this._breaks; this._breaks = [];
      for (const c of list) this.damage(c, c.lb.type === 'crystal' ? 99 : 1, c.lb.type === 'crystal' ? 'crystal' : 'impact');
      this._flush();
    }
    for (const s of this.shields) {
      if (s.active && !s.gens.some((g) => g.lb.alive)) { s.active = false; this.events.push({ t: 'shieldDown', x: s.x, y: s.y, z: s.z, r: s.r }); }
    }
    let maxV = 0;
    for (const b of this.bodies) {
      const L = b.lb;
      if (L.removed) continue;
      const p = b.position;
      if (L.target && L.alive && !L.cleared && (p.y < this.killY || Math.abs(p.x) > 16 || Math.abs(p.z) > 16)) {
        L.cleared = true; this.targetsLeft--;
        const pts = this._addScore(150);
        this.events.push({ t: 'fall', body: b, x: p.x, y: Math.max(p.y, this.killY), z: p.z, pts, combo: this.combo });
        if (L.type === 'star') this._bonus(b, 2);
        this._detachTethers(b);
      }
      if (p.y < this.killY - 22 || Math.abs(p.x) > 40 || Math.abs(p.z) > 40) {
        L.removed = true; L.alive = false;
        this.world.removeBody(b);
        continue;
      }
      if (b.type === CANNON.Body.DYNAMIC && L.alive && !L.cleared && b.sleepState !== CANNON.Body.SLEEPING) {
        const v = b.velocity.length() + b.angularVelocity.length() * 0.5;
        if (v > maxV) maxV = v;
      }
    }
    this.calm = maxV < 0.25 ? this.calm + 1 : 0;
    if (this.state === 'play') {
      if (this.targetsLeft <= 0) { this.state = 'clear'; this.events.push({ t: 'clear' }); }
      else if (this.lasers <= 0) {
        const since = this.stepN - this.lastShotStep;
        if (since > 45 && (this.calm > 50 || since > 330)) { this.state = 'fail'; this.events.push({ t: 'fail' }); }
      }
    }
  }

  _addScore(base) {
    if (this.t - this.lastScoreT < 1.1) this.combo = Math.min(this.combo + 1, 99); else this.combo = 1;
    this.lastScoreT = this.t;
    const pts = base * this.combo;
    this.score += pts;
    return pts;
  }
  _bonus(b, n) { this.lasers += n; this.events.push({ t: 'bonus', n, x: b.position.x, y: b.position.y, z: b.position.z }); }
  _detachTethers(b) {
    for (const c of this.tethers) {
      if (!c.lb.alive) continue;
      if (c.lb.a === b || c.lb.b === b) { c.lb.alive = false; this.world.removeConstraint(c); }
    }
  }
  tetherPoints(c) {
    const a = c.lb.a.position, b = c.lb.b.position;
    const top = { x: b.x, y: b.y + 0.5, z: b.z };
    return [{ x: a.x, y: a.y - (c.lb.anchor ? 0 : 0.5), z: a.z }, top];
  }

  _release(b) {
    const k = b.lb.kin;
    if (!k || !k.release || b.type !== CANNON.Body.KINEMATIC) return;
    b.type = CANNON.Body.DYNAMIC;
    b.mass = b.lb.mass; b.updateMassProperties();
    b.wakeUp();
    b.lb.kin = null;
    this.events.push({ t: 'release', x: b.position.x, y: b.position.y, z: b.position.z });
  }

  damage(b, amt, cause) {
    const L = b.lb;
    if (!L.alive || !L.target) return;
    L.hp -= amt;
    L.hitT = this.t;
    if (L.hp <= 0) { if (!L.dying) { L.dying = true; this._queue.push([b, cause]); } }
    else this.events.push({ t: 'crack', body: b, x: b.position.x, y: b.position.y, z: b.position.z });
  }
  _flush() {
    let guard = 0;
    while (this._queue.length && guard++ < 400) { const [b, c] = this._queue.shift(); this._destroy(b, c); }
  }
  _destroy(b, cause) {
    const L = b.lb;
    if (!L.alive) return;
    L.alive = false; L.removed = true;
    const wasCounted = L.cleared;
    if (L.target && !L.cleared) { L.cleared = true; this.targetsLeft--; }
    this._detachTethers(b);
    this.world.removeBody(b);
    const pos = { x: b.position.x, y: b.position.y, z: b.position.z };
    const pts = wasCounted ? 0 : this._addScore(L.type === 'core' ? 3000 : L.type === 'bomb' ? 300 : L.type === 'gen' ? 500 : 100);
    this.events.push({ t: 'destroy', body: b, x: pos.x, y: pos.y, z: pos.z, cause, pts, combo: this.combo });
    if (L.type === 'star' && !wasCounted) this._bonus(b, 2);
    if (L.type === 'bomb') {
      this.events.push({ t: 'bomb', x: pos.x, y: pos.y, z: pos.z });
      this.blast(pos, 4, 15, b, 'bomb');
      for (const o of this.bodies) {
        if (!o.lb.alive || !o.lb.target || o === b) continue;
        if (o.position.distanceTo(b.position) < 2.1 && !this.isPhased(o)) this.damage(o, 1, 'bomb');
      }
    } else if (L.type === 'core') {
      this.events.push({ t: 'coreDown', x: pos.x, y: pos.y, z: pos.z });
      this.blast(pos, 8, 17, b, 'core');
      for (const o of this.bodies) {
        const ko = o.lb.kin && o.lb.kin.o;
        if (o.lb.alive && ko && o.lb.kin.mode === 'orbit' && o.lb.type === 'steel' && Math.hypot(ko.cx - pos.x, ko.cy - pos.y, ko.cz - pos.z) < 1.5) { o.lb.kin.release = true; this._release(o); }
      }
    } else if (L.type === 'gen') this.blast(pos, 1.6, 5, b, 'gen');
    else if (cause === 'impact') this.blast(pos, 1.5, 5.5, b, 'destroy');
    else this.blast(pos, 2.1, 8.5, b, 'destroy', cause === 'laser' ? this._rayDir : null);
  }

  // radial shockwave; `push` optionally adds a directional shove (the laser direction)
  blast(p, R, K, exclude, kind, push) {
    this.events.push({ t: 'blast', x: p.x, y: p.y, z: p.z, r: R, kind });
    for (const b of this.bodies) {
      const L = b.lb;
      if (!L.alive || b === exclude) continue;
      if (L.kind === 'platform' || L.kind === 'spinner' || L.kind === 'hub') continue;
      if (this.isPhased(b)) continue;
      if (this.inShield(b.position) && !this.inShield(p)) continue;
      const dx = b.position.x - p.x, dy = b.position.y - p.y, dz = b.position.z - p.z;
      const dist = Math.hypot(dx, dy, dz);
      let f = dist < R ? 1 - dist / R : 0;
      // directional shots also carry the stack standing above the impact, so it moves as one chunk
      if (push && dy > -0.4) {
        const hd = Math.hypot(dx, dz), cw = R * 0.85;
        if (hd < cw) f = Math.max(f, SIM_OPTS.column * (1 - hd / cw) * Math.max(0.6, 1 - dy / 12));
      }
      if (f <= 0) continue;
      if (b.type === CANNON.Body.KINEMATIC) {
        if (L.kin && L.kin.release && dist < R * 0.75) this._release(b);
        else continue;
      }
      if (b.type === CANNON.Body.STATIC) continue;
      let nx = dist < 1e-3 ? 0 : dx / dist, ny = dist < 1e-3 ? 1 : dy / dist, nz = dist < 1e-3 ? 0 : dz / dist;
      // a coherent shove along the beam moves a packed chunk as one piece (radial pushes cancel inside a stack)
      if (push) { nx = nx * 0.3 + push.x; ny = ny * 0.3 + push.y; nz = nz * 0.3 + push.z; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; }
      const mf = clamp(Math.sqrt(1 / L.mass), 0.3, 1.25);
      const s = K * SIM_OPTS.blastK * f * mf;
      b.wakeUp();
      b.velocity.x += nx * s; b.velocity.y += ny * s + 2.6 * f * mf; b.velocity.z += nz * s;
      // tumble away from the blast
      b.angularVelocity.x += (-nz * 3 + (this.rand() - 0.5) * 2) * f * mf;
      b.angularVelocity.z += (nx * 3 + (this.rand() - 0.5) * 2) * f * mf;
      b.angularVelocity.y += (this.rand() - 0.5) * 2 * f;
    }
  }

  // ray query: nearest valid body along the ray (skipping phased blocks)
  raycast(o, dir, maxD) { return this.raycastList(o, dir, maxD)[0] || null; }
  // every valid body along the ray, nearest first (one entry per body)
  raycastList(o, dir, maxD) {
    const from = V(o.x, o.y, o.z), to = V(o.x + dir.x * maxD, o.y + dir.y * maxD, o.z + dir.z * maxD);
    const seen = new Map();
    this.world.raycastAll(from, to, { skipBackfaces: true }, (res) => {
      const b = res.body;
      if (!b || !b.lb || !b.lb.alive || b.lb.removed || this.isPhased(b)) return;
      const e = seen.get(b);
      if (!e || res.distance < e.dist) seen.set(b, { body: b, dist: res.distance, p: { x: res.hitPointWorld.x, y: res.hitPointWorld.y, z: res.hitPointWorld.z } });
    });
    return [...seen.values()].sort((a, b) => a.dist - b.dist);
  }
  // the beam drills on: blocks behind the one hit get shoved along the beam
  _pierce(list, dir) {
    const first = list[0];
    let n = 0;
    for (let i = 1; i < list.length && n < 4; i++) {
      const h = list[i], b = h.body, L = b.lb;
      if (h.dist - first.dist > SIM_OPTS.pierceDepth) break;
      if (!L.target && L.kind !== 'steel') break;          // pedestals / spinners stop the beam
      if (b.type !== CANNON.Body.DYNAMIC) continue;
      const f = 1 - (h.dist - first.dist) / (SIM_OPTS.pierceDepth + 0.5);
      const mf = clamp(Math.sqrt(1 / L.mass), 0.3, 1.2);
      const k = SIM_OPTS.pierce * f * mf;
      b.wakeUp();
      b.velocity.x += dir.x * k; b.velocity.y += dir.y * k + 1.5 * f; b.velocity.z += dir.z * k;
      b.angularVelocity.x += -dir.z * 4 * f; b.angularVelocity.z += dir.x * 4 * f;
      n++;
    }
  }

  // Fire along a ray from `o` in direction `dir` (unit). `plane` is the fallback depth for empty shots.
  fire(o, dir) {
    if (this.lasers <= 0 || this.state !== 'play') return false;
    this.lasers--; this.shots++; this.lastShotStep = this.stepN;
    this._rayDir = dir;
    const hits = this.raycastList(o, dir, 120);
    const hit = hits[0] || null;
    // tether cut: closest approach between the ray and each tether segment
    let tc = null, tcDist = Infinity;
    for (const c of this.tethers) {
      if (!c.lb.alive) continue;
      const [a, b] = this.tetherPoints(c);
      const r = raySegDist(o, dir, a, b);
      if (r.d < 0.28 && r.t < tcDist) { tcDist = r.t; tc = c; }
    }
    // shield: entering an active dome before the hit absorbs the shot
    for (const s of this.shields) {
      if (!s.active) continue;
      const tIn = raySphere(o, dir, s);
      if (tIn !== null && (!hit || hit.dist > tIn)) {
        const p = { x: o.x + dir.x * tIn, y: o.y + dir.y * tIn, z: o.z + dir.z * tIn };
        s.hitT = this.t; s.hitP = p;
        this.events.push({ t: 'laser', ...p, result: 'shield' });
        this.events.push({ t: 'shieldHit', ...p, s });
        return true;
      }
    }
    if (tc && (!hit || tcDist < hit.dist)) {
      const p = { x: o.x + dir.x * tcDist, y: o.y + dir.y * tcDist, z: o.z + dir.z * tcDist };
      tc.lb.alive = false; this.world.removeConstraint(tc);
      this.events.push({ t: 'laser', ...p, result: 'cut' });
      this.events.push({ t: 'cut', ...p });
      return true;
    }
    if (hit) {
      const L = hit.body.lb, p = hit.p;
      if (!L.target) {
        this.events.push({ t: 'laser', ...p, result: 'deflect' });
        this.events.push({ t: 'deflect', ...p });
        this.blast(p, 1.6, 5, null, 'deflect', dir);
        return true;
      }
      this.events.push({ t: 'laser', ...p, result: 'hit' });
      if (L.kin && L.kin.release) this._release(hit.body);
      if (L.float && L.float.on) { L.float.on = false; this.events.push({ t: 'floatOff', ...p }); }
      this.events.push({ t: 'hit', ...p, body: hit.body });
      this.damage(hit.body, 1, 'laser');
      this._flush();
      this._pierce(hits, dir);
      if (L.alive) {
        // survived (armor): shove it along the beam
        const b = hit.body;
        if (b.type === CANNON.Body.DYNAMIC) { b.wakeUp(); const mf = clamp(Math.sqrt(1 / L.mass), 0.3, 1.2); b.velocity.x += dir.x * 7 * mf; b.velocity.y += dir.y * 7 * mf + 1; b.velocity.z += dir.z * 7 * mf; }
        this.blast(p, 1.9, 8, b, 'hit', dir);
      }
      return true;
    }
    // empty: detonate where the ray crosses the stage's depth plane
    const pz = this.stage.focusZ || 0;
    let tt = Math.abs(dir.z) > 1e-3 ? (pz - o.z) / dir.z : 20;
    if (!(tt > 0)) tt = 20;
    const p = { x: o.x + dir.x * tt, y: o.y + dir.y * tt, z: o.z + dir.z * tt };
    this.events.push({ t: 'laser', ...p, result: 'empty' });
    this.blast(p, BLAST_R, 10, null, 'empty', dir);
    return true;
  }

  drainEvents() { const e = this.events; this.events = []; return e; }
  stars() {
    const ratio = this.lasers / Math.max(1, this.stage.lasers);
    return ratio >= 0.4 ? 3 : ratio >= 0.2 ? 2 : 1;
  }
}

function raySphere(o, d, s) {
  const ox = o.x - s.x, oy = o.y - s.y, oz = o.z - s.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - s.r * s.r;
  const h = b * b - c;
  if (h < 0) return null;
  const t = -b - Math.sqrt(h);
  return t > 0 ? t : null;
}
function raySegDist(o, d, a, b) {
  // closest distance between ray o + t d and segment a-b
  const ux = d.x, uy = d.y, uz = d.z;
  const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z;
  const wx = o.x - a.x, wy = o.y - a.y, wz = o.z - a.z;
  const A = 1, Bv = ux * vx + uy * vy + uz * vz, C = vx * vx + vy * vy + vz * vz;
  const D = ux * wx + uy * wy + uz * wz, E = vx * wx + vy * wy + vz * wz;
  const den = A * C - Bv * Bv;
  let sc = den > 1e-8 ? (Bv * E - C * D) / den : 0;
  let tc = den > 1e-8 ? (A * E - Bv * D) / den : E / C;
  tc = clamp(tc, 0, 1);
  sc = Math.max(0, -(D - Bv * tc));
  const px = wx + sc * ux - tc * vx, py = wy + sc * uy - tc * vy, pz = wz + sc * uz - tc * vz;
  return { d: Math.hypot(px, py, pz), t: sc };
}

/* ---------------------------------------------------------- Stage table */
let BUDGET = null;
export function setBudget(tab) { BUDGET = tab; }
export function getStage(n) {
  const tab = BUDGET && BUDGET[n - 1];
  const st = generate(n, tab ? tab[0] : 0);
  st.lasers = tab ? tab[1] : 12;
  const b = stageBounds(st);
  st.focusZ = (b.z0 + b.z1) / 2;
  return st;
}

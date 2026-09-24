/* LaserBeam - equipment catalog (100 items) and stat computation */
import { t as tr } from './i18n.js';

export const SLOTS = [
  { id: 'weapon', name: 'WEAPON' },
  { id: 'core', name: 'CORE' },
  { id: 'module', name: 'MODULE' },
  { id: 'color', name: 'COLOR' },
];

export const RARITY = [
  { name: 'COMMON', hue: 200 },
  { name: 'RARE', hue: 210 },
  { name: 'EPIC', hue: 280 },
  { name: 'LEGENDARY', hue: 45 },
  { name: 'MYTHIC', hue: 350 },
];

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
// tier t (1..5): stage requirement and base price
const REQ = [1, 40, 120, 280, 480];
const PRICE = [400, 1200, 3000, 6500, 12000];

// descriptions are translation keys + params: d = [[key, params], ...]
const items = [];
function add(it) { items.push(Object.assign({ rarity: 0, price: 0, req: 1, stats: {} }, it)); }
function tiered(slot, key, name, desc, stats, priceMul, icon, hue) {
  for (let t = 1; t <= 5; t++) {
    add({
      id: `${key}${t}`, slot, name: `${name} Mk-${ROMAN[t - 1]}`, d: desc(t), stats: stats(t),
      rarity: t - 1, price: Math.round((PRICE[t - 1] * priceMul) / 50) * 50, req: REQ[t - 1], icon, hue,
    });
  }
}
const pct = (v) => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;
const D = (k, p) => [[k, p]];
const SPLIT_K = [0.3, 0.38, 0.46, 0.38, 0.5];

/* ------------------------------------------------------------ WEAPON (31) */
add({ id: 'wStd', slot: 'weapon', name: 'STANDARD LASER', d: D('i.std'), icon: 'beam', hue: 190 });
tiered('weapon', 'wPulse', 'PULSE LASER', (t) => D('i.pulse', { v: pct(1 + 0.08 * t) }),
  (t) => ({ blastR: 1 + 0.08 * t, blastK: 1 + 0.08 * t, pierce: 1 + 0.1 * t }), 1, 'beam', 190);
tiered('weapon', 'wPierce', 'PIERCE LASER', (t) => D('i.pierce', { v: pct(1 + 0.6 * t) }),
  (t) => ({ pierce: 1 + 0.6 * t, blastK: 1 + 0.04 * t }), 1, 'pierce', 170);
tiered('weapon', 'wWide', 'WIDE BEAM', (t) => D('i.wide', { v: pct(1 + 0.16 * t) }),
  (t) => ({ blastR: 1 + 0.16 * t }), 1.1, 'wide', 100);
tiered('weapon', 'wHeavy', 'HEAVY CANNON', (t) => D('i.heavy', { v: pct(1 + 0.22 * t) }),
  (t) => ({ blastK: 1 + 0.22 * t }), 1.1, 'heavy', 20);
tiered('weapon', 'wPlasma', 'PLASMA LASER', (t) => [['i.plasma', { x: t >= 4 ? 3 : 2 }], ...(t >= 2 ? [['i.plasmaK', { v: pct(1 + 0.05 * (t - 1)) }]] : [])],
  (t) => ({ dmg: t >= 4 ? 3 : 2, blastK: 1 + 0.05 * (t - 1) }), 1.3, 'plasma', 300);
tiered('weapon', 'wSplit', 'SPLIT LASER', (t) => D(t >= 5 ? 'i.split5' : 'i.split', { n: t >= 4 ? 5 : 3, p: Math.round(SPLIT_K[t - 1] * 100) }),
  (t) => ({ splitN: t >= 4 ? 4 : 2, splitK: SPLIT_K[t - 1], splitDmg: t >= 5 ? 1 : 0 }), 1.8, 'split', 330);

/* -------------------------------------------------------------- CORE (20) */
add({ id: 'cBasic', slot: 'core', name: 'BASIC CORE', d: D('i.basicCore'), icon: 'core', hue: 200 });
tiered('core', 'cCell', 'ENERGY CELL', (t) => D('i.cell', { n: t }), (t) => ({ extra: t }), 1, 'cell', 55);
tiered('core', 'cBoost', 'PT BOOSTER', (t) => D('i.boost', { m: (1 + 0.2 * t).toFixed(1) }), (t) => ({ ptMul: 1 + 0.2 * t }), 0.8, 'coin', 48);
[[1, 'I', 1, 1500, 1, 0], [2, 'II', 2, 5000, 2, 60], [4, 'III', 4, 11000, 3, 200]].forEach(([b, r, rar, price, i, req]) =>
  add({ id: `cMag${i}`, slot: 'core', name: `STAR MAGNET ${r}`, d: D('i.magnet', { n: 2 + b }), stats: { starBonus: b }, rarity: rar, price, req: Math.max(1, req), icon: 'star', hue: 48 }));
[[1, 1.2, 1, 2500, 20], [2, 1.3, 2, 7000, 150], [3, 1.5, 3, 15000, 350]].forEach(([e, m, rar, price, req], i) =>
  add({ id: `cHyb${i + 1}`, slot: 'core', name: `HYBRID CORE ${ROMAN[i]}`, d: D('i.hybrid', { n: e, m }), stats: { extra: e, ptMul: m }, rarity: rar, price, req, icon: 'core', hue: 160 }));
add({ id: 'cLucky', slot: 'core', name: 'LUCKY CORE', d: D('i.lucky'), stats: { starBonus: 2, ptMul: 1.3 }, rarity: 2, price: 4500, req: 100, icon: 'star', hue: 90 });
add({ id: 'cQuantum', slot: 'core', name: 'QUANTUM CELL', d: D('i.quantum'), stats: { extra: 4, starBonus: 2 }, rarity: 3, price: 16000, req: 400, icon: 'cell', hue: 280 });
add({ id: 'cInfinity', slot: 'core', name: 'INFINITY CORE', d: D('i.infinity'), stats: { extra: 7 }, rarity: 4, price: 30000, req: 700, icon: 'core', hue: 350 });

/* ------------------------------------------------------------ MODULE (25) */
add({ id: 'mNone', slot: 'module', name: 'NO MODULE', d: D('i.noModule'), icon: 'none', hue: 220 });
tiered('module', 'mChain', 'CHAIN REACTOR', (t) => D('i.chain', { v: pct(1 + 0.15 * t) }), (t) => ({ chain: 1 + 0.15 * t }), 0.9, 'chain', 15);
[1, 2, 3].forEach((t) => add({ id: `mArmor${t}`, slot: 'module', name: `ARMOR BREAKER ${ROMAN[t - 1]}`, d: D('i.armor', { n: t }), stats: { armorDmg: t }, rarity: t, price: [900, 3200, 8000][t - 1], req: [8, 100, 300][t - 1], icon: 'armor', hue: 205 }));
tiered('module', 'mOver', 'OVERLOAD', (t) => D('i.over', { n: 8 - t }), (t) => ({ overload: 8 - t }), 1, 'over', 0);
tiered('module', 'mRech', 'COMBO RECHARGE', (t) => D('i.rech', { n: [10, 8, 7, 6, 5][t - 1] }), (t) => ({ recharge: [10, 8, 7, 6, 5][t - 1] }), 1.2, 'recharge', 120);
[1, 2, 3].forEach((t) => add({ id: `mAmp${t}`, slot: 'module', name: `SHOCK AMP ${ROMAN[t - 1]}`, d: D('i.wide', { v: pct(1 + 0.1 * t) }), stats: { blastR: 1 + 0.1 * t }, rarity: t - 1, price: [700, 2400, 6000][t - 1], req: [1, 60, 220][t - 1], icon: 'wide', hue: 185 }));
[1, 2, 3].forEach((t) => add({ id: `mDrv${t}`, slot: 'module', name: `IMPACT DRIVER ${ROMAN[t - 1]}`, d: D('i.heavy', { v: pct(1 + 0.1 * t) }), stats: { blastK: 1 + 0.1 * t }, rarity: t - 1, price: [700, 2400, 6000][t - 1], req: [1, 60, 220][t - 1], icon: 'heavy', hue: 30 }));

/* ------------------------------------------------------------- COLOR (24) */
add({ id: 'kSector', slot: 'color', name: 'SECTOR COLOR', d: D('i.sector'), icon: 'color', beam: { mode: 'sector' } });
[['CYAN', 188], ['AZURE', 205], ['BLUE', 228], ['VIOLET', 265], ['MAGENTA', 300], ['PINK', 325], ['CRIMSON', 352], ['ORANGE', 25], ['GOLD', 46], ['LIME', 90], ['EMERALD', 140], ['TEAL', 170]]
  .forEach(([nm, h], i) => add({ id: `k${nm}`, slot: 'color', name: `${nm} BEAM`, d: D('i.hue', { c: nm }), icon: 'color', hue: h, beam: { mode: 'hue', hue: h }, rarity: 0, price: 300 + i * 25 }));
add({ id: 'kIce', slot: 'color', name: 'ICE BEAM', d: D('i.ice'), icon: 'color', hue: 195, beam: { mode: 'hue', hue: 195, sat: 0.35 }, rarity: 1, price: 900 });
add({ id: 'kWhite', slot: 'color', name: 'PURE WHITE', d: D('i.white'), icon: 'color', hue: 0, beam: { mode: 'hue', hue: 0, sat: 0 }, rarity: 1, price: 900 });
const special = [
  ['kFire', 'FIRE BEAM', 'i.fire', { mode: 'cycle', a: 5, b: 50, speed: 6 }, 2, 2500, 30],
  ['kAurora', 'AURORA BEAM', 'i.aurora', { mode: 'cycle', a: 130, b: 285, speed: 1.2 }, 2, 2500, 60],
  ['kSunset', 'SUNSET BEAM', 'i.sunset', { mode: 'cycle', a: 15, b: 330, speed: 1.5 }, 2, 2500, 60],
  ['kToxic', 'TOXIC BEAM', 'i.toxic', { mode: 'cycle', a: 70, b: 110, speed: 4 }, 2, 2500, 90],
  ['kVoid', 'VOID BEAM', 'i.void', { mode: 'cycle', a: 250, b: 290, speed: 2 }, 2, 3000, 120],
  ['kDual', 'NEON DUAL', 'i.dual', { mode: 'alt', a: 188, b: 305 }, 3, 5000, 160],
  ['kGlitch', 'GLITCH BEAM', 'i.glitch', { mode: 'random' }, 3, 6000, 220],
  ['kRainbow', 'RAINBOW BEAM', 'i.rainbow', { mode: 'rainbow', speed: 0.6 }, 4, 12000, 300],
  ['kGalaxy', 'GALAXY BEAM', 'i.galaxy', { mode: 'rainbow', speed: 2.2 }, 4, 20000, 600],
];
for (const [id, name, key, beam, rarity, price, req] of special) add({ id, slot: 'color', name, d: D(key), icon: 'color', hue: beam.a || 300, beam, rarity, price, req });

// localised description of an item
export function itemDesc(it) { return it.d.map(([k, p]) => tr(k, p)).join(''); }

export const CATALOG = items;
export const BY_ID = Object.fromEntries(items.map((i) => [i.id, i]));
export const DEFAULT_EQUIP = { weapon: 'wStd', core: 'cBasic', module: 'mNone', color: 'kSector' };
export const FREE = items.filter((i) => i.price === 0).map((i) => i.id);

// combine the equipped items into the stat block the simulation understands
export function computeGear(equip) {
  const g = { blastR: 1, blastK: 1, pierce: 1, dmg: 1, armorDmg: 0, splitN: 0, splitK: 0.6, splitDmg: 0, extra: 0, starBonus: 0, chain: 1, overload: 0, recharge: 0, ptMul: 1 };
  for (const slot of ['weapon', 'core', 'module']) {
    const it = BY_ID[equip[slot]];
    if (!it) continue;
    for (const [k, v] of Object.entries(it.stats)) {
      if (['blastR', 'blastK', 'pierce', 'chain', 'ptMul'].includes(k)) g[k] *= v;
      else if (['extra', 'starBonus', 'armorDmg'].includes(k)) g[k] += v;
      else g[k] = v;
    }
  }
  return g;
}

// points earned for clearing stage n
export function ptReward(n, stars, score, first, boss, ptMul) {
  let pt = (30 + stars * 20 + score / 400) * (1 + n / 150);
  if (boss) pt *= 2;
  if (!first) pt *= 0.4;
  return Math.round(pt * ptMul);
}

// hue of the next shot for a colour item (sector hue as fallback)
let shotCount = 0;
export function beamHue(colorId, sectorHue, t) {
  const b = (BY_ID[colorId] || BY_ID.kSector).beam;
  shotCount++;
  switch (b.mode) {
    case 'hue': return { h: b.hue, s: b.sat === undefined ? 1 : b.sat };
    case 'cycle': return { h: b.a + (b.b - b.a) * (0.5 + 0.5 * Math.sin(t * b.speed)), s: 1 };
    case 'alt': return { h: shotCount % 2 ? b.a : b.b, s: 1 };
    case 'random': return { h: Math.random() * 360, s: 1 };
    case 'rainbow': return { h: (t * 360 * b.speed) % 360, s: 1 };
    default: return { h: sectorHue, s: 1 };
  }
}

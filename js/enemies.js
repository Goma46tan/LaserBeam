/* LaserBeam - enemy units that attack the player (the turret at the camera).
   Kept separate from stage generation so layouts and laser budgets are unaffected. */
import { makeRng, hash, difficulty, stageBounds, introAt, clamp } from './core3d.js';

export const ENEMY_TYPES = {
  scout:   { hp: 1, r: 0.45, fire: [4.8, 3.2], dmg: [8, 13], speed: 8.5, pts: 200, first: 15 },
  gunship: { hp: 3, r: 0.75, fire: [6.8, 4.8], burst: 3, dmg: [6, 9], speed: 9.5, pts: 400, first: 45 },
  bomber:  { hp: 2, r: 0.8, fire: [8.8, 6.5], missile: true, dmg: [24, 36], speed: 4.6, pts: 500, first: 85 },
  sniper:  { hp: 2, r: 0.55, fire: [8.5, 6], charge: 1.7, dmg: [20, 30], pts: 500, first: 125 },
};
const INTRO = { enemyScout: 'scout', enemyGunship: 'gunship', enemyBomber: 'bomber', enemySniper: 'sniper' };
export const BASE_HULL = 100;

// which enemies a stage has (deterministic, uses its own RNG stream)
export function genEnemies(st, n, variant) {
  if (n < ENEMY_TYPES.scout.first) return [];
  const r = makeRng(hash(n * 7717 + (variant || 0) * 131 + 5));
  const d = difficulty(n);
  const ik = introAt(n);
  const forced = INTRO[ik] || null;
  if (!forced && !r.chance(st.boss ? 0.75 : 0.28 + 0.47 * d)) return [];
  const avail = Object.keys(ENEMY_TYPES).filter((k) => ENEMY_TYPES[k].first <= n);
  const count = forced ? (forced === 'scout' ? 1 : 2) : clamp(1 + Math.floor(r.f() * (1 + d * 3.2)), 1, 4);
  const b = stageBounds(st);
  const x0 = Math.max(b.x0, -5) + 0.7, x1 = Math.min(b.x1, 5) - 0.7;
  const cx = (x0 + x1) / 2, span = Math.max(1.2, (x1 - x0) / 2);
  const yLo = b.y0 + (b.y1 - b.y0) * 0.45, yHi = b.y1 - 0.2;
  const out = [];
  for (let i = 0; i < count; i++) {
    let type = forced && i === 0 ? forced : r.pick(avail);
    if (forced && i > 0) type = r.pick(avail.filter((k) => k !== 'sniper'));
    const side = i % 2 ? 1 : -1;
    out.push({
      type,
      cx: type === 'sniper' ? cx + side * span * 0.9 : cx + r.range(-span, span) * 0.4,
      cy: r.range(yLo, Math.max(yLo + 0.5, yHi)),
      cz: b.z1 + 0.8 + r.range(0, 1.2),
      ax: type === 'sniper' ? 0.2 : span * r.range(0.6, 1),
      ay: type === 'sniper' ? 0.15 : r.range(0.3, 0.9),
      w: r.range(0.35, 0.6) * (r.chance(0.5) ? 1 : -1),
      ph: r.range(0, 6.28), ph2: r.range(0, 6.28),
      delay: 3 + i * 1.1 + r.range(0, 1.5),
    });
  }
  return out;
}

// the enemy fight inside a Sim (sim.enemySys)
export class EnemySystem {
  constructor(sim, specs, opts) {
    opts = opts || {};
    this.sim = sim;
    this.god = !!opts.god;
    const g = sim.gear;
    const d = difficulty(sim.stage.n);
    this.player = {
      pos: opts.player || { x: 0, y: 5, z: 20 },
      hullMax: BASE_HULL + (g.hull || 0), hull: BASE_HULL + (g.hull || 0),
      shieldMax: g.shield || 0, shield: g.shield || 0, shieldRegen: g.shieldRegen || 0,
      repair: g.repair || 0, reduce: g.reduce || 0, pd: g.pd || 0, pdT: 0, lastHitT: -99,
    };
    this.enemies = specs.map((s, i) => {
      const T = ENEMY_TYPES[s.type];
      return Object.assign({ id: i, hp: T.hp, maxHp: T.hp, alive: true, pos: { x: s.cx, y: s.cy, z: s.cz }, fireT: s.delay, state: 'idle', chargeT: 0, burstLeft: 0, hitT: -9, T, d }, s);
    });
    this.proj = [];
    this.kills = 0;
    this._pid = 0;
  }
  get active() { return this.enemies.some((e) => e.alive) || this.proj.length > 0; }

  step(dt) {
    const sim = this.sim, t = sim.t, P = this.player;
    if (sim.state !== 'play') {
      // stage over: everything left self-destructs
      for (const e of this.enemies) if (e.alive) { e.alive = false; sim.events.push({ t: 'enemyDown', ...e.pos, type: e.type, pts: 0 }); }
      for (const p of this.proj) sim.events.push({ t: 'projDown', ...p.pos });
      this.proj.length = 0;
      return;
    }
    // defense systems
    if (P.shieldMax && t - P.lastHitT > 2.5) P.shield = Math.min(P.shieldMax, P.shield + P.shieldRegen * dt);
    if (P.repair) P.hull = Math.min(P.hullMax, P.hull + P.repair * dt);
    if (P.pd) {
      P.pdT -= dt;
      if (P.pdT <= 0) {
        let best = null, bd = 14;
        for (const p of this.proj) { const dd = dist(p.pos, P.pos); if (dd < bd) { bd = dd; best = p; } }
        if (best) { this._killProj(best, 'pd'); P.pdT = P.pd; }
      }
    }
    // enemies
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const tt = t * e.w;
      e.pos.x = e.cx + e.ax * Math.sin(tt + e.ph);
      e.pos.y = e.cy + e.ay * Math.sin(tt * 1.7 + e.ph2);
      e.pos.z = e.cz + 0.3 * Math.sin(tt * 0.8 + e.ph);
      if (e.state === 'charge') {
        e.chargeT -= dt;
        if (e.chargeT <= 0) {
          e.state = 'idle';
          sim.events.push({ t: 'snipe', ...e.pos, id: e.id });
          this._hitPlayer(scaleDmg(e));
        }
        continue;
      }
      if (e.burstLeft > 0) {
        e.burstT -= dt;
        if (e.burstT <= 0) { this._fire(e); e.burstLeft--; e.burstT = 0.22; }
        continue;
      }
      e.fireT -= dt;
      if (e.fireT <= 0) {
        const T = e.T;
        e.fireT = T.fire[0] + (T.fire[1] - T.fire[0]) * e.d;
        if (T.charge) { e.state = 'charge'; e.chargeT = T.charge; sim.events.push({ t: 'snipeCharge', ...e.pos, id: e.id }); }
        else if (T.burst) { e.burstLeft = T.burst - 1; e.burstT = 0.22; this._fire(e); }
        else this._fire(e);
      }
    }
    // projectiles
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const p = this.proj[i];
      if (p.missile) {  // gentle homing
        const to = norm(sub(P.pos, p.pos));
        p.vel = scale(norm(add(scale(norm(p.vel), 0.96), scale(to, 0.04))), p.speed);
      }
      p.pos = add(p.pos, scale(p.vel, dt));
      p.age += dt;
      const toP = sub(P.pos, p.pos);
      if (len(toP) < 1.1 || dot(toP, p.vel) < 0 || p.age > 12) {
        this.proj.splice(i, 1);
        this._hitPlayer(p.dmg, p.pos);
      }
    }
  }

  _fire(e) {
    const T = e.T, P = this.player;
    const aim = { x: P.pos.x + (Math.random() - 0.5) * 0.6, y: P.pos.y - 0.6 + (Math.random() - 0.5) * 0.5, z: P.pos.z };
    const dir = norm(sub(aim, e.pos));
    const p = { id: this._pid++, pos: { ...e.pos }, vel: scale(dir, T.speed), speed: T.speed, dmg: scaleDmg(e), missile: !!T.missile, hp: 1, r: T.missile ? 0.45 : 0.28, age: 0, from: e.type };
    this.proj.push(p);
    this.sim.events.push({ t: 'enemyFire', ...e.pos, missile: p.missile, type: e.type });
  }

  _hitPlayer(dmg, at) {
    if (this.god) return;
    const P = this.player, sim = this.sim;
    dmg *= 1 - P.reduce;
    let absorbed = 0;
    if (P.shield > 0) { absorbed = Math.min(P.shield, dmg); P.shield -= absorbed; dmg -= absorbed; }
    P.hull = Math.max(0, P.hull - dmg);
    P.lastHitT = sim.t;
    sim.events.push({ t: 'playerHit', dmg: Math.round(dmg), absorbed: Math.round(absorbed), hull: P.hull, ...(at || P.pos) });
    if (P.hull <= 0 && sim.state === 'play') {
      sim.state = 'fail'; sim.failReason = 'hull';
      sim.events.push({ t: 'fail', reason: 'hull' });
    }
  }

  _killProj(p, by) {
    const i = this.proj.indexOf(p);
    if (i >= 0) this.proj.splice(i, 1);
    this.sim.events.push({ t: 'projDown', ...p.pos, by, missile: p.missile });
  }

  // nearest enemy or projectile along a ray (generous radius so taps feel fair)
  rayHit(o, d) {
    let best = null;
    const test = (c, r, obj, kind) => {
      const tt = raySphere(o, d, c, r);
      if (tt !== null && (!best || tt < best.dist)) best = { dist: tt, obj, kind };
    };
    for (const e of this.enemies) if (e.alive) test(e.pos, e.T.r + 0.35, e, 'enemy');
    for (const p of this.proj) test(p.pos, p.r + 0.45, p, 'proj');
    return best;
  }
  hit(h, dmg) {
    const sim = this.sim;
    if (h.kind === 'proj') { this._killProj(h.obj, 'laser'); sim._addScore(50); return; }
    const e = h.obj;
    e.hp -= dmg; e.hitT = sim.t;
    if (e.state === 'charge') { e.state = 'idle'; e.fireT = 2.5; sim.events.push({ t: 'snipeCancel', id: e.id }); }
    if (e.hp <= 0) {
      e.alive = false; this.kills++;
      const pts = sim._addScore(e.T.pts);
      sim.events.push({ t: 'enemyDown', ...e.pos, type: e.type, pts, combo: sim.combo });
    } else sim.events.push({ t: 'enemyHit', ...e.pos, type: e.type });
  }
}

function scaleDmg(e) { return e.T.dmg[0] + (e.T.dmg[1] - e.T.dmg[0]) * e.d; }
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);
const dist = (a, b) => len(sub(a, b));
const norm = (a) => { const l = len(a) || 1; return scale(a, 1 / l); };
function raySphere(o, d, c, r) {
  const oc = sub(o, c);
  const b = dot(oc, d), cc = dot(oc, oc) - r * r;
  const h = b * b - cc;
  if (h < 0) return null;
  const tt = -b - Math.sqrt(h);
  return tt > 0 ? tt : null;
}

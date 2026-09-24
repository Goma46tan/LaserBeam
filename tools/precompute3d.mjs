// Validates every 3D stage (stability + solvability) with a bot and writes js/budget3d.js
// usage: node tools/precompute3d.mjs [from] [to] [--out file.json] [-v] [--js] [--jobs 4]
import { fork } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as C from '../js/core3d.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const from = parseInt(args[0] || '1', 10);
const to = parseInt(args[1] || String(C.STAGE_COUNT), 10);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const verbose = args.includes('-v');
const jobs = parseInt(opt('--jobs') || '1', 10);
const BOT_ASPECT = 0.46;   // typical phone portrait
if (process.env.LB_OPTS) Object.assign(C.SIM_OPTS, JSON.parse(process.env.LB_OPTS));

function stabilityCheck(sim, st) {
  const moving = st.pedestals.some((p) => p.spin || p.move || p.rock);
  const init = sim.targets.map((b) => b.position.clone());
  for (let i = 0; i < 300; i++) {
    sim.step();
    if (sim.targetsLeft < sim.targetsTotal) return 'target lost at step ' + i;
  }
  sim.drainEvents();
  if (moving) return null;
  for (let i = 0; i < sim.targets.length; i++) {
    const b = sim.targets[i];
    if (b.lb.kin || b.lb.float) continue;
    const dd = b.position.distanceTo(init[i]);
    if (dd > 0.25) return 'moved ' + dd.toFixed(2) + ' ' + b.lb.shape;
  }
  return null;
}

function botChoose(sim, cam, rnd) {
  const o = cam.pos;
  const aimAt = (p) => {
    const dx = p.x - o.x, dy = p.y - o.y, dz = p.z - o.z, l = Math.hypot(dx, dy, dz);
    return { x: dx / l, y: dy / l, z: dz / l };
  };
  for (const s of sim.shields) if (s.active) { const g = s.gens.find((q) => q.lb.alive); if (g) return aimAt(g.position); }
  for (const c of sim.tethers) {
    if (c.lb.alive && c.lb.anchor && c.lb.b.lb.alive && rnd() < 0.8) {
      const [a, b] = sim.tetherPoints(c);
      return aimAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
    }
  }
  const peds = sim.bodies.filter((b) => b.lb.kind === 'platform');
  let best = null, bestS = -Infinity;
  for (const b of sim.targets) {
    const L = b.lb;
    if (!L.alive || L.cleared || sim.isPhased(b) || sim.inShield(b.position)) continue;
    const p = b.position;
    const off = { x: p.x + (rnd() - 0.5) * 0.4, y: p.y + (rnd() - 0.5) * 0.3, z: p.z };
    let s;
    if (b.type !== 1 || (L.float && L.float.on) || L.type === 'armor') s = 0.6 + rnd() * 0.6;
    else {
      let ped = null;
      for (const q of peds) if (Math.abs(p.x - q.position.x) < q.lb.w / 2 + 0.2 && q.position.y < p.y && (!ped || q.position.y > ped.position.y)) ped = q;
      s = ped ? Math.hypot(p.x - ped.position.x, p.z - ped.position.z) / (ped.lb.w / 2) + (p.y - ped.position.y) / 8 + rnd() * 0.5 : 0.5 + rnd();
    }
    if (s > bestS) { bestS = s; best = off; }
  }
  return best ? aimAt(best) : null;
}

function botRun(stage, seed) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const st = Object.assign({}, stage, { lasers: 999 });
  const sim = new C.Sim(st, { rand: rnd });
  const err = stabilityCheck(sim, st);
  if (err) return { err };
  const cam = C.cameraFor(st, BOT_ASPECT);
  let guard = 0;
  while (sim.state === 'play' && sim.shots < 80 && guard++ < 400) {
    const dir = botChoose(sim, cam, rnd);
    if (dir) sim.fire(cam.pos, dir);
    let w = 0;
    do { sim.step(); w++; } while (sim.state === 'play' && w < 150 && !(w > 25 && sim.calm > 15));
    sim.drainEvents();
  }
  if (sim.state !== 'clear') return { err: 'bot failed (' + sim.targetsLeft + '/' + sim.targetsTotal + ' left)' };
  return { shots: sim.shots, targets: sim.targetsTotal };
}

// generous early on, then tighter and tighter: by stage 1000 you get barely more than the bot needed
function budgetFor(n, shots) {
  const t = C.difficulty(n);
  const mult = 1.55 - 0.5 * t;
  const extra = n <= 20 ? 3 : n <= 150 ? 2 : n <= 600 ? 1 : 0;
  return Math.min(60, Math.ceil(shots * mult) + extra);
}

function runRange(a, b, log) {
  const results = [];
  for (let n = a; n <= b; n++) {
    let chosen = null;
    for (let v = 0; v < 16 && !chosen; v++) {
      const stage = C.generate(n, v);
      const r1 = botRun(stage, 1234 + n * 7 + v);
      if (r1.err) { if (verbose) log(`${n} v${v} ${r1.err} ${stage.feats.join(',')} | ${stage.templates.join(',')}`); continue; }
      const r2 = botRun(stage, 999 + n * 13 + v);
      if (r2.err) { if (verbose) log(`${n} v${v} run2 ${r2.err}`); continue; }
      const shots = Math.max(r1.shots, r2.shots);
      chosen = [v, budgetFor(n, shots), r1.targets, r1.shots, r2.shots];
    }
    if (!chosen) { log('!! stage ' + n + ' no valid variant'); chosen = [0, 30, 0, -1, -1]; }
    results.push([n, ...chosen]);
    if (verbose || n % 50 === 0) log(`${n} ${JSON.stringify(chosen)}`);
  }
  return results;
}

if (process.env.LB_WORKER) {
  const [a, b] = JSON.parse(process.env.LB_WORKER);
  const res = runRange(a, b, (m) => process.send({ log: m }));
  process.send({ done: res });
} else {
  const t0 = Date.now();
  let results = [];
  if (jobs <= 1) results = runRange(from, to, console.log);
  else {
    const span = Math.ceil((to - from + 1) / jobs);
    const parts = [];
    for (let j = 0; j < jobs; j++) {
      const a = from + j * span, b = Math.min(to, a + span - 1);
      if (a > b) continue;
      parts.push(new Promise((res) => {
        const w = fork(fileURLToPath(import.meta.url), args, { env: { ...process.env, LB_WORKER: JSON.stringify([a, b]) } });
        w.on('message', (m) => { if (m.log) console.log(m.log); if (m.done) res(m.done); });
      }));
    }
    results = (await Promise.all(parts)).flat().sort((x, y) => x[0] - y[0]);
  }
  const ok = results.filter((r) => r[4] > 0);
  const T = ok.reduce((a, r) => a + r[3], 0), S = ok.reduce((a, r) => a + r[4], 0);
  const vAvg = results.reduce((a, r) => a + r[1], 0) / results.length;
  console.log('time', ((Date.now() - t0) / 1000).toFixed(1) + 's', 'targets/shot', (T / S).toFixed(2), 'avg variant', vAvg.toFixed(2), 'failed', results.length - ok.length);
  const out = opt('--out');
  if (out) fs.writeFileSync(out, JSON.stringify(results));
  if (args.includes('--js')) {
    const tab = results.map((r) => [r[1], r[2]]);
    fs.writeFileSync(path.join(here, '../js/budget3d.js'),
      '/* generated by tools/precompute3d.mjs - [variant, lasers] per stage */\n' +
      'export const BUDGET = ' + JSON.stringify(tab) + ';\n');
    console.log('wrote js/budget3d.js');
  }
}

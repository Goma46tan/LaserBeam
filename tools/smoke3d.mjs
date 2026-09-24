import * as C from '../js/core3d.js';
const t0 = Date.now();
let bad = 0;
for (let n = +process.argv[2] || 1; n <= (+process.argv[3] || 60); n++) {
  const st = C.generate(n, 0); st.lasers = 99;
  const sim = new C.Sim(st);
  const init = sim.targets.map((b) => b.position.clone());
  let lost = -1;
  for (let i = 0; i < 300; i++) { sim.step(); if (lost < 0 && sim.targetsLeft < sim.targetsTotal) lost = i; }
  let mv = 0;
  sim.targets.forEach((b, i) => { if (b.lb.kin || b.lb.float || st.pedestals.some(p => p.spin || p.move || p.rock)) return; mv = Math.max(mv, b.position.distanceTo(init[i])); });
  if (lost >= 0 || mv > 0.25) bad++;
  console.log(n, 'blocks', sim.targetsTotal, 'lost', lost, 'moved', mv.toFixed(2), st.feats.join(','), '|', st.templates.join(','));
}
console.log('bad', bad, ((Date.now() - t0) / 1000).toFixed(1) + 's');

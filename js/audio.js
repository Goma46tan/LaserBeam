/* LaserBeam - synthesized audio (SFX + procedural synthwave BGM), no asset files */
(function (G) {
  'use strict';
  const LB = G.LB || (G.LB = {});

  const A = {
    ctx: null, master: null, sfxBus: null, musicBus: null, comp: null,
    sfxOn: true, musicOn: true, noiseBuf: null,
    music: null,
  };

  A.init = function () {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
    const AC = G.AudioContext || G.webkitAudioContext;
    if (!AC) return;
    const ctx = (A.ctx = new AC());
    A.comp = ctx.createDynamicsCompressor();
    A.comp.threshold.value = -14; A.comp.ratio.value = 4; A.comp.attack.value = 0.003; A.comp.release.value = 0.2;
    A.master = ctx.createGain(); A.master.gain.value = 0.9;
    A.sfxBus = ctx.createGain(); A.sfxBus.gain.value = A.sfxOn ? 0.8 : 0;
    A.musicBus = ctx.createGain(); A.musicBus.gain.value = A.musicOn ? 0.34 : 0;
    A.sfxBus.connect(A.comp); A.musicBus.connect(A.comp); A.comp.connect(A.master); A.master.connect(ctx.destination);
    const len = ctx.sampleRate * 1.5;
    A.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = A.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // small reverb-ish delay for sparkle
    A.delay = ctx.createDelay(); A.delay.delayTime.value = 0.13;
    A.fb = ctx.createGain(); A.fb.gain.value = 0.28;
    A.delayOut = ctx.createGain(); A.delayOut.gain.value = 0.25;
    A.delay.connect(A.fb); A.fb.connect(A.delay); A.delay.connect(A.delayOut); A.delayOut.connect(A.sfxBus);
  };

  A.setSfx = function (on) { A.sfxOn = on; if (A.sfxBus) A.sfxBus.gain.setTargetAtTime(on ? 0.8 : 0, A.ctx.currentTime, 0.02); };
  A.setMusic = function (on) { A.musicOn = on; if (A.musicBus) A.musicBus.gain.setTargetAtTime(on ? 0.34 : 0, A.ctx.currentTime, 0.1); };

  function env(g, t, a, peak, dcy, sus) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(sus || 0.0001, t + a + dcy);
  }
  function osc(type, freq, t, dur, dest, vol, a) {
    const c = A.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    env(g, t, a || 0.004, vol, dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  function noise(t, dur, dest, vol, ftype, f0, f1, q) {
    const c = A.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = A.noiseBuf;
    f.type = ftype || 'lowpass'; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, 0.003, vol, dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  const last = {};
  function throttle(name, ms) {
    const now = performance.now();
    if (last[name] && now - last[name] < ms) return true;
    last[name] = now; return false;
  }

  A.play = function (name, p) {
    if (!A.ctx || !A.sfxOn) return;
    const c = A.ctx, t = c.currentTime + 0.005, bus = A.sfxBus;
    p = p || {};
    switch (name) {
      case 'laser': {
        const o = osc('sawtooth', 2200, t, 0.22, bus, 0.22);
        o.frequency.exponentialRampToValueAtTime(160, t + 0.2);
        const o2 = osc('square', 1400, t, 0.16, bus, 0.09);
        o2.frequency.exponentialRampToValueAtTime(90, t + 0.16);
        noise(t, 0.12, bus, 0.18, 'highpass', 3000, 8000);
        const o3 = osc('sine', 3200, t, 0.3, A.delay, 0.08);
        o3.frequency.exponentialRampToValueAtTime(600, t + 0.3);
        break;
      }
      case 'hit': {
        if (throttle('hit', 30)) return;
        const o = osc('sine', 180, t, 0.25, bus, 0.5);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.22);
        noise(t, 0.18, bus, 0.35, 'lowpass', 4000, 300);
        break;
      }
      case 'blast': {
        if (throttle('blast', 40)) return;
        const o = osc('sine', 120, t, 0.35, bus, 0.55);
        o.frequency.exponentialRampToValueAtTime(30, t + 0.3);
        noise(t, 0.3, bus, 0.3, 'lowpass', 1800, 120);
        break;
      }
      case 'destroy': {
        if (throttle('destroy', 35)) return;
        const pitch = 1 + Math.min(p.combo || 0, 12) * 0.06;
        noise(t, 0.28, bus, 0.42, 'bandpass', 2400 * pitch, 400, 0.8);
        const o = osc('square', 880 * pitch, t, 0.12, bus, 0.08);
        o.frequency.exponentialRampToValueAtTime(220, t + 0.12);
        osc('triangle', 1320 * pitch, t + 0.03, 0.2, A.delay, 0.07);
        const o2 = osc('sine', 160, t, 0.2, bus, 0.35);
        o2.frequency.exponentialRampToValueAtTime(50, t + 0.18);
        break;
      }
      case 'crystal': {
        if (throttle('crystal', 40)) return;
        for (let i = 0; i < 4; i++) osc('sine', 2000 + Math.random() * 3000, t + i * 0.02, 0.25, A.delay, 0.07);
        noise(t, 0.2, bus, 0.25, 'highpass', 5000, 9000);
        break;
      }
      case 'bomb': {
        const o = osc('sine', 90, t, 0.9, bus, 0.9);
        o.frequency.exponentialRampToValueAtTime(22, t + 0.8);
        noise(t, 0.9, bus, 0.7, 'lowpass', 3000, 60);
        osc('sawtooth', 55, t, 0.5, bus, 0.25);
        break;
      }
      case 'core': {
        const o = osc('sine', 70, t, 1.6, bus, 1);
        o.frequency.exponentialRampToValueAtTime(18, t + 1.5);
        noise(t, 1.6, bus, 0.8, 'lowpass', 5000, 50);
        for (let i = 0; i < 6; i++) osc('square', 400 + i * 180, t + i * 0.05, 0.3, A.delay, 0.05);
        break;
      }
      case 'fall': {
        if (throttle('fall', 45)) return;
        const pitch = 1 + Math.min(p.combo || 0, 12) * 0.07;
        const o = osc('square', 520 * pitch, t, 0.14, bus, 0.07);
        o.frequency.exponentialRampToValueAtTime(1600 * pitch, t + 0.12);
        osc('triangle', 1040 * pitch, t + 0.06, 0.18, A.delay, 0.06);
        break;
      }
      case 'bonus': {
        [0, 4, 7, 12, 16].forEach((s, i) => osc('square', 660 * Math.pow(2, s / 12), t + i * 0.05, 0.14, bus, 0.08));
        [0, 7, 12].forEach((s, i) => osc('sine', 1320 * Math.pow(2, s / 12), t + 0.1 + i * 0.05, 0.3, A.delay, 0.08));
        break;
      }
      case 'deflect': {
        const o = osc('square', 300, t, 0.1, bus, 0.12);
        o.frequency.exponentialRampToValueAtTime(900, t + 0.08);
        noise(t, 0.08, bus, 0.25, 'highpass', 2500);
        osc('sine', 2400, t, 0.35, A.delay, 0.05);
        break;
      }
      case 'shield': {
        const o = osc('sine', 600, t, 0.35, bus, 0.25);
        o.frequency.exponentialRampToValueAtTime(200, t + 0.3);
        osc('triangle', 1200, t, 0.25, A.delay, 0.08);
        break;
      }
      case 'shieldDown': {
        const o = osc('sawtooth', 800, t, 0.8, bus, 0.25);
        o.frequency.exponentialRampToValueAtTime(60, t + 0.75);
        noise(t, 0.6, bus, 0.3, 'bandpass', 3000, 200, 2);
        break;
      }
      case 'cut': {
        noise(t, 0.12, bus, 0.35, 'highpass', 4000, 9000);
        const o = osc('square', 1800, t, 0.1, bus, 0.08);
        o.frequency.exponentialRampToValueAtTime(300, t + 0.1);
        break;
      }
      case 'release': {
        if (throttle('release', 60)) return;
        const o = osc('triangle', 300, t, 0.2, bus, 0.15);
        o.frequency.exponentialRampToValueAtTime(900, t + 0.18);
        break;
      }
      case 'crack': {
        if (throttle('crack', 40)) return;
        noise(t, 0.1, bus, 0.35, 'bandpass', 1500, 800, 3);
        osc('square', 140, t, 0.08, bus, 0.15);
        break;
      }
      case 'empty': {
        osc('sine', 300, t, 0.15, bus, 0.1);
        break;
      }
      case 'clear': {
        const notes = [0, 4, 7, 11, 12, 16, 19, 24];
        notes.forEach((s, i) => {
          osc('sawtooth', 330 * Math.pow(2, s / 12), t + i * 0.07, 0.35, bus, 0.07);
          osc('sine', 660 * Math.pow(2, s / 12), t + i * 0.07, 0.5, A.delay, 0.06);
        });
        [0, 4, 7, 12].forEach((s) => osc('sawtooth', 165 * Math.pow(2, s / 12), t + 0.6, 1.4, bus, 0.06, 0.05));
        break;
      }
      case 'star': {
        const f = 880 * Math.pow(2, (p.i || 0) * 4 / 12);
        osc('square', f, t, 0.18, bus, 0.09);
        osc('sine', f * 2, t, 0.5, A.delay, 0.08);
        break;
      }
      case 'fail': {
        [0, -3, -6, -12].forEach((s, i) => {
          const o = osc('sawtooth', 330 * Math.pow(2, s / 12), t + i * 0.16, 0.3, bus, 0.09);
          o.frequency.exponentialRampToValueAtTime(100 * Math.pow(2, s / 12), t + i * 0.16 + 0.3);
        });
        noise(t + 0.6, 0.5, bus, 0.2, 'bandpass', 800, 100, 2);
        break;
      }
      case 'ui': {
        osc('square', 1200, t, 0.05, bus, 0.06);
        osc('sine', 2400, t + 0.02, 0.08, bus, 0.04);
        break;
      }
      case 'start': {
        [0, 7, 12, 19].forEach((s, i) => osc('square', 440 * Math.pow(2, s / 12), t + i * 0.06, 0.12, bus, 0.06));
        break;
      }
      case 'charge': {
        const o = osc('sine', 200, t, 0.3, bus, 0.05);
        o.frequency.exponentialRampToValueAtTime(900, t + 0.3);
        break;
      }
    }
  };

  /* ------------------------------------------------------------- Music */
  // A procedural synthwave loop: kick, hats, bass, arp, pad. Progression is seeded per sector.
  const PROGS = [
    [[0, 3, 7], [-4, 0, 3], [-7, -3, 0], [-2, 2, 5]],   // i  VI III VII
    [[0, 3, 7], [5, 8, 12], [-2, 2, 5], [-4, 0, 3]],    // i  iv VII VI
    [[0, 3, 7], [-5, -2, 2], [-4, 0, 3], [-2, 2, 5]],   // i  v VI VII
    [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]],  // I  vi IV V
  ];
  const ROOTS = [45, 43, 47, 40, 42, 44, 38, 41];

  A.startMusic = function (seed, intensity) {
    if (!A.ctx) return;
    const sd = seed || 0;
    if (A.music && A.music.seed === sd) { A.music.intensity = intensity || 1; return; }
    A.stopMusic();
    const m = {
      seed: sd, intensity: intensity || 1,
      bpm: 112 + (sd % 4) * 6,
      prog: PROGS[sd % PROGS.length], root: ROOTS[sd % ROOTS.length],
      step: 0, next: A.ctx.currentTime + 0.1, timer: null, out: A.ctx.createGain(),
      arpPat: [0, 1, 2, 1, 2, 0, 2, 1].map((x, i) => (sd * 7 + i * 3) % 3),
    };
    m.out.gain.value = 0; m.out.connect(A.musicBus);
    m.out.gain.setTargetAtTime(1, A.ctx.currentTime, 0.8);
    m.filter = A.ctx.createBiquadFilter(); m.filter.type = 'lowpass'; m.filter.frequency.value = 1400; m.filter.Q.value = 6;
    m.filter.connect(m.out);
    A.music = m;
    const tick = () => {
      const ahead = A.ctx.currentTime + 0.2;
      while (m.next < ahead) { schedule(m, m.step, m.next); m.step++; m.next += 60 / m.bpm / 4; }
    };
    m.timer = setInterval(tick, 50);
    tick();
  };
  A.stopMusic = function () {
    const m = A.music; if (!m) return;
    clearInterval(m.timer);
    m.out.gain.setTargetAtTime(0, A.ctx.currentTime, 0.3);
    setTimeout(() => m.out.disconnect(), 1500);
    A.music = null;
  };
  A.duckMusic = function (v) { if (A.music) A.music.out.gain.setTargetAtTime(v, A.ctx.currentTime, 0.15); };

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function schedule(m, step, t) {
    const c = A.ctx, s16 = step % 16, bar = Math.floor(step / 16) % 4;
    const chord = m.prog[bar];
    const inten = m.intensity;
    // kick
    if (s16 % 4 === 0) {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      env(g, t, 0.002, 0.9, 0.22); o.connect(g); g.connect(m.out); o.start(t); o.stop(t + 0.3);
    }
    // snare on 2 & 4
    if (s16 === 4 || s16 === 12) noise(t, 0.16, m.out, 0.28 * inten, 'bandpass', 1800, 900, 0.8);
    // hats
    if (s16 % 2 === 1 || inten > 1.2) noise(t, 0.035, m.out, (s16 % 4 === 2 ? 0.1 : 0.06) * inten, 'highpass', 8000);
    // bass (offbeat pumping 8ths)
    if (s16 % 2 === 0) {
      const f = mtof(m.root - 12 + chord[0]);
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sawtooth'; o.frequency.value = f;
      env(g, t, 0.01, s16 % 4 === 0 ? 0.12 : 0.2, 0.13);
      o.connect(g); g.connect(m.filter); o.start(t); o.stop(t + 0.2);
    }
    // arp
    {
      const idx = m.arpPat[s16 % 8];
      const oct = s16 >= 8 ? 12 : 0;
      const f = mtof(m.root + 12 + chord[idx] + oct);
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'square'; o.frequency.value = f;
      env(g, t, 0.004, 0.045 * inten, 0.1);
      o.connect(g); g.connect(m.filter); g.connect(A.delay);
      o.start(t); o.stop(t + 0.15);
    }
    // pad on bar start
    if (s16 === 0) {
      for (const iv of chord) {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'sawtooth'; o.frequency.value = mtof(m.root + iv); o.detune.value = (Math.random() - 0.5) * 14;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.03, t + 0.4);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 60 / m.bpm * 4);
        o.connect(g); g.connect(m.filter); o.start(t); o.stop(t + 60 / m.bpm * 4 + 0.1);
      }
      m.filter.frequency.setTargetAtTime(900 + 900 * inten + 500 * Math.sin(step / 16), t, 0.5);
    }
  }

  LB.Audio = A;
})(typeof globalThis !== 'undefined' ? globalThis : this);

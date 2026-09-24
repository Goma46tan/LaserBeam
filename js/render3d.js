/* LaserBeam 3D - renderer: neon block shader, bloom, synthwave world, particles, beams */
import * as THREE from 'three';
import { EffectComposer } from '../lib/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../lib/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../lib/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../lib/addons/postprocessing/ShaderPass.js';
import { OutputPass } from '../lib/addons/postprocessing/OutputPass.js';
import * as C from './core3d.js';

const TAU = Math.PI * 2;
const clamp = C.clamp;

export const R = {
  quality: 'high', t: 0, hue: 190,
  shake: 0, flash: 0, flashCol: new THREE.Color(1, 1, 1), glitch: 0, zoom: 0, zoomAt: new THREE.Vector3(),
  introT: 99, aimWorld: null, recoil: 0,
};

let renderer, scene, camera, composer, bloom, fxPass, canvas;
let cw = 1, ch = 1, dpr = 1;
const camBase = { pos: new THREE.Vector3(0, 6, 20), target: new THREE.Vector3(0, 2, 0), fov: 42 };
let sky, sun, grid, city, stars, keyLight, fillA, fillB, impactLight, hemi;
let turret, barrel, muzzle;
const world = new THREE.Group();          // everything that belongs to the current stage
let sim = null;
const meshes = new Map();                 // body -> mesh
let pedMeshes = [];
let tetherLines = [], shieldMeshes = [], orbitLines = [];
let floorY = -8;

const hsl = (h, s, l) => new THREE.Color().setHSL((((h % 360) + 360) % 360) / 360, s, l);

/* ================================================================== setup */
R.init = function (cv) {
  canvas = cv;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05020f, 0.012);
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 900);
  scene.add(camera);
  scene.add(world);
  buildEnvironment();
  buildTurret();
  buildParticles();
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.4, 0.78);
  composer.addPass(bloom);
  fxPass = new ShaderPass(FX_SHADER);
  composer.addPass(fxPass);
  composer.addPass(new OutputPass());
  R.resize();
};

R.resize = function () {
  const vv = window.visualViewport;
  cw = Math.round(vv ? vv.width : window.innerWidth);
  ch = Math.round(vv ? vv.height : window.innerHeight);
  dpr = Math.min(window.devicePixelRatio || 1, R.quality === 'low' ? 1 : 1.75);
  renderer.setPixelRatio(dpr);
  renderer.setSize(cw, ch, false);
  canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
  composer.setPixelRatio(dpr);
  composer.setSize(cw, ch);
  const bs = R.quality === 'low' ? 0.35 : 0.5;
  bloom.resolution.set(cw * dpr * bs, ch * dpr * bs);
  renderer.shadowMap.enabled = R.quality !== 'low';
  camera.aspect = cw / ch;
  if (sim) frameStage();
  camera.updateProjectionMatrix();
  placeTurret();
  partMat.uniforms.uScale.value = (ch * dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360));
};
R.aspect = () => cw / ch;

/* ============================================================ environment */
function buildEnvironment() {
  // sky dome
  sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { cTop: { value: new THREE.Color() }, cMid: { value: new THREE.Color() }, cHor: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 cTop, cMid, cHor; varying vec3 vP;
      void main(){ float y = vP.y; vec3 c = mix(cHor, cMid, smoothstep(0.0, 0.2, y)); c = mix(c, cTop, smoothstep(0.2, 0.7, y));
      c = mix(cTop * 0.6, c, smoothstep(-0.03, 0.0, y));
      c += cHor * 0.35 * exp(-abs(y) * 60.0); gl_FragColor = vec4(c, 1.0); }`,
  }));
  scene.add(sky);
  // synthwave sun
  sun = new THREE.Mesh(new THREE.CircleGeometry(70, 64), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { c1: { value: new THREE.Color() }, c2: { value: new THREE.Color() }, uT: { value: 0 } },
    vertexShader: 'varying vec2 vU; void main(){ vU = position.xy / 70.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 c1, c2; uniform float uT; varying vec2 vU;
      void main(){ float y = vU.y; vec3 c = mix(c2, c1, smoothstep(-0.8, 0.9, y));
      float band = 1.0; if (y < 0.1) { float k = (0.1 - y) * 9.0; band = step(0.5 * (0.1 - y) * 2.2, fract(y * 9.0 - uT * 0.3)); }
      gl_FragColor = vec4(c * 1.6, band); }`,
  }));
  sun.position.set(0, 26, -300);
  scene.add(sun);
  // city skyline
  const cityGeo = new THREE.BoxGeometry(1, 1, 1);
  cityGeo.translate(0, 0.5, 0);
  const winTex = windowTexture();
  const cityMat = new THREE.MeshBasicMaterial({ map: winTex, color: 0xffffff });
  city = new THREE.InstancedMesh(cityGeo, cityMat, 150);
  const m = new THREE.Matrix4(), rng = C.makeRng(99);
  for (let i = 0; i < 150; i++) {
    const ring = i < 90 ? 0 : 1;
    const a = rng.range(-1.2, 1.2);
    const dist = ring ? rng.range(170, 230) : rng.range(90, 150);
    const w = rng.range(6, 16), h = rng.range(14, ring ? 110 : 70), d = rng.range(6, 16);
    m.compose(new THREE.Vector3(Math.sin(a) * dist, -12, -Math.cos(a) * dist - 20), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
    city.setMatrixAt(i, m);
  }
  scene.add(city);
  // stars
  const sg = new THREE.BufferGeometry(), sp = [];
  for (let i = 0; i < 500; i++) {
    const a = Math.random() * TAU, e = 0.08 + Math.random() * 0.9;
    sp.push(Math.cos(a) * Math.cos(e) * 450, Math.sin(e) * 450, Math.sin(a) * Math.cos(e) * 450);
  }
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7 }));
  scene.add(stars);
  // neon grid floor
  grid = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uCol: { value: new THREE.Color() }, uT: { value: 0 }, uFog: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 uCol, uFog; uniform float uT; varying vec3 vW;
      float line(float x, float w){ float d = abs(fract(x) - 0.5); float fw = fwidth(x); return 1.0 - smoothstep(0.5 - w - fw, 0.5 - w + fw, 0.5 - d + 0.0) ; }
      void main(){
        vec2 p = vW.xz / 3.0; p.y += uT * 0.8;
        vec2 g = abs(fract(p) - 0.5) / fwidth(p);
        float l = 1.0 - min(min(g.x, g.y), 1.0);
        float dist = length(vW.xz - cameraPosition.xz);
        float fade = exp(-dist * 0.012);
        vec3 c = uCol * l * 0.4 * fade;
        gl_FragColor = vec4(c, clamp(l * fade, 0.0, 1.0));
      }`,
  }));
  grid.rotation.x = -Math.PI / 2;
  scene.add(grid);
  // lights
  hemi = new THREE.HemisphereLight(0x8899ff, 0x220022, 0.35);
  scene.add(hemi);
  keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(6, 16, 10);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.bias = -0.0008;
  keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight); scene.add(keyLight.target);
  fillA = new THREE.PointLight(0x00e5ff, 40, 40, 1.6); fillA.position.set(-8, 4, 6); scene.add(fillA);
  fillB = new THREE.PointLight(0xff2fd0, 40, 40, 1.6); fillB.position.set(8, 6, -4); scene.add(fillB);
  impactLight = new THREE.PointLight(0xffffff, 0, 14, 1.5); scene.add(impactLight);
}

function windowTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#05030c'; g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 6) for (let x = 3; x < 61; x += 6) {
    if (Math.random() < 0.3) { g.fillStyle = Math.random() < 0.7 ? '#3fe8ff' : '#ff4fd8'; g.globalAlpha = 0.35 + Math.random() * 0.5; g.fillRect(x, y, 3, 3); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

R.setHue = function (h) {
  R.hue = h;
  const h2 = h + 150;
  sky.material.uniforms.cTop.value.copy(hsl(h + 20, 0.7, 0.012));
  sky.material.uniforms.cMid.value.copy(hsl(h - 10, 0.7, 0.04));
  sky.material.uniforms.cHor.value.copy(hsl(h2, 0.8, 0.18));
  sun.material.uniforms.c1.value.copy(hsl(h2 + 40, 1, 0.6));
  sun.material.uniforms.c2.value.copy(hsl(h2 - 30, 1, 0.45));
  grid.material.uniforms.uCol.value.copy(hsl(h, 1, 0.5));
  city.material.color.copy(hsl(h, 0.6, 0.75));
  scene.fog.color.copy(hsl(h2, 0.6, 0.035));
  fillA.color.copy(hsl(h, 1, 0.6));
  fillB.color.copy(hsl(h2, 1, 0.6));
  hemi.color.copy(hsl(h, 0.6, 0.7));
  if (turret) turret.traverse((o) => { if (o.userData.neon) o.material.color.copy(hsl(h, 1, 0.6)); });
};

/* ========================================================= block material */
const BLOCK_VERT_COMMON = '#include <common>\nvarying vec3 vLocal;\nvarying vec3 vLN;\nvarying float vWY;';
const BLOCK_VERT_BEGIN = '#include <begin_vertex>\nvLocal = position; vLN = normal; vWY = (modelMatrix * vec4(position, 1.0)).y;';
const BLOCK_FRAG_HEAD = `#include <common>
uniform vec3 uHalf; uniform vec3 uCol; uniform float uFlash, uBuild, uFade, uType, uTime, uPulse, uDmg, uGlow;
varying vec3 vLocal; varying vec3 vLN; varying float vWY;
float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float sdStar5(vec2 p, float r, float rf){
  const vec2 k1 = vec2(0.809016994375, -0.587785252292); const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x); p -= 2.0 * max(dot(k1, p), 0.0) * k1; p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x); p.y -= r; vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0, 1);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r); return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float bandLine(float x, float w){ return 1.0 - smoothstep(w * 0.5, w, x); }
`;
// type ids: 0 box, 1 pillar, 2 star, 3 bomb, 4 armor, 5 crystal, 6 phase, 7 steel, 8 gen, 9 core, 10 orb, 11 plank
const BLOCK_FRAG_MAIN = `
  float yb = vLocal.y / (2.0 * uHalf.y) + 0.5;
  if (yb > uBuild) discard;
  float nz = h3(floor(vLocal * 9.0));
  if (uFade > 0.0 && nz < uFade) discard;
`;
const BLOCK_FRAG_EMIS = `
  vec3 an = abs(vLN); vec2 uv; vec2 hf;
  if (an.x > 0.5) { uv = vLocal.zy; hf = uHalf.zy; } else if (an.y > 0.5) { uv = vLocal.xz; hf = uHalf.xz; } else { uv = vLocal.xy; hf = uHalf.xy; }
  float ed = min(hf.x - abs(uv.x), hf.y - abs(uv.y));
  float pat = 0.0;
  if (uType > 7.5) {
    vec3 dir = normalize(vLocal);
    float lat = asin(clamp(dir.y, -1.0, 1.0)), lon = atan(dir.z, dir.x);
    if (uType < 8.5) {           // generator (hex prism)
      pat = bandLine(abs(abs(vLocal.y) - uHalf.y * 0.8), 0.05) + bandLine(abs(fract(lon / 1.0472 + 0.5) - 0.5), 0.06) * 0.7;
      pat += step(an.y, 0.5) * 0.0 + bandLine(abs(vLocal.y), 0.08) * 1.2;
    } else if (uType < 9.5) {    // core
      pat = bandLine(abs(fract(lat * 2.2 + uTime * 0.4) - 0.5), 0.08) * 0.8 + bandLine(abs(fract(lon * 1.27) - 0.5), 0.05) * 0.5;
      pat += smoothstep(0.45, 0.2, length(dir.xy - vec2(0.0, 0.0)) ) * step(0.0, dir.z) * 2.5;
    } else {                     // orb
      pat = bandLine(abs(lat), 0.07) + bandLine(abs(fract(lon * 0.955) - 0.5), 0.05) * 0.6 + bandLine(abs(abs(lat) - 0.8), 0.05) * 0.5;
    }
  } else {
    float e = 1.0 - smoothstep(0.03, 0.065, ed);
    float inner = (1.0 - smoothstep(0.008, 0.022, abs(ed - 0.13))) * 0.45;
    float chip = (1.0 - smoothstep(0.06, 0.085, max(abs(uv.x), abs(uv.y)))) * step(0.3, min(hf.x, hf.y));
    float tr = (1.0 - smoothstep(0.008, 0.02, abs(uv.y - 0.22 * sign(uv.x)))) * step(0.14, abs(uv.x)) * step(abs(uv.x), hf.x - 0.13) * 0.4;
    pat = e + inner + chip * 0.9 + tr;
    if (uType > 0.5 && uType < 1.5) {        // pillar: ring bands
      pat = e * 0.7 + bandLine(abs(fract(vLocal.y * 2.0 + 0.25) - 0.5), 0.04) * 0.8 * step(0.5, 1.0 - an.y) + chip * 0.4;
    } else if (uType > 10.5) {               // plank: centre conduit
      float mid = bandLine(abs(uv.y), 0.025) * step(abs(uv.x), hf.x - 0.12) * step(0.12, hf.y);
      pat = e + mid * 0.8 + bandLine(abs(fract(uv.x * 2.0) - 0.5), 0.05) * bandLine(abs(uv.y), 0.05) * 0.8;
    } else if (uType > 1.5 && uType < 2.5) { // star emblem
      float s = sdStar5(uv * vec2(1.0, -1.0) * 1.0, min(hf.x, hf.y) * 0.62, 0.45);
      pat = e + (1.0 - smoothstep(-0.01, 0.02, s)) * 1.6 + bandLine(abs(s), 0.03) * 0.8;
    } else if (uType > 2.5 && uType < 3.5) { // bomb core
      float r = length(uv);
      pat = e + bandLine(abs(r - 0.26), 0.03) + (1.0 - smoothstep(0.12, 0.16, r)) * (1.2 + 0.8 * sin(uTime * 9.0));
    } else if (uType > 3.5 && uType < 4.5) { // armor: double frame + bolts
      pat = e * 1.2 + (1.0 - smoothstep(0.008, 0.02, abs(ed - 0.1))) * 0.9 + (1.0 - smoothstep(0.008, 0.02, abs(ed - 0.17))) * 0.5;
      vec2 q = abs(uv) - (hf - 0.12); pat += (1.0 - smoothstep(0.03, 0.05, length(max(q, 0.0)) + min(max(q.x, q.y), 0.0))) * 0.8 * step(max(q.x,q.y), 0.05);
      if (uDmg > 0.0) { float cr = h3(floor(vec3(uv * 7.0, uDmg))); pat += step(0.93 - uDmg * 0.06, cr) * 1.6; }
    } else if (uType > 4.5 && uType < 5.5) { // crystal facets
      pat = e * 1.5 + bandLine(abs(uv.x + uv.y * 0.6 - 0.1), 0.02) * 0.6 + bandLine(abs(uv.x * 0.4 - uv.y + 0.2), 0.02) * 0.6;
    } else if (uType > 5.5 && uType < 6.5) { // phase: dashed frame
      pat = e * step(0.5, fract((uv.x + uv.y) * 4.0 - uTime * 2.0)) * 1.4 + chip * 0.5;
    } else if (uType > 6.5 && uType < 7.5) { // steel: faint cold edge + rivets
      vec2 q = abs(uv) - (hf - 0.1);
      pat = e * 0.15 + (1.0 - smoothstep(0.02, 0.035, length(q))) * 0.25;
    }
  }
  float pulse = 0.82 + 0.28 * sin(uTime * 3.0 + uPulse) + 0.7 * exp(-pow((vWY - (mod(uTime * 3.2, 22.0) - 6.0)) * 1.6, 2.0));
  vec3 emis = uCol * pat * uGlow * pulse;
  float bl = 1.0 - smoothstep(0.0, 0.06, uBuild - yb);
  emis += vec3(1.0) * bl * step(uBuild, 0.999) * 3.0;
  if (uFade > 0.0) emis += uCol * step(nz, uFade + 0.08) * 4.0;
  emis += vec3(1.0) * uFlash * 2.5;
  totalEmissiveRadiance += emis;
`;

const TYPE_ID = { normal: 0, star: 2, bomb: 3, armor: 4, crystal: 5, phase: 6, steel: 7, gen: 8, core: 9 };
function typeId(L) {
  if (L.type === 'normal') {
    if (L.shape === 'cyl') return 1;
    if (L.shape === 'orb') return 10;
    if (L.shape === 'plank' || L.shape === 'slab') return 11;
    return 0;
  }
  if (L.kind === 'hub' || L.kind === 'spinner') return 7;
  return TYPE_ID[L.type] || 0;
}

R.blockHue = function (L) {
  const h = R.hue;
  switch (L.type) {
    case 'star': return 48;
    case 'bomb': return 2;
    case 'armor': return h + 160;
    case 'crystal': return 185;
    case 'phase': return 285;
    case 'gen': return 95;
    case 'core': return 330;
    case 'steel': case 'spinner': case 'hub': return 205;
  }
  const off = [0, 48, -42, 96, -90][((L.site % 5) + 5) % 5];
  return h + off + (Math.floor(L.hueShift * 3) - 1) * 10;
};

function blockMaterial(L) {
  const tid = typeId(L);
  const hue = R.blockHue(L);
  const col = hsl(hue, 1, tid === 7 ? 0.8 : 0.55);
  const steel = tid === 7;
  const m = new THREE.MeshStandardMaterial({
    color: steel ? 0x8a96a8 : hsl(hue, 0.55, tid === 5 ? 0.4 : 0.2),
    metalness: steel ? 0.85 : 0.15, roughness: steel ? 0.35 : 0.5,
    emissive: 0xffffff, transparent: tid === 5 || tid === 6, opacity: tid === 5 ? 0.62 : 1,
  });
  const u = {
    uHalf: { value: new THREE.Vector3(L.w / 2, L.h / 2, (L.d || L.w) / 2) },
    uCol: { value: col }, uFlash: { value: 0 }, uBuild: { value: 1 }, uFade: { value: 0 },
    uType: { value: tid }, uTime: { value: 0 }, uPulse: { value: Math.random() * 6 }, uDmg: { value: 0 },
    uGlow: { value: steel ? 1 : tid === 2 ? 1.7 : 1.35 },
  };
  if (L.shape === 'orb' || L.shape === 'core') u.uHalf.value.set(L.w / 2, L.w / 2, L.w / 2);
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', BLOCK_VERT_COMMON).replace('#include <begin_vertex>', BLOCK_VERT_BEGIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', BLOCK_FRAG_HEAD)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + BLOCK_FRAG_MAIN)
      .replace('#include <emissivemap_fragment>', BLOCK_FRAG_EMIS)
      .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = vec3(0.0);');
  };
  m.customProgramCacheKey = () => 'lbBlock';
  return m;
}

const geoCache = new Map();
function blockGeometry(L) {
  const key = L.shape + '|' + L.w.toFixed(2) + '|' + L.h.toFixed(2) + '|' + (L.d || 0).toFixed(2);
  let g = geoCache.get(key);
  if (g) return g;
  if (L.shape === 'orb' || L.shape === 'core') g = new THREE.IcosahedronGeometry(L.w / 2, L.shape === 'core' ? 2 : 3);
  else if (L.shape === 'gen') g = new THREE.CylinderGeometry(L.w / 2, L.w / 2, L.h, 6);
  else g = new THREE.BoxGeometry(L.w, L.h, L.d);
  geoCache.set(key, g);
  return g;
}

/* ================================================================ stage */
R.setStage = function (s) {
  clearStage();
  sim = s;
  const st = sim.stage;
  floorY = st.killY - 5.5;
  grid.position.y = floorY;
  city.position.y = floorY + 12;
  for (const b of sim.bodies) {
    const L = b.lb;
    if (L.kind === 'platform') { buildPedestal(b); continue; }
    const mesh = new THREE.Mesh(blockGeometry(L), blockMaterial(L));
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.body = b;
    world.add(mesh);
    meshes.set(b, mesh);
  }
  for (const c of sim.tethers) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(10 * 3), 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: hsl(185, 1, 0.7), transparent: true, blending: THREE.AdditiveBlending }));
    line.userData.c = c;
    world.add(line); tetherLines.push(line);
    if (c.lb.anchor) {
      const node = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), new THREE.MeshBasicMaterial({ color: hsl(185, 1, 0.75) }));
      node.position.copy(c.lb.a.position); world.add(node);
    }
  }
  for (const s of sim.shields) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(s.r, 48, 24), shieldMaterial());
    m.position.set(s.x, s.y, s.z); m.userData.s = s; m.renderOrder = 5;
    world.add(m); shieldMeshes.push(m);
  }
  for (const o of st.orbits) {
    const pts = [];
    const rr = o.items[0].r;
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * TAU;
      if (o.horizontal) pts.push(new THREE.Vector3(o.cx + Math.cos(a) * rr, o.cy, o.cz + Math.sin(a) * rr));
      else { const tz = o.tilt || 0; pts.push(new THREE.Vector3(o.cx + Math.cos(a) * rr * Math.cos(tz), o.cy + Math.sin(a) * rr, o.cz + Math.cos(a) * rr * Math.sin(tz))); }
    }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: hsl(o.steel ? 0 : R.hue, 1, 0.6), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }));
    world.add(l); orbitLines.push(l);
  }
  frameStage();
  R.introT = 0;
};

function clearStage() {
  for (const m of meshes.values()) { m.material.dispose(); }
  meshes.clear();
  for (const o of [...world.children]) {
    world.remove(o);
    o.traverse((q) => {
      if (q.geometry && !isCachedGeo(q.geometry)) q.geometry.dispose();
      if (q.material && q.material.dispose && !q.userData.keepMat) q.material.dispose();
    });
  }
  pedMeshes = []; tetherLines = []; shieldMeshes = []; orbitLines = [];
  R.clearFx();
}
function isCachedGeo(g) { for (const v of geoCache.values()) if (v === g) return true; return false; }

function frameStage() {
  const cam = C.cameraFor(sim.stage, cw / ch);
  camBase.pos.set(cam.pos.x, cam.pos.y, cam.pos.z);
  camBase.target.set(cam.target.x, cam.target.y, cam.target.z);
  camBase.fov = cam.fov;
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();
  // shadow frustum around the stage
  const b = C.stageBounds(sim.stage);
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  keyLight.position.set(cx + 6, b.y1 + 14, cz + 9);
  keyLight.target.position.set(cx, b.y0, cz);
  const sc = keyLight.shadow.camera, ext = Math.max(b.x1 - b.x0, b.z1 - b.z0, b.y1 - b.y0) / 2 + 4;
  sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 60;
  sc.updateProjectionMatrix();
  fillA.position.set(b.x0 - 3, b.y1 * 0.6 + 2, cz + 5);
  fillB.position.set(b.x1 + 3, b.y1 * 0.8 + 3, cz - 3);
}

function turntableTexture(hue) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#07060f'; g.fillRect(0, 0, 256, 256);
  g.translate(128, 128);
  const col = `hsl(${hue},100%,62%)`;
  g.strokeStyle = col; g.lineWidth = 5;
  g.beginPath(); g.arc(0, 0, 122, 0, TAU); g.stroke();
  g.lineWidth = 2; g.globalAlpha = 0.6;
  g.beginPath(); g.arc(0, 0, 70, 0, TAU); g.stroke();
  g.globalAlpha = 1;
  for (let i = 0; i < 12; i++) {
    g.save(); g.rotate((i / 12) * TAU);
    g.fillStyle = col; g.globalAlpha = i % 3 === 0 ? 1 : 0.45;
    g.beginPath(); g.moveTo(96, -8); g.lineTo(112, 0); g.lineTo(96, 8); g.lineTo(100, 0); g.closePath(); g.fill();
    g.fillRect(74, -1.5, 16, 3);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildPedestal(b) {
  const L = b.lb, p = L.spec;
  const hue = R.hue + 150;
  const grp = new THREE.Group();
  const neon = hsl(hue, 1, 0.6);
  const dark = new THREE.MeshStandardMaterial({ color: hsl(hue, 0.4, 0.09), metalness: 0.7, roughness: 0.35 });
  const trimMat = new THREE.MeshBasicMaterial({ color: neon.clone().multiplyScalar(2.2) });
  let top;
  if (L.round) {
    const r = L.w / 2;
    const topMat = new THREE.MeshStandardMaterial({ color: 0x0a0a14, metalness: 0.5, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 1.4 });
    topMat.map = turntableTexture(hue); topMat.emissiveMap = topMat.map;
    top = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L.h, 48), [dark, topMat, dark]);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.045, 8, 72), trimMat);
    rim.rotation.x = Math.PI / 2; rim.position.y = L.h / 2; top.add(rim);
    const rim2 = rim.clone(); rim2.position.y = -L.h / 2; top.add(rim2);
  } else {
    top = new THREE.Mesh(new THREE.BoxGeometry(L.w, L.h, L.d), dark);
    const e = 0.05;
    for (const [x, z, w, d] of [[0, L.d / 2, L.w, e], [0, -L.d / 2, L.w, e], [L.w / 2, 0, e, L.d], [-L.w / 2, 0, e, L.d]]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(w + e, e, d + e), trimMat); s.position.set(x, L.h / 2, z); top.add(s);
    }
  }
  top.receiveShadow = true; top.castShadow = true;
  grp.add(top);
  // column down into the grid
  const colR = clamp(Math.min(L.w, L.d) * 0.28, 0.25, 0.9);
  const colH = Math.max(1, b.position.y - L.h / 2 - floorY);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(colR * 0.8, colR, colH, 20, 1, true), new THREE.MeshStandardMaterial({ color: hsl(hue, 0.4, 0.07), metalness: 0.6, roughness: 0.4 }));
  column.position.y = -L.h / 2 - colH / 2;
  const rings = [];
  for (let i = 0; i < 4; i++) {
    const rg = new THREE.Mesh(new THREE.TorusGeometry(colR * 0.95, 0.03, 6, 32), trimMat);
    rg.rotation.x = Math.PI / 2; column.add(rg); rings.push(rg);
  }
  const colGroup = new THREE.Group(); colGroup.add(column);
  world.add(grp); world.add(colGroup);
  pedMeshes.push({ body: b, grp, top, colGroup, column, rings, colH });
}

function shieldMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uCol: { value: hsl(175, 1, 0.55) }, uT: { value: 0 }, uHit: { value: new THREE.Vector3() }, uHitT: { value: 9 }, uA: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vW; varying vec3 vL;
      void main(){ vN = normalize(normalMatrix * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vL = position; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uCol, uHit; uniform float uT, uHitT, uA; varying vec3 vN; varying vec3 vW; varying vec3 vL;
      void main(){
        float fr = pow(1.0 - abs(dot(normalize(vN), vec3(0.0, 0.0, 1.0))), 2.2);
        vec3 d = normalize(vL); float u = atan(d.z, d.x) * 6.0, v = asin(d.y) * 7.0;
        vec2 h = abs(fract(vec2(u, v + 0.5 * floor(u)) ) - 0.5);
        float hex = smoothstep(0.42, 0.48, max(h.x, h.y));
        float rip = 0.0; float dh = distance(vW, uHit);
        if (uHitT < 0.8) rip = smoothstep(0.35, 0.0, abs(dh - uHitT * 7.0)) * (1.0 - uHitT / 0.8) * 2.0;
        float a = (fr * 0.9 + hex * 0.18 * (0.7 + 0.3 * sin(uT * 3.0)) + rip) * uA;
        gl_FragColor = vec4(uCol * a, a);
      }`,
  });
}

/* ================================================================ turret */
function buildTurret() {
  turret = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a4250, metalness: 0.9, roughness: 0.3, fog: false });
  const darkM = new THREE.MeshStandardMaterial({ color: 0x14171d, metalness: 0.8, roughness: 0.4, fog: false });
  const neonMat = () => { const m = new THREE.MeshBasicMaterial({ color: 0x33ddff, fog: false }); return m; };
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.78, 0.22, 32), darkM);
  turret.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.022, 6, 48), neonMat()); ring.userData.neon = true;
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.1; turret.add(ring);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 12, 0, TAU, 0, Math.PI / 2), metal);
  dome.position.y = 0.1; turret.add(dome);
  barrel = new THREE.Group(); barrel.position.y = 0.3; turret.add(barrel);
  const tube = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.05), metal); tube.position.z = 0.5; barrel.add(tube);
  for (let i = 0; i < 4; i++) {
    const coil = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.05), neonMat()); coil.userData.neon = true; coil.userData.coil = i;
    coil.position.z = 0.28 + i * 0.16; barrel.add(coil);
  }
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.12, 12), neonMat()); tip.userData.neon = true;
  tip.rotation.x = Math.PI / 2; tip.position.z = 1.06; barrel.add(tip);
  muzzle = new THREE.Object3D(); muzzle.position.z = 1.15; barrel.add(muzzle);
  turret.traverse((o) => { o.renderOrder = 10; });
  camera.add(turret);
  const tl = new THREE.PointLight(0x88ccff, 6, 4); tl.position.set(0, 0.8, 0.6); turret.add(tl);
}
function placeTurret() {
  const dist = 4.2;
  const halfH = Math.tan((camera.fov * Math.PI) / 360) * dist;
  turret.position.set(0, -halfH + 0.28, -dist);
  turret.rotation.x = 0.35;
  const s = clamp(0.36 * Math.min(1.4, (cw / ch) / 0.46), 0.3, 0.5);
  turret.scale.setScalar(s);
}
R.muzzleWorld = function () { const v = new THREE.Vector3(); muzzle.getWorldPosition(v); return v; };

/* ============================================================= particles */
const PMAX = 2400;
const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3), pSize = new Float32Array(PMAX), pAlpha = new Float32Array(PMAX), pShape = new Float32Array(PMAX);
const pVel = new Float32Array(PMAX * 3), pLife = new Float32Array(PMAX), pMax = new Float32Array(PMAX), pG = new Float32Array(PMAX), pDrag = new Float32Array(PMAX), pS0 = new Float32Array(PMAX);
let pCount = 0, partGeo, partMat, points;
function buildParticles() {
  partGeo = new THREE.BufferGeometry();
  partGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  partGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
  partGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
  partGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  partGeo.setAttribute('aShape', new THREE.BufferAttribute(pShape, 1).setUsage(THREE.DynamicDrawUsage));
  partMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uScale: { value: 500 } },
    vertexShader: `attribute vec3 aColor; attribute float aSize, aAlpha, aShape; uniform float uScale;
      varying vec3 vC; varying float vA, vS;
      void main(){ vC = aColor; vA = aAlpha; vS = aShape; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(1.0, aSize * uScale / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; varying float vA, vS;
      void main(){ vec2 c = gl_PointCoord - 0.5; float a;
        if (vS > 0.5) a = step(max(abs(c.x), abs(c.y)), 0.36); else { float d = length(c); a = smoothstep(0.5, 0.0, d); a *= a; }
        gl_FragColor = vec4(vC * a * vA, a * vA); }`,
  });
  points = new THREE.Points(partGeo, partMat);
  points.frustumCulled = false; points.renderOrder = 6;
  scene.add(points);
  buildShards();
  buildPools();
}
function P(x, y, z, vx, vy, vz, col, size, life, g, drag, shape) {
  if (pCount >= (R.quality === 'low' ? 900 : PMAX)) return;
  const i = pCount++;
  pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
  pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
  pCol[i * 3] = col.r; pCol[i * 3 + 1] = col.g; pCol[i * 3 + 2] = col.b;
  pSize[i] = size; pS0[i] = size; pAlpha[i] = 1; pShape[i] = shape || 0;
  pLife[i] = 0; pMax[i] = life; pG[i] = g; pDrag[i] = drag;
}
function updateParticles(dt) {
  for (let i = 0; i < pCount; i++) {
    pLife[i] += dt;
    if (pLife[i] >= pMax[i]) {
      const j = --pCount;
      if (i !== j) {
        for (let k = 0; k < 3; k++) { pPos[i * 3 + k] = pPos[j * 3 + k]; pVel[i * 3 + k] = pVel[j * 3 + k]; pCol[i * 3 + k] = pCol[j * 3 + k]; }
        pSize[i] = pSize[j]; pS0[i] = pS0[j]; pAlpha[i] = pAlpha[j]; pShape[i] = pShape[j]; pLife[i] = pLife[j]; pMax[i] = pMax[j]; pG[i] = pG[j]; pDrag[i] = pDrag[j];
      }
      i--; continue;
    }
    const dr = Math.exp(-pDrag[i] * dt);
    pVel[i * 3] *= dr; pVel[i * 3 + 1] = pVel[i * 3 + 1] * dr - pG[i] * dt; pVel[i * 3 + 2] *= dr;
    pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    const f = 1 - pLife[i] / pMax[i];
    pAlpha[i] = f * (pShape[i] > 0.5 && Math.random() < 0.12 ? 0.3 : 1);
    pSize[i] = pS0[i] * (0.5 + 0.5 * f);
  }
  partGeo.setDrawRange(0, pCount);
  for (const k of ['position', 'aColor', 'aSize', 'aAlpha', 'aShape']) partGeo.attributes[k].needsUpdate = true;
}

// shards: instanced tetrahedra
const SMAX = 600;
let shardMesh; const shards = [];
function buildShards() {
  shardMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(1), new THREE.MeshBasicMaterial({ color: 0xffffff }), SMAX);
  shardMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SMAX * 3), 3);
  shardMesh.count = 0; shardMesh.frustumCulled = false;
  scene.add(shardMesh);
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function updateShards(dt) {
  let n = 0;
  for (let i = shards.length - 1; i >= 0; i--) {
    const s = shards[i];
    s.t += dt;
    if (s.t > s.life) { shards.splice(i, 1); continue; }
    s.vy -= 26 * dt;
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    s.rx += s.wx * dt; s.ry += s.wy * dt;
  }
  for (const s of shards) {
    if (n >= SMAX) break;
    const f = 1 - s.t / s.life;
    _e.set(s.rx, s.ry, 0); _q.setFromEuler(_e);
    _m.compose(_v.set(s.x, s.y, s.z), _q, _s.setScalar(s.size * Math.min(1, f * 2)));
    shardMesh.setMatrixAt(n, _m);
    shardMesh.instanceColor.setXYZ(n, s.c.r * (0.6 + f), s.c.g * (0.6 + f), s.c.b * (0.6 + f));
    n++;
  }
  shardMesh.count = n;
  shardMesh.instanceMatrix.needsUpdate = true;
  shardMesh.instanceColor.needsUpdate = true;
}

// rings, flares, beams
const rings = [], flares = [], beams = [];
let glowTex;
function buildPools() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
}
function spawnRing(p, r0, r1, life, col, width) {
  const m = new THREE.Mesh(new THREE.RingGeometry(1 - (width || 0.08), 1, 48), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  m.position.copy(p); m.renderOrder = 7;
  scene.add(m);
  rings.push({ m, r0, r1, t: 0, life });
}
function spawnFlare(p, size, life, col, streak) {
  const mat = new THREE.SpriteMaterial({ map: glowTex, color: col.clone().multiplyScalar(2.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const s = new THREE.Sprite(mat); s.position.copy(p); s.renderOrder = 8;
  scene.add(s);
  let st = null;
  if (streak) { st = new THREE.Sprite(mat.clone()); st.position.copy(p); st.renderOrder = 8; scene.add(st); }
  flares.push({ s, st, size, t: 0, life });
}
function updateRingsFlares(dt) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]; r.t += dt;
    const f = r.t / r.life;
    if (f >= 1) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); rings.splice(i, 1); continue; }
    const e = 1 - Math.pow(1 - f, 3);
    r.m.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
    r.m.quaternion.copy(camera.quaternion);
    r.m.material.opacity = 1 - f;
  }
  for (let i = flares.length - 1; i >= 0; i--) {
    const fl = flares[i]; fl.t += dt;
    const f = fl.t / fl.life;
    if (f >= 1) { scene.remove(fl.s); fl.s.material.dispose(); if (fl.st) { scene.remove(fl.st); fl.st.material.dispose(); } flares.splice(i, 1); continue; }
    const sz = fl.size * (0.6 + 0.6 * Math.sqrt(f));
    fl.s.scale.set(sz, sz, 1); fl.s.material.opacity = 1 - f;
    if (fl.st) { fl.st.scale.set(sz * 4, sz * 0.18, 1); fl.st.material.opacity = (1 - f) * 0.9; }
  }
}
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
function spawnBeam(a, b, col) {
  const len = a.distanceTo(b);
  const grp = new THREE.Group();
  grp.position.copy(a); grp.lookAt(b);
  const layers = [[0.32, col.clone().multiplyScalar(1.4), 0.5], [0.13, col.clone().multiplyScalar(2.6), 0.95], [0.025, col.clone().lerp(new THREE.Color(1, 1, 1), 0.5).multiplyScalar(3), 1]];
  for (const [w, c, o] of layers) {
    const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    m.scale.set(w, w, len); m.userData.w = w; m.userData.o = o;
    grp.add(m);
  }
  grp.renderOrder = 9;
  scene.add(grp);
  beams.push({ grp, t: 0, life: 0.32, len });
}
function updateBeams(dt) {
  for (let i = beams.length - 1; i >= 0; i--) {
    const b = beams[i]; b.t += dt;
    const f = b.t / b.life;
    if (f >= 1) { scene.remove(b.grp); b.grp.children.forEach((m) => m.material.dispose()); beams.splice(i, 1); continue; }
    const grow = clamp(b.t / 0.04, 0, 1);
    const fade = f < 0.3 ? 1 : 1 - (f - 0.3) / 0.7;
    for (const m of b.grp.children) {
      const w = m.userData.w * (0.4 + 0.6 * fade) * (1 + Math.sin(R.t * 90) * 0.12);
      m.scale.set(w, w, b.len * grow);
      m.material.opacity = m.userData.o * fade;
    }
  }
}
R.clearFx = function () {
  pCount = 0; shards.length = 0;
  for (const r of rings) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); } rings.length = 0;
  for (const f of flares) { scene.remove(f.s); if (f.st) scene.remove(f.st); } flares.length = 0;
  for (const b of beams) scene.remove(b.grp); beams.length = 0;
};

/* ---------------------------------------------------------------- fx API */
const V3 = (p) => new THREE.Vector3(p.x, p.y, p.z);
R.fx = {
  beamFrom(from, to, hue, w) { spawnBeam(V3(from), V3(to), hsl(hue, 1, 0.6)); },
  beam(to, hue, sat) { const c = hsl(hue, sat === undefined ? 1 : sat, sat === 0 ? 0.85 : 0.6); spawnBeam(R.muzzleWorld(), V3(to), c); R.recoil = 1; spawnFlare(R.muzzleWorld(), 0.5, 0.16, c); },
  spark(p, hue, n, speed, life, size) {
    const c = hsl(hue, 1, 0.65);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * TAU, s = Math.sqrt(1 - u * u), v = speed * (0.3 + Math.random());
      P(p.x, p.y, p.z, Math.cos(a) * s * v, u * v, Math.sin(a) * s * v, c, (size || 0.09) * (0.6 + Math.random()), life * (0.5 + Math.random() * 0.8), 14, 2.2, 0);
    }
  },
  glows(p, hue, n, speed, size, life) {
    const c = hsl(hue, 1, 0.55);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * TAU, s = Math.sqrt(1 - u * u), v = speed * Math.random();
      P(p.x, p.y, p.z, Math.cos(a) * s * v, u * v, Math.sin(a) * s * v, c, size * (0.5 + Math.random()), life * (0.6 + Math.random() * 0.6), -0.5, 2.5, 0);
    }
  },
  pixels(p, hue, n, spread) {
    for (let i = 0; i < n; i++) {
      const c = hsl(hue + (Math.random() - 0.5) * 40, 1, 0.6);
      P(p.x + (Math.random() - 0.5) * spread, p.y + (Math.random() - 0.5) * spread, p.z + (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * 1.5, 1 + Math.random() * 3.5, (Math.random() - 0.5) * 1.5, c, 0.1 + Math.random() * 0.12, 0.6 + Math.random() * 0.9, -1.5, 1.2, 1);
    }
  },
  shards(p, L, q, vel, power) {
    const n = Math.min(30, 8 + Math.round(L.w * L.h * (L.d || 1) * 7));
    const c = hsl(R.blockHue(L), 1, 0.6);
    for (let i = 0; i < n && shards.length < SMAX; i++) {
      const lx = (Math.random() - 0.5) * L.w, ly = (Math.random() - 0.5) * L.h, lz = (Math.random() - 0.5) * (L.d || L.w);
      _v.set(lx, ly, lz).applyQuaternion(q);
      const d = _v.length() || 1, sp = (3 + Math.random() * 6) * power;
      shards.push({ x: p.x + _v.x, y: p.y + _v.y, z: p.z + _v.z, vx: (_v.x / d) * sp + vel.x * 0.4, vy: (_v.y / d) * sp + 3 * power + vel.y * 0.4, vz: (_v.z / d) * sp + vel.z * 0.4,
        rx: Math.random() * 6, ry: Math.random() * 6, wx: (Math.random() - 0.5) * 16, wy: (Math.random() - 0.5) * 16,
        size: 0.06 + Math.random() * 0.13 * Math.min(L.w, L.h) * 1.4, c, t: 0, life: 0.8 + Math.random() * 0.9 });
    }
  },
  ring(p, r0, r1, life, hue, width) { spawnRing(V3(p), r0, r1, life, hsl(hue, 1, 0.6), width); },
  flare(p, size, life, hue, streak) { spawnFlare(V3(p), size, life, hsl(hue, 1, 0.6), streak); },
  light(p, hue, intensity) { impactLight.position.set(p.x, p.y, p.z); impactLight.color.copy(hsl(hue, 1, 0.65)); impactLight.intensity = Math.max(impactLight.intensity, intensity); },
};
R.addShake = (v) => { R.shake = Math.min(1.2, Math.max(R.shake, v)); };
R.addFlash = (v, col) => { R.flash = Math.max(R.flash, v); R.flashCol.copy(col || new THREE.Color(1, 1, 1)); };
R.addGlitch = (v) => { R.glitch = Math.max(R.glitch, v); };
R.hsl = hsl;

/* ------------------------------------------------------------- popups (DOM) */
const pops = [];
let popLayer = null;
R.pop = function (p, text, hue, size, life) {
  if (!popLayer) popLayer = document.getElementById('pops');
  if (pops.length > 30) { const o = pops.shift(); o.el.remove(); }
  const el = document.createElement('div');
  el.className = 'pop';
  el.textContent = text;
  el.style.setProperty('--ph', Math.round(((hue % 360) + 360) % 360));
  el.style.fontSize = (size || 20) + 'px';
  popLayer.appendChild(el);
  pops.push({ el, p: V3(p), t: 0, life: life || 0.9 });
};
function updatePops(dt) {
  for (let i = pops.length - 1; i >= 0; i--) {
    const o = pops[i]; o.t += dt;
    const f = o.t / o.life;
    if (f >= 1) { o.el.remove(); pops.splice(i, 1); continue; }
    _v.copy(o.p); _v.y += f * 0.8; _v.project(camera);
    const x = (_v.x * 0.5 + 0.5) * cw, y = (-_v.y * 0.5 + 0.5) * ch;
    const sc = f < 0.12 ? 0.6 + (f / 0.12) * 0.6 : 1.2 - Math.min(0.2, f - 0.12);
    o.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${sc})`;
    o.el.style.opacity = f > 0.7 ? (1 - f) / 0.3 : 1;
  }
}

/* --------------------------------------------------------------- picking */
const raycaster = new THREE.Raycaster();
R.pickRay = function (sx, sy) {
  const ndc = new THREE.Vector2((sx / cw) * 2 - 1, -(sy / ch) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const o = raycaster.ray.origin, d = raycaster.ray.direction;
  return { origin: { x: o.x, y: o.y, z: o.z }, dir: { x: d.x, y: d.y, z: d.z } };
};
R.project = function (p) { _v.set(p.x, p.y, p.z).project(camera); return { x: (_v.x * 0.5 + 0.5) * cw, y: (-_v.y * 0.5 + 0.5) * ch }; };

/* ================================================================ frame */
const FX_SHADER = {
  uniforms: { tDiffuse: { value: null }, uT: { value: 0 }, uGlitch: { value: 0 }, uFlash: { value: 0 }, uFlashCol: { value: new THREE.Color() }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uT, uGlitch, uFlash; uniform vec3 uFlashCol; uniform vec2 uRes; varying vec2 vUv;
    float rnd(float x){ return fract(sin(x * 91.3) * 47453.1); }
    void main(){
      vec2 uv = vUv;
      if (uGlitch > 0.0) { float band = floor(uv.y * 24.0 + floor(uT * 30.0) * 7.0); if (rnd(band) < uGlitch * 0.6) uv.x += (rnd(band + 3.0) - 0.5) * 0.08 * uGlitch; }
      float ca = 0.0015 + uGlitch * 0.012;
      vec2 dc = (uv - 0.5) * ca;
      vec3 c = vec3(texture2D(tDiffuse, uv + dc).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - dc).b);
      float vig = smoothstep(1.05, 0.35, length((vUv - 0.5) * vec2(1.0, 1.25)));
      c *= mix(0.55, 1.0, vig);
      c *= 0.94 + 0.06 * sin(vUv.y * uRes.y * 1.6);
      c += uFlashCol * uFlash;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

const _tgt = new THREE.Vector3();
R.update = function (dt, simT) {
  R.t += dt;
  R.introT += dt;
  // camera: base pose + gentle sway + shake + zoom punch
  const sway = 0.35;
  camera.position.copy(camBase.pos);
  camera.position.x += Math.sin(R.t * 0.23) * sway;
  camera.position.y += Math.sin(R.t * 0.17) * sway * 0.4;
  _tgt.copy(camBase.target);
  if (R.zoom > 0) {
    camera.position.lerp(R.zoomAt, R.zoom * 0.35);
    _tgt.lerp(R.zoomAt, R.zoom * 0.6);
  }
  if (R.shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * R.shake;
    camera.position.y += (Math.random() - 0.5) * R.shake;
  }
  camera.lookAt(_tgt);
  R.shake *= Math.exp(-dt * 9);
  R.flash *= Math.exp(-dt * 7);
  R.glitch = Math.max(0, R.glitch - dt);
  R.recoil *= Math.exp(-dt * 14);
  impactLight.intensity *= Math.exp(-dt * 10);
  // turret aim
  if (R.aimWorld) {
    const m = new THREE.Matrix4().lookAt(barrel.getWorldPosition(_v), R.aimWorld, camera.up);
    // aim along the local +z axis
    const wq = new THREE.Quaternion().setFromRotationMatrix(m).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    const pq = new THREE.Quaternion(); barrel.parent.getWorldQuaternion(pq);
    const target = pq.invert().multiply(wq);
    barrel.quaternion.slerp(target, Math.min(1, dt * 18));
  }
  barrel.children[0].position.z = 0.5 - R.recoil * 0.18;
  turret.children.forEach(() => {});
  barrel.children.forEach((c) => { if (c.userData.coil !== undefined) c.material.color.copy(hsl(R.hue, 1, (Math.floor(R.t * 10) + c.userData.coil) % 4 === 0 ? 0.85 : 0.45)).multiplyScalar(1.6); });
  // environment animation
  grid.material.uniforms.uT.value = R.t;
  sun.material.uniforms.uT.value = R.t;
  updateParticles(dt); updateShards(dt); updateRingsFlares(dt); updateBeams(dt); updatePops(dt); updateEnemies(dt);
  if (!sim) return;
  // sync meshes
  const intro = R.introT;
  const st = sim.stage;
  const b0 = C.stageBounds(st);
  const span = Math.max(1, b0.y1 - b0.y0);
  for (const [b, mesh] of meshes) {
    const L = b.lb;
    if (L.removed) { mesh.visible = false; continue; }
    mesh.position.copy(b.position);
    mesh.quaternion.copy(b.quaternion);
    const u = mesh.material.userData.u;
    u.uTime.value = R.t;
    // materialise bottom-up at stage start (spinners and hubs have no home, so use where they are)
    if (intro < 1.8) {
      const d = clamp(((L.home || b.position).y - b0.y0) / span, 0, 1);
      u.uBuild.value = clamp((intro - d * 0.8) / 0.45, 0, 1);
    } else u.uBuild.value = 1;
    u.uFlash.value = L.hitT !== undefined && sim.t - L.hitT < 0.14 ? 1 - (sim.t - L.hitT) / 0.14 : 0;
    u.uDmg.value = L.maxHp > 1 ? L.maxHp - L.hp : 0;
    if (L.cleared) u.uFade.value = clamp((sim.killY - b.position.y) / 3.5 + 0.15, 0, 1);
    if (L.type === 'phase') { const pl = sim.phaseLevel(b); mesh.material.opacity = 1 - pl * 0.78; }
    if (L.float) u.uGlow.value = L.float.on ? 1.35 + Math.sin(R.t * 8) * 0.25 : 1.35;
  }
  for (const pm of pedMeshes) {
    const b = pm.body;
    pm.grp.position.copy(b.position); pm.grp.quaternion.copy(b.quaternion);
    pm.colGroup.position.set(b.position.x, b.position.y, b.position.z);
    pm.rings.forEach((rg, i) => { const q = ((R.t * 0.35 + i / pm.rings.length) % 1); rg.position.y = -pm.colH / 2 + q * pm.colH; rg.scale.setScalar(1 - q * 0.15); });
  }
  for (const line of tetherLines) {
    const c = line.userData.c;
    line.visible = c.lb.alive;
    if (!c.lb.alive) continue;
    const [a, b] = sim.tetherPoints(c);
    const arr = line.geometry.attributes.position.array;
    for (let i = 0; i < 10; i++) {
      const q = i / 9, j = i === 0 || i === 9 ? 0 : 0.06;
      arr[i * 3] = a.x + (b.x - a.x) * q + (Math.random() - 0.5) * j;
      arr[i * 3 + 1] = a.y + (b.y - a.y) * q + (Math.random() - 0.5) * j;
      arr[i * 3 + 2] = a.z + (b.z - a.z) * q + (Math.random() - 0.5) * j;
    }
    line.geometry.attributes.position.needsUpdate = true;
  }
  for (const m of shieldMeshes) {
    const s = m.userData.s, u = m.material.uniforms;
    u.uT.value = R.t;
    if (s.hitP) { u.uHit.value.set(s.hitP.x, s.hitP.y, s.hitP.z); u.uHitT.value = sim.t - s.hitT; }
    if (!s.active) { m.userData.down = (m.userData.down || 0) + dt; u.uA.value = Math.max(0, 1 - m.userData.down / 0.6) * (Math.random() < 0.5 ? 1 : 0.3); m.visible = u.uA.value > 0.01; }
  }
};

R.render = function () {
  fxPass.uniforms.uT.value = R.t;
  fxPass.uniforms.uGlitch.value = Math.min(1, R.glitch * 2.5);
  fxPass.uniforms.uFlash.value = Math.min(1, R.flash);
  fxPass.uniforms.uFlashCol.value.copy(R.flashCol);
  fxPass.uniforms.uRes.value.set(cw * dpr, ch * dpr);
  composer.render();
};

// small preview canvas for UI icons (gimmick intro cards)
R.iconCanvas = function (type, shape, size) {
  const c = document.createElement('canvas'); c.width = c.height = size * 2;
  const g = c.getContext('2d');
  const L = { type, shape, site: 0, hueShift: 0.5, kind: type === 'steel' ? 'steel' : 'block' };
  const hue = R.blockHue(L);
  g.translate(size, size);
  const s = size * 0.7;
  g.save();
  g.shadowColor = `hsl(${hue},100%,60%)`; g.shadowBlur = 24;
  g.fillStyle = type === 'steel' ? '#4a5462' : `hsl(${hue},60%,10%)`;
  g.strokeStyle = type === 'steel' ? '#aebbd0' : `hsl(${hue},100%,65%)`; g.lineWidth = 6;
  g.beginPath();
  if (shape === 'orb' || shape === 'core') g.arc(0, 0, s / 2, 0, TAU);
  else if (shape === 'gen') for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; g.lineTo(Math.cos(a) * s / 2, Math.sin(a) * s / 2); }
  else if (shape === 'round') { g.ellipse(0, s * 0.1, s * 0.62, s * 0.24, 0, 0, TAU); }
  else g.rect(-s / 2, -s / 2, s, shape === 'plank' ? s * 0.3 : s);
  g.closePath(); g.fill(); g.stroke();
  g.restore();
  g.fillStyle = `hsl(${hue},100%,80%)`;
  if (type === 'star') { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * TAU, r = i % 2 ? s * 0.12 : s * 0.3; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.fill(); }
  else if (shape === 'round') { g.strokeStyle = `hsl(${hue},100%,70%)`; g.lineWidth = 4; g.beginPath(); g.ellipse(0, s * 0.1, s * 0.4, s * 0.15, 0, 0.3, 4.8); g.stroke(); }
  else g.fillRect(-s * 0.08, -s * 0.08, s * 0.16, s * 0.16);
  return c;
};

/* ================================================================ enemies */
const enemyGroup = new THREE.Group();
let esys = null;
const enemyMeshes = new Map();   // enemy -> group
const projMeshes = new Map();    // projectile -> mesh
const aimLines = new Map();      // sniper id -> line
let enemyMats = null;
function eMats() {
  if (enemyMats) return enemyMats;
  enemyMats = {
    hull: new THREE.MeshStandardMaterial({ color: 0x1b1d26, metalness: 0.85, roughness: 0.3 }),
    red: new THREE.MeshStandardMaterial({ color: 0x300008, emissive: 0xff2244, emissiveIntensity: 1.8, metalness: 0.4, roughness: 0.4 }),
    orange: new THREE.MeshStandardMaterial({ color: 0x301000, emissive: 0xff7a20, emissiveIntensity: 2.2 }),
    bolt: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.6, 0.35) }),
    missile: new THREE.MeshStandardMaterial({ color: 0x2a2a30, emissive: 0xff3010, emissiveIntensity: 0.8, metalness: 0.7, roughness: 0.3 }),
  };
  return enemyMats;
}
function buildEnemy(type) {
  const m = eMats();
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, rx, ry, rz) => { const o = new THREE.Mesh(geo, mat); o.position.set(x || 0, y || 0, z || 0); o.rotation.set(rx || 0, ry || 0, rz || 0); o.castShadow = true; g.add(o); return o; };
  if (type === 'scout') {
    add(new THREE.OctahedronGeometry(0.34), m.red);
    const ring = add(new THREE.TorusGeometry(0.52, 0.045, 8, 32), m.orange, 0, 0, 0, Math.PI / 2);
    g.userData.spin = ring;
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.3, 0.06, 0.12), m.hull, s * 0.62, 0, 0);
  } else if (type === 'gunship') {
    add(new THREE.BoxGeometry(1.1, 0.26, 0.7), m.hull);
    add(new THREE.SphereGeometry(0.2, 16, 10), m.red, 0, 0.12, 0.25);
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.55, 0.06, 0.45), m.hull, s * 0.78, -0.02, -0.05, 0, 0, s * 0.15);
      add(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 10), m.orange, s * 0.45, -0.05, -0.38, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 6), m.hull, s * 0.3, -0.12, 0.45, Math.PI / 2);
    }
  } else if (type === 'bomber') {
    add(new THREE.CapsuleGeometry(0.34, 0.9, 6, 14), m.hull, 0, 0, 0, 0, 0, Math.PI / 2);
    for (const x of [-0.35, 0, 0.35]) add(new THREE.TorusGeometry(0.35, 0.03, 6, 24), m.red, x, 0, 0, 0, Math.PI / 2);
    add(new THREE.BoxGeometry(0.5, 0.12, 0.35), m.orange, 0, -0.33, 0.05);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.2, 0.5, 0.06), m.hull, s * 0.72, 0.18, -0.1);
  } else {
    add(new THREE.ConeGeometry(0.28, 1.1, 8), m.hull, 0, 0, 0, Math.PI / 2);
    const eye = add(new THREE.SphereGeometry(0.17, 16, 10), m.red, 0, 0, 0.5);
    g.userData.eye = eye;
    const ring = add(new THREE.TorusGeometry(0.42, 0.035, 6, 28), m.orange, 0, 0, 0.05);
    g.userData.spin2 = ring;
  }
  g.userData.hitMat = null;
  return g;
}
R.setEnemies = function (sys) {
  esys = sys;
  for (const g of enemyMeshes.values()) enemyGroup.remove(g);
  for (const m of projMeshes.values()) enemyGroup.remove(m);
  for (const l of aimLines.values()) { enemyGroup.remove(l); l.material.dispose(); l.geometry.dispose(); }
  enemyMeshes.clear(); projMeshes.clear(); aimLines.clear();
  if (!enemyGroup.parent) scene.add(enemyGroup);
  if (!sys) return;
  for (const e of sys.enemies) { const g = buildEnemy(e.type); g.position.set(e.pos.x, e.pos.y, e.pos.z); enemyGroup.add(g); enemyMeshes.set(e, g); }
};
R.playerPos = () => ({ x: camBase.pos.x, y: camBase.pos.y, z: camBase.pos.z });
const boltGeo = new THREE.SphereGeometry(0.16, 12, 8), missileGeo = new THREE.ConeGeometry(0.16, 0.6, 10).rotateX(Math.PI / 2);
function updateEnemies(dt) {
  if (!esys) return;
  const m = eMats();
  for (const [e, g] of enemyMeshes) {
    if (!e.alive) { g.visible = false; continue; }
    g.position.set(e.pos.x, e.pos.y, e.pos.z);
    g.lookAt(camera.position);
    g.rotateZ(Math.sin(R.t * 2 + e.id) * 0.15);
    if (g.userData.spin) g.userData.spin.rotation.z += dt * 4;
    if (g.userData.spin2) g.userData.spin2.rotation.z -= dt * 3;
    const flash = esys.sim.t - e.hitT < 0.12;
    const charging = e.state === 'charge';
    const warn = !charging && e.fireT < 0.6 && e.burstLeft === 0;
    g.traverse((o) => { if (o.material === m.red || o.userData.baseMat === m.red) { o.userData.baseMat = m.red; o.material = flash ? m.bolt : m.red; } });
    const s = 1 + (warn ? 0.12 * Math.sin(R.t * 40) : 0);
    g.scale.setScalar(s);
    // sniper aim line
    let line = aimLines.get(e.id);
    if (charging) {
      if (!line) {
        line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: new THREE.Color(3, 0.2, 0.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        line.frustumCulled = false; enemyGroup.add(line); aimLines.set(e.id, line);
      }
      const pp = esys.player.pos;
      const arr = line.geometry.attributes.position.array;
      arr[0] = e.pos.x; arr[1] = e.pos.y; arr[2] = e.pos.z;
      arr[3] = pp.x; arr[4] = pp.y - 1.2; arr[5] = pp.z - 2;
      line.geometry.attributes.position.needsUpdate = true;
      const k = 1 - e.chargeT / e.T.charge;
      line.material.opacity = 0.3 + 0.7 * k * (0.6 + 0.4 * Math.sin(R.t * (20 + k * 40)));
      line.visible = true;
      if (g.userData.eye) g.userData.eye.scale.setScalar(1 + k * 0.8);
    } else if (line) line.visible = false;
  }
  const seen = new Set();
  for (const p of esys.proj) {
    seen.add(p);
    let mesh = projMeshes.get(p);
    if (!mesh) {
      mesh = new THREE.Mesh(p.missile ? missileGeo : boltGeo, p.missile ? m.missile : m.bolt);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(3, 0.7, 0.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.setScalar(p.missile ? 1.3 : 0.9); mesh.add(glow);
      enemyGroup.add(mesh); projMeshes.set(p, mesh);
    }
    mesh.position.set(p.pos.x, p.pos.y, p.pos.z);
    if (p.missile) mesh.lookAt(mesh.position.x + p.vel.x, mesh.position.y + p.vel.y, mesh.position.z + p.vel.z);
    // trail
    if (Math.random() < (p.missile ? 0.9 : 0.5)) P(p.pos.x, p.pos.y, p.pos.z, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, hsl(p.missile ? 15 : 25, 1, 0.55), p.missile ? 0.35 : 0.2, 0.35, 0, 1, 0);
  }
  for (const [p, mesh] of projMeshes) if (!seen.has(p)) { enemyGroup.remove(mesh); mesh.children.forEach((c) => c.material.dispose()); projMeshes.delete(p); }
}

R.renderer = () => renderer;
R.camera = () => camera;

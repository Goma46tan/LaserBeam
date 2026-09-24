// Stamps index.html with content hashes so browsers always fetch changed files after an update.
// Run before every upload:  node tools/version.mjs
// - every JS module gets an import-map entry  "./js/x.js" -> "./js/x.js?v=<hash>"
//   (relative imports between modules resolve to the mapped, versioned URL)
// - the stylesheet, audio script and entry module get ?v=<hash>
// - <meta name="lb-version"> holds a build id shown in SETTINGS
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.relative(root, p).split(path.sep).join('/');
const hashOf = (f) => crypto.createHash('md5').update(fs.readFileSync(path.join(root, f))).digest('hex').slice(0, 8);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(rel(p));
  }
  return out;
}
const modules = [...walk(path.join(root, 'js'), []), ...walk(path.join(root, 'lib'), [])].sort();
const imports = {};
for (const f of modules) {
  const v = `./${f}?v=${hashOf(f)}`;
  imports[`./${f}`] = v;
  if (f === 'lib/three.module.min.js') imports.three = v;
}
const all = crypto.createHash('md5');
for (const f of [...modules, 'css/style.css', 'index.html'].filter((f) => f !== 'index.html')) all.update(hashOf(f));
const d = new Date();
const build = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${all.digest('hex').slice(0, 6)}`;

const idx = path.join(root, 'index.html');
let html = fs.readFileSync(idx, 'utf8');
const map = `<script type="importmap">${JSON.stringify({ imports }, null, 1)}</script>`;
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, map);
html = html.replace(/href="css\/style\.css(\?v=\w+)?"/, `href="css/style.css?v=${hashOf('css/style.css')}"`);
html = html.replace(/src="js\/audio\.js(\?v=\w+)?"/, `src="js/audio.js?v=${hashOf('js/audio.js')}"`);
html = html.replace(/src="js\/main3d\.js(\?v=\w+)?"/, `src="js/main3d.js?v=${hashOf('js/main3d.js')}"`);
if (/<meta name="lb-version"/.test(html)) html = html.replace(/<meta name="lb-version" content="[^"]*">/, `<meta name="lb-version" content="${build}">`);
else html = html.replace('<meta charset="UTF-8">', `<meta charset="UTF-8">\n<meta name="lb-version" content="${build}">`);
fs.writeFileSync(idx, html);
console.log(`version ${build}: ${modules.length} modules stamped`);

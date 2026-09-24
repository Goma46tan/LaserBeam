/* LaserBeam - equipment shop screen */
import { CATALOG, BY_ID, SLOTS, RARITY, itemDesc } from './gear.js';

const $ = (id) => document.getElementById(id);

// small inline icons, tinted with --ih
const ICON = {
  beam: '<path d="M3 21L21 3" stroke-width="3"/><circle cx="21" cy="3" r="2.5" fill="currentColor"/>',
  pierce: '<path d="M2 12h18M15 7l5 5-5 5" stroke-width="2.5"/><rect x="8" y="5" width="3" height="14" rx="1" opacity=".5"/>',
  wide: '<circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="10" opacity=".6"/>',
  heavy: '<circle cx="12" cy="12" r="6" fill="currentColor" opacity=".35"/><path d="M4 12h12M12 8l4 4-4 4" stroke-width="3"/>',
  plasma: '<circle cx="12" cy="12" r="5" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/>',
  split: '<path d="M3 20L12 4M12 20V4M21 20L12 4" stroke-width="2.2"/>',
  core: '<path d="M12 2l8.7 5v10L12 22l-8.7-5V7z"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
  cell: '<rect x="6" y="4" width="12" height="17" rx="2"/><rect x="9" y="2" width="6" height="2"/><path d="M13 7l-3 5h4l-3 5" stroke-width="2"/>',
  coin: '<circle cx="12" cy="12" r="9"/><text x="12" y="16" text-anchor="middle" font-size="9" font-weight="900" fill="currentColor" stroke="none">PT</text>',
  star: '<path d="M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.2 1.3-6.6-4.9-4.6 6.6-.8z" fill="currentColor" opacity=".85"/>',
  chain: '<circle cx="8" cy="12" r="4"/><circle cx="16" cy="12" r="4"/><path d="M12 3v3M12 18v3M4 5l2 2M18 17l2 2"/>',
  armor: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path d="M8 12l3 3 5-6" stroke-width="2"/>',
  over: '<path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor"/>',
  recharge: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 3v5h-5" stroke-width="2"/><path d="M12 8v8M8 12h8"/>',
  none: '<circle cx="12" cy="12" r="8" opacity=".5"/><path d="M8 12h8"/>',
  shield: '<path d="M4 13a8 8 0 0 1 16 0" stroke-width="2.4"/><path d="M7 13a5 5 0 0 1 10 0" opacity=".6"/><path d="M12 16v5M9 21h6"/>',
  pd: '<circle cx="12" cy="15" r="4"/><path d="M12 11l5-8M15 3h4v4"/><circle cx="19" cy="3" r="1.5" fill="currentColor"/>',
  color: '<circle cx="12" cy="12" r="8" fill="currentColor"/><circle cx="9" cy="9" r="2.5" fill="#fff" opacity=".7"/>',
};

function iconSvg(it) {
  const hue = it.beam && it.beam.mode === 'rainbow' ? null : it.hue;
  const style = hue === null ? 'background:conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red);color:#fff' : `--ih:${Math.round(hue || 0)}`;
  const sat = it.beam && it.beam.sat === 0 ? ';--is:0%' : '';
  return `<div class="ico${hue === null ? ' rainbow' : ''}" style="${style}${sat}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[it.icon] || ICON.none}</svg></div>`;
}

let ctx = null;
let tab = 'weapon';

export function openShop(c) {
  ctx = c;
  render();
}
export function refreshShop() { if (ctx) render(); }

function render() {
  const { save } = ctx;
  $('shopPt').textContent = `${save.pt.toLocaleString()} PT`;
  // loadout
  $('loadout').innerHTML = SLOTS.map((s) => {
    const it = BY_ID[save.equip[s.id]];
    return `<button class="lo-slot ${s.id === tab ? 'active' : ''}" data-slot="${s.id}">${iconSvg(it)}<div><div class="lo-k">${s.name}</div><div class="lo-v">${it.name}</div></div></button>`;
  }).join('');
  $('loadout').querySelectorAll('.lo-slot').forEach((b) => { b.onclick = () => { tab = b.dataset.slot; ctx.A.play('ui'); render(); }; });
  // tabs
  const owned = (id) => save.owned.includes(id);
  $('shopTabs').innerHTML = SLOTS.map((s) => {
    const all = CATALOG.filter((i) => i.slot === s.id);
    return `<button class="st-tab ${s.id === tab ? 'active' : ''}" data-slot="${s.id}">${s.name}<small>${all.filter((i) => owned(i.id)).length}/${all.length}</small></button>`;
  }).join('');
  $('shopTabs').querySelectorAll('.st-tab').forEach((b) => { b.onclick = () => { tab = b.dataset.slot; ctx.A.play('ui'); render(); $('shopList').scrollTop = 0; }; });
  // items
  const list = CATALOG.filter((i) => i.slot === tab);
  $('shopList').innerHTML = list.map((it) => {
    const own = owned(it.id), eq = save.equip[it.slot] === it.id;
    const locked = !own && it.req > save.unlocked;
    const afford = save.pt >= it.price;
    let btn;
    if (eq) btn = '<button class="buy eq" disabled>EQUIPPED</button>';
    else if (own) btn = `<button class="buy own" data-act="equip" data-id="${it.id}">EQUIP</button>`;
    else if (locked) btn = `<button class="buy lock" disabled>🔒 STAGE ${it.req}</button>`;
    else btn = `<button class="buy ${afford ? '' : 'poor'}" data-act="buy" data-id="${it.id}">${it.price.toLocaleString()} PT</button>`;
    const r = RARITY[it.rarity];
    return `<div class="item r${it.rarity} ${eq ? 'is-eq' : ''} ${locked ? 'is-lock' : ''}" style="--rh:${r.hue}">
      ${iconSvg(it)}
      <div class="info"><div class="nm">${it.name}</div><div class="rar">${r.name}</div><div class="ds">${itemDesc(it)}</div></div>
      ${btn}</div>`;
  }).join('');
  $('shopList').querySelectorAll('button[data-act]').forEach((b) => {
    b.onclick = () => {
      const it = BY_ID[b.dataset.id];
      if (b.dataset.act === 'equip') { save.equip[it.slot] = it.id; ctx.A.play('ui'); ctx.writeSave(); render(); return; }
      if (save.pt < it.price) { ctx.A.play('empty'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); return; }
      save.pt -= it.price;
      save.owned.push(it.id);
      save.equip[it.slot] = it.id;
      ctx.writeSave();
      ctx.A.play('bonus');
      ctx.toast(ctx.t('toast.equipped', { name: it.name }));
      render();
    };
  });
}

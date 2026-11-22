// A village that lives only in this page: the same engine the server runs, stepped on demand.
import { createVillage, stepVillage, locationsOf } from '/sim.mjs';
import { createMap } from '/map.js';
import { formatDate } from '/engine/calendar.mjs';
import { skyOver } from '/ambient.js';
import { residentCard } from '/card.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, value) => { const node = document.createElement(tag); if (cls) node.className = cls; if (value !== undefined) node.textContent = value; return node; };
const map = createMap($('map'), id => { selected = id; show(); }, (actor, others) => residentCard(actor, {
  index: village.actors.findIndex(a => a.id === actor.id), names: locationsOf(village.map, village.actors), minute: village.world.minute, others }));
let village, selected, walk = null, mode = 'plan', revision = -1, log = [], running = 0;

function time(minute) {
  const hour = Math.floor(minute / 60) % 24;
  return formatDate(minute) + ' · ' + (hour % 12 || 12) + ':' + String(minute % 60).padStart(2, '0') + (hour < 12 ? ' am' : ' pm');
}
function show() {
  const { world, actors } = village, names = locationsOf(village.map, actors);
  if (revision !== village.map.revision) {
    revision = village.map.revision;
    // The views keep their own copy, as they would when reading the map from the server.
    const copy = structuredClone(village.map);
    map.setMap(copy, names);
    walk?.setMap(copy);
  }
  if (!actors.some(a => a.id === selected)) selected = actors[0].id;
  const snapshot = structuredClone(actors);
  const extras = { coldHearths: world.coldHearths || [] };
  map.update(snapshot, selected, names, undefined, world.minute, extras);
  if (mode === 'walk') walk?.update(snapshot, selected, world.minute, undefined, extras);
  $('day').textContent = time(world.minute);
  $('weather').textContent = skyOver(world.minute, village.map.seed).label + ' · ' + world.supplies.wood + ' firewood'
    + (extras.coldHearths.length ? ' · ' + extras.coldHearths.length + ' cold hearths' : '');
  $('people').textContent = actors.length + ' residents';
  $('map-count').textContent = actors.length + ' residents';
  const picker = $('pick-resident');
  if (picker.options.length !== actors.length) picker.replaceChildren(...actors.map(a => new Option(a.name, a.id)));
  picker.value = selected;
  const kinds = {};
  for (const p of village.map.places) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
  $('built').textContent = Object.entries(kinds).map(([k, n]) => n + ' ' + k).join(' · ') + ' · ' + village.map.roads.filter(r => r.name).length + ' named ways';
  $('log').replaceChildren(...(log.length ? log.slice(-40).reverse().map(e => {
    const row = el('div', 'memory-item');
    row.append(el('time', '', time(e.minute)), el('p', 'memory-text', e.text));
    return row;
  }) : [el('p', 'empty', 'Nothing built or decided yet. Advance the days to watch the village grow.')]));
}
function advance(minutes) {
  for (const e of stepVillage(village, { minutes })) if (['civic', 'build', 'arrival'].includes(e.type) && !/ told /.test(e.text)) log.push(e);
  show();
}
function found() {
  village = createVillage(Number($('seed').value) || 26111);
  revision = -1; log = []; selected = village.actors[0].id;
  show(); map.home();
}
async function view(next) {
  mode = next;
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === mode));
  $('map').hidden = mode !== 'plan'; $('walk').hidden = mode !== 'walk';
  document.querySelector('.map-zoom').hidden = document.querySelector('.map-key').hidden = mode !== 'plan';
  if (mode === 'walk' && !walk) {
    const { createWalk } = await import('/view3d.js');
    walk = createWalk($('walk'), id => { selected = id; show(); });
    walk.setMap(structuredClone(village.map));
  }
  walk?.setActive(mode === 'walk');
  if (mode === 'plan') map.redraw();
  show();
}
$('found').addEventListener('click', found);
$('random').addEventListener('click', () => { $('seed').value = Math.floor(Math.random() * 999983) + 1; found(); });
$('day1').addEventListener('click', () => advance(1440));
$('day10').addEventListener('click', () => advance(14400));
$('run').addEventListener('click', () => {
  if (running) { clearInterval(running); running = 0; }
  else running = setInterval(() => advance(3), 500);
  $('run').setAttribute('aria-pressed', String(Boolean(running)));
  $('run').textContent = running ? 'Stop' : 'Run';
});
$('pick-resident').addEventListener('change', e => { selected = e.target.value; show(); });
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => view(b.dataset.view));
$('zoom-in').addEventListener('click', () => map.zoom(1.4));
$('zoom-out').addEventListener('click', () => map.zoom(1 / 1.4));
$('zoom-home').addEventListener('click', () => map.home());
const asked = new URLSearchParams(location.search);
if (asked.get('seed')) $('seed').value = asked.get('seed');
found();
if (Number(asked.get('days')) > 0) advance(Math.min(400, Number(asked.get('days'))) * 1440);
window.atlas = { get village() { return village; }, get walk() { return walk; }, map, advance, view };

// A village that lives only in this page: the same engine the server runs, stepped on demand.
import { createVillage, stepVillage, locationsOf } from '/sim.mjs';
import { createMap } from '/map.js';
import { bindMapFullscreen } from './map-fullscreen.js';
import { formatDate } from '/engine/calendar.mjs';
import { childResidents } from '/engine/children.mjs';
import { addPlace, extendLane, pickLot } from '/engine/sites.mjs';
import { skyOver } from '/ambient.js';
import { residentCard } from '/card.js';
import { bindVillageSound } from './village-audio.js';

const $ = id => document.getElementById(id);
const asked = new URLSearchParams(location.search);
const el = (tag, cls, value) => { const node = document.createElement(tag); if (cls) node.className = cls; if (value !== undefined) node.textContent = value; return node; };
const map = createMap($('map'), id => { selected = id; show(); }, { resident: (actor, others) => residentCard(actor, {
  index: people.findIndex(a => a.id === actor.id), names: locationsOf(village.map, village.actors), minute: village.world.minute, others }) });
let village, selected, walk = null, mode = 'plan', revision = -1, log = [], running = 0;
let people = [];

function time(minute) {
  const hour = Math.floor(minute / 60) % 24;
  return formatDate(minute) + ' · ' + (hour % 12 || 12) + ':' + String(minute % 60).padStart(2, '0') + (hour < 12 ? ' am' : ' pm');
}
function show() {
  const { world, actors } = village, names = locationsOf(village.map, actors);
  const children = childResidents(world);
  people = [...actors, ...children];
  if (revision !== village.map.revision) {
    revision = village.map.revision;
    // The views keep their own copy, as they would when reading the map from the server.
    const copy = structuredClone(village.map);
    map.setMap(copy, names);
    walk?.setMap(copy);
  }
  if (!people.some(a => a.id === selected)) selected = people[0].id;
  const snapshot = structuredClone(people);
  const extras = { world, coldHearths: world.coldHearths || [] };
  map.update(snapshot, selected, names, undefined, world.minute, extras);
  if (mode === 'walk') walk?.update(snapshot, selected, world.minute, undefined, extras);
  $('day').textContent = time(world.minute);
  $('weather').textContent = skyOver(world.minute, village.map.seed).label + ' · ' + world.supplies.wood + ' firewood'
    + (extras.coldHearths.length ? ' · ' + extras.coldHearths.length + ' cold hearths' : '');
  const population = actors.length + ' residents' + (children.length ? ' · ' + children.length + (children.length === 1 ? ' child' : ' children') : '');
  $('people').textContent = $('map-count').textContent = population;
  const picker = $('pick-resident');
  if (picker.options.length !== people.length || [...picker.options].some((option, i) => option.value !== people[i].id)) {
    picker.replaceChildren(...people.map(a => new Option(a.name, a.id)));
  }
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
  for (const e of stepVillage(village, { minutes })) {
    if ((e.outcome?.lesson || e.outcome?.chore || ['civic', 'build', 'arrival', 'life', 'storm', 'visit', 'herd'].includes(e.type))
        && !/ told /.test(e.text)) log.push(e);
  }
  show();
}
function found() {
  village = createVillage(Number($('seed').value) || 26111);
  // The Sandbox shows whole lives, death included. The live village leaves death out.
  village.world.mortal = true;
  if (asked.get('families') === '1') {
    const { world, map } = village;
    world.familyArrivals = [];
    world.minute = 539;
    for (const item of ['bread', 'flour', 'wood']) world.supplies[item] = world.capacity[item];
    for (let i = 0; i < 3; i++) {
      let lot = pickLot(map, 'cottage', () => 0);
      if (!lot && extendLane(map, () => 0.5) >= 0) lot = pickLot(map, 'cottage', () => 0);
      if (lot) addPlace(map, 'cottage', lot, { road: lot.road });
    }
  }
  revision = -1; log = []; selected = village.actors[0].id;
  show(); map.home();
}
async function view(next) {
  mode = next;
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === mode));
  $('map').hidden = mode !== 'plan'; $('walk').hidden = mode !== 'walk';
  document.querySelector('.map-key').hidden = mode !== 'plan';
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
$('pick-resident').addEventListener('change', e => { selected = e.target.value; map.watch({ id: selected }); show(); });
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => view(b.dataset.view));
$('zoom-in').addEventListener('click', () => map.zoom(1.4));
$('zoom-out').addEventListener('click', () => map.zoom(1 / 1.4));
$('zoom-home').addEventListener('click', () => map.home());
bindMapFullscreen($('map-fullscreen'));
bindVillageSound($('sound'), now => (mode === 'walk' && walk?.soundScene(now)) || map.soundScene(now));
if (asked.get('seed')) $('seed').value = asked.get('seed');
if (asked.get('families') === '1') $('summary').textContent = 'A separate village with spare cottages and stocked shelves for two arriving families.';
found();
if (Number(asked.get('days')) > 0) advance(Math.min(400, Number(asked.get('days'))) * 1440);
window.atlas = { get village() { return village; }, get walk() { return walk; }, map, advance, view };

// Runs a village through a year under local rules and reports how it fared, month by month.
//   node tools/year.mjs [days=365] [seed=26111] [--mortal]
// Columns: date, residents, children, food in days, barley ripe in the fields, stores, average hunger
// and cold, residents ill, and the chronicle's commonest sentence and its share.
import { createVillage, stepVillage } from '../sim.mjs';
import { formatDate } from '../engine/calendar.mjs';
import { foodDays, mouths, storeDays } from '../engine/stores.mjs';
import { salienceOf, PUBLIC } from '../engine/chronicle.mjs';

const days = Number(process.argv[2] || 365), seed = Number(process.argv[3] || 26111);
const village = createVillage(seed);
if (process.argv.includes('--mortal')) village.world.mortal = true;
const sentences = new Map(), kinds = {}, notable = [];
let shown = 0;
// A sentence with its names and numbers taken out, so "Mabel took a loaf" and "Hugh took a loaf" count together.
const shape = text => text.replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, 'X').replace(/\d+/g, 'N').slice(0, 80);

const avg = key => Math.round(village.actors.reduce((s, a) => s + (a.needs[key] || 0), 0) / Math.max(1, village.actors.length));
const row = () => {
  const { world, actors } = village, m = mouths(village);
  const ripe = Object.values(world.fields).reduce((s, n) => s + n, 0);
  const ill = actors.filter(a => a.illness).length;
  const kids = Object.values(world.cottages || {}).reduce((s, c) => s + (c.children?.length || 0), 0);
  console.log([formatDate(world.minute, 'short').padEnd(6), String(actors.length).padStart(3), String(kids).padStart(3),
    String(Math.round(foodDays(world, m))).padStart(4) + 'd', String(Math.round(storeDays(world, m))).padStart(4) + 'd cap',
    String(Math.round(ripe)).padStart(4) + ' ripe', 'g' + world.supplies.grain + ' f' + world.supplies.flour + ' b' + world.supplies.bread + ' p' + (world.supplies.preserved || 0),
    'hunger ' + avg('hunger'), 'cold ' + avg('cold'), 'ill ' + ill].join('  '));
};

console.log('seed ' + seed + ', ' + days + ' days');
row();
for (let day = 1; day <= days; day++) {
  for (const e of stepVillage(village, { minutes: 1440 })) {
    kinds[e.type] = (kinds[e.type] || 0) + 1;
    if (salienceOf(e) < PUBLIC) continue;
    shown++;
    const key = shape(e.text);
    sentences.set(key, (sentences.get(key) || 0) + 1);
    if (['life', 'visit', 'storm', 'feast'].includes(e.type) || salienceOf(e) >= 8) notable.push(formatDate(e.minute, 'short') + '  ' + e.text);
  }
  if (day % 30 === 0 || day === days) row();
}
console.log('\nevents by type', kinds);
const top = [...sentences].sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log('\npublic chronicle: ' + shown + ' entries, ' + (shown / days).toFixed(1) + ' a day. Commonest sentences:');
for (const [text, n] of top) console.log(String((100 * n / shown).toFixed(1)).padStart(5) + '%  ' + text);
console.log('\nnotable:\n' + notable.slice(0, 80).join('\n'));

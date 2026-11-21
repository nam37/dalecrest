// Runs a village without a database and reports how it grew: node tools/simulate.mjs [days] [seed]
import { createVillage, stepVillage } from '../sim.mjs';

const days = Number(process.argv[2] || 30), seed = Number(process.argv[3] || 26111), verbose = process.argv.includes('-v');
const village = createVillage(seed);
const started = performance.now();
const counts = {};
for (let day = 0; day < days; day++) {
  for (const e of stepVillage(village, { minutes: 1440 })) {
    counts[e.type] = (counts[e.type] || 0) + 1;
    if (['civic', 'build', 'arrival'].includes(e.type) && (verbose || e.type !== 'civic' || /moot/i.test(e.text))) {
      console.log('Day ' + (Math.floor(e.minute / 1440) + 1) + ' ' + String(Math.floor(e.minute / 60) % 24).padStart(2, '0') + ':' + String(e.minute % 60).padStart(2, '0') + '  ' + e.text);
    }
  }
}
const { world, actors, map } = village;
const kinds = {};
for (const p of map.places) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
console.log('\nAfter ' + days + ' days (' + Math.round(performance.now() - started) + ' ms): ' + actors.length + ' residents');
console.log('places', kinds, 'roads', map.roads.map(r => r.name || 'path').join(', '));
console.log('supplies', world.supplies, 'capacity', world.capacity);
console.log('fields', world.fields, 'strain', world.strain, 'projects', world.projects.length, 'proposals', world.proposals.map(p => p.key + ':' + p.supporters.length).join(' '));
console.log('needs avg', ['hunger', 'fatigue', 'loneliness', 'cold'].map(k => k + ' ' + Math.round(actors.reduce((s, a) => s + a.needs[k], 0) / actors.length)).join(', '));
console.log('events', counts, 'map bytes', JSON.stringify(map).length, 'nodes', map.nodes.length);

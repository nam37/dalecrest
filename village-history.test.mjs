import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPresence } from './village-history.mjs';
import { createVillage, stepVillage } from './sim.mjs';
import { advanceWithTraces } from './decision-trace.mjs';

test('presence measures time per cell and day and keeps residents with reused IDs apart', () => {
  const map = { w: 20, h: 20 };
  const actor = { id: 'wat', position: { x: 3.1, y: 4 } };
  const recording = collectPresence();
  for (const minute of [1438, 1439, 1440]) recording.observe({ map, actors: [actor], world: { minute } });
  recording.observe({ map, actors: [{ ...actor, arrived: 1441 }], world: { minute: 1442 } });
  recording.observe({ map, actors: [{ ...actor, position: { x: -1, y: 5 } }], world: { minute: 1443 } });
  assert.deepEqual(recording.rows, [
    { actor_id: 'wat', arrived: 0, day: 0, cell_x: 1, cell_y: 2, minutes: 2, first_minute: 1438, last_minute: 1439 },
    { actor_id: 'wat', arrived: 0, day: 1, cell_x: 1, cell_y: 2, minutes: 1, first_minute: 1440, last_minute: 1440 },
    { actor_id: 'wat', arrived: 1441, day: 1, cell_x: 1, cell_y: 2, minutes: 1, first_minute: 1442, last_minute: 1442 },
  ]);
});

test('recording observes every village minute without changing ordinary or traced simulation', () => {
  const baseline = createVillage(), recorded = structuredClone(baseline), traced = structuredClone(baseline);
  stepVillage(baseline, { minutes: 4 });
  const ordinary = collectPresence(), decision = collectPresence();
  stepVillage(recorded, { minutes: 4, observe: ordinary.observe });
  advanceWithTraces(traced, 4, [{ actor_id: 'agnes', id: '1', until_minute: 525 }], false, null, decision.observe);
  assert.deepEqual(recorded, baseline);
  assert.deepEqual(traced, baseline);
  assert.deepEqual(decision.rows, ordinary.rows);
  assert.equal(ordinary.rows.filter(row => row.actor_id === 'agnes').reduce((sum, row) => sum + row.minutes, 0), 4);
});

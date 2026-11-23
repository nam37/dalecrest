import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from './engine/worldgen.mjs';
import { freeGround } from './engine/sites.mjs';
import { rectPoly } from './engine/geom.mjs';
import { fenceSpans, logsIn, parishLayout, strayCattle } from './public/parish.js';
import { residentActivity, residentPose, toolFor } from './public/resident-pose.js';

test('both views can dress a saved map without changing its roads or sites', () => {
  const saved = JSON.stringify(generateMap(26111));
  const map = JSON.parse(saved), layout = parishLayout(map);
  assert.deepEqual(layout, parishLayout(JSON.parse(saved)));
  assert.equal(JSON.stringify(map), saved);
  assert.ok(layout.gardens.length > 0);
  assert.ok(layout.sheep.length > 0);
  for (const item of [...layout.gardens, ...layout.piles]) {
    assert.ok(freeGround(map, rectPoly(item, 0.1), { gap: 0.08, roadGap: 0.15, bank: 0.4 }));
  }
  const garden = layout.gardens[0], corners = rectPoly(garden);
  const [a, b] = garden.door > 0 ? corners.slice(2) : corners.slice(0, 2);
  assert.ok(!fenceSpans(garden).some(([p, q]) =>
    [p, q].every(([x, y]) => Math.abs((x - a[0]) * (b[1] - a[1]) - (y - a[1]) * (b[0] - a[0])) < 1e-8)));
});

test('logs and cattle follow the current stocks and herd window on the same map', () => {
  const map = generateMap(26111), { common, piles } = parishLayout(map);
  const house = piles.find(p => !p.common);
  const world = { minute: 100, supplies: { wood: 24 }, cottages: { [house.id]: { woodpile: 3 } },
    herd: { field: 'fields', from: 100, until: 140 } };
  assert.equal(logsIn(common, world), 12);
  assert.equal(logsIn(house, world), 3);
  assert.equal(logsIn(house, {}), 0);
  assert.equal(logsIn(common, { supplies: { wood: 0 } }), 0);
  assert.equal(strayCattle(map, { ...world, minute: 99 }).length, 0);
  assert.equal(strayCattle(map, world).length, 3);
  assert.equal(strayCattle(map, { ...world, minute: 140 }).length, 0);
});

test('work poses distinguish the axe from the oven peel and hide tools while queued or travelling', () => {
  const work = (job, changes) => residentActivity({ action: { kind: 'work', phase: 'working', job, ...changes } }, false);
  const chop = work('cut'), bake = work('bake'), frame = { now: 700, index: 0, moving: false };
  assert.equal(toolFor(chop), 'axe');
  assert.equal(toolFor(bake), 'peel');
  assert.notEqual(residentPose({ ...frame, ...chop }).armR, residentPose({ ...frame, ...bake }).armR);
  assert.equal(toolFor(work('bake', { queued: 310 })), null);
  assert.equal(toolFor(work('bake', { phase: 'travelling' })), null);
});

// Residents who need a choice at once are served side by side, never by more lanes than allowed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createLanes } from './planner-lanes.mjs';

test('a queue is worked by several lanes and finishes without a pause between residents', async () => {
  const queue = Array.from({ length: 12 }, (_, i) => 'resident-' + i), served = [];
  let busy = 0, most = 0;
  const lanes = createLanes(async open => {
    const next = queue.shift();
    if (!next) return false;
    open();
    busy++; most = Math.max(most, busy);
    await delay(20);
    busy--;
    served.push(next);
    return 'sent';
  }, { lanes: 3 });
  const started = Date.now();
  await lanes.open();
  while (lanes.running) await delay(5);
  assert.equal(served.length, 12);
  assert.equal(most, 3, 'never more lanes than allowed');
  // Twelve replies of 20 ms in three lanes take about 80 ms. One lane polled every two seconds took 24 s.
  assert.ok(Date.now() - started < 400, 'served in ' + (Date.now() - started) + ' ms');
});

test('a quiet village is checked by one lane, and a failure closes it', async () => {
  let checks = 0;
  const quiet = createLanes(async () => { checks++; return false; }, { lanes: 3 });
  await quiet.open();
  assert.equal(checks, 1);
  assert.equal(quiet.running, 0);

  const failures = [];
  const broken = createLanes(async () => { throw new Error('OpenAI HTTP 503'); }, { lanes: 3, failed: error => failures.push(error.message) });
  await broken.open();
  assert.deepEqual(failures, ['OpenAI HTTP 503']);
  assert.equal(broken.running, 0);
});

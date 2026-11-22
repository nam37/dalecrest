import test from 'node:test';
import assert from 'node:assert/strict';
import { judge, salienceOf, PUBLIC } from './engine/chronicle.mjs';

const missed = (extra = {}) => ({ type: 'social', minute: 600, actorIds: ['agnes'],
  text: 'Agnes Reed could not tell Hugh Dale about the oven count witnessed by Mabel Ash because they did not meet.',
  outcome: { verb: 'share', delivered: false, to: 'hugh', cause: 'they did not meet', ...extra } });

test('a missed visit stays out of the public chronicle unless a request for help hung on it', () => {
  assert.ok(salienceOf(missed()) < PUBLIC);
  assert.equal(salienceOf(missed({ verb: 'ask', requestId: 'help-1' })), PUBLIC);
  const told = { ...missed(), text: 'Agnes Reed told Hugh Dale about the oven count witnessed by Mabel Ash.', outcome: { verb: 'share', delivered: true } };
  assert.equal(salienceOf(told), PUBLIC);
});

test('the same sentence with different numbers is told once in three days', () => {
  const world = { minute: 600 };
  const count = (n, minute) => ({ type: 'social', minute, actorIds: ['agnes'], text: 'Agnes Reed counted ' + n + ' loaves aloud on the green.', salience: 4 });
  const events = [count(3, 600), count(5, 700), count(7, 600 + 3 * 1440 + 1)];
  judge(world, events);
  assert.deepEqual(events.map(e => e.salience >= PUBLIC), [true, false, true]);
  // A sentence that differs in a word, not a number, is its own news.
  const other = { type: 'social', minute: 710, actorIds: ['hugh'], text: 'Hugh Dale counted 5 loaves aloud on the green.', salience: 4 };
  judge(world, [other]);
  assert.ok(other.salience >= PUBLIC);
});

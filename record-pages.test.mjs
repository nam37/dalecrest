import assert from 'node:assert/strict';
import test from 'node:test';
import { recordPage } from './record-pages.mjs';
import { dayLink, recordPath, residentAtLink, residentLink } from './public/record-links.js';
import { followSnapshot, newer, recordChanges } from './public/follows.js';

test('record addresses use saved IDs and distinguish resident lifetimes', () => {
  assert.equal(residentLink({ id: 'agnes' }), '/residents/agnes');
  assert.equal(residentLink({ id: 'wat', arrived: 56, left: 100 }), '/residents/wat/56');
  assert.equal(residentLink({ id: 'wat', left: 100 }), '/residents/wat/left-100');
  assert.equal(residentAtLink('wat', 50), '/residents/wat?at=50');
  assert.equal(dayLink(1440), '/days/2');
  assert.deepEqual(recordPath('/moots/moot-1110'), { kind: 'moots', id: 'moot-1110', lifetime: undefined });
  for (const bad of ['/days/0', '/days/1/2', '/moots/1110', '/residents/agnes/left-no', '/promises/%2e%2e']) {
    assert.equal(recordPath(bad), null, bad);
  }
});

test('a stored resident address keeps the same person after the actor ID is reused', async () => {
  const village = {
    minute: 300, places: [],
    actors: [{ id: 'wat', name: 'Wat Greenway', arrived: 200 }],
    departed: [
      { id: 'wat', name: 'Wat Bell', arrived: 10, minute: 100, age: 24 },
      { id: 'joan', name: 'Joan Dale', minute: 195, age: 53 },
    ],
  };
  const db = { query: async () => ({ rows: [village] }) };
  const read = path => {
    const url = new URL(path, 'http://localhost');
    return recordPage(db, recordPath(url.pathname), url.searchParams);
  };
  assert.equal((await read('/residents/wat/10')).body.person.name, 'Wat Bell');
  assert.equal((await read('/residents/wat/200')).body.person.name, 'Wat Greenway');
  assert.equal((await read('/residents/wat?at=50')).body.path, '/residents/wat/10');
  assert.equal((await read('/residents/wat?at=250')).body.path, '/residents/wat/200');
  assert.equal((await read('/residents/wat?at=125')).status, 404);
  assert.equal((await read('/residents/joan?latest=1')).body.path, '/residents/joan/left-195');
});

test('following reports household membership and moot outcomes from the last saved visit', () => {
  const household = (residents, children = []) => followSnapshot('households', { residents, children, stage: 2, cold: false });
  const before = household([{ name: 'Wat Bell', born: -6000, path: '/residents/wat/100' }], [{ name: 'Edith', born: 400 }]);
  const after = household([
    { name: 'Wat Vale', born: -8000, path: '/residents/wat/2020' },
    { name: 'Edith Bell', born: 400, path: '/residents/edith/2210' },
  ]);
  assert.deepEqual(recordChanges('households', before, after), [
    'Wat Vale now lives here.', 'Edith Bell now lives here.', 'Wat Bell no longer lives here.',
  ]);
  assert.deepEqual(recordChanges('households', after, after), []);
  const migrated = household(before.occupants.map(([path, name, born]) => ({ path, name, born })),
    [{ id: 'child-1', name: 'Edith Bell', born: 400 }]);
  assert.deepEqual(recordChanges('households', before, migrated), []);
  const grown = household([
    { name: 'Wat Bell', born: -6000, path: '/residents/wat/100' },
    { name: 'Edith Bell', born: 400, path: '/residents/child-1/2210' },
  ]);
  assert.deepEqual(recordChanges('households', migrated, grown), ['Edith Bell now lives here.']);
  const scheduled = followSnapshot('moots', { status: 'scheduled', attendees: [], items: [] });
  const finished = followSnapshot('moots', {
    status: 'resolved', attendees: [{ id: 'agnes' }],
    items: [{ key: 'field', title: 'Another field', status: 'agreed', votes: [{ id: 'agnes', choice: 'support' }] }],
  });
  assert.deepEqual(recordChanges('moots', scheduled, finished), [
    'The moot concluded.', '1 resident attended.', 'Another field · agreed.',
  ]);
  assert.deepEqual(recordChanges('moots', finished, finished), []);
});

test('following a resident keeps meaningful status without repeating a recorded departure', () => {
  const current = followSnapshot('residents', { person: { role: 'Miller', action: { label: 'At work' } } });
  const later = followSnapshot('residents', { person: { role: 'Miller', action: { label: 'Eating supper' } } });
  const departed = followSnapshot('residents', { person: { role: 'Miller', left: 3000, how: 'nursed' } });
  assert.deepEqual(recordChanges('residents', current, later), []);
  assert.deepEqual(recordChanges('residents', later, departed), ['Left Dalecrest.']);
  assert.deepEqual(recordChanges('residents', later, departed, [{ life: 'left' }]), []);
  assert.ok(newer('9007199254740993', '9007199254740992'));
});

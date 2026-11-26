import test from 'node:test';
import assert from 'node:assert/strict';
import { dawnPets, dogOf, normalizePets } from './engine/pets.mjs';
import { keepStores } from './engine/stores.mjs';

const DAY = 1440;
const person = (id, name, home, traits = []) => ({ id, name, home, traits, memories: [], needs: {}, action: { kind: 'rest', phase: 'working', target: home } });
function village() {
  const world = { minute: 10 * DAY + 360, seed: 99, cottages: { 'cottage-1': { larder: 3 }, 'cottage-2': { larder: 0 }, 'cottage-3': { larder: 2 } }, supplies: { grain: 300 } };
  const actors = [person('agnes', 'Agnes Reed', 'cottage-1', ['generous']), person('hugh', 'Hugh Fen', 'cottage-2'), person('mabel', 'Mabel Ash', 'cottage-3')];
  return { world, actors, map: { seed: 7, places: ['cottage-1', 'cottage-2', 'cottage-3'].map(id => ({ id, kind: 'cottage' })) } };
}
const dawns = (state, n, events = []) => {
  for (let i = 0; i < n; i++) { state.world.minute += DAY; dawnPets(state, (type, text, ids, outcome) => events.push({ type, text, ids, outcome })); }
  return events;
};

test('the first stray comes at the first dawn and takes to a household', () => {
  const state = village();
  normalizePets(state.world);
  assert.deepEqual(state.world.pets, []);
  const events = dawns(state, 1);
  assert.equal(state.world.pets.length, 1);
  const [pet] = state.world.pets;
  assert.ok(['dog', 'cat'].includes(pet.kind));
  assert.equal(state.actors.find(a => a.id === pet.owner).home, pet.home);
  assert.equal(events[0].type, 'life');
  assert.match(events[0].text, new RegExp(pet.name));
  assert.equal(state.actors.find(a => a.id === pet.owner).memories.length, 1);
  assert.equal(state.world.seed, 99, 'pets draw nothing from the village’s own random state');
});

test('a dog eats scraps from its larder, and goes off when there are none for days', () => {
  const state = village();
  state.world.pets = [{ id: 'pet-1', kind: 'dog', name: 'Bran', home: 'cottage-1', owner: 'agnes', came: 0, coat: 0 }];
  dawns(state, 4);
  assert.equal(state.world.cottages['cottage-1'].larder, 2, 'a loaf in scraps every four days');
  assert.ok(dogOf(state.world, 'agnes'));
  state.world.cottages['cottage-1'].larder = 0;
  const events = dawns(state, 8);
  assert.equal(dogOf(state.world, 'agnes'), null);
  assert.ok(events.some(e => e.outcome?.left && /Bran/.test(e.text)));
});

test('a pet stays with whoever is left at the house, and wanders off from an empty one', () => {
  const state = village();
  state.actors.push(person('robin', 'Robin Marsh', 'cottage-1'));
  state.world.pets = [{ id: 'pet-1', kind: 'cat', name: 'Smoke', home: 'cottage-1', owner: 'agnes', came: 0, coat: 0 }];
  state.world.petDue = null;
  state.actors = state.actors.filter(a => a.id !== 'agnes');
  dawns(state, 1);
  assert.equal(state.world.pets.find(p => p.id === 'pet-1').owner, 'robin');
  state.actors = state.actors.filter(a => a.id !== 'robin');
  const events = dawns(state, 1);
  assert.equal(state.world.pets.some(p => p.id === 'pet-1'), false);
  assert.ok(events.some(e => /Smoke/.test(e.text) && e.outcome?.left));
});

test('cats keep the mice from the barley', () => {
  const plain = { supplies: { grain: 300 }, grainLoss: 0 }, guarded = { supplies: { grain: 300 }, grainLoss: 0, pets: [{ kind: 'cat' }, { kind: 'cat' }] };
  for (let i = 0; i < 30; i++) { keepStores(plain); keepStores(guarded); }
  assert.ok(guarded.supplies.grain > plain.supplies.grain);
});

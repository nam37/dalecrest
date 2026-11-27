import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { PET_COMPANY, dawnPets, dogOf, normalizePets, petAtHome } from './engine/pets.mjs';
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

test('a pet at the house is company, and a dog only when its owner is home', () => {
  const state = village();
  state.actors.push(person('robin', 'Robin Marsh', 'cottage-1'));
  const [agnes, , , robin] = state.actors;
  const { world, actors } = state;
  assert.equal(petAtHome(world, actors, agnes), false, 'no pet, no company');
  world.pets = [{ id: 'pet-1', kind: 'cat', name: 'Smoke', home: 'cottage-1', owner: 'agnes', came: 0, coat: 0 }];
  assert.ok(petAtHome(world, actors, robin), 'a cat keeps the whole household company');
  robin.action = { kind: 'work', phase: 'working', target: 'mill' };
  assert.equal(petAtHome(world, actors, robin), false, 'nobody is kept company away from home');
  robin.action = { kind: 'rest', phase: 'travelling', target: 'cottage-1' };
  assert.equal(petAtHome(world, actors, robin), false, 'or on the way there');
  robin.action = { kind: 'rest', phase: 'working', target: 'cottage-1' };
  world.pets = [{ id: 'pet-2', kind: 'dog', name: 'Bran', home: 'cottage-1', owner: 'agnes', came: 0, coat: 0 }];
  assert.ok(petAtHome(world, actors, robin), 'the dog is home while Agnes is');
  agnes.action = { kind: 'work', phase: 'working', target: 'mill' };
  assert.equal(petAtHome(world, actors, robin), false, 'the dog has gone with Agnes');
  assert.ok(PET_COMPANY > 0 && PET_COMPANY < 1, 'company slows loneliness without ending it');
});

test('cats keep the mice from the barley', () => {
  const plain = { supplies: { grain: 300 }, grainLoss: 0 }, guarded = { supplies: { grain: 300 }, grainLoss: 0, pets: [{ kind: 'cat' }, { kind: 'cat' }] };
  for (let i = 0; i < 30; i++) { keepStores(plain); keepStores(guarded); }
  assert.ok(guarded.supplies.grain > plain.supplies.grain);
});

// The views import with the paths the web server serves: /engine/… from the project and anything
// else under / from public/. Map those onto files so the views' own code can run here.
const served = new URL('./', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, context, next) {
    if (spec.startsWith('/engine/')) return next(${JSON.stringify(served)} + spec.slice(1), context);
    if (spec.startsWith('/') && !spec.startsWith('//') && context.parentURL?.startsWith(${JSON.stringify(served)})) return next(${JSON.stringify(served)} + 'public' + spec, context);
    return next(spec, context);
  }`));

test('a dog at its owner’s heels faces the way they are walking', async () => {
  const { createPets } = await import('./public/pets.js');
  const placePets = createPets(), map = { seed: 7, places: [] };
  const pets = [{ id: 'dog-1', kind: 'dog', owner: 'robin', home: 'cottage-1', came: 0 }];
  const actors = [{ id: 'robin', action: { kind: 'work', phase: 'travelling', target: 'storehouse' } }];
  // Robin walks north (up the map, toward smaller y) at a steady pace, twenty frames a second.
  let dog;
  for (let i = 0; i < 80; i++) {
    const where = { x: 50, y: 60 - i * 0.04, heading: -Math.PI / 2, moving: true };
    [dog] = placePets(map, pets, actors, () => where, i * 50, 0, 0.05);
  }
  assert.ok(dog.moving, 'trotting, not sliding');
  assert.ok(Math.abs(Math.atan2(Math.sin(dog.heading + Math.PI / 2), Math.cos(dog.heading + Math.PI / 2))) < 0.3, 'facing north as they go');
});

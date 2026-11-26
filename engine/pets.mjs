// Dogs and cats. Now and then a stray takes to a household and stays: a dog follows its owner about and
// eats scraps from the household larder, and a cat keeps the mice down and feeds itself. A dog left
// without scraps for days goes off to look for them elsewhere, and a pet whose house empties wanders
// off. Every choice here is drawn from the map's seed and the day, not from the village's own random
// state, so adding pets leaves the rest of a stored village's replay as it was.
import { hash2 } from './geom.mjs';
import { remember } from './memory.mjs';

const DAY = 1440;
const DOGS = ['Bran', 'Gelert', 'Tray', 'Ranger', 'Rook', 'Holdfast', 'Swift', 'Lyard', 'Bramble', 'Talbot'];
const CATS = ['Smoke', 'Tib', 'Gib', 'Mouser', 'Ashes', 'Pippin', 'Grise', 'Sooty', 'Moll', 'Whisker'];
// How much of a loaf a dog eats in scraps each day, and how many days it bears with none.
const SCRAPS = 0.25, PATIENCE = 4;

// Gives a village from before pets its list, and has the first stray come at the next dawn. Safe to repeat.
export function normalizePets(world) {
  if (world.pets) return;
  world.pets = [];
  world.petDue = world.minute;
}

export const dogOf = (world, actorId) => world.pets?.find(p => p.kind === 'dog' && p.owner === actorId) ?? null;
export const catCount = world => (world.pets ?? []).filter(p => p.kind === 'cat').length;
export const petsOf = (world, actorId) => (world.pets ?? []).filter(p => p.owner === actorId);

const adultsAt = (actors, home) => actors.filter(a => a.home === home && !a.child);

// At dawn: each pet stays with someone at its house and a dog is fed, and now and then a new stray comes.
export function dawnPets(state, emit) {
  const { world, actors, map } = state, minute = world.minute, day = Math.floor(minute / DAY);
  const roll = salt => hash2(map.seed + 211, day, salt);
  world.pets ??= [];
  for (const pet of [...world.pets]) {
    const kind = pet.kind === 'dog' ? 'dog' : 'cat';
    let owner = actors.find(a => a.id === pet.owner && a.home === pet.home);
    owner ??= adultsAt(actors, pet.home)[0];
    if (!owner) {
      world.pets = world.pets.filter(p => p !== pet);
      emit('life', 'With nobody left at the house, ' + pet.name + ' the ' + kind + ' has wandered off.', [], { pet: pet.id, left: true });
      continue;
    }
    if (owner.id !== pet.owner) {
      pet.owner = owner.id;
      remember(owner, minute, owner.name + ' has taken on ' + pet.name + ' the ' + kind + '.', [owner.id], 'observation', { pet: pet.id });
    }
    if (pet.kind !== 'dog') continue;
    const cottage = world.cottages?.[pet.home];
    pet.owed = (pet.owed || 0) + SCRAPS;
    if (pet.owed >= 1) {
      if (cottage?.larder >= 1) { cottage.larder--; pet.owed -= 1; pet.hungry = 0; }
      else pet.hungry = (pet.hungry || 0) + 1;
    }
    if ((pet.hungry || 0) >= PATIENCE) {
      world.pets = world.pets.filter(p => p !== pet);
      const text = pet.name + ', ' + owner.name + '’s dog, has gone off to find scraps elsewhere after days with nothing from the larder.';
      emit('life', text, [owner.id], { pet: pet.id, left: true }, pet.home);
      remember(owner, minute, text, [owner.id], 'observation', { pet: pet.id, importance: 5 });
    }
  }
  // A stray comes now and then, and at most about two for every five households keep one.
  const cottages = Object.keys(world.cottages ?? {}).filter(home => map.places?.find(p => p.id === home)?.kind === 'cottage');
  const homes = cottages.filter(home => adultsAt(actors, home).length && !world.pets.some(p => p.home === home));
  const room = world.pets.length < Math.max(1, Math.round(cottages.length * 0.4));
  const due = world.petDue != null && minute >= world.petDue;
  if (!homes.length || !room || (!due && roll(1) > 0.05)) return;
  delete world.petDue;
  const home = homes[Math.floor(roll(2) * homes.length)], people = adultsAt(actors, home);
  // A generous soul is the likeliest to take in a stray.
  const owner = people.find(a => a.traits?.includes('generous')) ?? people[Math.floor(roll(3) * people.length)];
  const kind = roll(4) < 0.6 ? 'dog' : 'cat', names = kind === 'dog' ? DOGS : CATS;
  const free = names.filter(n => !world.pets.some(p => p.name === n)), name = (free.length ? free : names)[Math.floor(roll(5) * (free.length || names.length))];
  world.petCount = (world.petCount || 0) + 1;
  const pet = { id: 'pet-' + world.petCount, kind, name, home, owner: owner.id, came: minute, coat: Math.floor(roll(6) * 4) };
  world.pets.push(pet);
  const first = owner.name.split(' ')[0];
  const text = kind === 'dog'
    ? 'A stray dog has taken to following ' + owner.name + ' about and has stayed. ' + first + ' calls the dog ' + name + '.'
    : 'A cat has moved in at ' + owner.name + '’s house and keeps the mice down. ' + first + ' calls the cat ' + name + '.';
  emit('life', text, [owner.id], { pet: pet.id, came: true }, home);
  remember(owner, minute, text, [owner.id], 'observation', { pet: pet.id, importance: 4 });
}

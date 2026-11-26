import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { availableActions, createVillage, startChosen, stepVillage } from './sim.mjs';
import { ageOf, YEAR } from './engine/lives.mjs';
import { shapeActionMenu } from './engine/action-menu.mjs';
import * as civic from './engine/civic.mjs';
import { childResidents } from './engine/children.mjs';
import { place, touch } from './engine/roads.mjs';
import { addPlace, pickLot } from './engine/sites.mjs';

const DAY = 1440;
const adminUrl = process.env.DALECREST_TEST_ADMIN_URL;
function stockedVillage() {
  const village = createVillage();
  village.actors.find(actor => actor.id === 'alice').trade = 'keep';
  village.world.supplies.bread = 32;
  return village;
}

function at(village, day, minute) {
  village.world.minute = day * DAY + minute - 1;
  return stepVillage(village, { minutes: 1, externalActions: true });
}
function addCottage({ map }) {
  return addPlace(map, 'cottage', pickLot(map, 'cottage', () => 0));
}
const familyEvents = events => events.filter(event => event.type === 'arrival' && event.outcome?.arrival === 'family');

test('families keep their place in the housing queue and arrive only as a provisioned household', () => {
  const village = stockedVillage(), { world } = village;
  const unoccupied = addCottage(village);
  assert.equal(familyEvents(at(village, 0, 540)).length, 0, 'the family arrivals have not been queued');
  world.familyArrivals = [];
  // With the barn out of use the family has nowhere to lodge, so it keeps its place in the queue for a cottage.
  place(village.map, 'barn').stage = 1;
  const lodger = village.actors.find(a => a.id === 'robin');
  const unfinished = place(village.map, lodger.home);
  unfinished.stage = 1;
  touch(village.map);
  lodger.home = 'hall';
  assert.equal(familyEvents(at(village, 1, 540)).length, 0, 'the existing lodger has first claim');
  at(village, 2, 360);
  assert.equal(lodger.home, unoccupied.id);
  assert.equal(familyEvents(at(village, 2, 540)).length, 0, 'the other cottage is unfinished');

  unfinished.stage = 2;
  touch(village.map);
  for (const item of ['fish', 'game', 'meat', 'mutton', 'cooked', 'peas', 'apples', 'preserved']) world.supplies[item] = 0;
  world.supplies.bread = 15;
  assert.equal(familyEvents(at(village, 3, 540)).length, 0, 'the village needs 10 loaves plus the family’s six');
  assert.equal(world.supplies.bread, 15);
  // Food other than bread counts toward the check, by the hunger it relieves.
  world.supplies.preserved = 2;
  world.supplies.apples = 2;
  const [event] = familyEvents(at(village, 4, 540));
  assert.ok(event, 'salt fish and apples make up the shortfall in bread');
  assert.equal(event.outcome.home, unfinished.id);
  assert.equal(event.outcome.bread, 6);
  assert.equal(world.supplies.bread, 9);
  const parents = village.actors.filter(actor => event.actorIds.includes(actor.id));
  assert.equal(parents.length, 2);
  assert.equal(parents[0].trade, 'bake');
  for (const [parent, spouse] of [[parents[0], parents[1]], [parents[1], parents[0]]]) {
    assert.equal(parent.home, unfinished.id);
    assert.equal(parent.spouse, spouse.id);
    assert.equal(parent.action.target, unfinished.id);
  }
  const cottage = world.cottages[unfinished.id];
  assert.equal(cottage.larder, 6);
  assert.equal(cottage.ration, 0.5);
  assert.deepEqual(cottage.children.map(child => ageOf(child, world.minute)), [12, 9, 6, 3]);
  assert.ok(cottage.children.every(child => child.parents.join() === event.actorIds.join()));
  assert.ok(cottage.children.every(child => child.position.x === parents[0].position.x && child.position.y === parents[0].position.y));
  assert.equal(new Set(cottage.children.map(child => child.name)).size, 4);
});

test('with no cottage free a family lodges in the barn and moves in together when one is built', () => {
  const village = stockedVillage(), { world, map } = village;
  world.familyArrivals = [];
  const [event] = familyEvents(at(village, 0, 540));
  assert.ok(event, 'the family comes although no cottage stands empty');
  assert.equal(event.outcome.home, 'barn');
  assert.equal(event.outcome.lodging, 'barn');
  assert.match(event.text, /ox-cart/);
  assert.match(event.text, /the barn/);
  const family = world.familyArrivals[0];
  assert.equal(family.lodging, 'barn');
  assert.deepEqual(family.cart, { oxen: 2 });
  const parents = village.actors.filter(actor => family.parents.includes(actor.id));
  assert.ok(parents.every(parent => parent.home === 'barn'));
  const lodged = world.cottages.barn;
  assert.equal(lodged.lodging, true);
  assert.equal(lodged.children.length, 4);
  assert.ok(lodged.larder > 0);

  // One parent asks the moot for a cottage for the family, and the other does not ask again.
  const asking = parents.map(parent => civic.concerns(parent, village).find(c => c.kind === 'cottage' && c.key === 'cottage:' + parent.id)).filter(Boolean);
  assert.equal(asking.length, 1);
  assert.match(asking[0].claim, /family of 6 cannot go on living in the barn/);

  // A second family finds the barn taken.
  world.familyArrivals[0].fedDawns = 3;
  world.supplies.bread = 40;
  assert.equal(familyEvents(at(village, 1, 540)).length, 0, 'one family lodges in a place at a time');

  // A finished cottage takes the whole household at dawn: parents, children and larder.
  const larder = lodged.larder;
  const home = addCottage(village);
  at(village, 2, 360);
  assert.ok(parents.every(parent => parent.home === home.id));
  assert.equal(world.cottages.barn, undefined);
  assert.equal(world.cottages[home.id].children.length, 4);
  assert.ok(world.cottages[home.id].larder >= Math.min(larder, 1));
  assert.equal(family.lodging, undefined);
  assert.equal(family.home, home.id);
});

test('a finished alehouse puts a family up in its loft before the barn', () => {
  const village = stockedVillage(), { world, map } = village;
  world.familyArrivals = [];
  const alehouse = addPlace(map, 'alehouse', pickLot(map, 'alehouse', () => 0), { name: 'The Plough' });
  const [event] = familyEvents(at(village, 0, 540));
  assert.equal(event.outcome.lodging, alehouse.id);
  assert.match(event.text, /the loft over The Plough/);
  const parent = village.actors.find(actor => actor.id === event.actorIds[0]);
  assert.equal(parent.home, alehouse.id);
});

test('the next family waits through a hungry dawn and three fed dawns, including after reload', () => {
  let village = stockedVillage();
  village.world.familyArrivals = [];
  addCottage(village);
  const first = familyEvents(at(village, 0, 540))[0];
  assert.ok(first);
  addCottage(village);
  at(village, 1, 360);
  assert.equal(village.world.familyArrivals[0].fedDawns, 1);
  village.world.cottages[first.outcome.home].larder = 0;
  at(village, 2, 360);
  assert.equal(village.world.familyArrivals[0].fedDawns, 0);
  for (const day of [3, 4]) {
    village.world.cottages[first.outcome.home].larder = 4;
    at(village, day, 360);
    village.world.supplies.bread = 32;
    assert.equal(familyEvents(at(village, day, 540)).length, 0);
  }
  village = JSON.parse(JSON.stringify(village));
  village.world.cottages[first.outcome.home].larder = 4;
  at(village, 5, 360);
  const [second] = familyEvents(at(village, 5, 540));
  assert.ok(second);
  assert.notEqual(second.outcome.home, first.outcome.home);
  assert.equal(village.world.familyArrivals.length, 2);
  addCottage(village);
  assert.equal(familyEvents(at(village, 6, 540)).length, 0, 'both planned households already arrived');

  const oldest = village.world.cottages[second.outcome.home].children[0];
  oldest.born = village.world.minute - 14 * YEAR;
  at(village, 7, 360);
  assert.equal(village.world.familyArrivals[1].fedDawns, 1);
  const grown = village.actors.find(actor => actor.born === oldest.born);
  assert.equal(grown.id, oldest.id);
  assert.match(grown.backstory, /was born in Elmstead/);
  assert.equal(grown.home, second.outcome.home);
});

test('the moot can approve a spare family cottage without assigning it to a lodger', () => {
  const village = stockedVillage(), { world, actors } = village;
  world.familyArrivals = [];
  const thomas = actors.find(actor => actor.id === 'thomas');
  thomas.action = { kind: 'waiting', phase: 'waiting', since: world.minute, target: 'hall', remaining: 0 };
  const key = 'cottage:new-family-1';
  const offered = 'civic:raise:' + key;
  assert.ok(availableActions(thomas, village).has(offered));
  startChosen(thomas, village, offered, { id: '7' });
  stepVillage(village, { minutes: 1, externalActions: true });
  const proposal = world.proposals.find(item => item.key === key);
  assert.ok(proposal);
  proposal.supporters = actors.map(actor => actor.id);
  for (const actor of actors) actor.action = { kind: 'meeting', target: 'hall', phase: 'working', remaining: 75 };
  world.moot = { at: 1110, tries: 0 };
  world.minute = 1110;
  civic.tick(village, () => {}, () => 0.5);
  world.minute += 40;
  civic.tick(village, () => {}, () => 0.5);
  const project = world.projects.find(item => item.key === key);
  assert.ok(project);
  assert.equal(project.for, undefined);
  assert.equal(world.mootHistory.at(-1).items[0].status, 'agreed');
});

test('teaching is a protected choice and a lesson stops if the hall is taken for a moot', () => {
  const village = stockedVillage(), { world } = village;
  const teacher = village.actors.find(actor => actor.id === 'edith');
  const hall = place(village.map, 'hall');
  world.minute = DAY + 500; // Wednesday morning
  world.cottages[teacher.home].children = [{ name: 'Joan', born: world.minute - 9 * YEAR, parents: [teacher.id] }];
  teacher.schoolTeacher = true;
  teacher.position = { x: hall.at[0], y: hall.at[1] };
  teacher.action = { kind: 'waiting', phase: 'waiting', since: world.minute, target: 'hall', remaining: 0 };
  const choices = availableActions(teacher, village), id = 'teach:hall';
  assert.ok(choices.has(id));
  assert.ok(shapeActionMenu(teacher, village, choices).menu.has(id));
  world.moot = { at: world.minute + 20, tries: 0 };
  assert.ok(!availableActions(teacher, village).has(id));
  world.moot = null;
  startChosen(teacher, village, id, { id: '8' });
  stepVillage(village, { minutes: 55, externalActions: true });
  const session = world.school.lesson;
  assert.equal(session.teacher, teacher.id);
  assert.ok(Object.values(session.pupils).some(pupil => pupil.minutes > 0));
  world.moot = { at: world.minute + 35, tries: 0 };
  const event = stepVillage(village, { minutes: 1, externalActions: true }).find(row => row.outcome?.lesson);
  assert.equal(event.outcome.status, 'interrupted');
  assert.equal(event.outcome.first, true);
  assert.equal(world.school.lesson, undefined);
});

test('a free-running family preview records school, play and delivered kindling', () => {
  const village = stockedVillage(), { world } = village;
  world.familyArrivals = [];
  world.minute = 539;
  world.supplies.flour = world.capacity.flour;
  world.supplies.wood = world.capacity.wood;
  for (let i = 0; i < 3; i++) addCottage(village);
  const play = new Set();
  const events = stepVillage(village, { minutes: 7 * DAY, observe: ({ world }) => {
    for (const child of childResidents(world)) {
      if (child.action.kind === 'play' && child.action.phase === 'working') play.add(child.id);
    }
  } });
  assert.equal(world.familyArrivals.length, 2);
  assert.ok(world.familyArrivals.every(family => family.fedDawns === 3));
  const children = childResidents(world);
  assert.equal(children.length, 8);
  assert.ok(children.every(child => !village.actors.some(actor => actor.id === child.id)));
  assert.ok(children.filter(child => child.age < 5).every(child => !play.has(child.id)));
  assert.ok(play.size >= 4);
  const lessons = events.filter(event => event.outcome?.lesson);
  assert.equal(lessons.filter(event => event.outcome.first).length, 1);
  assert.ok(lessons.some(event => event.outcome.status === 'completed' && event.outcome.pupils.length >= 4));
  const chores = events.filter(event => event.outcome?.chore === 'kindling');
  assert.ok(chores.length >= 2);
  assert.ok(chores.every(event => event.outcome.stockDelta.wood === -1 && event.outcome.householdDelta.woodpile === 1));
  assert.equal(new Set(chores.map(event => Math.floor(event.minute / DAY) + '/' + event.outcome.home)).size, chores.length);
});

test('the hosted clock saves a family, their household and their bread together', { skip: !adminUrl }, async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  const name = 'dalecrest_family_test_' + randomUUID().replaceAll('-', '');
  let db, created = false;
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE ' + name);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = '/' + name;
    process.env.DATABASE_URL = url.href;
    process.env.PLANNER_PROVIDER = 'openai';
    process.env.VILLAGE_SECONDS_PER_MINUTE = '30';
    process.env.VILLAGE_MIN_RESIDENTS = '8';
    process.env.VILLAGE_FAMILY_ARRIVALS = '1';
    db = await import('./db.mjs');
    await db.initialize();

    const village = stockedVillage();
    const home = addCottage(village).id;
    village.world.minute = 539;
    village.world.mapRevision = village.map.revision;
    await db.pool.query('UPDATE dalecrest.map SET revision=$1,state=$2 WHERE id=1', [village.map.revision, village.map]);
    await db.pool.query('UPDATE dalecrest.world SET state=$1,next_tick=now() WHERE id=1', [village.world]);
    const keeper = village.actors.find(actor => actor.trade === 'keep');
    await db.pool.query('UPDATE dalecrest.actors SET state=$1 WHERE id=$2', [keeper, keeper.id]);
    await db.advance();

    const snapshot = await db.snapshot();
    assert.equal(snapshot.world.minute, 540);
    assert.equal(snapshot.world.supplies.bread, 26);
    assert.equal(snapshot.world.cottages[home].larder, 6);
    assert.equal(snapshot.world.cottages[home].children.length, 4);
    const family = snapshot.world.familyArrivals[0];
    assert.equal(family.home, home);
    assert.deepEqual(snapshot.actors.filter(actor => actor.home === home).map(actor => actor.id), family.parents);
    assert.equal(snapshot.events.filter(event => event.type === 'arrival').length, 1);

    await db.initialize();
    await db.advance();
    assert.deepEqual((await db.snapshot()).world.familyArrivals, [family]);
  } finally {
    if (db) await db.pool.end();
    if (created) await admin.query('DROP DATABASE ' + name);
    await admin.end();
  }
});

test('a family’s oxen eat a little stored hay in winter and none the rest of the year', async () => {
  const { feedOxen, OX_HAY } = await import('./engine/families.mjs');
  const world = { familyArrivals: [{ cart: { oxen: 2 } }], supplies: { hay: 40 } };
  let winter = 0, summer = 0;
  for (let day = 0; day < 400 && (!winter || !summer); day++) {
    const minute = day * DAY + 360, month = (await import('./engine/calendar.mjs')).dateOf(minute).month;
    if (!winter && [12, 1, 2].includes(month)) winter = minute;
    if (!summer && month === 7) summer = minute;
  }
  world.minute = summer;
  for (let i = 0; i < 30; i++) feedOxen(world);
  assert.equal(world.supplies.hay, 40, 'they graze through the summer');
  world.minute = winter;
  for (let i = 0; i < 30; i++) feedOxen(world);
  assert.equal(world.supplies.hay, 40 - Math.round(30 * 2 * OX_HAY), 'a pair eats about a fifth of a bundle a winter day');
  world.supplies.hay = 0;
  for (let i = 0; i < 10; i++) feedOxen(world);
  assert.equal(world.supplies.hay, 0, 'with the hay gone they make do');
});

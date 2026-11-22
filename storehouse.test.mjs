// Stage 3a: the common store. Meals wait for hunger, goods are carried to the storehouse, each household
// draws its allowance there, and a storekeeper counts the shelves and can ask the baker for bread.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillage, stepVillage, availableActions, startChosen, adoptVillage } from './sim.mjs';
import { place } from './engine/roads.mjs';
import { actionBody } from './decisions.mjs';
import { ALLOWANCE, MEAL_FLOOR, issueAllowance } from './engine/storehouse.mjs';

const DAY = 1440;
const tick = (village, minutes = 1, externalActions = true) => stepVillage(village, { minutes, externalActions });
const resident = (village, id) => village.actors.find(a => a.id === id);
const menuOf = (village, actor) => [...availableActions(actor, village).keys()];
function choose(village, actor, prefix) {
  actor.action = { kind: 'waiting', phase: 'waiting', remaining: 0, target: actor.action.target, since: village.world.minute };
  const id = menuOf(village, actor).find(k => k.startsWith(prefix));
  assert.ok(id, 'no ' + prefix + ' on the menu: ' + menuOf(village, actor).join(' '));
  return startChosen(actor, village, id, { id: 't' + village.world.minute, model: 'test' });
}
// Everyone else rests, so only the residents under test change the stores.
const quiet = (village, ...busy) => {
  for (const a of village.actors) if (!busy.includes(a)) a.action = { kind: 'rest', label: 'Resting', target: a.home, phase: 'working', remaining: 5000 };
};
const until = (village, fits, limit = 300) => {
  for (let i = 0; i < limit; i++) { const found = tick(village).find(fits); if (found) return found; }
};

test('nobody is offered a meal until they are hungry', () => {
  const village = createVillage(), hugh = resident(village, 'hugh');
  Object.assign(village.world.supplies, { cooked: 3, preserved: 3 });
  village.world.cottages[hugh.home].larder = 2;
  hugh.needs.hunger = MEAL_FLOOR - 1;
  assert.ok(!menuOf(village, hugh).some(k => k.startsWith('food:')));
  hugh.needs.hunger = MEAL_FLOOR + 10;
  const menu = menuOf(village, hugh);
  for (const meal of ['food:draw:storehouse', 'food:larder:', 'food:cooked:hall', 'food:preserved:hall']) assert.ok(menu.some(k => k.startsWith(meal)), meal);
  assert.ok(!menu.includes('food:oven'), 'bread is no longer taken at the oven');
});

test('every village has a storehouse, and a keeper is sent for who sleeps there', () => {
  const village = createVillage(), store = place(village.map, 'storehouse');
  assert.equal(store.kind, 'storehouse');
  assert.equal(store.name, 'Storehouse');
  assert.ok(village.world.condition.storehouse > 0, 'the storehouse wears like the other common buildings');
  const events = tick(village, 120, false);
  const keeper = village.actors.find(a => a.trade === 'keep');
  assert.ok(keeper, 'no keeper came');
  assert.equal(keeper.home, 'storehouse');
  assert.equal(keeper.role, 'Storekeeper');
  assert.ok(events.some(e => e.type === 'arrival' && /came up the road to keep the storehouse/.test(e.text)));
  assert.equal(village.actors.filter(a => a.trade === 'keep').length, 1);
  // A village stored before the storehouse gains one in the same place a new one would have it.
  const { world, actors } = createVillage();
  const legacy = { world: { minute: 5000, seed: world.seed, supplies: world.supplies }, actors };
  const map = adoptVillage(legacy);
  assert.deepEqual(place(map, 'storehouse').at, store.at);
});

test('a baker carries the loaves to the storehouse, and they count when they are on the shelf', () => {
  const village = createVillage(), mabel = resident(village, 'mabel');
  village.world.minute = 2 * DAY + 600;
  Object.assign(village.world.supplies, { flour: 10, wood: 10, bread: 4 });
  const oven = place(village.map, 'oven');
  mabel.position = { x: oven.at[0], y: oven.at[1] };
  mabel.action = { kind: 'work', job: 'bake', label: 'Baking bread', target: 'oven', phase: 'working', remaining: 1, basis: { kind: 'fresh', trace: '4' } };
  quiet(village, mabel);
  tick(village);
  assert.equal(mabel.action.label, 'Carrying five loaves to the storehouse');
  assert.equal(mabel.action.target, 'storehouse');
  assert.equal(village.world.supplies.bread, 4, 'loaves on the road are not yet on the shelf');
  assert.equal(village.world.supplies.flour, 8, 'what the oven used is gone');
  const done = until(village, e => e.type === 'work' && e.actorIds.includes('mabel'));
  assert.equal(done.text, 'Mabel Ash drew five loaves from the oven and took them to the storehouse.');
  assert.deepEqual(done.outcome, { job: 'bake', site: 'oven', workerId: 'mabel', helperIds: [], status: 'completed',
    stockDelta: { flour: -2, wood: -1, bread: 5 }, basis: 'fresh', traceId: '4' });
  assert.equal(done.place.id, 'storehouse');
  assert.equal(village.world.supplies.bread, 9);
  // The carry is the end of the shift. The next activity is a choice like any other.
  tick(village);
  assert.equal(mabel.action.kind, 'waiting');
});

test('a household draws what is due to it, and no more', () => {
  const village = createVillage(), agnes = resident(village, 'agnes'), { world } = village;
  const cottage = world.cottages[agnes.home];
  world.minute = 2 * DAY + 600;
  world.supplies.bread = 20;
  Object.assign(cottage, { larder: 0, ration: 2.5 });
  agnes.needs.hunger = 70;
  quiet(village, agnes);
  choose(village, agnes, 'food:draw:storehouse');
  const meal = until(village, e => e.type === 'meal');
  assert.equal(meal.text, 'Agnes Reed drew 2 loaves at the storehouse for the household and ate one.');
  assert.equal(world.supplies.bread, 18);
  assert.equal(cottage.larder, 1);
  assert.equal(cottage.ration, 0.5);
  assert.ok(agnes.needs.hunger < 20);
  // Nothing more is due today, however hungry she gets.
  agnes.needs.hunger = 90;
  assert.ok(!menuOf(village, agnes).includes('food:draw:storehouse'));
  assert.ok(menuOf(village, agnes).some(k => k.startsWith('food:larder:')));
  // The day's allowance comes at dawn, and an allowance left undrawn keeps only one more day.
  issueAllowance(village);
  assert.equal(cottage.ration, 0.5 + ALLOWANCE);
  for (let d = 0; d < 5; d++) issueAllowance(village);
  assert.equal(cottage.ration, 2 * ALLOWANCE);
  // A bare shelf is found out by going to look.
  world.supplies.bread = 1;
  agnes.needs.hunger = 70;
  choose(village, agnes, 'food:draw:storehouse');
  world.supplies.bread = 0;
  for (let i = 0; i < 200 && agnes.action.kind === 'food'; i++) tick(village);
  assert.ok(agnes.memories.some(m => m.shortage === 'bread' && /shelves at the storehouse bare/.test(m.text)));
});

test('a lodger draws a loaf at a time, against their own allowance', () => {
  const village = createVillage(), { world } = village;
  tick(village, 120, false);
  const keeper = village.actors.find(a => a.trade === 'keep');
  quiet(village, keeper);
  keeper.ration = 1;
  keeper.needs.hunger = 60;
  world.supplies.bread = 10;
  choose(village, keeper, 'food:draw:storehouse');
  const meal = until(village, e => e.type === 'meal');
  assert.match(meal.text, /drew a loaf at the storehouse and ate it\.$/);
  assert.equal(world.supplies.bread, 9);
  assert.equal(keeper.ration, 0);
  assert.ok(!menuOf(village, keeper).includes('food:draw:storehouse'));
});

test('the keeper counts the shelves, and a short count can be passed on and becomes a request to the baker', () => {
  const village = createVillage(), { world } = village;
  world.minute = 2 * DAY + 480;
  tick(village, 60, false);
  const keeper = village.actors.find(a => a.trade === 'keep');
  const mabel = resident(village, 'mabel');
  world.supplies.bread = 2;
  quiet(village, keeper);
  const store = place(village.map, 'storehouse');
  keeper.position = { x: store.at[0], y: store.at[1] };
  choose(village, keeper, 'work:keep:storehouse');
  const count = until(village, e => e.type === 'work' && e.actorIds.includes(keeper.id));
  assert.match(count.text, /counted the shelves at the storehouse: 2 loaves, /);
  assert.equal(keeper.lastLowCount.item, 'bread');
  // The keeper can tell a neighbour, and can ask the baker for bread.
  const menu = menuOf(village, keeper);
  assert.ok(menu.some(k => k.startsWith('share:mabel:store-' + keeper.id)), menu.join(' '));
  assert.ok(menu.some(k => k.startsWith('ask:mabel:bread-store-')), menu.join(' '));
  assert.ok(!menu.some(k => k.startsWith('ask:agnes:bread-')), 'only a baker is asked to bake');
  // Told, Mabel knows what the shelves held and who counted them.
  mabel.position = { ...keeper.position };
  mabel.action = { kind: 'leisure', label: 'Walking', target: 'storehouse', phase: 'working', remaining: 200 };
  choose(village, keeper, 'share:mabel:store-');
  until(village, e => e.type === 'social' && e.outcome?.verb === 'share');
  assert.equal(mabel.reports.store.fact.stock.bread, 2);
  const seen = JSON.parse(actionBody(mabel, world, availableActions(mabel, village))).input[0].content[0].data;
  assert.equal(seen.lastStorehouseCount.bread, 2);
  assert.equal(seen.lastStorehouseCount.toldBy, keeper.name);
  assert.match(seen.breadAllowance, /due|Nothing more/);
});

test('loaves taken across a month stay near what residents eat', () => {
  const village = createVillage(26112);
  let drawn = 0, residentDays = 0, hungry = 0, samples = 0;
  for (let d = 0; d < 20; d++) {
    for (let h = 0; h < 24; h++) {
      for (const e of tick(village, 60, false)) {
        const many = /drew (\d+) loaves at the storehouse/.exec(e.text);
        if (many) drawn += Number(many[1]);
        else if (/drew (the household’s|a) loaf at the storehouse/.test(e.text)) drawn++;
        if (/took a loaf from the/.test(e.text)) assert.fail('a loaf was taken at the oven: ' + e.text);
      }
      for (const a of village.actors) { samples++; if (a.needs.hunger > 80) hungry++; }
    }
    residentDays += village.actors.length;
  }
  assert.ok(drawn / residentDays <= 1.5, (drawn / residentDays).toFixed(2) + ' loaves a resident a day');
  assert.ok(hungry / samples < 0.02, 'residents went hungry ' + (100 * hungry / samples).toFixed(1) + '% of the time');
});

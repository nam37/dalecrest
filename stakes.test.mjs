// Stage 3: a village with stakes. The year's harvest, households, lives, the working day, visitors from
// outside and a chronicle that selects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillage, stepVillage, availableActions, startChosen } from './sim.mjs';
import { FIELD_HOLDS, foodDays, growing, harvestYear, mouths, ripening, storeDays } from './engine/stores.mjs';
import { forgetTold, judge, salienceOf, PUBLIC } from './engine/chronicle.mjs';
import { ageOf, maybeCourt, removeResident } from './engine/lives.mjs';
import { restDay, tradeOpen } from './engine/workday.mjs';
import { dateOf } from './engine/calendar.mjs';
import { concerns } from './engine/civic.mjs';
import { actionBody } from './decisions.mjs';

const DAY = 1440;
const tick = (village, minutes = 1, externalActions = false) => stepVillage(village, { minutes, externalActions });
// The first minute of a village day that passes the test, counting from day 0, 1 August 1312.
const dayWhen = (fits, from = 0) => { for (let d = from; d < from + 800; d++) if (fits(d * DAY)) return d * DAY; throw new Error('no such day'); };
const resident = (village, id) => village.actors.find(a => a.id === id);
function chooseFor(village, actor, prefix) {
  actor.action = { kind: 'waiting', phase: 'waiting', remaining: 0, target: actor.action.target, since: village.world.minute };
  const id = [...availableActions(actor, village).keys()].find(k => k.startsWith(prefix));
  assert.ok(id, 'no ' + prefix + ' on the menu: ' + [...availableActions(actor, village).keys()].join(' '));
  return startChosen(actor, village, id, { id: 't' + village.world.minute, model: 'test' });
}

test('barley ripens only from April to October, in good years and poor', () => {
  for (const month of [11, 12, 1, 2, 3]) assert.equal(ripening(dayWhen(m => dateOf(m).month === month)), 0);
  assert.ok(ripening(dayWhen(m => dateOf(m).month === 8)) > ripening(dayWhen(m => dateOf(m).month === 5)));
  let total = 0;
  for (let d = 0; d < 365; d++) total += ripening(d * DAY);
  assert.ok(total > 700 && total < 760, 'a field ripens ' + total + ' measures in an ordinary year');
  for (let year = 0; year < 30; year++) {
    const kind = harvestYear((40 + 365 * year) * DAY, 26111 + year);
    assert.ok(kind >= 0.55 && kind <= 1.2);
  }
  // Nothing grows in the fields over a winter, so nothing can be gathered.
  const village = createVillage();
  const winter = dayWhen(m => dateOf(m).month === 12) + 300;
  village.world.minute = winter;
  for (const id of Object.keys(village.world.fields)) village.world.fields[id] = 0;
  tick(village, 20 * DAY);
  assert.ok(Object.values(village.world.fields).every(n => n === 0));
  assert.ok(!growing(village.world.minute));
  assert.ok(Object.values(village.world.fields).every(n => n <= FIELD_HOLDS));
});

test('food is counted in days, so a granary with room to spare is no shortage', () => {
  const village = createVillage();
  const { world } = village;
  Object.assign(world.supplies, { grain: 20, flour: 10, bread: 10, cooked: 0, preserved: 0 });
  const days = foodDays(world, mouths(village));
  assert.equal(Math.round(days * 10) / 10, Math.round((20 * 3.75 + 10 * 2.5 + 10) / (8 * 1.14) * 10) / 10);
  // Twelve days of food is no shortage however large the barn, and nobody talks of one.
  world.capacity.grain = 1000;
  assert.ok(storeDays(world, 8) > 150);
  assert.ok(!concerns(village.actors[0], village).some(c => c.kind === 'granary'), 'a barn with room to spare asks for no granary');
  // A barn that could not see the village through a winter, filling at harvest, starts the case for a granary.
  world.capacity.grain = 160;
  world.supplies.grain = 120;
  for (let i = 0; i < 12; i++) village.actors.push({ ...structuredClone(village.actors[1]), id: 'extra' + i });
  assert.ok(storeDays(world, village.actors.length) < 150);
  assert.ok(concerns(village.actors[0], village).some(c => c.kind === 'granary'));
});

test('a hard winter can outrun the stores', () => {
  // Early December with three weeks in store, inaccessible wild food and no surplus sheep.
  const village = createVillage(26113), { world } = village;
  world.minute = dayWhen(m => dateOf(m).month === 12) + 359;
  Object.assign(world.supplies, { grain: 30, flour: 8, bread: 10, cooked: 0, preserved: 0, fish: 0, meat: 0, game: 0 });
  Object.assign(world.capacity, { fish: 0, game: 0 });
  world.smallholding.flock.spare = 0;
  for (const id of Object.keys(world.fields)) world.fields[id] = 0;
  let empty = null;
  for (let d = 0; d < 60 && empty == null; d++) {
    tick(village, DAY);
    if (foodDays(world, mouths(village)) < 0.5) empty = d;
  }
  assert.ok(empty != null, 'the stores lasted the winter');
  // What is left in the larders and the catch from the river last a little while after the stores are empty.
  let hungry = false;
  for (let d = 0; d < 14 && !hungry; d++) {
    tick(village, DAY);
    hungry = village.actors.some(a => a.illness || a.hardship?.hungry >= 2 || a.needs.hunger > 85);
  }
  assert.ok(hungry, 'nobody went hungry');
});

test('the public chronicle selects: routine stays out and no sentence fills it', () => {
  const village = createVillage(26112);
  const shapes = new Map();
  let shown = 0, all = 0;
  for (let d = 0; d < 90; d++) {
    for (const e of tick(village, DAY)) {
      all++;
      assert.ok(Number.isFinite(e.salience));
      if (e.type === 'meal') assert.equal(e.salience, 0);
      if (e.salience < PUBLIC) continue;
      shown++;
      const key = e.text.replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, 'X').replace(/\d+/g, 'N');
      shapes.set(key, (shapes.get(key) || 0) + 1);
    }
  }
  assert.ok(shown > 30 && shown < all / 10, shown + ' public entries of ' + all);
  const [top, n] = [...shapes].sort((a, b) => b[1] - a[1])[0];
  assert.ok(n / shown <= 0.1, (100 * n / shown).toFixed(1) + '% is "' + top + '"');
  // Older entries without a salience are rated by kind and content.
  assert.equal(salienceOf({ type: 'social', text: 'A asked B.', outcome: { verb: 'ask' } }), 6);
  assert.equal(salienceOf({ type: 'work', text: 'A stacked wood.', outcome: { status: 'completed' } }), 1);
  assert.ok(salienceOf({ type: 'life', text: 'A and B were married.' }) >= PUBLIC);
});

test('the same people doing the same thing again within three days is routine the second time', () => {
  const world = { minute: 0, told: {} };
  const loaf = minute => ({ type: 'social', minute, text: 'Agnes Reed and Hugh Fen divided a warm loaf between them at the oven.', actorIds: [] });
  const talk = (minute, where) => ({ type: 'social', minute, text: 'Agnes Reed and Hugh Fen discussed the dwindling water reserve ' + where + '.', actorIds: [] });
  const events = [loaf(1000), talk(1000, 'at the well'), loaf(1000 + DAY), talk(1000 + DAY, 'on the green')];
  judge(world, events);
  assert.deepEqual(events.map(e => e.salience >= PUBLIC), [true, true, false, false]);
  world.minute = 1000 + 4 * DAY;
  forgetTold(world);
  const later = [loaf(world.minute)];
  judge(world, later);
  assert.ok(later[0].salience >= PUBLIC);
});

test('residents age, fall ill from hunger, mend when fed, and a long illness takes them away', () => {
  const village = createVillage(), { world } = village;
  const agnes = resident(village, 'agnes');
  assert.equal(ageOf(agnes, world.minute), 34);
  assert.equal(agnes.sex, 'f');
  // Days of hunger at dawn bring illness.
  world.minute = 2 * DAY + 300;
  world.supplies.bread = 0;
  let ill = false;
  for (let d = 0; d < 8 && !ill; d++) {
    agnes.needs.hunger = 95;
    // Nothing in the larder at home, nothing due at the storehouse and nothing cooked at the hall.
    Object.assign(world.cottages[agnes.home], { larder: 0, ration: 0 });
    Object.assign(world.supplies, { cooked: 0, preserved: 0 });
    tick(village, DAY);
    ill = Boolean(agnes.illness);
  }
  assert.ok(ill, 'hunger did not make Agnes ill');
  assert.ok(![...availableActions(agnes, village).values()].some(a => a.kind === 'work') || agnes.illness.severity < 2);
  assert.ok(JSON.parse(actionBody(agnes, world, availableActions(agnes, village))).input[0].content[0].data.life.ill);
  // Fed, warm and rested, she mends.
  for (let d = 0; d < 20 && agnes.illness; d++) {
    Object.assign(agnes.needs, { hunger: 10, cold: 0, fatigue: 10 });
    tick(village, DAY);
  }
  assert.equal(agnes.illness, undefined);
  // A long, grave illness: in the live village the resident leaves to be nursed elsewhere.
  const live = createVillage(), hugh = resident(live, 'hugh');
  live.world.minute = 3 * DAY + 300;
  hugh.illness = { since: live.world.minute - 30 * DAY, cause: 'cold', severity: 3, worst: 3, gravely: 5 };
  const events = [];
  for (let d = 0; d < 3 && live.actors.includes(hugh); d++) {
    Object.assign(hugh.needs, { hunger: 99, cold: 99, fatigue: 99 });
    events.push(...tick(live, DAY));
  }
  assert.ok(!live.actors.includes(hugh));
  assert.ok(events.some(e => e.type === 'life' && /Hugh Fen has left Dalecrest, too ill to stay/.test(e.text)));
  assert.equal(live.world.departed.at(-1).how, 'nursed');
  // Where the village allows it, a long illness can end in death.
  let died = false;
  for (let seed = 1; seed < 12 && !died; seed++) {
    const mortal = createVillage(26000 + seed), oswin = resident(mortal, 'oswin');
    mortal.world.mortal = true;
    mortal.world.minute = 3 * DAY + 300;
    oswin.illness = { since: mortal.world.minute - 17 * DAY, cause: 'age', severity: 3, worst: 3, gravely: 5 };
    Object.assign(oswin.needs, { hunger: 99, cold: 99, fatigue: 99 });
    died = tick(mortal, DAY).some(e => e.type === 'life' && /Oswin Holt died of/.test(e.text));
  }
  assert.ok(died);
});

test('a resident who goes leaves their open requests, their partner and their strip behind settled', () => {
  const village = createVillage(), { world } = village;
  const agnes = resident(village, 'agnes'), hugh = resident(village, 'hugh');
  world.helpRequests = { r1: { id: 'r1', askerId: 'agnes', helperId: 'hugh', status: 'accepted', due: world.minute + 500, terms: 'grind flour' } };
  hugh.helpBook = { r1: { ...world.helpRequests.r1 } };
  agnes.spouse = 'hugh'; hugh.spouse = 'agnes'; hugh.spouseName = 'Agnes Reed';
  const events = [];
  removeResident(village, agnes, 'hungry', (type, text, actorIds, outcome) => events.push({ type, text, actorIds, outcome }), () => 0.1);
  assert.ok(!village.actors.includes(agnes));
  assert.deepEqual(world.helpRequests, {});
  assert.equal(hugh.helpBook.r1.status, 'released');
  assert.equal(hugh.spouse, undefined);
  assert.equal(world.barleyStrip.keeper, 'hugh');
  assert.match(events[0].text, /^Agnes Reed has left Dalecrest to look for bread in /);
  assert.ok(hugh.memories.some(m => m.kind === 'life' && /Agnes Reed has left/.test(m.text)));
});

test('two residents who grow close may walk out together, though not every close pair', () => {
  const village = createVillage();
  const said = [];
  // Strangers never court.
  maybeCourt(village.actors[0], village.actors[1], village, (type, text) => said.push(text));
  assert.equal(village.actors[0].courting, undefined);
  // Close, trusting pairs court only where there is a spark, which is fixed for the pair.
  let pairs = 0, courting = 0;
  for (const x of village.actors) for (const y of village.actors) {
    if (x.id >= y.id || x.courting || y.courting) continue;
    pairs++;
    for (const [p, q] of [[x, y], [y, x]]) { p.relationships[q.id] = 90; (p.trust ??= {})[q.id] = 60; }
    maybeCourt(x, y, village, (type, text) => said.push(text));
    if (x.courting) courting++;
  }
  assert.ok(courting >= 1 && courting < pairs / 2, courting + ' of ' + pairs + ' pairs began courting');
  assert.ok(said.every(t => /have begun walking out together\.$/.test(t)));
});

test('a proposal, an answer, and a wedding on the green that brings two households under one roof', () => {
  const village = createVillage(), { world } = village;
  const mabel = resident(village, 'mabel'), thomas = resident(village, 'thomas');
  world.minute = 10 * DAY + 600;
  mabel.courting = { with: 'thomas', name: thomas.name, since: world.minute - 40 * DAY };
  thomas.courting = { with: 'mabel', name: mabel.name, since: world.minute - 40 * DAY };
  // Put them side by side, awake.
  thomas.position = { ...mabel.position };
  thomas.action = { kind: 'leisure', label: 'Walking', target: mabel.action.target, phase: 'working', remaining: 200 };
  chooseFor(village, mabel, 'propose:thomas');
  tick(village, 5, true);
  assert.equal(thomas.proposal?.from, 'mabel');
  // Thomas answers on his own turn.
  mabel.action = { kind: 'leisure', label: 'Walking', target: thomas.action.target, phase: 'working', remaining: 200 };
  mabel.position = { ...thomas.position };
  chooseFor(village, thomas, 'wed:mabel');
  const said = tick(village, 5, true);
  assert.ok(said.some(e => /Thomas Pike agreed to marry Mabel Ash/.test(e.text)));
  const wedding = world.weddings[0];
  assert.equal(dateOf(wedding.at).weekday, 'Sunday');
  world.minute = wedding.at - 1;
  const day = tick(village, 2);
  assert.ok(day.some(e => /Thomas Pike and Mabel Ash were married on the green|Mabel Ash and Thomas Pike were married on the green/.test(e.text)));
  assert.equal(mabel.spouse, 'thomas');
  assert.equal(mabel.home, thomas.home);
});

test('a married couple can have a child, who eats from the larder and comes of age', () => {
  const village = createVillage(), { world } = village;
  const mabel = resident(village, 'mabel'), thomas = resident(village, 'thomas');
  mabel.spouse = 'thomas'; mabel.spouseName = thomas.name; thomas.spouse = 'mabel'; thomas.spouseName = mabel.name;
  thomas.home = mabel.home;
  world.minute = 3 * DAY + 359;
  mabel.expecting = { since: 0, due: world.minute + 1 };
  const born = tick(village, 2);
  const cottage = world.cottages[mabel.home];
  assert.equal(cottage.children.length, 1);
  assert.ok(born.some(e => e.type === 'life' && / have a (son|daughter), /.test(e.text)));
  // A year on the child eats a loaf a day from the larder, and goes hungry when it is empty.
  cottage.children[0].born -= 400 * DAY;
  world.minute = 4 * DAY + 359;
  cottage.larder = 0;
  const morning = tick(village, 2);
  assert.ok(morning.some(e => /missed breakfast/.test(e.text) && e.outcome?.hungry === 1));
  assert.ok(mabel.memories.some(m => m.shortage === 'larder'));
  assert.ok(mouths(village) > village.actors.length);
  // At fourteen the child takes their place among the residents.
  const count = village.actors.length;
  cottage.children[0].born -= 15 * 365.25 * DAY;
  const grown = tick(village, DAY);
  // The day may also bring the storekeeper up the road.
  assert.equal(village.actors.length, count + 1 + grown.filter(e => e.type === 'arrival').length);
  assert.ok(grown.some(e => /has come of age/.test(e.text)));
  assert.equal(village.actors.find(a => a.backstory.includes('was born in Dalecrest')).home, mabel.home);
});

test('a lodger moves into a cottage that stands empty', () => {
  const village = createVillage(), { world } = village;
  const edith = resident(village, 'edith'), empty = edith.home;
  edith.home = 'hall';
  const lodger = resident(village, 'alice');
  lodger.home = 'hall';
  lodger.arrived = -100;
  edith.arrived = 0;
  world.minute = 2 * DAY + 359;
  const said = tick(village, 2);
  assert.ok(said.some(e => /Alice Brook has moved from the hall into the empty cottage/.test(e.text)));
  assert.equal(lodger.home, empty);
});

test('trades keep hours, and nobody works at a trade on a Sunday or a feast day', () => {
  const sunday = dayWhen(m => dateOf(m).weekday === 'Sunday');
  assert.equal(restDay(sunday + 600), 'Sunday');
  assert.equal(restDay(dayWhen(m => dateOf(m).month === 9 && dateOf(m).day === 29)), 'Michaelmas');
  assert.ok(!tradeOpen('mill', sunday + 600) && tradeOpen('draw', sunday + 600));
  const tuesday = sunday + 2 * DAY;
  assert.ok(tradeOpen('bake', tuesday + 300) && !tradeOpen('mill', tuesday + 300) && !tradeOpen('weave', tuesday + 1350));
  const village = createVillage(), hugh = resident(village, 'hugh');
  village.world.minute = sunday + 600;
  assert.ok(![...availableActions(hugh, village).keys()].some(k => k.startsWith('work:mill')));
  assert.equal(JSON.parse(actionBody(hugh, village.world, availableActions(hugh, village))).input[0].content[0].data.dayOfRest, 'Sunday');
  village.world.minute = tuesday + 600;
  assert.ok([...availableActions(hugh, village).keys()].some(k => k.startsWith('work:mill')));
  // On a feast day the village eats together on the green.
  const feast = createVillage(), michaelmas = dayWhen(m => dateOf(m).month === 9 && dateOf(m).day === 29);
  feast.world.minute = michaelmas + 779;
  const said = tick(feast, 2);
  assert.ok(said.some(e => e.type === 'feast' && /keeps Michaelmas with a feast on the green/.test(e.text)));
  assert.ok([...availableActions(resident(feast, 'alice'), feast).values()].some(a => a.feast === 'Michaelmas'));
});

test('a second baker waits for the oven, and a worn oven bakes less until the carpenter mends it', () => {
  const village = createVillage(), { world } = village;
  const mabel = resident(village, 'mabel'), robin = resident(village, 'robin');
  world.minute = 2 * DAY + 600;
  Object.assign(world.supplies, { flour: 20, wood: 10, bread: 0 });
  const oven = village.map.places.find(p => p.id === 'oven');
  for (const [who, remaining] of [[mabel, 10], [robin, 58]]) {
    who.position = { x: oven.at[0], y: oven.at[1] };
    who.action = { kind: 'work', job: 'bake', label: 'Baking bread', target: 'oven', phase: 'working', remaining };
  }
  tick(village, 3, true);
  assert.ok(robin.action.queued);
  assert.equal(robin.action.label, 'Waiting for the oven');
  assert.equal(robin.action.remaining, 58);
  tick(village, 9, true);
  assert.equal(robin.action.queued, undefined);
  assert.ok(robin.action.remaining < 58);
  // An oven in poor repair turns out four loaves, not five, which go to the storehouse.
  world.condition.oven = 30;
  mabel.action = { kind: 'work', job: 'bake', label: 'Baking bread', target: 'oven', phase: 'working', remaining: 1 };
  robin.action = { kind: 'rest', label: 'Resting', target: robin.home, phase: 'working', remaining: 500 };
  for (const a of village.actors) if (a !== mabel && a !== robin) a.action = { kind: 'rest', label: 'Resting', target: a.home, phase: 'working', remaining: 500 };
  const before = world.supplies.bread;
  tick(village, 1, true);
  assert.equal(mabel.action.label, 'Carrying four loaves to the storehouse');
  assert.equal(world.supplies.bread, before);
  let baked;
  for (let i = 0; i < 60 && !baked; i++) baked = tick(village, 1, true).find(e => e.type === 'work' && e.actorIds.includes('mabel'));
  assert.match(baked.text, /drew four loaves from the oven, the oven being in poor repair, and took them to the storehouse/);
  assert.equal(baked.outcome.site, 'oven');
  assert.deepEqual(baked.outcome.stockDelta, { flour: -2, wood: -1, bread: 4 });
  assert.equal(world.supplies.bread, before + 4);
  // The stock of repair work goes to the worst building at dawn.
  world.minute = 3 * DAY + 359;
  world.supplies.repair = 5;
  const said = tick(village, 1);
  assert.equal(world.condition.oven, 30 - 1 + 12);
  assert.equal(world.supplies.repair, 2);
  void said;
});

test('the reeve takes the rent, a peddler trades, and strays are seen and driven off', () => {
  const village = createVillage(), { world } = village;
  const michaelmas = dayWhen(m => dateOf(m).month === 9 && dateOf(m).day === 29);
  world.minute = michaelmas + 359;
  world.supplies.grain = 100;
  world.supplies.cloth = 3;
  const rent = tick(village, 300).find(e => e.type === 'visit');
  assert.match(rent.text, /^The lord’s reeve came to the hall for the Michaelmas rent and took 10 measures of barley and a length of linen\.$/);
  assert.equal(world.supplies.grain <= 90, true);
  // A peddler on the green.
  world.peddler = { name: 'Hamon of Ashby', from: world.minute - 10, until: world.minute + 300 };
  world.supplies.cloth = 2;
  world.supplies.preserved = 0;
  const edith = resident(village, 'edith');
  chooseFor(village, edith, 'work:trade:green');
  let traded;
  for (let i = 0; i < 200 && !traded; i++) traded = tick(village, 1, true).find(e => e.type === 'work' && e.actorIds.includes('edith') && /Hamon/.test(e.text));
  assert.match(traded.text, /traded a length of linen with Hamon of Ashby for three salted fish/);
  assert.equal(traded.outcome.stockDelta.preserved, 3);
  assert.deepEqual(world.freshFood.preserved.filter(batch => batch.origins?.tradedFish), [
    { quantity: 3, origins: { tradedFish: 1 } },
  ]);
  // Stray cattle in a ripe field: those who see them know, and can drive them out.
  const field = village.map.places.find(p => p.kind === 'field');
  world.fields[field.id] = 20;
  const agnes = resident(village, 'agnes'), mabel = resident(village, 'mabel');
  agnes.position = { x: field.at[0], y: field.at[1] };
  agnes.action = { kind: 'work', job: 'harvest', label: 'Gathering barley', target: field.id, phase: 'working', remaining: 300 };
  mabel.position = { x: field.at[0] + 40, y: field.at[1] + 40 };
  mabel.action = { kind: 'rest', label: 'Resting', target: mabel.home, phase: 'working', remaining: 300 };
  world.herd = { field: field.id, from: world.minute + 1, until: world.minute + 400, from_: 'Thornwick', eaten: 0 };
  const seen = tick(village, 2).find(e => e.type === 'herd');
  assert.ok(seen.actorIds.includes('agnes') && !seen.actorIds.includes('mabel'));
  assert.ok([...availableActions(agnes, village).keys()].some(k => k.startsWith('work:driveHerd')));
  assert.ok(![...availableActions(mabel, village).keys()].some(k => k.startsWith('work:driveHerd')));
  chooseFor(village, agnes, 'work:driveHerd');
  let driven;
  for (let i = 0; i < 120 && !driven; i++) driven = tick(village, 1, true).find(e => /drove the stray cattle out of/.test(e.text));
  assert.ok(driven);
  assert.equal(world.herd, undefined);
});

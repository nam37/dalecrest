import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillage, stepVillage, availableActions } from './sim.mjs';
import { weatherAt, dayTemp, daylight, seasonOf, fuelPerHearth, chill, SPELL } from './engine/seasons.mjs';
import { actionBody } from './decisions.mjs';

const DAY = 1440;
// Village days are counted from 1 August 1312, so day 150 is in late December and day 340 in early July.
const mean = (seed, fromDay, days) => {
  let sum = 0;
  for (let d = 0; d < days; d++) sum += dayTemp((fromDay + d) * DAY, seed);
  return sum / days;
};
// The first dawn on or after a day whose mean temperature passes the test.
function dawnWhen(seed, fromDay, fits) {
  for (let day = fromDay; day < fromDay + 200; day++) if (fits(dayTemp(day * DAY, seed))) return day * DAY + 360;
  throw new Error('no such day');
}

test('the year turns: seasons follow the calendar, winter is cold and its days are short', () => {
  assert.equal(seasonOf(0), 'summer');
  assert.equal(seasonOf(40 * DAY), 'autumn');
  assert.equal(seasonOf(150 * DAY), 'winter');
  assert.equal(seasonOf(250 * DAY), 'spring');
  for (const seed of [26111, 7, 4242]) {
    const winter = mean(seed, 135, 60), summer = mean(seed, 320, 60);
    assert.ok(winter < 6, 'a winter averaging ' + winter.toFixed(1));
    assert.ok(summer > 13, 'a summer averaging ' + summer.toFixed(1));
  }
  // The shortest day falls about the thirteenth of December by the old calendar, and the longest in mid-June.
  const midwinter = daylight(134 * DAY), midsummer = daylight(316 * DAY);
  assert.ok(midwinter.length > 7 * 60 && midwinter.length < 8 * 60);
  assert.ok(midsummer.length > 16 * 60 && midsummer.length < 17 * 60);
  assert.ok(daylight(124 * DAY).length > midwinter.length && daylight(144 * DAY).length > midwinter.length);
  assert.equal(Math.round(midwinter.sunrise + midwinter.sunset), 1440);
});

test('weather is a pure function of the minute and the seed', () => {
  const a = weatherAt(150 * DAY + 400, 26111);
  assert.deepEqual(weatherAt(150 * DAY + 400, 26111), a);
  assert.deepEqual(weatherAt(150 * DAY + 401, 26111), a, 'weather holds within a spell');
  let differs = 0, snow = 0, rain = 0, total = 0;
  for (let minute = 0; minute < 365 * DAY; minute += SPELL) {
    const w = weatherAt(minute, 26111), other = weatherAt(minute, 26112);
    total++;
    if (w.temp !== other.temp) differs++;
    if (w.snow) { snow++; assert.ok(w.temp <= 1, 'snow at ' + w.temp + ' degrees'); assert.match(w.phrase, /snow/); }
    if (w.rain) { rain++; assert.ok(w.temp > 1); assert.match(w.phrase, /rain/); }
    assert.ok(!(w.rain && w.snow));
    assert.ok(w.lying >= 0 && w.lying <= 1 && w.cloud >= 0 && w.cloud <= 1);
    assert.match(w.text, /^[A-Z]/);
  }
  assert.ok(differs > total * 0.9, 'another seed has other weather');
  assert.ok(snow > 0 && rain > total * 0.1 && rain < total * 0.4, rain + ' wet spells and ' + snow + ' of snow in ' + total);
  // No snow falls or lies in high summer.
  for (let minute = 300 * DAY; minute < 360 * DAY; minute += SPELL) assert.equal(weatherAt(minute, 26111).lying, 0);
});

test('a hearth burns nothing in mild weather and a bundle a day in hard frost', () => {
  assert.equal(fuelPerHearth(15), 0);
  assert.equal(fuelPerHearth(11), 0);
  assert.equal(fuelPerHearth(5), 0.5);
  assert.equal(fuelPerHearth(-4), 1);
  assert.equal(chill(12), 0);
  assert.ok(chill(-1) === 1 && chill(-20) === 1.3);
});

// A founding village moved to a chosen dawn, a minute before the households draw on the stores.
function villageAt(minute) {
  const village = createVillage();
  village.world.minute = minute - 1;
  return village;
}

test('on a cold dawn every hearth takes firewood from the common store, and none in summer', () => {
  const summer = villageAt(dawnWhen(26111, 2, t => t >= 11));
  summer.world.supplies.wood = 20;
  const warm = stepVillage(summer, { minutes: 1 });
  assert.equal(summer.world.supplies.wood, 20);
  assert.match(warm.find(e => /^Dawn breaks/.test(e.text)).text, /village stores\.$/);

  const dawn = dawnWhen(26111, 130, t => t <= 2);
  const winter = villageAt(dawn), rate = fuelPerHearth(dayTemp(dawn, winter.map.seed));
  winter.world.supplies.wood = 20;
  const events = stepVillage(winter, { minutes: 1 });
  // Eight households, each with its own cottage.
  const taken = Math.floor(8 * rate);
  assert.ok(taken >= 6);
  assert.equal(winter.world.supplies.wood, 20 - taken);
  assert.match(events.find(e => /^Dawn breaks/.test(e.text)).text, new RegExp('carry home ' + taken + ' bundles of firewood'));
  assert.deepEqual(winter.world.coldHearths, []);
  assert.ok(winter.actors.every(a => a.observations.hearth.lit));
});

test('when the woodpile will not go round, some hearths stay cold and those households know it', () => {
  const dawn = dawnWhen(26111, 130, t => t <= -1);
  const village = villageAt(dawn);
  village.world.supplies.wood = 3;
  village.world.supplies.flour = 12;
  const events = stepVillage(village, { minutes: 1 });
  const { world, actors } = village;
  assert.equal(world.supplies.wood, 0, 'the households took what there was');
  assert.equal(world.coldHearths.length, 5);
  const short = events.find(e => /firewood for only/.test(e.text));
  assert.match(short.text, /^There was firewood for only 3 of the 8 hearths this morning\. .* woke to a cold house\.$/);
  assert.deepEqual(short.outcome, { hearths: 8, lit: 3, firewoodTaken: 3 });
  const without = actors.filter(a => world.coldHearths.includes(a.home));
  assert.deepEqual(short.actorIds.slice().sort(), without.map(a => a.id).sort());
  for (const actor of actors) {
    const cold = world.coldHearths.includes(actor.home);
    assert.equal(actor.observations.hearth.lit, !cold);
    // Only those who went without learn of the shortage, and it is theirs to remember.
    assert.equal(actor.memories.some(m => m.shortage === 'wood' && /cold hearth/.test(m.text)), cold, actor.name);
  }
  // Someone who woke to a cold hearth will turn out to cut wood, though it is not their trade.
  const weaver = actors.find(a => a.id === 'edith');
  if (world.coldHearths.includes(weaver.home)) assert.ok([...availableActions(weaver, village).keys()].some(id => id.startsWith('work:cut')));
  // The request to the action model carries the weather and the cold hearth, and only for those it happened to.
  const body = actor => JSON.parse(actionBody(actor, world, availableActions(actor, village), {}, weatherAt(world.minute, village.map.seed).text)).input[0].content[0].data;
  assert.match(body(without[0]).ownHearth, /no firewood/);
  assert.equal(body(actors.find(a => !world.coldHearths.includes(a.home))).ownHearth, undefined);
  assert.match(body(without[0]).weather, /cold|freezing/i);
  assert.equal(body(without[0]).needs.cold, 0);

  // A day and a night without a fire leaves them chilled, and those with a fire are not.
  village.world.supplies.wood = 0;
  let coldest = 0, warmest = 0;
  for (let i = 0; i < 1380; i++) {
    stepVillage(village, { minutes: 1 });
    village.world.supplies.wood = 0;
  }
  for (const actor of actors) {
    if (world.coldHearths.includes(actor.home)) coldest = Math.max(coldest, actor.needs.cold);
    else if (actor.action.kind === 'rest' && actor.action.phase === 'working') warmest = Math.max(warmest, actor.needs.cold);
  }
  assert.ok(coldest >= 60, 'the coldest reached ' + coldest.toFixed(0));
  assert.ok(warmest < 20, 'someone asleep by a fire is at ' + warmest.toFixed(0));
});

test('the fields and the coppice are worked by daylight only', () => {
  // A winter evening, an hour after sunset, with the oven store known to be empty.
  const day = 140, village = villageAt(day * DAY + Math.round(daylight(day * DAY).sunset) + 60);
  const oswin = village.actors.find(a => a.id === 'oswin');
  const jobs = () => [...availableActions(oswin, village).keys()].filter(id => id.startsWith('work:'));
  assert.deepEqual(jobs().filter(id => /cut|harvest/.test(id)), []);
  village.world.minute = day * DAY + 720;
  assert.ok(jobs().some(id => id.startsWith('work:cut')));
});

test('snow makes poor woodcutting', () => {
  // Find a spell with snow lying deep and finish a woodcutting shift in it.
  let minute = 120 * DAY;
  while (!(weatherAt(minute, 26111).lying > 0.5 && minute % DAY > 600 && minute % DAY < 780)) minute += SPELL;
  const village = villageAt(minute + 2);
  const oswin = village.actors.find(a => a.id === 'oswin'), coppice = village.map.places.find(p => p.id === 'wood');
  oswin.position = { x: coppice.at[0], y: coppice.at[1] };
  oswin.action = { kind: 'work', job: 'cut', label: 'Stacking firewood', target: 'wood', phase: 'working', remaining: 1 };
  village.world.supplies.wood = 5;
  const events = stepVillage(village, { minutes: 1 });
  const shift = events.find(e => e.type === 'work' && e.actorIds.includes('oswin'));
  assert.match(shift.text, /one bundle of dry wood out from under the snow/);
  assert.deepEqual(shift.outcome.stockDelta, { wood: 1 });
  assert.equal(village.world.supplies.wood, 6);
});

test('a first winter under local rules brings a morning with flour and no firewood, unscripted', () => {
  // Seed 26113 from its founding to the middle of February. Nothing is staged.
  const village = createVillage(26113);
  let mornings = 0, coldDays = 0, found = 0;
  for (let day = 0; day < 200; day++) {
    let bare = false;
    for (let step = 0; step < 48; step++) {
      for (const e of stepVillage(village, { minutes: 30 })) {
        if (/firewood for only/.test(e.text)) coldDays++;
        // A resident learns of it by going to the oven and counting.
        if (e.type === 'observation' && e.outcome.flour >= 2 && e.outcome.wood === 0) found++;
      }
      const t = village.world.minute % DAY, s = village.world.supplies;
      if (t >= 360 && t <= 720 && s.flour >= 2 && s.wood < 1) bare = true;
    }
    if (bare) mornings++;
  }
  assert.ok(mornings >= 1, mornings + ' mornings with flour and no wood');
  assert.ok(coldDays >= 1, coldDays + ' days with cold hearths');
  assert.ok(found >= 1, found + ' counts at the oven that found flour and no wood');
  assert.ok(village.actors.every(a => a.needs.hunger < 100), 'nobody starved');
});

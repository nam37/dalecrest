// The Storehouse. Dalecrest holds its goods in common, and the finished goods residents take for
// themselves are kept in one building: loaves, linen, salt fish and smoked game, and leather. Whoever
// makes them carries them there at the end of the shift. Each day every household is allowed its
// bread, and draws it into the larder at home. A storekeeper counts the shelves. Anyone who goes there
// sees what is on them, and can pass the count on.
import { dist } from './geom.mjs';
import { place } from './roads.mjs';
import { addPlace, pickLot } from './sites.mjs';
import { remember } from './memory.mjs';

// What a cottage larder holds. Kept here so the larder and the allowance agree on it.
export const LARDER_HOLDS = 8;

export const STOREHOUSE = 'storehouse';
// Goods that are kept at the storehouse. Barley stays in the barn, flour and firewood at the oven,
// water at the well, and fresh and cooked food at the hall.
export const STORED = ['bread', 'cloth', 'preserved', 'leather'];
// Nobody is offered a meal until they are this hungry. A loaf removes 53, so a meal below it is waste.
export const MEAL_FLOOR = 30;
// Loaves a grown resident is allowed each day. A resident eats a little over a loaf a day, and cooked
// meals, salt fish and feasts make up the rest. A child old enough to eat is allowed a loaf.
export const ALLOWANCE = 1.25;
// An allowance not drawn keeps for one more day, so nobody can lay up a store of their own.
const KEEPS = 2;
// The count below which a storekeeper calls the bread short.
export const BREAD_LOW = 6;

const YEAR = 365 * 1440;
const eatingChildren = (cottage, minute) => (cottage?.children || []).filter(c => minute - c.born >= YEAR).length;

export const storehouseOf = map => {
  const p = place(map, STOREHOUSE);
  return p?.stage === 2 ? p : null;
};

// Gives a village its storehouse, on the best free lot between the green and the oven. Safe to repeat.
// The lot is chosen by rule, so a stored village and a new one with the same map get the same building.
export function addStorehouse(map) {
  if (place(map, STOREHOUSE)) return null;
  const green = place(map, 'green'), oven = place(map, 'oven'), hall = place(map, 'hall');
  if (!green) return null;
  const score = lot => -dist([lot.x, lot.y], [green.x, green.y]) - 0.35 * (oven ? dist([lot.x, lot.y], oven.at) : 0)
    - 0.2 * (hall ? dist([lot.x, lot.y], hall.at) : 0) + (lot.way === 'road' ? 1.5 : 0);
  const lot = pickLot(map, STOREHOUSE, score);
  if (!lot) return null;
  return addPlace(map, STOREHOUSE, lot, { id: STOREHOUSE, name: 'Storehouse', road: lot.road });
}

// ------------------------------------------------------------------- the allowance

const dayAllowance = (world, actors, home) => {
  const cottage = world.cottages?.[home];
  const adults = actors.filter(a => a.home === home).length;
  return adults * ALLOWANCE + eatingChildren(cottage, world.minute);
};

// Opens the allowance once, with one day's worth for everyone, however the village was stored. After
// that every household's allowance comes at dawn, so stepping the clock in small or large steps agrees.
export function normalizeAllowance({ world, actors }) {
  if (world.allowanceSince != null) return;
  world.allowanceSince = world.minute;
  for (const [home, cottage] of Object.entries(world.cottages || {})) cottage.ration = dayAllowance(world, actors, home);
  for (const actor of actors) if (!world.cottages?.[actor.home]) actor.ration = ALLOWANCE;
}

// At dawn each household and each lodger is allowed the day's bread.
export function issueAllowance({ world, actors }) {
  for (const [home, cottage] of Object.entries(world.cottages || {})) {
    const day = dayAllowance(world, actors, home);
    if (day) cottage.ration = round(Math.min(day * KEEPS, (cottage.ration || 0) + day));
  }
  for (const actor of actors) {
    if (world.cottages?.[actor.home]) continue;
    actor.ration = round(Math.min(ALLOWANCE * KEEPS, (actor.ration || 0) + ALLOWANCE));
  }
}
// Adding 0 turns a negative zero into zero, which JSON would otherwise change on a save and reload.
const round = n => Math.round(n * 100) / 100 + 0;

// Loaves this resident may draw now: what is due to the household, as far as the larder has room and
// the shelves hold. A lodger draws one loaf at a time and eats it there.
export function drawable(actor, world) {
  const cottage = world.cottages?.[actor.home], bread = world.supplies.bread || 0;
  if (!cottage) return Math.min(1, Math.floor(actor.ration || 0), bread);
  return Math.max(0, Math.min(Math.floor(cottage.ration || 0), LARDER_HOLDS - cottage.larder, bread));
}

// What is still due to a resident's household, as they would put it.
function dueWords(actor, world) {
  const cottage = world.cottages?.[actor.home];
  const due = Math.floor(cottage ? cottage.ration || 0 : actor.ration || 0);
  return due === 0 ? 'Nothing more is due today.' : due === 1 ? 'One loaf is due.' : due + ' loaves are due.';
}

// ------------------------------------------------------------------- what is on the shelves

export const shelves = world => Object.fromEntries(STORED.map(item => [item, world.supplies[item] || 0]));

export function shelfWords(stock) {
  const n = (count, one, many) => count === 0 ? 'no ' + many : count === 1 ? 'one ' + one : count + ' ' + many;
  return n(stock.bread, 'loaf', 'loaves') + ', ' + n(stock.cloth, 'length of linen', 'lengths of linen') + ', '
    + n(stock.preserved, 'portion of salt fish or smoked game', 'portions of salt fish and smoked game') + ' and '
    + n(stock.leather, 'piece of leather', 'pieces of leather');
}

// A count of the storehouse, as a fact that can be passed from one resident to another.
export function storeFact(actor, seen) {
  return { id: ['store', actor.id, seen.minute].join('-'), topic: 'store', observer: actor.name, observerId: actor.id,
    minute: seen.minute, site: seen.site, text: 'The storehouse held ' + shelfWords(seen.stock) + '.', stock: { ...seen.stock } };
}

// Anyone at the storehouse sees what is on its shelves. Returns what they saw.
export function seeShelves(actor, world, source) {
  const seen = { source, site: STOREHOUSE, minute: world.minute, stock: shelves(world) };
  actor.observations ??= {};
  actor.observations.storehouse = seen;
  return seen;
}

// The storekeeper's count. A short bread count is news the keeper acts on.
export function keepShelves(actor, world, actors) {
  const seen = seeShelves(actor, world, 'storekeeper’s count');
  const short = seen.stock.bread < Math.max(BREAD_LOW, Math.ceil(actors.length * 0.6));
  const previous = actor.lastShelfCount;
  if (short && !(previous?.short)) actor.lastLowCount = { minute: world.minute, item: 'bread' };
  actor.lastShelfCount = { minute: world.minute, short };
  const text = actor.name + ' counted the shelves at the storehouse: ' + shelfWords(seen.stock) + '.';
  remember(actor, world.minute, text, [actor.id], 'observation', { site: STOREHOUSE, ...(short && { shortage: 'bread' }) });
  return 'counted the shelves at the storehouse: ' + shelfWords(seen.stock);
}

// ------------------------------------------------------------------- a meal from the storehouse

// Draws what is due, carries it to the larder in the mind's eye, and eats one loaf. Returns the words
// for the chronicle, or null when the shelves were bare.
export function drawAndEat(actor, world) {
  const cottage = world.cottages?.[actor.home];
  seeShelves(actor, world, 'drawing bread');
  const n = drawable(actor, world);
  if (n < 1) return null;
  world.supplies.bread -= n;
  if (cottage) {
    cottage.ration = round(cottage.ration - n);
    cottage.larder += n - 1;
    return n === 1 ? 'drew the household’s loaf at the storehouse and ate it' : 'drew ' + n + ' loaves at the storehouse for the household and ate one';
  }
  actor.ration = round(actor.ration - 1);
  return 'drew a loaf at the storehouse and ate it';
}

// Puts loaves already taken from the shelves into the larder at home, against the household's allowance.
export function stockLarder(actor, world, n) {
  const cottage = world.cottages?.[actor.home];
  if (!cottage) return;
  cottage.ration = round(cottage.ration - n);
  cottage.larder += n;
}

// What a resident knows of the storehouse and their allowance, for the action model.
export function storehouseContext(actor, world, minute) {
  const seen = actor.observations?.storehouse;
  const heard = actor.reports?.store;
  const latest = heard && (!seen || heard.fact.minute > seen.minute) ? { minute: heard.fact.minute, stock: heard.fact.stock, toldBy: heard.from } : seen;
  return { breadAllowance: dueWords(actor, world),
    ...(latest && { lastStorehouseCount: { minutesAgo: minute - latest.minute, ...latest.stock, ...(latest.toldBy && { toldBy: latest.toldBy }) } }) };
}

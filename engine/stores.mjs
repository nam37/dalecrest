// The village's food year. Barley grows only in its season, and what the village eats between the
// last harvest and the next has to come out of the barn and the granaries. Food is counted in days:
// how long the stores would feed everyone, not what fraction of a bin is full.
import { dateOf } from './calendar.mjs';
import { hash2 } from './geom.mjs';

const DAY = 1440;

// Measures of barley a field ripens each day, by month of the village's calendar. Nothing grows from
// November to March. Across a year a field ripens about 735 measures, enough for six or seven people.
const GROWTH = [0, 0, 0, 1, 2, 3, 5, 6.5, 5, 1.5, 0, 0];
// Ripe barley a field holds before the rest is lost standing.
export const FIELD_HOLDS = 30;
// What the founding village's barn holds, and what each granary adds.
export const BARN = { grain: 160, flour: 34 };
export const GRANARY = { grain: 120, flour: 20 };

export const ripening = minute => GROWTH[dateOf(minute).month - 1];

// How kind a year is to barley, from a poor 0.55 to a fine 1.2, fixed by the map's seed for each harvest year.
export function harvestYear(minute, seed) {
  const { year, month } = dateOf(minute);
  const h = hash2(seed, month >= 9 ? year : year - 1, 911);
  return 0.55 + 0.65 * h * h * (3 - 2 * h);
}
// What a field ripens on a given day: the season, the year, and heavy rain at harvest time laying the crop flat.
export function ripeningOn(minute, seed, sky) {
  const month = dateOf(minute).month;
  const flattened = sky && sky.rain > 0.5 && month >= 7 && month <= 9 ? 0.6 : 1;
  return ripening(minute) * harvestYear(minute, seed) * flattened;
}
export const growing = minute => ripening(minute) > 0;

// One measure of barley grinds to a measure and a half of flour, and two measures of flour bake five
// loaves. A resident eats a little over a loaf a day.
export const LOAVES = { grain: 3.75, flour: 2.5, bread: 1, cooked: 1.1, preserved: 0.9 };
export const EATS = 1.14;

export function loavesIn(supplies) {
  let total = 0;
  for (const [item, worth] of Object.entries(LOAVES)) total += (supplies[item] || 0) * worth;
  return total;
}

// Days the stores would feed `mouths` people. Children count as half a mouth.
export function foodDays(world, mouths) {
  return mouths > 0 ? loavesIn(world.supplies) / (mouths * EATS) : Infinity;
}

// Days the full barn and granaries would feed them.
export function storeDays(world, mouths) {
  return mouths > 0 ? loavesIn(world.capacity) / (mouths * EATS) : Infinity;
}

// Days from this minute until the fields ripen again, or 0 while they are ripening.
export function daysToHarvest(minute) {
  if (growing(minute)) return 0;
  let day = Math.floor(minute / DAY);
  while (!growing(day * DAY) && day - Math.floor(minute / DAY) < 366) day++;
  return day - Math.floor(minute / DAY);
}

// Everyone who eats from the common stores: residents, and each household's children as half a mouth.
export function mouths({ actors, world }) {
  let children = 0;
  for (const cottage of Object.values(world.cottages || {})) children += cottage.children?.length || 0;
  return actors.length + children / 2;
}

// Barley in store is lost to mice and damp, about one measure in three hundred a day.
export function keepStores(world) {
  world.grainLoss = (world.grainLoss || 0) + world.supplies.grain * 0.0033;
  const lost = Math.min(world.supplies.grain, Math.floor(world.grainLoss));
  world.supplies.grain -= lost;
  world.grainLoss -= lost;
  return lost;
}

// Gives a village from before the seasonal year its barn. Safe to repeat.
export function normalizeStores(world) {
  if (world.barn) return;
  world.barn = true;
  // The old bins held 44 measures, and each old granary 36. The barn takes the place of the bins.
  const granaries = Math.max(0, Math.round((world.capacity.grain - 44) / 36));
  world.capacity.grain = Math.max(world.capacity.grain, BARN.grain + granaries * GRANARY.grain);
}

// Ripens each field's barley at dawn. A field still holds what was not gathered, up to FIELD_HOLDS.
export function ripen(world, fields, minute, except, seed, sky) {
  const rate = ripeningOn(minute, seed, sky);
  for (const field of fields) {
    if (field.id === except) continue;
    world.fields[field.id] = Math.min(FIELD_HOLDS, (world.fields[field.id] ?? 0) + rate);
  }
}

// The village year: the season, the length of the day and the weather. Like the calendar, all of it is
// a pure function of the village minute and the founding seed. Nothing is stored, so a stored village
// replays under the same sky and an existing one simply gains its weather.
import { dateOf } from './calendar.mjs';
import { hash2, clamp, lerp, smooth, TAU } from './geom.mjs';

const DAY = 1440;
// Weather holds for three hours at a time.
export const SPELL = 180;
// England kept the Julian calendar, which in the 1300s ran eight days behind the sun.
const SUN_LAG = 8;
const LATITUDE = 52.5 * Math.PI / 180;
const BEFORE = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

// The day of the sun's year, 1 on the first of January as we would now count it.
export function sunDay(minute) {
  const { year, month, day } = dateOf(minute);
  return BEFORE[month - 1] + day + (month > 2 && year % 4 === 0 ? 1 : 0) + SUN_LAG;
}

// Winter is December to February by the village's own calendar, and so on round the year.
export function seasonOf(minute) {
  return ['winter', 'spring', 'summer', 'autumn'][Math.floor((dateOf(minute).month % 12) / 3)];
}

// Sunrise and sunset in minutes after midnight, with noon at twelve.
export function daylight(minute) {
  const tilt = -23.44 * Math.PI / 180 * Math.cos(TAU * (sunDay(minute) + 10) / 365.25);
  const half = Math.acos(clamp(-Math.tan(LATITUDE) * Math.tan(tilt), -1, 1)) * 720 / Math.PI;
  return { sunrise: 720 - half, sunset: 720 + half, length: half * 2 };
}

// A value between 0 and 1 that drifts smoothly as t advances, one new value per unit of t.
function drift(seed, salt, t) {
  const i = Math.floor(t), f = t - i, k = f * f * (3 - 2 * f);
  return lerp(hash2(seed, i, salt), hash2(seed, i + 1, salt), k);
}
// The year's own curve: coldest late in January, warmest late in July.
const usual = minute => 9.6 - 6.8 * Math.cos(TAU * (sunDay(minute) + (minute % DAY) / DAY - 24.5) / 365.25);
// Warm and cold spells that last several days, wider in winter.
function spell(minute, seed) {
  const t = minute / DAY, wintry = clamp((10 - usual(minute)) / 7);
  return (drift(seed, 71, t / 5.3) * 0.62 + drift(seed, 72, t / 1.9) * 0.38 - 0.5) * (13 + 5 * wintry);
}

// The mean temperature of the calendar day a minute falls on, in degrees Celsius.
export function dayTemp(minute, seed) {
  const noon = Math.floor(minute / DAY) * DAY + 720;
  return usual(noon) + spell(noon, seed);
}

// How damp the air is: above about 0.5 the sky clouds over, and further up it rains.
function damp(minute, seed) {
  const t = minute / DAY;
  return (drift(seed, 81, t / 3.1) * 0.6 + drift(seed, 82, t / 0.8) * 0.4) * 0.78 + hash2(seed, Math.floor(minute / SPELL), 83) * 0.22;
}
const RAIN_AT = 0.61;

function spellAt(index, seed) {
  const minute = index * SPELL + SPELL / 2, wet = damp(minute, seed);
  const cloud = smooth(0.36, 0.58, wet), falling = clamp((wet - RAIN_AT) / 0.2);
  const summery = clamp((usual(minute) - 4) / 12);
  // Afternoons are warmer than the small hours, more so in summer and under a clear sky.
  const swing = Math.cos(TAU * ((minute % DAY) - 900) / DAY) * lerp(1.8, 4.6, summery) * (1 - 0.5 * cloud);
  const temp = Math.round((usual(minute) + spell(minute, seed) + swing) * 10) / 10;
  return { temp, cloud, falling, snowing: falling > 0 && temp <= 1 };
}

// Snow on the ground builds while it snows and goes as the air warms or rain falls on it.
function lying(index, seed) {
  let depth = 0;
  for (let i = index - 56; i <= index; i++) {
    const s = spellAt(i, seed);
    if (s.snowing) depth += 0.25 + s.falling * 0.5;
    else if (s.falling) depth -= 0.3 + s.falling * 0.4;
    if (s.temp > 1) depth -= (s.temp - 1) * 0.045;
    depth = clamp(depth, 0, 1.6);
  }
  return Math.min(1, depth);
}

const words = (temp) => temp < -2 ? 'bitterly cold' : temp < 1.5 ? 'freezing' : temp < 6 ? 'cold' : temp < 11 ? 'chilly' : temp < 16 ? 'mild' : temp < 21 ? 'warm' : 'hot';
const amount = (falling, what) => (falling < 0.35 ? 'light ' : falling > 0.75 ? 'heavy ' : '') + what;

const cache = new Map();
// The weather at a village minute. temp is in degrees Celsius. cloud, rain, snow and lying run from 0 to 1.
// phrase reads after "Dawn breaks" or on its own: "cold and overcast", "chilly, with light rain".
export function weatherAt(minute, seed) {
  const index = Math.floor(minute / SPELL), key = seed + ':' + index;
  let found = cache.get(key);
  if (found) return found;
  const s = spellAt(index, seed), snow = s.snowing ? s.falling : 0, rain = s.snowing ? 0 : s.falling;
  const sky = snow ? 'snow' : rain ? 'rain' : s.cloud > 0.75 ? 'overcast' : s.cloud > 0.3 ? 'fair' : 'clear';
  const cover = lying(index, seed), feel = words(s.temp);
  const phrase = snow ? feel + ', with ' + amount(snow, 'snow') : rain ? feel + ', with ' + amount(rain, 'rain')
    : feel + ' and ' + sky + (cover > 0.3 ? ', with snow lying' : '');
  found = { season: seasonOf(minute), temp: s.temp, sky, cloud: Math.max(s.cloud, s.falling ? 1 : 0), rain, snow, lying: cover,
    phrase, text: phrase[0].toUpperCase() + phrase.slice(1) };
  if (cache.size > 4000) cache.clear();
  cache.set(key, found);
  return found;
}

// How hard the cold presses on someone without a fire: nothing in mild air, 1 at about a degree of frost.
export const chill = temp => clamp((9 - temp) / 10, 0, 1.3);

// Bundles of firewood one hearth burns in a day whose mean temperature is temp. Nothing in mild
// weather, half a bundle on an ordinary winter's day and a whole one in a hard frost.
export const fuelPerHearth = temp => Math.round(clamp((11 - temp) / 12) * 100) / 100;

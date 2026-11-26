// What the hour, the season, the weather and the residents lend to both views: how light it is,
// how the year shows on the land, and which hearths are lit.
import { daylight, sunDay, weatherAt, seasonOf } from '/engine/seasons.mjs';

const smooth = (lo, hi, v) => { const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo))); return t * t * (3 - 2 * t); };

// day is 0 through the night and 1 at noon. dark is its complement, easing quickly after dawn.
// dusk is the warm band around sunrise and sunset. The sun keeps the hours of the season.
export function light(minute) {
  const m = ((minute % 1440) + 1440) % 1440, { sunrise, sunset } = daylight(minute), p = (m - sunrise) / (sunset - sunrise);
  const day = p > 0 && p < 1 ? Math.sin(Math.PI * p) : 0;
  const bright = Math.min(1, day * 2.4);
  const dusk = Math.max(0, 1 - Math.min(Math.abs(m - sunrise), Math.abs(m - sunset)) / 85);
  return { minute: m, p, day, bright, dark: 1 - bright, dusk, night: bright < 0.35 };
}

// The light a plan is drawn in when it shows no particular hour: from the north-west, as on a survey sheet.
export const PLAIN_LIGHT = { toward: [-0.644, -0.765], reach: 1, depth: 1 };

// The sun as the plan sees it, with north at the top of the sheet. It keeps the path it follows over
// the walk view: up in the east, round by the south and down in the west.
//   toward  the way to the light across the sheet, as a unit vector
//   reach   how far a shadow runs for each unit of height: long at either end of the day, short at noon
//   depth   how firm shadows are, from 0 (none) to 1
// Cloud spreads the light, so shadows shorten and soften under it. By night the moon stands in the
// south-west, as it does over the walk view, and throws a fainter shadow of its own.
export function sunOver(minute, cloud = 0) {
  const { p, day } = light(minute), murk = cloud * cloud;
  if (!(day > 0)) return { toward: [-0.669, 0.743], reach: 0.93 * (1 - 0.55 * murk), depth: 0.42 * smooth(0, 0.08, p < 0 ? -p : p - 1) * (1 - 0.6 * murk) };
  const x = Math.cos(Math.PI * p), y = 0.45 * Math.sin(Math.PI * p) + 0.2, flat = Math.hypot(x, y);
  return { toward: [x / flat, y / flat], reach: Math.min(2.4, flat / Math.max(0.06, day * 0.95)) * (1 - 0.55 * murk),
    depth: smooth(0, 0.22, day) * (1 - 0.6 * murk) };
}

// A colour part of the way from one hex colour to another.
export function blend(a, b, t) {
  const k = Math.min(1, Math.max(0, t)), n = i => { const x = parseInt(a.slice(i, i + 2), 16), y = parseInt(b.slice(i, i + 2), 16); return Math.round(x + (y - x) * k).toString(16).padStart(2, '0'); };
  return '#' + n(1) + n(3) + n(5);
}

const BARLEY = [[0, '#b7a482'], [78, '#b7a482'], [118, '#b3bd84'], [185, '#a6b674'], [222, '#d3bd70'], [262, '#d8cc9c'], [300, '#d8cc9c'], [330, '#b7a482'], [366, '#b7a482']];
// How the year shows on the land.
//   leaf   how much leaf the broadleaved trees carry, from 0 (bare) to 1
//   turn   how far those leaves have turned, from 0 (green) to 1 (russet)
//   lush   how green the grass is, from 0 (winter) to 1
//   barley the colour of the fields: bare plough, green corn, gold at Lammas, then stubble
export function yearLook(minute) {
  const g = (sunDay(minute) - 1) % 365 + 1;
  let barley = BARLEY[0][1];
  for (let i = 1; i < BARLEY.length; i++) if (g <= BARLEY[i][0]) { barley = blend(BARLEY[i - 1][1], BARLEY[i][1], (g - BARLEY[i - 1][0]) / (BARLEY[i][0] - BARLEY[i - 1][0])); break; }
  return {
    leaf: Math.min(smooth(92, 128, g), 1 - smooth(288, 326, g)),
    turn: g > 200 ? smooth(252, 300, g) : 0,
    lush: 0.25 + 0.75 * Math.min(smooth(66, 128, g), 1 - smooth(296, 348, g)),
    barley,
  };
}

// Hoar frost on the ground, from 0 to 1. It forms on a cold, clear night, whitens the ground through
// the small hours and is gone within the first two or three hours of the morning. How hard it lies
// follows the cold and the cloud of the coming dawn, so it does not jump as the weather turns over in
// the night. Rain, snow falling or snow lying leave none to see.
export function frostOver(minute, seed) {
  const day = Math.floor(minute / 1440) * 1440, m = minute - day, { sunrise, sunset } = daylight(minute);
  const evening = m >= sunrise + 200, dawn = evening ? day + 1440 + daylight(day + 1440).sunrise : day + sunrise;
  const at = weatherAt(dawn, seed), now = weatherAt(minute, seed);
  if (now.rain || now.snow || now.lying > 0.3 || at.lying > 0.3) return 0;
  const hours = !evening ? 1 - smooth(sunrise + 30, sunrise + 170, m) : smooth(sunset + 60, sunset + 240, m);
  return hours * smooth(3, -1.5, at.temp) * (1 - smooth(0.45, 0.85, Math.max(at.cloud, now.cloud)));
}

// The sky over a village: its weather, with the season's name, for whoever draws or labels it.
export function skyOver(minute, seed) {
  const w = weatherAt(minute, seed), season = seasonOf(minute);
  return { ...w, season, label: season[0].toUpperCase() + season.slice(1) + ' · ' + w.text.toLowerCase() };
}

// Buildings with a fire going and someone inside: a home being slept or rested in, an oven in use,
// the hall during a moot, the alehouse of an evening. They smoke by day and glow by night. A house
// that got no firewood this morning stays dark.
export function hearths(map, actors, cold = []) {
  const lit = new Set();
  for (const a of actors) {
    const action = a.action;
    if (!action || action.phase !== 'working') continue;
    if (action.kind === 'rest' || action.kind === 'meeting' || (action.kind === 'leisure' && action.target !== 'green')
      || action.indoors || (action.kind === 'work' && ['bake', 'weave', 'repairBed'].includes(action.job))) lit.add(action.target);
  }
  return map.places.filter(p => p.w && p.kind !== 'field' && p.stage === 2 && lit.has(p.id) && !cold.includes(p.id));
}

// A resident who is indoors and out of sight.
export const indoors = ({ action }) => action?.phase === 'working' && (action.kind === 'rest' || action.indoors || action.job === 'repairBed');

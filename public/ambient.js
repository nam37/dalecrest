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

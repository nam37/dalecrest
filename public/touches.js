// Small signs of the village's days on the map: sheaves standing in the reaped fields, washing out on
// a line, ducks on the river, the mill at work, and footprints in lying snow. Each works from the
// stored map and world, so the views stay in step with the village and with each other.
import { hash2, smooth } from '../engine/geom.mjs';
import { sunDay } from '../engine/seasons.mjs';
import { PEAS_LAST, PEAS_RIPE } from '../engine/smallholding.mjs';

const tag = id => { let h = 0; for (const ch of String(id)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0; return h; };
const local = (p, lx, ly) => [p.x + lx * Math.cos(p.a) - ly * Math.sin(p.a), p.y + lx * Math.sin(p.a) + ly * Math.cos(p.a)];
const doorSide = p => (p.at[0] - p.x) * -Math.sin(p.a) + (p.at[1] - p.y) * Math.cos(p.a) > 0 ? 1 : -1;

// Sheaves stood up in stooks to dry. Reaping starts once the barley has turned gold, a little after
// Lammas, and goes across each field a row at a time over about two and a half weeks. The stooks stand
// a while and are carted to the barn in the same order, the last gone by the time the stubble shows.
// Returns [x, y, angle] for each stook standing on the minute given.
export const REAPING = [222, 240], CARTING = [248, 262];
export function stooksOf(map, minute) {
  const day = (sunDay(minute) - 1) % 365 + 1;
  const reaped = smooth(REAPING[0], REAPING[1], day), carted = smooth(CARTING[0], CARTING[1], day);
  if (reaped <= 0 || carted >= 1) return [];
  const out = [];
  for (const f of map.places) {
    if (f.kind !== 'field' || f.stage !== 2 || !f.w) continue;
    const across = Math.max(1, Math.floor((f.w - 1.4) / 1.7)), down = Math.max(1, Math.floor((f.d - 1.2) / 1.45)), salt = tag(f.id);
    for (let i = 0; i < across; i++) {
      const row = (i + 0.5) / across;
      if (row > reaped || row < carted) continue;
      for (let j = 0; j < down; j++) {
        const lx = -f.w / 2 + 0.7 + (i + 0.5) * (f.w - 1.4) / across + (hash2(map.seed, salt + i, j) - 0.5) * 0.35;
        const ly = -f.d / 2 + 0.6 + (j + 0.5) * (f.d - 1.2) / down + (hash2(map.seed + 3, salt + i, j) - 0.5) * 0.3;
        out.push([...local(f, lx, ly), f.a + (hash2(map.seed + 5, salt + i, j) - 0.5) * 0.6]);
      }
    }
  }
  return out;
}

// Washing out on a line behind a cottage. Each household has a washing day now and then, and the
// clothes go out mid-morning and come in before dusk, or as soon as it rains or snows.
// Returns { id, a: [x, y], b: [x, y], cloths: [{ t, color, wide }] } for each line in use.
const CLOTHS = ['#f1ead8', '#e6dcc4', '#b9c3c9', '#d8c49a', '#c99b84', '#a9b48d', '#efe7d2'];
export function washingOf(map, world, minute, seed, sky) {
  if (sky?.rain || sky?.snow) return [];
  const day = Math.floor(minute / 1440), m = minute - day * 1440;
  if (m < 570 || m > 990) return [];
  const out = [];
  for (const p of map.places) {
    if (p.kind !== 'cottage' || p.stage !== 2 || !p.w) continue;
    const home = world?.cottages?.[p.id];
    if (!home || home.lodging) continue;
    const salt = tag(p.id);
    if (hash2(seed, day, salt) > 0.3) continue;
    // Out a little later and in a little earlier at one house than the next.
    if (m < 570 + hash2(seed + 1, day, salt) * 90 || m > 990 - hash2(seed + 2, day, salt) * 120) continue;
    const back = -doorSide(p) * (p.d / 2 + 1.05), reach = p.w * 0.36;
    const count = 3 + Math.floor(hash2(seed + 3, day, salt) * 3);
    const cloths = Array.from({ length: count }, (_, i) => ({
      t: (i + 0.5) / count + (hash2(seed + 4, salt, i) - 0.5) * 0.08,
      color: CLOTHS[Math.floor(hash2(seed + 5, day * 7 + i, salt) * CLOTHS.length)],
      wide: 0.24 + hash2(seed + 6, salt, i) * 0.16,
    }));
    out.push({ id: p.id, a: local(p, -reach, back), b: local(p, reach, back), cloths });
  }
  return out;
}

// The mill at work. While someone is grinding, the sluice is open and the wheel runs fast, the
// water comes off it white, and sacks of meal stand by the door, more as the grinding goes on.
// Otherwise the wheel only idles round. Returns null when there is no finished mill.
export function millWork(map, actors) {
  const mill = map.places.find(p => p.kind === 'mill' && p.stage === 2);
  if (!mill) return null;
  let progress = -1;
  for (const a of actors) {
    const act = a.action;
    if (act?.job !== 'mill' || act.phase !== 'working' || act.target !== mill.id) continue;
    progress = Math.max(progress, Math.min(1, Math.max(0, 1 - (act.remaining ?? 69) / 69)));
  }
  const side = doorSide(mill), along = (mill.at[0] - mill.x) * Math.cos(mill.a) + (mill.at[1] - mill.y) * Math.sin(mill.a);
  const sacks = progress < 0 ? 0 : 1 + Math.floor(progress * 3.99);
  return { id: mill.id, milling: progress >= 0, sacks, at: local(mill, along + 0.75, side * (mill.d / 2 + 0.35)), a: mill.a, door: local(mill, along, side * (mill.d / 2 + 0.25)) };
}

// A walk along the river by distance. at(s) gives [x, y, heading] s units downstream from its head.
export function riverWalk(river) {
  const run = [0];
  for (let i = 1; i < river.length; i++) run.push(run[i - 1] + Math.hypot(river[i][0] - river[i - 1][0], river[i][1] - river[i - 1][1]));
  const length = run[run.length - 1];
  return {
    length,
    at(s) {
      s = Math.max(0, Math.min(length - 1e-6, s));
      let i = 1;
      while (i < run.length - 1 && run[i] < s) i++;
      const a = river[i - 1], b = river[i], k = (s - run[i - 1]) / (run[i] - run[i - 1] || 1);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, Math.atan2(b[1] - a[1], b[0] - a[0])];
    },
  };
}

// Two small flocks of ducks on the river. Each lets the current carry it slowly down a stretch out in
// the stream, then paddles back up close in to the bank, over a minute and a half or so. A flock keeps
// clear of anyone fishing and edges away along the river when one is near. At night they are roosting
// on the bank, out of sight. Call with the time in milliseconds, where each angler is drawn, and the
// seconds since the last call. Returns [{ x, y, heading, drake, paddling }].
export function createDucks() {
  const shy = [0, 0];
  let walk = null, riverKey = null;
  return function ducksAt(map, time, anglers, dt) {
    const river = map.terrain?.river;
    if (!river || river.length < 2) return [];
    if (riverKey !== river) { riverKey = river; walk = riverWalk(river); }
    const rw = map.terrain.riverWidth || 4, out = [];
    for (let j = 0; j < 2; j++) {
      const home = walk.length * (0.28 + 0.38 * j + hash2(map.seed, 41, j) * 0.08);
      const where = t => {
        const q = ((t / 1000 + j * 41) / 95) % 1, drifting = q < 0.72;
        const gone = drifting ? q / 0.72 : 1 - (q - 0.72) / 0.28;
        const lean = (j ? -1 : 1) * rw * (0.08 + 0.3 * smooth(0.6, 0.9, q) * (1 - smooth(0.94, 1, q)));
        return { s: home + shy[j] + gone * 16, lean, drifting };
      };
      const now = where(time);
      // Edge away from anyone fishing close by.
      const [cx, cy] = walk.at(now.s);
      let push = 0;
      for (const a of anglers) {
        const d = Math.hypot(a.x - cx, a.y - cy);
        if (d < 7) { const [ax, ay] = walk.at(now.s + 1); push += ((ax - cx) * (cx - a.x) + (ay - cy) * (cy - a.y)) >= 0 ? 1 : -1; }
      }
      if (push) shy[j] += Math.sign(push) * Math.min(1, dt) * 2.2;
      else shy[j] *= Math.pow(0.97, dt * 10);
      shy[j] = Math.max(-walk.length * 0.2, Math.min(walk.length * 0.2, shy[j]));
      const count = 4 + j;
      for (let i = 0; i < count; i++) {
        // Each duck follows a little behind the one before, so the flock strings out along its way.
        const lag = i * 650, at = where(time - lag), ahead = where(time - lag + 250);
        const [x, y] = walk.at(at.s), [nx, ny] = walk.at(ahead.s), [, , h] = walk.at(at.s);
        const wander = at.lean + Math.sin(time * 0.0007 + i * 2.1) * 0.25 + (i % 2 ? 0.3 : -0.3) * Math.min(1, i);
        const side = Math.max(-0.4 * rw, Math.min(0.4 * rw, wander));
        const px = -Math.sin(h), py = Math.cos(h);
        const sx = x + px * side, sy = y + py * side, moved = Math.hypot(nx - x, ny - y);
        out.push({ x: sx, y: sy, heading: moved > 1e-4 ? Math.atan2(ny - y, nx - x) : h, drake: i % 2 === 0, paddling: !at.drifting });
      }
    }
    return out;
  };
}

// Footprints in lying snow. Each resident out of doors leaves a print every half stride, left and
// right in turn, and the prints fill in over a few hours of village time.
export const PRINTS_LAST = 240;
export function createTracks() {
  const trails = new Map();
  return {
    step(id, p, minute) {
      let trail = trails.get(id);
      if (!trail) trails.set(id, trail = { last: null, foot: 1, prints: [] });
      if (!trail.last) { trail.last = [p.x, p.y]; return; }
      const dx = p.x - trail.last[0], dy = p.y - trail.last[1], d = Math.hypot(dx, dy);
      if (d > 4) { trail.last = [p.x, p.y]; return; }
      if (d < 0.32) return;
      trail.foot = -trail.foot;
      const ux = dx / d, uy = dy / d;
      trail.prints.push({ x: p.x - uy * 0.07 * trail.foot, y: p.y + ux * 0.07 * trail.foot, a: Math.atan2(dy, dx), minute });
      if (trail.prints.length > 400) trail.prints.splice(0, trail.prints.length - 400);
      trail.last = [p.x, p.y];
    },
    // Every print still showing, with how fresh it is from 1 down to 0.
    prints(minute) {
      const out = [];
      for (const trail of trails.values()) {
        trail.prints = trail.prints.filter(q => minute - q.minute < PRINTS_LAST && q.minute <= minute + 1);
        for (const q of trail.prints) out.push({ ...q, fresh: 1 - (minute - q.minute) / PRINTS_LAST });
      }
      return out;
    },
    clear() { trails.clear(); },
  };
}

// How a kept building's thatch looks from its condition (0 to 100) and when it was last mended.
// wear runs from 0 on a sound roof to 1 on one falling in; a roof below 65 has a strip torn away to
// the battens; fresh is how new a mended patch still looks, from 1 the day it was laid to 0 after
// eight days. key changes only when the look does.
export function roofWear(condition, mendedAt, minute) {
  const wear = Math.round(Math.min(1, Math.max(0, (92 - (condition ?? 100)) / 60)) * 10) / 10;
  const days = mendedAt == null ? Infinity : (minute - mendedAt) / 1440;
  const fresh = days >= 0 && days < 8 ? Math.round((1 - days / 8) * 4) / 4 : 0;
  const bare = (condition ?? 100) < 65;
  return { wear, bare, fresh, at: mendedAt ?? 0, key: [wear, bare, fresh, mendedAt ?? 0].join('/') };
}

// The grass worn thin where people keep walking straight between two places. Each line follows the
// gentle bend the path will take once enough feet have crossed (engine/civic.mjs tread), and shows
// more as the count nears the twelve walks that make a path. Returns [{ key, pts, worn }].
export const PATH_WEAR = 12;
export function treadLines(map, wear) {
  const out = [];
  for (const [key, count] of Object.entries(wear || {})) {
    const [aid, bid] = key.split('|'), a = map.places.find(p => p.id === aid), b = map.places.find(p => p.id === bid);
    if (!a?.at || !b?.at) continue;
    const length = Math.hypot(b.at[0] - a.at[0], b.at[1] - a.at[1]);
    if (length < 1) continue;
    const bend = (key.length % 2 ? 1 : -1) * length * 0.05, pts = [];
    for (let i = 0, steps = Math.max(2, Math.round(length / 1.4)); i <= steps; i++) {
      const t = i / steps, k = Math.sin(t * Math.PI) * bend;
      pts.push([a.at[0] + (b.at[0] - a.at[0]) * t - (b.at[1] - a.at[1]) / length * k, a.at[1] + (b.at[1] - a.at[1]) * t + (b.at[0] - a.at[0]) / length * k]);
    }
    out.push({ key, pts, worn: Math.min(1, count / PATH_WEAR) });
  }
  return out;
}

// The pea rows in the kitchen garden, from the garden's sowing and picking. grow runs from 0 at
// sowing to 1 when the peas are ripe; they flower just before; podded while there are peas to pick;
// left is the share of the plants still to be picked over; spent once the crop is done, until the
// rows are cleared about three weeks later. Null for bare earth.
export function peaRows(world, minute) {
  const garden = world?.smallholding?.garden;
  if (!garden || garden.sownAt == null) return null;
  const age = minute - garden.sownAt;
  if (age < 0 || age >= PEAS_RIPE + PEAS_LAST + 20 * 1440) return null;
  const most = garden.tended ? 8 : 4, spent = age >= PEAS_RIPE + PEAS_LAST || garden.picked >= most;
  return {
    grow: Math.round(Math.min(1, age / PEAS_RIPE) * 20) / 20,
    flowering: !spent && age > PEAS_RIPE * 0.72 && age < PEAS_RIPE * 1.05,
    podded: !spent && age >= PEAS_RIPE * 0.9,
    left: Math.round((1 - Math.min(1, (garden.picked || 0) / most) * 0.7) * 10) / 10,
    spent, tended: Boolean(garden.tended),
  };
}

// A haystack and a corn rick at the end of the barn away from the lane, each as big as the hay and
// the grain in store against what the barn can hold. Returns [{ kind: 'hay' | 'corn', x, y, a, size }].
export function ricksOf(map, world) {
  const barn = map.places.find(p => p.kind === 'barn' && p.stage === 2);
  if (!barn || !world?.supplies) return [];
  const out = [], end = -(barn.w / 2 + 1.35);
  for (const [kind, v] of [['hay', -0.85], ['corn', 0.9]]) {
    const have = world.supplies[kind === 'hay' ? 'hay' : 'grain'] || 0, room = world.capacity?.[kind === 'hay' ? 'hay' : 'grain'] || 160;
    if (have <= 0) continue;
    const size = Math.round(Math.sqrt(Math.min(1, have / room)) * 20) / 20;
    const [x, y] = local(barn, end, v);
    out.push({ kind, x, y, a: barn.a, size: Math.max(0.15, size) });
  }
  return out;
}

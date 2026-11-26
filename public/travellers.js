// Visitors from beyond the parish, for both views. The engine keeps only when each one is due: a
// peddler's hours on the green, the day the reeve comes for the rent, and when a drover comes for strayed
// cattle. From those times this works out where each visitor is: coming up the road from the edge of the
// map, at their business, and going away again, with their pony or the cattle, and the peddler's pack
// set out on the green.
import { route } from '../engine/roads.mjs';
import { createAppearance } from '../engine/appearance.mjs';
import { animalPose } from './parish.js';

const tag = id => { let h = 0; for (const ch of String(id)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0; return h; };

// Walking paces in map units a village minute: a peddler leading a laden pony, the reeve, a drover.
export const PACE = { peddler: 1.5, reeve: 1.9, drover: 1.7, strays: 2.1 };
// How long the reeve stays at the hall.
export const REEVE_STAYS = 40;
// The peddler's record is kept this long after trading ends (engine/visitors.mjs PEDDLER_GOING), so the
// walk away must fit inside it.
const GOING_WITHIN = 140;

// The village minute now, with the part of the current tick that has gone by, so a visitor walks
// smoothly between ticks. tick is the view's liveTick ({ minute, minutes, ms, endsAt }).
export function liveMinute(clock, tick, now) {
  if (!tick?.ms || !tick.minutes || tick.minute !== clock) return clock;
  return clock + tick.minutes * Math.min(1, Math.max(0, 1 - (tick.endsAt - now) / tick.ms));
}

// The ways in from beyond the parish: the ends of the roads at the edge of the map.
export function gatesOf(map) {
  const gates = (map.gates || []).map(n => map.nodes[n]).filter(Boolean);
  return gates.length ? gates : map.nodes.length ? [map.nodes[0]] : [];
}

const paths = new WeakMap();
// A walk from a point to a place along the ways, with an extra step at the end if given. Cached per map.
function pathTo(map, from, placeId, extra) {
  let cache = paths.get(map);
  if (!cache) paths.set(map, cache = new Map());
  const key = from.join() + '>' + placeId + '>' + (extra ? extra.join() : '');
  if (cache.has(key)) return cache.get(key);
  const r = route(map, from, placeId);
  let found = null;
  if (r) {
    const pts = [from.slice(), ...r.pts.map(p => p.slice())];
    if (extra) pts.push(extra.slice());
    const lens = [];
    let length = 0;
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); lens.push(d); length += d; }
    found = { pts, lens, length };
  }
  cache.set(key, found);
  return found;
}
const reversed = path => path && { pts: [...path.pts].reverse(), lens: [...path.lens].reverse(), length: path.length };

// Where a walk has got to after d map units: { x, y, heading }.
export function along(path, d) {
  let rest = Math.max(0, Math.min(path.length, d)), heading = 0;
  for (let i = 1; i < path.pts.length; i++) {
    const a = path.pts[i - 1], b = path.pts[i], len = path.lens[i - 1];
    if (len > 0.05) heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (rest <= len || i === path.pts.length - 1) {
      const k = len ? Math.min(1, rest / len) : 1;
      return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, heading };
    }
    rest -= len;
  }
  const [x, y] = path.pts[0] || [0, 0];
  return { x, y, heading };
}

// Someone on a walk, d units along, with whatever follows behind them at the gaps given.
function walking(path, d, gaps) {
  const lead = along(path, d), moving = d > 0 && d < path.length;
  return { lead: { ...lead, moving, gone: d }, behind: gaps.map(gap => ({ ...along(path, Math.max(0, d - gap)), moving: moving && d - gap > 0, gone: Math.max(0, d - gap) })) };
}

// The peddler's pitch on the green: the cloth is spread between the spot where villagers gather and the
// way in, and the peddler stands behind it on the road side, facing the customers.
export function pitchOf(map) {
  const green = map.places.find(p => p.kind === 'green');
  if (!green) return null;
  // The way in is the path that leaves the green's gathering spot and runs furthest from the middle of
  // the green, rather than the short spur to the well.
  const [ax, ay] = green.at, out = (map.edges || []).filter(([a, b]) => a === green.node || b === green.node)
    .map(([a, b]) => map.nodes[a === green.node ? b : a]).sort((m, n) => Math.hypot(n[0] - green.x, n[1] - green.y) - Math.hypot(m[0] - green.x, m[1] - green.y));
  const [nx, ny] = out[0] ?? [green.x, green.y + 1];
  let dx = nx - ax, dy = ny - ay, d = Math.hypot(dx, dy);
  if (d < 0.5) { dx = ax - green.x; dy = ay - green.y; d = Math.hypot(dx, dy) || 1; }
  const ux = dx / d, uy = dy / d, step = Math.min(1.3, Math.max(0.9, d * 0.4));
  return { x: ax + ux * step, y: ay + uy * step, a: Math.atan2(uy, ux), stand: [ax + ux * (step + 0.75), ay + uy * (step + 0.75)],
    graze: [ax + ux * (step + 0.6) - uy * 2, ay + uy * (step + 0.6) + ux * 2], face: Math.atan2(-uy, -ux) };
}

// The reeve's look: a good dark gown and a hood, the same at every visit.
const REEVE = { version: 1, seed: 'reeve', cloth: ['#55607a', '#363e52', '#7a86a0'], skin: ['#dca481', '#a46751', '#f3c19e'], hair: ['#6d6456', '#a89a82'], headwear: 'hood' };

// Every visitor and beast to draw at this minute (fractional minutes walk smoothly), and the peddler's
// pitch. time is in milliseconds, for grazing.
//   walkers: [{ id, name, role, x, y, heading, moving, gone, carry, actor }]
//   animals: [{ id, kind: 'pony' | 'cattle', x, y, heading, moving, gone, graze, laden, coat }]
//   pitch:   { x, y, a, fish, linen } while the peddler's goods are set out, else null
export function visitorsOf(map, world, minute, time = 0) {
  const out = { walkers: [], animals: [], pitch: null };
  if (!map || !world) return out;
  const gates = gatesOf(map);
  if (!gates.length) return out;
  const person = (id, name, role, at, extra = {}) => out.walkers.push({ id, name, role, ...at, actor: { id, name, appearance: extra.appearance ?? createAppearance({ id }), action: { kind: 'visit' } }, carry: extra.carry ?? null });
  const grazing = (id, spot, phase, extra) => {
    const pose = animalPose({ x: spot[0], y: spot[1], phase }, time);
    out.animals.push({ id, x: pose.x, y: pose.y, heading: pose.heading, moving: Math.abs(pose.stride) > 0.02, gone: time / 400, graze: pose.graze, ...extra });
  };

  // The peddler and the pony with the pack.
  const p = world.peddler, pitch = pitchOf(map);
  if (p && pitch) {
    const gi = tag(p.name) % gates.length, id = 'peddler:' + p.name;
    const coming = pathTo(map, gates[gi], 'green', pitch.stand), going = reversed(pathTo(map, gates[(gi + 1) % gates.length], 'green', pitch.stand));
    if (coming && going) {
      const start = p.from - coming.length / PACE.peddler, outPace = Math.max(PACE.peddler, going.length / GOING_WITHIN);
      const traded = p.traded || 0;
      if (minute >= start && minute < p.from) {
        const w = walking(coming, (minute - start) * PACE.peddler, [1.05]);
        person(id, p.name, 'peddler', w.lead);
        out.animals.push({ id: id + ':pony', kind: 'pony', ...w.behind[0], laden: true });
      } else if (minute >= p.from && minute < p.until) {
        person(id, p.name, 'peddler', { x: pitch.stand[0], y: pitch.stand[1], heading: pitch.face, moving: false, gone: 0 });
        grazing(id + ':pony', pitch.graze, tag(p.name) % 7, { kind: 'pony', laden: false });
        // Seven fish to start with, three off for each length of linen, and the linen piling up.
        out.pitch = { x: pitch.x, y: pitch.y, a: pitch.a, fish: Math.max(1, 7 - traded * 2), linen: Math.min(6, traded) };
      } else if (minute >= p.until && minute < p.until + going.length / outPace) {
        const w = walking(going, (minute - p.until) * outPace, [1.05]);
        person(id, p.name, 'peddler', w.lead);
        out.animals.push({ id: id + ':pony', kind: 'pony', ...w.behind[0], laden: true });
      }
    }
  }

  // The lord's reeve, come to the hall for the rent, with a pony for what he takes.
  const reeveAt = world.reeveAt ?? world.reeveVisit?.at, hall = map.places.find(q => q.id === 'hall');
  if (reeveAt != null && hall) {
    const id = 'reeve', way = pathTo(map, gates[0], 'hall');
    if (way) {
      const start = reeveAt - way.length / PACE.reeve, leave = reeveAt + REEVE_STAYS, laden = Boolean(world.reeveVisit?.grain || world.reeveVisit?.cloth);
      if (minute >= start && minute < reeveAt) {
        const w = walking(way, (minute - start) * PACE.reeve, [1.05]);
        person(id, 'The lord’s reeve', 'reeve', w.lead, { appearance: REEVE });
        out.animals.push({ id: 'reeve:pony', kind: 'pony', ...w.behind[0], laden: false, coat: 1 });
      } else if (minute >= reeveAt && minute < leave) {
        const face = Math.atan2(hall.y - hall.at[1], hall.x - hall.at[0]);
        person(id, 'The lord’s reeve', 'reeve', { x: hall.at[0], y: hall.at[1], heading: face, moving: false, gone: 0 }, { appearance: REEVE, carry: 'board' });
        grazing('reeve:pony', [hall.at[0] - Math.sin(face) * 1.6, hall.at[1] + Math.cos(face) * 1.6], 2, { kind: 'pony', laden, coat: 1 });
      } else if (minute >= leave && minute < leave + way.length / PACE.reeve) {
        const w = walking(reversed(way), (minute - leave) * PACE.reeve, [1.05]);
        person(id, 'The lord’s reeve', 'reeve', w.lead, { appearance: REEVE });
        out.animals.push({ id: 'reeve:pony', kind: 'pony', ...w.behind[0], laden, coat: 1 });
      }
    }
  }

  // A drover coming for strayed cattle, and taking them home; or the strays making off alone once
  // the villagers have turned them out.
  const herd = world.herd, drover = world.drover;
  const nearestGate = field => gates.reduce((best, g) => Math.hypot(g[0] - field.at[0], g[1] - field.at[1]) < Math.hypot(best[0] - field.at[0], best[1] - field.at[1]) ? g : best);
  if (herd) {
    const field = map.places.find(q => q.id === herd.field), way = field && pathTo(map, nearestGate(field), field.id);
    if (way) {
      const start = herd.until - way.length / PACE.drover;
      if (minute >= start && minute < herd.until) person('drover:' + herd.from_, 'A drover from ' + herd.from_, 'drover', walking(way, (minute - start) * PACE.drover, []).lead, { carry: 'rod' });
    }
  }
  if (drover) {
    const field = map.places.find(q => q.id === drover.field), way = field && reversed(pathTo(map, nearestGate(field), field.id));
    if (way) {
      const pace = drover.driven ? PACE.strays : PACE.drover, d = (minute - drover.at) * pace;
      if (d >= 0 && d < way.length + 4) {
        const w = walking(way, d, drover.driven ? [0, 1.1, 2.2] : [1.3, 2.4, 3.5]);
        if (!drover.driven) person('drover:' + drover.from_, 'A drover from ' + drover.from_, 'drover', w.lead, { carry: 'rod' });
        w.behind.forEach((beast, i) => { if (beast.gone < way.length) out.animals.push({ id: 'stray:' + i, kind: 'cattle', ...beast, coat: i }); });
      }
    }
  }
  return out;
}

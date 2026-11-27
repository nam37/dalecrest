// The road graph and the places it connects. Nodes and edges are plain arrays in the map;
// everything derived from them is cached per map revision and never stored.
import { dist, segDist, rectPoly, segHitsPoly, r2, TAU } from './geom.mjs';
import { riverDistance } from './terrain.mjs';

// Half the drawn width of each kind of way, in map units.
export const HALF = { road: 0.62, bridge: 0.62, lane: 0.42, path: 0.2, track: 0.13 };
const EFFORT = { road: 1, bridge: 1, lane: 1.04, path: 1.1, track: 1.18 };

const caches = new WeakMap();
function cache(map) {
  let c = caches.get(map);
  if (!c || c.revision !== map.revision) caches.set(map, c = { revision: map.revision });
  return c;
}
export function touch(map) { map.revision++; }

// The road over the river runs between points just inside the water, so a deck drawn only along it stops
// short of the banks. Each view draws the deck on past the ends of the whole span, far enough that both
// corners reach the land where the river crosses at a slant. Where two stretches of bridge meet, neither reaches out. Drawing only: the road is unchanged.
export const BRIDGE_LANDING = 1.1;
export function bridgeDecks(map) {
  const spans = map.edges.filter(edge => edge[2] === 'bridge'), ends = new Map();
  for (const [a, b] of spans) for (const node of [a, b]) ends.set(node, (ends.get(node) ?? 0) + 1);
  return spans.map(([a, b]) => {
    const A = map.nodes[a], B = map.nodes[b], len = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
    return { a, b, A, B, len, ux: (B[0] - A[0]) / len, uy: (B[1] - A[1]) / len,
      from: ends.get(a) > 1 ? 0 : -BRIDGE_LANDING, to: ends.get(b) > 1 ? len : len + BRIDGE_LANDING };
  });
}

export function place(map, id) {
  const c = cache(map);
  c.byId ??= new Map(map.places.map(p => [p.id, p]));
  return c.byId.get(id);
}
export const placesOf = (map, kind, built = true) => map.places.filter(p => p.kind === kind && (!built || p.stage === 2));

// The ground a place occupies, or nothing for places people may walk across.
export function outline(p, grow = 0) {
  if (p.w) return rectPoly(p, grow);
  if (p.kind === 'green') {
    const c = Math.cos(p.a), s = Math.sin(p.a), pts = [];
    for (let i = 0; i < 14; i++) {
      const u = Math.cos(i * TAU / 14) * (p.rx + grow), v = Math.sin(i * TAU / 14) * (p.ry + grow);
      pts.push([p.x + u * c - v * s, p.y + u * s + v * c]);
    }
    return pts;
  }
  if (p.kind === 'well') return rectPoly({ x: p.x, y: p.y, w: 1.3, d: 1.3, a: 0 }, grow);
  return null;
}

export function addNode(map, x, y) {
  map.nodes.push([r2(x), r2(y)]);
  touch(map);
  return map.nodes.length - 1;
}
export function addEdge(map, a, b, kind, road = -1) {
  if (a === b) return;
  map.edges.push([a, b, kind, road]);
  touch(map);
}

export function nearestOnRoads(map, p, allow = kind => kind !== 'bridge') {
  let best = null;
  for (let i = 0; i < map.edges.length; i++) {
    const [a, b, kind] = map.edges[i];
    if (!allow(kind)) continue;
    const hit = segDist(p, map.nodes[a], map.nodes[b]);
    if (!best || hit.d < best.d) { best = hit; best.edge = i; best.kind = kind; }
  }
  return best;
}

export function splitEdge(map, index, x, y) {
  const [a, b, kind, road] = map.edges[index];
  if (dist([x, y], map.nodes[a]) < 0.7) return a;
  if (dist([x, y], map.nodes[b]) < 0.7) return b;
  const n = addNode(map, x, y);
  map.edges[index] = [a, n, kind, road];
  map.edges.push([n, b, kind, road]);
  touch(map);
  return n;
}

// Joins a point to the nearest way with a short track and returns its node.
export function attach(map, x, y) {
  const hit = nearestOnRoads(map, [x, y]);
  const on = splitEdge(map, hit.edge, hit.x, hit.y);
  if (dist([x, y], map.nodes[on]) < 0.5) return on;
  const n = addNode(map, x, y);
  addEdge(map, n, on, 'track');
  return n;
}

function adjacency(map) {
  const c = cache(map);
  if (!c.adj) {
    c.adj = map.nodes.map(() => []);
    for (const [a, b, kind] of map.edges) {
      const cost = dist(map.nodes[a], map.nodes[b]) * EFFORT[kind];
      c.adj[a].push([b, cost]);
      c.adj[b].push([a, cost]);
    }
  }
  return c.adj;
}

// Cheapest walk from every node to one destination. Most trips share a few destinations.
function walksTo(map, target) {
  const c = cache(map);
  c.walks ??= new Map();
  let found = c.walks.get(target);
  if (!found) {
    const adj = adjacency(map), n = adj.length;
    const cost = new Float64Array(n).fill(Infinity), next = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    cost[target] = 0;
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && cost[i] < best) { best = cost[i]; u = i; }
      if (u < 0) break;
      done[u] = 1;
      for (const [v, w] of adj[u]) if (cost[u] + w < cost[v]) { cost[v] = cost[u] + w; next[v] = u; }
    }
    c.walks.set(target, found = { cost, next });
  }
  return found;
}

// A straight walk is allowed when it stays dry and passes through no building or crop.
export function clearWalk(map, a, b, skip = []) {
  const length = dist(a, b), steps = Math.max(1, Math.ceil(length / 1.1)), wet = map.terrain.riverWidth / 2 + 0.4;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (riverDistance(map, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) < wet) return false;
  }
  for (const p of map.places) {
    if (!p.w || skip.includes(p.id)) continue;
    if (segHitsPoly(a, b, rectPoly(p, 0.2))) return false;
  }
  return true;
}

export const placeAt = (map, pos) => map.places.find(p => Math.abs(p.at[0] - pos[0]) < 0.05 && Math.abs(p.at[1] - pos[1]) < 0.05);

// Waypoints from a position to a place: along the ways, or straight across open ground
// when that is clearly shorter. Returns null for an unknown destination.
export function route(map, from, targetId) {
  const target = place(map, targetId);
  if (!target) return null;
  const end = target.at, direct = dist(from, end);
  if (direct < 0.05) return { pts: [], length: 0, direct: false };
  const origin = placeAt(map, from);
  const walks = walksTo(map, target.node);
  let entry, lead = 0, joinAt = null;
  if (origin) entry = origin.node;
  else {
    const hit = nearestOnRoads(map, from, () => true);
    const [a, b] = map.edges[hit.edge];
    const viaA = dist([hit.x, hit.y], map.nodes[a]) + walks.cost[a], viaB = dist([hit.x, hit.y], map.nodes[b]) + walks.cost[b];
    entry = viaA <= viaB ? a : b;
    lead = hit.d + Math.min(viaA, viaB) - walks.cost[entry];
    joinAt = [r2(hit.x), r2(hit.y)];
  }
  const byRoad = lead + walks.cost[entry];
  const shortcut = direct <= 6 || (byRoad > direct * 1.45 && direct <= 36);
  if ((shortcut || !Number.isFinite(byRoad)) && clearWalk(map, from, end, [targetId, origin?.id])) {
    return { pts: [end.slice()], length: direct, direct: true, byRoad, from: origin?.id };
  }
  if (!Number.isFinite(byRoad)) return { pts: [end.slice()], length: direct, direct: false };
  const pts = joinAt ? [joinAt] : [];
  for (let n = entry; n !== -1 && n !== target.node; n = walks.next[n]) pts.push(map.nodes[n].slice());
  pts.push(map.nodes[target.node].slice());
  if (dist(map.nodes[target.node], end) > 0.05) pts.push(end.slice());
  return { pts, length: byRoad, direct: false };
}

// Part of the route a resident can cover in the given number of village minutes.
// Keep the waypoints as well as the endpoint so both the clock and the map follow the same turns.
export function walkingSpeed(actor) {
  if (actor.action?.familyPace) return actor.action.familyPace;
  if (actor.child) return actor.age < 8 ? 1.4 : 1.75;
  return actor.traits.includes('restless') ? 2.65 : 2.15;
}

export function walkingSegment(actor, path, minutes = 1) {
  let left = walkingSpeed(actor) * minutes;
  let walked = 0;
  let from = [actor.position.x, actor.position.y], passed = 0;
  const points = [];
  for (const to of path) {
    const length = dist(from, to);
    if (length > left) {
      points.push([from[0] + left * (to[0] - from[0]) / length, from[1] + left * (to[1] - from[1]) / length]);
      walked += left;
      break;
    }
    points.push(to);
    passed++;
    left -= length;
    walked += length;
    from = to;
  }
  return { points, passed, walked };
}

// Walking distance between two places along the ways.
export function walkLength(map, fromId, toId) {
  const a = place(map, fromId), b = place(map, toId);
  if (!a || !b) return Infinity;
  return walksTo(map, b.node).cost[a.node];
}

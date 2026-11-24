// Where things may be built: lots along the ways, new lanes when the lots run out, and fresh fields.
// Used both to seed the village and to grow it, so old and new quarters follow the same rules.
import { dist, rectPoly, polysTouch, segPolyDist, inPoly, r2, TAU } from './geom.mjs';
import { riverDistance, slopeAt } from './terrain.mjs';
import { HALF, place, placesOf, outline, addNode, addEdge, attach, nearestOnRoads, touch } from './roads.mjs';

// Width along the road and depth away from it.
export const FOOTPRINT = {
  cottage: [2.7, 1.8], hall: [5, 2.8], oven: [2.2, 2], mill: [3.4, 2.5], granary: [3.3, 2.2],
  alehouse: [3.9, 2.4], well: [1.3, 1.3], field: [13, 7.4], storehouse: [3.2, 2.2],
  garden: [4, 2.5], orchard: [5, 3.2], pasture: [5.5, 4],
};
export const LANE_NAMES = ['Brook Lane', 'Meadow Lane', 'Orchard Lane', 'Nether Lane', 'Hollow Way', 'Long Row',
  'Pound Lane', 'Goose Lane', 'Stony Lane', 'Cuckoo Lane', 'Marsh Lane', 'Sheep Street', 'Furze Lane', 'Lark Rise'];
export const FIELD_NAMES = ['Long furlong', 'Nether field', 'Brook furlong', 'West field', 'Cross acre', 'Broad meadow',
  'Stony furlong', 'Lark field', 'Hollow acre', 'Gorse field', 'Mill furlong', 'Upper field'];

export function freeGround(map, poly, { gap = 0.5, roadGap = 0.45, bank = 1.6, ignore = [] } = {}) {
  const probes = [...poly];
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    probes.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    cx += a[0] / poly.length; cy += a[1] / poly.length;
  }
  probes.push([cx, cy]);
  const wet = map.terrain.riverWidth / 2 + bank;
  for (const [x, y] of probes) {
    if (x < 6 || y < 6 || x > map.w - 6 || y > map.h - 6) return false;
    if (riverDistance(map, x, y) < wet) return false;
  }
  for (const p of map.places) {
    if (ignore.includes(p.id)) continue;
    const other = outline(p, gap);
    if (other && polysTouch(poly, other)) return false;
  }
  for (const [a, b, kind] of map.edges) {
    if (segPolyDist(map.nodes[a], map.nodes[b], poly) < HALF[kind] + roadGap) return false;
  }
  return true;
}

// One candidate lot on each side of every stretch of road or lane.
export function lotCandidates(map, [w, d], turned = false) {
  const out = [];
  for (let index = 0; index < map.edges.length; index++) {
    const [a, b, kind] = map.edges[index];
    if (kind !== 'road' && kind !== 'lane') continue;
    const A = map.nodes[a], B = map.nodes[b], len = dist(A, B);
    if (len < 1.2) continue;
    const ux = (B[0] - A[0]) / len, uy = (B[1] - A[1]) / len;
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
    for (const side of [1, -1]) {
      const nx = -uy * side, ny = ux * side;
      const off = HALF[kind] + 0.85 + (turned ? w : d) / 2;
      out.push({
        x: r2(mx + nx * off), y: r2(my + ny * off), w, d, a: r2(Math.atan2(uy, ux) + (turned ? Math.PI / 2 : 0)),
        at: [r2(mx + nx * (HALF[kind] + 0.35)), r2(my + ny * (HALF[kind] + 0.35))], way: kind, road: map.edges[index][3],
      });
    }
  }
  return out;
}

export function pickLot(map, kind, score, { turned = false } = {}) {
  let best = null;
  for (const lot of lotCandidates(map, FOOTPRINT[kind], turned)) {
    if (!freeGround(map, rectPoly(lot, 0.3))) continue;
    const value = score(lot);
    if (!best || value > best.value) best = { ...lot, value };
  }
  return best;
}

function clearTrees(map, p) {
  const poly = outline(p, p.kind === 'field' ? 0.3 : 0.9);
  if (!poly) return 0;
  const before = map.trees.length;
  map.trees = map.trees.filter(t => !inPoly(t, poly));
  return before - map.trees.length;
}

// Adds a place, joins it to the ways and clears its ground. Returns the place.
export function addPlace(map, kind, geo, props = {}) {
  const p = { id: props.id || kind + '-' + map.nextId++, kind, x: r2(geo.x), y: r2(geo.y) };
  for (const key of ['w', 'd', 'a', 'rx', 'ry', 'r']) if (geo[key] !== undefined) p[key] = r2(geo[key]);
  p.at = [r2(geo.at[0]), r2(geo.at[1])];
  Object.assign(p, { stage: 2 }, props, { id: p.id });
  p.node = attach(map, p.at[0], p.at[1]);
  map.places.push(p);
  p.felled = clearTrees(map, p);
  touch(map);
  return p;
}

// Cuts a new lane out from the settled ways into open ground. Returns its road index, or -1.
export function extendLane(map, rand) {
  const green = place(map, 'green');
  const ways = map.nodes.map(() => []);
  for (const [a, b, kind] of map.edges) {
    if (kind !== 'road' && kind !== 'lane') continue;
    ways[a].push(b); ways[b].push(a);
  }
  const solids = map.places.map(p => outline(p, p.kind === 'field' ? 0.4 : 0.9)).filter(Boolean);
  const houses = placesOf(map, 'cottage', false).length;
  const reach = 15 + 4.5 * Math.sqrt(houses);
  const wet = map.terrain.riverWidth / 2 + 5;
  let best = null;
  for (let n = 0; n < map.nodes.length; n++) {
    const P = map.nodes[n];
    if (!ways[n].length || ways[n].length > 2 || dist(P, [green.x, green.y]) > reach) continue;
    if (P[0] < 12 || P[1] < 12 || P[0] > map.w - 12 || P[1] > map.h - 12) continue;
    const Q = map.nodes[ways[n][0]];
    const along = Math.atan2(P[1] - Q[1], P[0] - Q[0]);
    const headings = ways[n].length === 1 ? [along - 0.35, along + 0.35] : [along + Math.PI / 2, along - Math.PI / 2];
    for (let heading of headings) {
      const pts = [];
      let x = P[0], y = P[1], ok = true;
      const steps = 5 + Math.floor(rand() * 3);
      for (let i = 1; i <= steps && ok; i++) {
        heading += (rand() - 0.5) * 0.5;
        x += Math.cos(heading) * 2.8; y += Math.sin(heading) * 2.8;
        if (x < 10 || y < 10 || x > map.w - 10 || y > map.h - 10 || riverDistance(map, x, y) < wet) ok = false;
        else if (solids.some(poly => inPoly([x, y], poly))) ok = false;
        else if (nearestOnRoads(map, [x, y], () => true).d < Math.min(5.5, 2.2 * i)) ok = false;
        pts.push([x, y]);
      }
      if (!ok) continue;
      let room = 0;
      for (const [px, py] of pts) {
        for (const side of [2.6, -2.6]) {
          const lot = { x: px + Math.cos(heading + Math.PI / 2) * side, y: py + Math.sin(heading + Math.PI / 2) * side, w: 2.7, d: 1.8, a: heading };
          if (freeGround(map, rectPoly(lot, 0.3), { roadGap: 0.2 })) room++;
        }
      }
      const mid = pts[pts.length >> 1];
      const value = room * 1.4 - dist(mid, [green.x, green.y]) * 0.5 - slopeAt(map, mid[0], mid[1]) * 25 + rand() * 3;
      if (!best || value > best.value) best = { value, start: n, pts };
    }
  }
  if (!best) return -1;
  const taken = new Set(map.roads.map(r => r.name));
  const name = LANE_NAMES.find(n => !taken.has(n)) || 'New Lane';
  const road = map.roads.push({ name, kind: 'lane' }) - 1;
  let last = best.start;
  for (const [x, y] of best.pts) {
    const n = addNode(map, x, y);
    addEdge(map, last, n, 'lane', road);
    last = n;
  }
  map.trees = map.trees.filter(t => !best.pts.some(p => dist(t, p) < 1.6));
  touch(map);
  return road;
}

// Ground for a new field: beside an existing one where possible, otherwise open land near a way.
export function fieldSite(map, rand) {
  const [w, d] = FOOTPRINT.field, green = place(map, 'green');
  const options = [];
  for (const f of placesOf(map, 'field', false)) {
    const c = Math.cos(f.a), s = Math.sin(f.a);
    for (const [du, dv] of [[0, d + 0.7], [0, -(d + 0.7)], [w + 0.9, 0], [-(w + 0.9), 0], [0, d + 2.1], [0, -(d + 2.1)]]) {
      options.push({ x: f.x + du * c - dv * s, y: f.y + du * s + dv * c, a: f.a, w, d, beside: 10 });
    }
  }
  for (let i = 0; i < 40; i++) {
    const angle = rand() * TAU, r = 24 + rand() * 34;
    options.push({ x: green.x + Math.cos(angle) * r, y: green.y + Math.sin(angle) * r, a: rand() * Math.PI, w, d, beside: 0 });
  }
  let best = null;
  for (const o of options) {
    const jitter = rand();
    if (!freeGround(map, rectPoly(o, 0.25), { gap: 0.3, roadGap: 0.3 })) continue;
    const access = nearestOnRoads(map, [o.x, o.y]);
    const value = o.beside - access.d * 0.7 - dist([o.x, o.y], [green.x, green.y]) * 0.12 - slopeAt(map, o.x, o.y) * 30 + jitter * 2;
    if (!best || value > best.value) best = { ...o, value, access };
  }
  if (!best) return null;
  // Workers stand just inside the edge that faces the nearest way.
  const toRoad = Math.atan2(best.access.y - best.y, best.access.x - best.x) - best.a;
  const c = Math.cos(best.a), s = Math.sin(best.a);
  const [u, v] = Math.abs(Math.cos(toRoad)) * d > Math.abs(Math.sin(toRoad)) * w
    ? [Math.sign(Math.cos(toRoad)) * (w / 2 - 1.6), 0] : [0, Math.sign(Math.sin(toRoad)) * (d / 2 - 1.6)];
  best.at = [r2(best.x + u * c - v * s), r2(best.y + u * s + v * c)];
  return best;
}

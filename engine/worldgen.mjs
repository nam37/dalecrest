// Seeds a village from a single number. Roads come first: a through road, lanes out to the
// places people work, then buildings on lots along those ways, fields and woods.
import { rng, spline, dist, r2, fbm, TAU, inPoly, lerp } from './geom.mjs';
import { riverDistance, isWater } from './terrain.mjs';
import { HALF, addNode, addEdge, nearestOnRoads, outline, place } from './roads.mjs';
import { FOOTPRINT, addPlace, pickLot } from './sites.mjs';

export const MAP_VERSION = 1;
const r1 = n => Math.round(n * 10) / 10 + 0;

function lay(map, name, kind, pts, first = null, last = null) {
  const road = map.roads.push({ name, kind }) - 1;
  const ids = pts.map((p, i) => i === 0 && first !== null ? first : i === pts.length - 1 && last !== null ? last : addNode(map, p[0], p[1]));
  for (let i = 1; i < ids.length; i++) {
    const A = map.nodes[ids[i - 1]], B = map.nodes[ids[i]];
    addEdge(map, ids[i - 1], ids[i], isWater(map, (A[0] + B[0]) / 2, (A[1] + B[1]) / 2, 0.9) ? 'bridge' : kind, road);
  }
  return ids;
}

// Bends each long stretch a little so no lane runs ruler-straight.
function winding(points, rand, sway = 0.14) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], len = dist(a, b);
    if (len > 9) {
      const k = (rand() - 0.5) * 2 * sway * len;
      out.push([(a[0] + b[0]) / 2 - (b[1] - a[1]) / len * k, (a[1] + b[1]) / 2 + (b[0] - a[0]) / len * k]);
    }
    out.push(b);
  }
  return out;
}

function plant(map, rand) {
  const { seed, cx, cy, riverWidth } = map.terrain;
  const solids = map.places.map(p => outline(p, p.kind === 'field' ? 0.4 : 1)).filter(Boolean);
  const wood = place(map, 'wood');
  for (let gy = 3; gy < map.h - 2; gy += 2.1) {
    for (let gx = 3; gx < map.w - 2; gx += 2.1) {
      const x = gx + (rand() - 0.5) * 1.7, y = gy + (rand() - 0.5) * 1.7;
      const roll = rand(), kindRoll = rand(), size = rand();
      const bank = riverDistance(map, x, y) - riverWidth / 2;
      if (bank < 0.7) continue;
      const fromCentre = dist([x, y], [cx, cy]), density = fbm(seed + 31, x / 26, y / 26);
      const inWood = dist([x, y], [wood.x, wood.y]) < wood.r * (0.7 + 0.6 * fbm(seed + 5, x / 6, y / 6, 2));
      let chance = inWood ? 0.86 : fromCentre > 22 && density > 0.56 ? 0.8 : fromCentre > 15 && density > 0.5 ? 0.1 : 0.022;
      if (bank < 3) chance = Math.max(chance, 0.2);
      if (roll > chance || solids.some(poly => inPoly([x, y], poly))) continue;
      const way = nearestOnRoads(map, [x, y], () => true);
      if (way.d < HALF[way.kind] + 1) continue;
      const pine = fbm(seed + 77, x / 30, y / 30) > 0.52 ? kindRoll < 0.8 : kindRoll < 0.08;
      map.trees.push([r1(x), r1(y), r1(0.6 + size * 0.55), pine ? 1 : 0]);
    }
  }
}

export function generateMap(seed = 26111) {
  const rand = rng(seed), jig = k => (rand() - 0.5) * k;
  const w = 160, h = 120;
  const cx = r2(w * 0.44 + jig(10)), cy = r2(h * 0.5 + jig(8));
  const base = cx + 29 + rand() * 6, slant = jig(0.2), p1 = rand() * TAU, p2 = rand() * TAU;
  const river = [];
  for (let y = -12; y <= h + 12; y += 4) {
    river.push([r2(base + 5 * Math.sin(y * 0.047 + p1) + 2.2 * Math.sin(y * 0.118 + p2) + (y - cy) * slant), y]);
  }
  const riverX = y => {
    const i = Math.min(river.length - 2, Math.max(0, Math.floor((y + 12) / 4)));
    return lerp(river[i][0], river[i + 1][0], (y - river[i][1]) / 4);
  };
  const map = {
    version: MAP_VERSION, seed, revision: 1, w, h,
    terrain: { seed, cx, cy, river, riverWidth: r2(4.2 + rand() * 1.2) },
    nodes: [], edges: [], roads: [], places: [], trees: [], gates: [], nextId: 9,
  };

  // The through road enters from the west, skirts the green and crosses the river at the bridge.
  const yb = cy + 4.5 + jig(5), xb = riverX(yb);
  const high = lay(map, 'High Road', 'road', spline([
    [-8, cy + jig(26)], [cx - 44, cy + 3 + jig(12)], [cx - 20, cy + 5 + jig(5)], [cx, cy + 5.4],
    [cx + 13, cy + 4.6 + jig(2)], [xb - 5, yb], [xb + 5, yb], [xb + 20, yb + jig(8)], [w + 8, yb + jig(22)],
  ], 2.8));
  map.gates = [high[0], high[high.length - 1]];
  const onHigh = x => high.reduce((best, n) => Math.abs(map.nodes[n][0] - x) < Math.abs(map.nodes[best][0] - x) ? n : best);

  addPlace(map, 'green', { x: cx, y: cy, rx: 5 + rand(), ry: 3.3 + rand() * 0.8, a: jig(0.4), at: [cx + 0.6, cy + 0.9] }, { id: 'green', name: 'Village green' });
  addPlace(map, 'well', { x: cx - 2.4, y: cy - 0.9, at: [cx - 1.4, cy - 0.1] }, { id: 'well', name: 'Village well' });

  // The mill stands on the near bank upstream, its long side to the water.
  const ym = cy - 27 - rand() * 8, xm = riverX(ym);
  let tx = riverX(ym + 2) - riverX(ym - 2), ty = 4;
  const tl = Math.hypot(tx, ty); tx /= tl; ty /= tl;
  const [mw, md] = FOOTPRINT.mill, off = map.terrain.riverWidth / 2 + md / 2 + 0.2;
  const millAt = [xm - ty * (off + md / 2 + 1), ym + tx * (off + md / 2 + 1)];
  const millStart = onHigh(cx + 10);
  lay(map, 'Mill Lane', 'lane', spline(winding([map.nodes[millStart], [lerp(map.nodes[millStart][0], millAt[0], 0.5), lerp(map.nodes[millStart][1], millAt[1], 0.45)], millAt], rand), 2.8), millStart);
  addPlace(map, 'mill', { x: xm - ty * off, y: ym + tx * off, w: mw, d: md, a: Math.atan2(ty, tx), at: millAt }, { id: 'mill', name: 'Watermill' });

  // Field Lane ends in a straight run between the first two fields.
  const fieldStart = onHigh(cx - 10), S = map.nodes[fieldStart];
  const E = [cx - 27 - rand() * 6, cy - 25 - rand() * 5];
  const fl = dist(S, E), ux = (E[0] - S[0]) / fl, uy = (E[1] - S[1]) / fl;
  const [fw, fd] = FOOTPRINT.field;
  const E0 = [E[0] - ux * (fw + 0.4), E[1] - uy * (fw + 0.4)], Em = [E[0] - ux * fw / 2, E[1] - uy * fw / 2];
  lay(map, 'Field Lane', 'lane', spline([...winding([S, E0], rand, 0.1), Em, E], 2.8), fieldStart);
  for (const [side, id, name] of [[1, 'fields', 'Strip fields'], [-1, 'fields-2', 'Long furlong']]) {
    const nx = -uy * side, ny = ux * side, reach = fd / 2 + 1;
    addPlace(map, 'field', { x: Em[0] + nx * reach, y: Em[1] + ny * reach, w: fw, d: fd, a: Math.atan2(uy, ux), at: [Em[0] + nx * 2.6, Em[1] + ny * 2.6] }, { id, name });
  }

  // The coppice lies out to the south-west at the end of its own lane.
  const woodAt = [cx - 40 - rand() * 7, cy + 17 + rand() * 8], woodStart = onHigh(cx - 27);
  lay(map, 'Wood Lane', 'lane', spline(winding([map.nodes[woodStart], woodAt], rand), 2.8), woodStart);
  addPlace(map, 'wood', { x: woodAt[0] - 2.5, y: woodAt[1] + 1.5, r: 8.5, at: woodAt }, { id: 'wood', name: 'Coppice' });

  // Back Lane loops south of the green and rejoins the road.
  const backA = onHigh(cx + 5), backB = onHigh(cx - 21);
  const S1 = [cx + 3 + jig(3), cy + 16 + jig(3)], S2 = [cx - 10 + jig(4), cy + 20 + jig(4)];
  lay(map, 'Back Lane', 'lane', spline([map.nodes[backA], S1, S2, map.nodes[backB]], 2.8), backA, backB);

  const near = (x, y) => lot => -dist([lot.x, lot.y], [x, y]);
  addPlace(map, 'hall', pickLot(map, 'hall', near(S1[0], S1[1])), { id: 'hall', name: 'Village hall' });
  addPlace(map, 'oven', pickLot(map, 'oven', near(cx + 12, cy + 2)), { id: 'oven', name: 'Common oven' });
  for (let i = 1; i <= 8; i++) {
    const turned = rand() < 0.25, home = [cx - 7 + jig(4), cy + 11 + jig(4)];
    addPlace(map, 'cottage', pickLot(map, 'cottage', lot => -dist([lot.x, lot.y], home) + rand() * 5, { turned }), { id: 'cottage-' + i });
  }
  plant(map, rand);
  return map;
}

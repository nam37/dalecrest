// Shared geometry and deterministic noise. Runs unchanged in Node and in the browser.
export const TAU = Math.PI * 2;
// Rounded for storage. Adding zero turns -0 into 0, which JSON would do anyway.
export const r2 = n => Math.round(n * 100) / 100 + 0;
export const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (lo, hi, v) => { const t = clamp((v - lo) / (hi - lo)); return t * t * (3 - 2 * t); };
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// mulberry32: a small generator whose whole state is the seed.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(seed, x, y) {
  let h = (seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function noise(seed, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(seed, xi, yi), b = hash2(seed, xi + 1, yi);
  const c = hash2(seed, xi, yi + 1), d = hash2(seed, xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export function fbm(seed, x, y, octaves = 3) {
  let sum = 0, amp = 0.5, total = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(seed + i * 101, x, y);
    total += amp; amp *= 0.5; x *= 2.03; y *= 2.03;
  }
  return sum / total;
}

// Closest point on segment ab to p.
export function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len) : 0;
  const x = a[0] + dx * t, y = a[1] + dy * t;
  return { d: Math.hypot(p[0] - x, p[1] - y), t, x, y };
}

export function segCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// Corners of a rectangle centred on (x, y), w along its angle and d across it.
export function rectPoly({ x, y, w, d, a = 0 }, grow = 0) {
  const c = Math.cos(a), s = Math.sin(a), hw = w / 2 + grow, hd = d / 2 + grow;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [x + u * c - v * s, y + u * s + v * c]);
}

export function inPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Separating axis test for convex polygons.
export function polysTouch(A, B) {
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      const nx = y2 - y1, ny = x1 - x2;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const [x, y] of A) { const v = x * nx + y * ny; minA = Math.min(minA, v); maxA = Math.max(maxA, v); }
      for (const [x, y] of B) { const v = x * nx + y * ny; minB = Math.min(minB, v); maxB = Math.max(maxB, v); }
      if (maxA < minB || maxB < minA) return false;
    }
  }
  return true;
}

export function segHitsPoly(a, b, poly) {
  if (inPoly(a, poly) || inPoly(b, poly)) return true;
  for (let i = 0; i < poly.length; i++) if (segCross(a, b, poly[i], poly[(i + 1) % poly.length])) return true;
  return false;
}

// Distance from a segment to a convex polygon, zero when they meet.
export function segPolyDist(a, b, poly) {
  if (segHitsPoly(a, b, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    best = Math.min(best, segDist(p, a, b).d, segDist(a, p, q).d, segDist(b, p, q).d);
  }
  return best;
}

// Evenly spaced points along a Catmull-Rom curve through the given points.
export function spline(points, spacing) {
  const dense = [];
  const at = i => points[clamp(i, 0, points.length - 1)];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < 16; s++) {
      const t = s / 16, t2 = t * t, t3 = t2 * t;
      dense.push([0, 1].map(k => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t
        + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  dense.push(points[points.length - 1]);
  let length = 0;
  for (let i = 1; i < dense.length; i++) length += dist(dense[i - 1], dense[i]);
  const count = Math.max(1, Math.round(length / spacing)), step = length / count;
  const out = [dense[0]];
  let walked = 0, next = step;
  for (let i = 1; i < dense.length && out.length < count; i++) {
    const seg = dist(dense[i - 1], dense[i]);
    while (walked + seg >= next && out.length < count) {
      const t = (next - walked) / seg;
      out.push([lerp(dense[i - 1][0], dense[i][0], t), lerp(dense[i - 1][1], dense[i][1], t)]);
      next += step;
    }
    walked += seg;
  }
  out.push(dense[dense.length - 1]);
  return out;
}

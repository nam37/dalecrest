// The plan view. Everything here is drawn from the village's stored map, so a new lane,
// field or cottage appears as soon as the residents have made it.
import { heightAt } from '/engine/terrain.mjs';
import { rectPoly, rng, hash2, TAU } from '/engine/geom.mjs';
import { createMotion } from '/motion.js';
import { light, hearths, indoors, yearLook, skyOver, blend } from '/ambient.js';

import { drawMapFigure } from './map-figure.js';
import { drawAnimal, drawGarden, drawWoodpile } from './map-parish.js';
import { parishLayout, strayCattle, workHeading } from './parish.js';
import { residentActivity } from './resident-pose.js';

export { villageColors } from './resident-pose.js';

const ink = '#524d3b', ground = '#cdd6a4';
const roofs = ['#a57456', '#a88c5d', '#aa7352', '#90907a', '#9c8259', '#b19769', '#a17c58', '#a96e50'];
const fieldTones = ['#c4b77e', '#cbbd87', '#c4b07c', '#b9b18a', '#c7bc8c', '#c9b67c'];
const leaf = ['#74935f', '#7f9d66', '#8ca872', '#688858'], needle = ['#577a5c', '#4f7056', '#628263'];
const russet = ['#b98a4e', '#c39c57', '#a9743f', '#b9a45c'], SNOW = '#f5f4ec';
const WAYS = { road: [0.98, '#ead7b1'], lane: [0.66, '#e7d3ae'], path: [0.34, '#dccba3'], track: [0.22, '#d8c8a2'] };
const tag = id => { let h = 0; for (const ch of id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0; return h; };

function trace(c, pts, close = false) {
  c.beginPath();
  pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  if (close) c.closePath();
}
function curve(c, pts) {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    c.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
  }
  c.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
}
function disc(c, x, y, r, fill, stroke, width) {
  c.beginPath(); c.arc(x, y, r, 0, TAU);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
}

// The convex outline of a set of points.
function hull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]), turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = list => { const out = []; for (const p of list) { while (out.length > 1 && turn(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop(); out.push(p); } out.pop(); return out; };
  return [...half(pts), ...half(pts.reverse())];
}

// The river's centre line moved sideways: positive distances lie to the east of a south-flowing river.
export function beside(river, offset) {
  return river.map((p, i) => {
    const a = river[Math.max(0, i - 1)], b = river[Math.min(river.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] + (b[1] - a[1]) / len * offset, p[1] - (b[0] - a[0]) / len * offset];
  });
}

// Joins each way's short edges back into one line so it can be drawn as a smooth stroke.
export function chains(map) {
  const groups = new Map(), out = [];
  for (const [a, b, kind, road] of map.edges) {
    if (road < 0) { out.push({ kind, road, pts: [map.nodes[a], map.nodes[b]] }); continue; }
    if (!groups.has(road)) groups.set(road, []);
    groups.get(road).push([a, b]);
  }
  for (const [road, edges] of groups) {
    const next = new Map();
    for (const [a, b] of edges) {
      if (!next.has(a)) next.set(a, []);
      if (!next.has(b)) next.set(b, []);
      next.get(a).push(b); next.get(b).push(a);
    }
    let at = [...next.keys()].find(n => next.get(n).length === 1) ?? edges[0][0], from = -1;
    const ids = [at];
    while (ids.length <= edges.length) {
      const to = next.get(at).find(n => n !== from);
      if (to === undefined) break;
      ids.push(to); from = at; at = to;
    }
    out.push({ kind: map.roads[road].kind, road, name: map.roads[road].name, pts: ids.map(n => map.nodes[n]) });
  }
  return out;
}

function building(c, p, line, lodgers, snowed = color => color) {
  const [w, d] = [p.w, p.d], hw = w / 2, hd = d / 2;
  c.save();
  c.translate(p.x, p.y); c.rotate(p.a);
  const h = tag(p.id);
  if (p.stage === 0) {
    c.setLineDash([0.35, 0.3]); c.strokeStyle = '#7b6d50'; c.lineWidth = line;
    c.strokeRect(-hw, -hd, w, d); c.setLineDash([]);
    for (const [x, y] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) disc(c, x, y, 0.14, '#6e5b3f');
    c.restore(); return;
  }
  if (p.stage === 1) {
    c.fillStyle = '#d9cba3'; c.fillRect(-hw, -hd, w, d);
    c.strokeStyle = '#8a6f4c'; c.lineWidth = line * 1.6;
    c.strokeRect(-hw, -hd, w, d);
    c.beginPath();
    for (let x = -hw + 0.45; x < hw; x += 0.45) { c.moveTo(x, -hd); c.lineTo(x, hd); }
    c.moveTo(-hw, 0); c.lineTo(hw, 0);
    c.lineWidth = line; c.stroke();
    c.restore(); return;
  }
  // Light falls from the north-west, so the roof plane turned that way is the paler one.
  const sunny = Math.cos(p.a) * 0.7 - Math.sin(p.a) * 0.7 > 0 ? -1 : 1;
  const roof = p.kind === 'hall' ? '#8e7459' : p.kind === 'mill' ? '#9b7858' : p.kind === 'granary' ? '#a8935f' : p.kind === 'alehouse' ? '#9a6a4c' : p.kind === 'storehouse' ? '#7d6b52' : roofs[h % roofs.length];
  c.fillStyle = snowed(roof); c.fillRect(-hw, -hd, w, d);
  c.fillStyle = '#fff5d02e'; c.fillRect(-hw, sunny < 0 ? -hd : 0, w, hd);
  c.fillStyle = '#3a2f2026'; c.fillRect(-hw, sunny < 0 ? 0 : -hd, w, hd);
  c.strokeStyle = '#695b4866'; c.lineWidth = line * 0.7;
  c.beginPath();
  for (let x = -hw + 0.3 + (h % 3) * 0.08; x < hw; x += 0.42) { c.moveTo(x, -hd + 0.12); c.lineTo(x, -0.1); c.moveTo(x + 0.2, 0.1); c.lineTo(x + 0.2, hd - 0.12); }
  c.stroke();
  c.strokeStyle = ink; c.lineWidth = line * 1.25; c.strokeRect(-hw, -hd, w, d);
  c.beginPath(); c.moveTo(-hw, 0); c.lineTo(hw, 0); c.stroke();
  if (p.kind === 'granary') { c.beginPath(); c.moveTo(-hw, -hd); c.lineTo(-hw + hd, 0); c.lineTo(-hw, hd); c.moveTo(hw, -hd); c.lineTo(hw - hd, 0); c.lineTo(hw, hd); c.stroke(); }
  if (p.kind === 'cottage' || p.kind === 'alehouse' || p.kind === 'hall') {
    c.fillStyle = '#6b5a47'; c.fillRect(hw * 0.45, -0.17, 0.34, 0.34); c.strokeRect(hw * 0.45, -0.17, 0.34, 0.34);
  }
  // A mark on the eaves facing the lane shows the door.
  const side = (p.at[0] - p.x) * -Math.sin(p.a) + (p.at[1] - p.y) * Math.cos(p.a) > 0 ? 1 : -1;
  const along = (p.at[0] - p.x) * Math.cos(p.a) + (p.at[1] - p.y) * Math.sin(p.a);
  if (Math.abs(along) < hw) { c.fillStyle = '#4c3f2e'; c.fillRect(along - 0.2, side * hd - 0.09, 0.4, 0.18); }
  if (p.kind === 'mill') {
    c.fillStyle = '#a1845b'; c.strokeStyle = ink; c.lineWidth = line;
    c.fillRect(-0.75, -side * hd - (side > 0 ? 0.7 : 0), 1.5, 0.7); c.strokeRect(-0.75, -side * hd - (side > 0 ? 0.7 : 0), 1.5, 0.7);
    c.beginPath();
    for (let x = -0.55; x < 0.7; x += 0.28) { c.moveTo(x, -side * hd); c.lineTo(x, -side * (hd + 0.7)); }
    c.stroke();
  }
  if (lodgers && p.kind === 'hall') { c.fillStyle = '#f3e4b1'; c.fillRect(-hw + 0.25, -0.14, 0.28, 0.28); }
  // Barrels and sacks stand by the storehouse door.
  if (p.kind === 'storehouse' && Math.abs(along) < hw) {
    c.fillStyle = '#8a6a44'; c.strokeStyle = ink; c.lineWidth = line * 0.8;
    for (const dx of [-0.75, -0.42, 0.55]) {
      c.beginPath(); c.arc(along + dx, side * (hd + 0.32), 0.15, 0, Math.PI * 2); c.fill(); c.stroke();
    }
  }
  c.restore();
}

function paintPaper(c, map, look, scale) {
  const line = Math.max(0.085, 1.05 / scale);
  c.lineCap = 'round'; c.lineJoin = 'round';
  // The season and any lying snow change the colours the sheet is painted in.
  const year = look.year || { leaf: 1, turn: 0, lush: 1, barley: null }, snow = look.snow || 0;
  const snowed = (color, k = 0.82) => snow ? blend(color, SNOW, snow * k) : color;
  c.fillStyle = snowed(blend('#e3dcc6', ground, year.lush)); c.fillRect(-40, -40, map.w + 80, map.h + 80);
  for (const [x, y, r, warm] of look.washes) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, warm ? '#eef2c244' : '#8ea86a44'); g.addColorStop(1, '#cdd6a400');
    c.globalAlpha = (1 - snow * 0.85) * (warm ? 1 : 0.3 + 0.7 * year.lush);
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  c.globalAlpha = 1;
  // Relief: slopes turned to the north-west light are lifted and those turned away are shaded.
  for (const [x, y, r, lit] of look.relief) {
    const g = c.createRadialGradient(x, y, 0, x, y, r), a = Math.min(0.15, Math.abs(lit) * 1.05) * (1 - snow * 0.4);
    g.addColorStop(0, lit > 0 ? 'rgba(252,255,214,' + a.toFixed(3) + ')' : 'rgba(38,62,48,' + a.toFixed(3) + ')');
    g.addColorStop(1, lit > 0 ? 'rgba(252,255,214,0)' : 'rgba(38,62,48,0)');
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Dotted contours mark each rise in the ground.
  c.strokeStyle = snow > 0.4 ? '#7f8a8288' : '#4f6a4688'; c.lineWidth = line * 1.7; c.setLineDash([0.01, 0.62]);
  c.beginPath();
  for (const [a, b] of look.contours) { c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
  c.stroke(); c.setLineDash([]);
  if (scale > 5) {
    c.strokeStyle = '#6f8a5566'; c.lineWidth = line * 0.8; c.fillStyle = '#5f7a4a40';
    for (const [x, y, tuft] of look.specks) {
      if (tuft) { c.beginPath(); c.moveTo(x, y); c.lineTo(x - 0.16, y - 0.2); c.moveTo(x, y); c.lineTo(x + 0.1, y - 0.28); c.moveTo(x + 0.25, y); c.lineTo(x + 0.4, y - 0.2); c.stroke(); }
      else c.fillRect(x, y, 0.08, 0.06);
    }
  }
  const places = map.places;
  const green = places.find(p => p.kind === 'green');
  if (green) {
    c.save(); c.translate(green.x, green.y); c.rotate(green.a);
    c.beginPath(); c.ellipse(0, 0, green.rx, green.ry, 0, 0, TAU);
    c.fillStyle = snowed(blend('#d2ceaa', '#bcd08a', year.lush)); c.fill();
    c.setLineDash([0.01, 0.5]); c.strokeStyle = '#5f7a5299'; c.lineWidth = line * 1.5; c.stroke(); c.setLineDash([]);
    c.restore();
  }
  // River: an earth bank, a pale strand, then water that deepens toward a channel that wanders
  // from one side to the other. The current itself is drawn live, over this.
  const river = map.terrain.river, rw = map.terrain.riverWidth;
  const band = (pts, width, color) => { curve(c, pts); c.strokeStyle = color; c.lineWidth = width; c.stroke(); };
  band(river, rw + 1.7, '#5f7a5233');
  band(river, rw + 1.05, '#8f9a7c');
  band(river, rw + 0.78, '#e4dcb6');
  band(river, rw + 0.1, '#4f6f6a');
  band(river, rw, '#9fcbcc');
  band(river, rw * 0.84, '#8fc1c6');
  const channel = river.map((p, i) => {
    const a = river[Math.max(0, i - 1)], b = river[Math.min(river.length - 1, i + 1)], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const sway = Math.sin(i * 0.9 + (map.seed % 7)) * rw * 0.16;
    return [p[0] + (b[1] - a[1]) / len * sway, p[1] - (b[0] - a[0]) / len * sway];
  });
  band(channel, rw * 0.5, '#7fb4bf');
  band(channel, rw * 0.24, '#6fa6b6');
  for (const side of [-1, 1]) band(beside(river, side * (rw / 2 - 0.42)), line * 1.6, '#eef8f2b0');
  // The west bank throws a little shade on the water and the east edge catches the light.
  band(beside(river, -rw * 0.4), rw * 0.14, '#3f5f5c26');
  band(beside(river, rw * 0.41), rw * 0.07, '#f4fbf266');
  // Reeds and stones along both banks.
  for (let i = 1; i < river.length - 1; i++) {
    for (let j = 0; j < 4; j++) {
      const roll = hash2(map.seed + 11, i * 4 + j, 9), side = roll < 0.5 ? -1 : 1, t = hash2(map.seed + 12, i * 4 + j, 4);
      const a = river[i], b = river[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = (b[1] - a[1]) / len, ny = -(b[0] - a[0]) / len;
      const edge = rw / 2 + 0.12 + hash2(map.seed + 13, i, j) * 0.5;
      const x = a[0] + (b[0] - a[0]) * t + nx * side * edge, y = a[1] + (b[1] - a[1]) * t + ny * side * edge;
      if (hash2(map.seed + 14, i, j) < 0.62) {
        c.strokeStyle = '#66754d'; c.lineWidth = line * 0.9; c.beginPath();
        for (const lean of [-0.14, 0, 0.14]) { c.moveTo(x + lean * 0.6, y); c.lineTo(x + lean * 1.6, y - 0.42 - Math.abs(lean)); }
        c.stroke();
      } else disc(c, x, y, 0.1 + hash2(map.seed + 15, i, j) * 0.1, '#c9c3a2', '#8d8869', line * 0.6);
    }
  }
  // Fields with furrows along their long side.
  places.filter(p => p.kind === 'field').forEach((f, i) => {
    const poly = rectPoly(f);
    if (f.stage === 0) {
      c.setLineDash([0.4, 0.35]); trace(c, poly, true); c.strokeStyle = '#7b6d50'; c.lineWidth = line; c.stroke(); c.setLineDash([]);
      for (const [x, y] of poly) disc(c, x, y, 0.15, '#6e5b3f');
      return;
    }
    c.save();
    // A worked field takes the colour of the barley's year, with a little of its own tone.
    const tone = fieldTones[tag(f.id) % fieldTones.length];
    c.translate(f.x, f.y); c.rotate(f.a);
    c.beginPath();
    if (c.roundRect) c.roundRect(-f.w / 2, -f.d / 2, f.w, f.d, 1.1); else c.rect(-f.w / 2, -f.d / 2, f.w, f.d);
    c.fillStyle = snowed(f.stage === 1 ? '#b9a488' : year.barley ? blend(year.barley, tone, 0.28) : tone); c.fill();
    c.strokeStyle = '#7d705488'; c.lineWidth = line * 1.3; c.stroke(); c.clip();
    const until = f.stage === 1 ? 0 : f.d / 2, bow = (tag(f.id) % 2 ? 1 : -1) * (0.35 + (tag(f.id) % 5) * 0.1);
    for (let y = -f.d / 2 - 0.4; y < until + 0.6; y += 0.5) {
      c.beginPath(); c.moveTo(-f.w / 2, y); c.quadraticCurveTo(0, y + bow, f.w / 2, y); c.strokeStyle = '#6f624680'; c.lineWidth = line * 0.8; c.stroke();
      c.beginPath(); c.moveTo(-f.w / 2, y + 0.14); c.quadraticCurveTo(0, y + bow + 0.14, f.w / 2, y + 0.14); c.strokeStyle = '#f0e6b380'; c.lineWidth = line; c.stroke();
    }
    c.restore();
  });
  for (const garden of look.parish.gardens) drawGarden(c, garden, year, snow, line);
  // Ways, narrowest first so the road lies over the lanes that join it.
  for (const kind of ['track', 'path', 'lane', 'road']) {
    const width = WAYS[kind][0], fill = snowed(WAYS[kind][1], 0.4);
    for (const pass of [0, 1]) {
      for (const way of look.chains) {
        if (way.kind !== kind) continue;
        curve(c, way.pts);
        if (kind === 'track' || kind === 'path') {
          if (pass) { c.strokeStyle = fill; c.lineWidth = width; c.stroke(); }
          else if (kind === 'path') { c.setLineDash([0.25, 0.4]); c.strokeStyle = '#a8977299'; c.lineWidth = width + line * 1.6; c.stroke(); c.setLineDash([]); }
        } else {
          c.strokeStyle = pass ? fill : '#b3a281'; c.lineWidth = width + (pass ? 0 : line * 2.2); c.stroke();
        }
      }
    }
  }
  for (const [a, b, kind] of map.edges) {
    if (kind !== 'bridge') continue;
    const A = map.nodes[a], B = map.nodes[b], len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    c.save(); c.translate(A[0], A[1]); c.rotate(Math.atan2(B[1] - A[1], B[0] - A[0]));
    c.fillStyle = '#2f454433'; c.fillRect(0.1, -0.36, len - 0.2, 1.3);
    c.fillStyle = '#b79a72'; c.fillRect(-0.05, -0.62, len + 0.1, 1.24);
    c.strokeStyle = '#7d6a4f'; c.lineWidth = line * 0.8; c.beginPath();
    for (let x = 0.2; x < len; x += 0.42) { c.moveTo(x, -0.6); c.lineTo(x, 0.6); }
    c.stroke();
    c.strokeStyle = '#675e48'; c.lineWidth = line * 2; c.beginPath(); c.moveTo(-0.05, -0.62); c.lineTo(len + 0.05, -0.62); c.moveTo(-0.05, 0.62); c.lineTo(len + 0.05, 0.62); c.stroke();
    c.restore();
  }
  // Shadows first, then buildings, then the trees that overhang them.
  // Filled as one shape, so the shadows of neighbouring buildings do not darken where they meet.
  c.beginPath();
  for (const p of places) {
    if (!p.w || p.kind === 'field' || p.stage !== 2) continue;
    const tall = p.kind === 'hall' || p.kind === 'mill' ? 1.25 : 0.9, foot = rectPoly(p);
    hull([...foot, ...foot.map(([x, y]) => [x + 0.8 * tall, y + 0.95 * tall])]).forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
    c.closePath();
  }
  c.fillStyle = '#26382e4d'; c.fill();
  for (const p of places) {
    if (p.kind === 'well') {
      if (p.stage < 2) { c.setLineDash([0.25, 0.22]); disc(c, p.x, p.y, 0.6, p.stage ? '#cbbf9c' : null, '#7b6d50', line); c.setLineDash([]); continue; }
      disc(c, p.x + 0.14, p.y + 0.17, 0.62, '#5a53392e'); disc(c, p.x, p.y, 0.58, '#beb294', ink, line * 1.2); disc(c, p.x, p.y, 0.32, '#6f7f7a', ink, line * 0.8);
      c.strokeStyle = '#6d6049'; c.lineWidth = line * 2; c.beginPath(); c.moveTo(p.x - 0.62, p.y); c.lineTo(p.x + 0.62, p.y); c.stroke();
    } else if (p.kind === 'oven' && p.stage === 2) {
      building(c, { ...p, w: p.w * 0.6, x: p.x - Math.cos(p.a) * p.w * 0.2, y: p.y - Math.sin(p.a) * p.w * 0.2 }, line, false, snowed);
      const ox = p.x + Math.cos(p.a) * p.w * 0.27, oy = p.y + Math.sin(p.a) * p.w * 0.27;
      disc(c, ox + 0.12, oy + 0.15, 0.62, '#5a53392e'); disc(c, ox, oy, 0.6, '#c2946e', ink, line * 1.2); disc(c, ox - 0.15, oy - 0.15, 0.2, '#d8b08a'); disc(c, ox, oy, 0.14, '#5f5142');
    } else if (p.w && p.kind !== 'field') building(c, p, line, look.lodgers, snowed);
  }
  const leafy = year.leaf > 0.3;
  // The shade of every tree is gathered into one shape and filled once, so where trees stand close
  // their shadows run together instead of darkening one another. Each is the crown's own outline
  // thrown south-east, away from the light, and joined to the foot of the tree.
  c.beginPath();
  for (const [x, y, r, pine] of look.woods) {
    if (!pine && !leafy) continue;
    for (const [dx, dy, size] of [[0.1, 0.12, 1.04], [0.34, 0.41, 1], [0.58, 0.7, 0.96]]) {
      c.moveTo(x + r * (dx + size), y + r * dy); c.arc(x + r * dx, y + r * dy, r * size, 0, TAU);
    }
  }
  c.fillStyle = '#22352b4d'; c.fill();
  for (const [x, y, r, pine] of look.woods) {
    const k = hash2(map.seed, x * 10, y * 10);
    if (pine) {
      const star = (cx, cy, size) => { c.beginPath(); for (let i = 0; i < 16; i++) { const a = i * TAU / 16 + k, rr = i % 2 ? size * 0.72 : size; c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } c.closePath(); };
      const tone = needle[Math.floor(k * 3)];
      star(x, y, r); c.fillStyle = snowed(blend(tone, '#22382e', 0.4), 0.45); c.fill(); c.strokeStyle = '#2f4638'; c.lineWidth = line; c.stroke();
      star(x - r * 0.1, y - r * 0.12, r * 0.68); c.fillStyle = snowed(tone, 0.6); c.fill();
      disc(c, x - r * 0.1, y - r * 0.12, r * 0.13, '#3a5544');
    } else {
      // Out of leaf, a broadleaved tree is its trunk and branches. The crown thickens over them in
      // spring, turns in autumn and thins again as it falls.
      if (year.leaf < 0.7) {
        c.strokeStyle = snow > 0.4 ? '#8d8672' : '#7a6e55'; c.lineWidth = line * 1.1; c.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = i * TAU / 6 + k * 6, rr = r * (0.62 + 0.3 * hash2(map.seed + 5, x * 10 + i, y * 10));
          c.moveTo(x, y); c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          c.moveTo(x + Math.cos(a) * rr * 0.55, y + Math.sin(a) * rr * 0.55); c.lineTo(x + Math.cos(a + 0.5) * rr * 0.9, y + Math.sin(a + 0.5) * rr * 0.9);
        }
        c.stroke();
        disc(c, x, y, r * 0.13, '#6b5f49');
      }
      if (year.leaf < 0.08) continue;
      c.globalAlpha = Math.min(1, 0.25 + year.leaf * 0.85);
      // Seven lobes of uneven size. The outline starts on the first lobe and ends there, so the
      // crown closes on itself with no straight edge left over.
      const lobe = i => { const a = (i % 7) * TAU / 7 + k * 6, rr = 0.86 + 0.16 * Math.sin((i % 7) * 2.3 + k * 9); return [a, rr]; };
      const crown = (cx, cy, size) => {
        const [a0, r0] = lobe(0);
        c.beginPath(); c.moveTo(cx + Math.cos(a0) * r0 * size, cy + Math.sin(a0) * r0 * size);
        for (let i = 1; i <= 7; i++) { const [a, rr] = lobe(i); c.quadraticCurveTo(cx + Math.cos(a - 0.45) * rr * size * 1.13, cy + Math.sin(a - 0.45) * rr * size * 1.13, cx + Math.cos(a) * rr * size, cy + Math.sin(a) * rr * size); }
        c.closePath();
      };
      // Each tree turns in its own week.
      const turned = Math.min(1, Math.max(0, year.turn * 1.5 - hash2(map.seed + 6, x * 10, y * 10) * 0.5));
      const tone = blend(leaf[Math.floor(k * 4)], russet[Math.floor(k * 4)], turned);
      // The shaded skirt of the crown, then its lit top, set toward the light.
      crown(x, y, r); c.fillStyle = snowed(blend(tone, turned > 0.5 ? '#6b4a2a' : '#2b4a3a', 0.38), 0.4); c.fill();
      c.strokeStyle = blend('#2f4638', '#6d5230', turned); c.lineWidth = line; c.stroke();
      crown(x - r * 0.12, y - r * 0.14, r * 0.74); c.fillStyle = snowed(tone, 0.55); c.fill();
      crown(x - r * 0.2, y - r * 0.23, r * 0.42); c.fillStyle = snowed(blend(tone, '#e9f0b8', 0.22), 0.6); c.fill();
      // A few scallops give the foliage its grain.
      c.strokeStyle = blend('#2f463866', '#6d523066', turned); c.lineWidth = line * 0.8; c.setLineDash([0.16, 0.14]);
      for (let i = 0; i < 3; i++) {
        const a = k * 9 + i * 2.2, d = r * (0.28 + 0.14 * i);
        c.beginPath(); c.arc(x - r * 0.1 + Math.cos(a) * d * 0.5, y - r * 0.1 + Math.sin(a) * d * 0.5, r * 0.34, a + 0.4, a + 2.3); c.stroke();
      }
      c.setLineDash([]);
      c.globalAlpha = 1;
    }
  }
}

// Decoration that depends only on the terrain is worked out once per map.
function prepare(map) {
  const rand = rng(map.seed + 3), look = { washes: [], relief: [], contours: [], specks: [] };
  for (let i = 0; i < 150; i++) look.washes.push([rand() * map.w, rand() * map.h, 5 + rand() * 13, i % 3 !== 0]);
  // A grid of heights gives both the shading of each slope and the contour lines between levels.
  const step = 2, nx = Math.ceil(map.w / step), ny = Math.ceil(map.h / step), H = [];
  for (let j = 0; j <= ny; j++) { H.push([]); for (let i = 0; i <= nx; i++) H[j].push(heightAt(map, i * step, j * step)); }
  let top = 0;
  for (let j = 1; j < ny; j++) {
    for (let i = 1; i < nx; i++) {
      top = Math.max(top, H[j][i]);
      if (H[j][i] < 0.06) continue;
      // Ground that rises toward the south-east faces the north-west light.
      const lit = ((H[j][i + 1] - H[j][i - 1]) + (H[j + 1][i] - H[j - 1][i])) / (2 * step) / Math.SQRT2;
      if (Math.abs(lit) > 0.012) look.relief.push([i * step, j * step, step * 1.9, lit]);
    }
  }
  for (let level = 0.42; level < top; level += 0.4) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = i * step, y = j * step, pts = [];
        const cross = (h1, h2, x1, y1, x2, y2) => { if ((h1 < level) !== (h2 < level)) { const t = (level - h1) / (h2 - h1); pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]); } };
        cross(H[j][i], H[j][i + 1], x, y, x + step, y); cross(H[j][i + 1], H[j + 1][i + 1], x + step, y, x + step, y + step);
        cross(H[j + 1][i], H[j + 1][i + 1], x, y + step, x + step, y + step); cross(H[j][i], H[j + 1][i], x, y, x, y + step);
        if (pts.length >= 2) look.contours.push([pts[0], pts[1]]);
        if (pts.length === 4) look.contours.push([pts[2], pts[3]]);
      }
    }
  }
  for (let i = 0; i < 5200; i++) look.specks.push([rand() * map.w, rand() * map.h, i % 6 === 0]);
  return look;
}

export function surveyBounds(maps, cells = [], cellSize = 0) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  function include(x, y, rx, ry) {
    left = Math.min(left, x - rx); right = Math.max(right, x + rx);
    top = Math.min(top, y - ry); bottom = Math.max(bottom, y + ry);
  }
  for (const map of maps) {
    for (const p of map.places) {
      const radius = p.r ?? (p.w ? Math.hypot(p.w, p.d) / 2 : 2);
      include(p.x, p.y, p.rx ?? radius, p.ry ?? radius);
    }
    for (const [a, b, kind] of map.edges) {
      if (kind !== 'lane') continue;
      for (const node of [a, b]) include(...map.nodes[node], 0, 0);
    }
  }
  for (const [x, y] of cells) include((x + 0.5) * cellSize, (y + 0.5) * cellSize, cellSize / 2, cellSize / 2);
  return Number.isFinite(left) ? [left - 6, top - 5, right + 6, bottom + 5] : [0, 0, maps[0].w, maps[0].h];
}

// A still plate for the archive and resident records, using the live map's terrain and buildings.
export function createSurvey(canvas) {
  const c = canvas.getContext('2d');
  let groundKey, look, lastMap;
  return (map, { minute = 720, bounds, changes = [], heat } = {}) => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const key = [map.seed, map.w, map.h].join(':');
    if (key !== groundKey) { look = prepare(map); groundKey = key; }
    if (map !== lastMap) {
      look.chains = chains(map);
      look.parish = parishLayout(map);
      look.woods = [...map.trees].sort((a, b) => a[1] - b[1]);
      lastMap = map;
    }
    look.year = yearLook(minute);
    look.snow = Math.round(skyOver(minute, map.seed).lying * 4) / 4;
    const [left, top, right, bottom] = bounds ?? surveyBounds([map], heat?.cells, heat?.cellSize);
    const scale = Math.min(w / (right - left), h / (bottom - top));
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    c.setTransform(scale * dpr, 0, 0, scale * dpr, dpr * (w / 2 - cx * scale), dpr * (h / 2 - cy * scale));
    paintPaper(c, map, look, scale);
    if (heat?.cells.length) {
      c.fillStyle = '#f7efdb70';
      c.fillRect(cx - w / scale / 2, cy - h / scale / 2, w / scale, h / scale);
      const { cells, cellSize } = heat, strongest = Math.log1p(cells[0][2]);
      for (const [x, y, minutes] of cells) {
        const intensity = Math.log1p(minutes) / strongest;
        c.fillStyle = blend('#edc060', '#a22e20', intensity);
        c.globalAlpha = 0.36 + 0.51 * intensity;
        c.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
      c.globalAlpha = 1;
      c.strokeStyle = '#6d2c21'; c.lineWidth = 1.2 / scale;
      c.strokeRect(cells[0][0] * cellSize, cells[0][1] * cellSize, cellSize, cellSize);
      return;
    }
    for (const p of changes) {
      if (p.w) trace(c, rectPoly(p, 0.24), true);
      else { c.beginPath(); c.arc(p.x, p.y, 1, 0, TAU); }
      c.strokeStyle = '#f7ead1'; c.lineWidth = 4 / scale; c.stroke();
      c.strokeStyle = '#a44d2b'; c.lineWidth = 1.85 / scale; c.stroke();
    }
    if (w > 540) {
      c.font = 'italic ' + (15 / scale) + 'px "IM Fell English", Georgia, serif';
      c.textAlign = 'center'; c.textBaseline = 'top';
      c.strokeStyle = '#f6eddb'; c.fillStyle = ink; c.lineWidth = 3 / scale;
      for (const p of map.places) {
        if (!p.name || !['green', 'mill', 'wood'].includes(p.kind)) continue;
        const y = p.y + (p.ry ?? p.d ?? 1.5) / 2 + 1;
        c.strokeText(p.name, p.x, y); c.fillText(p.name, p.x, y);
      }
    }
  };
}

// cards.resident(actor, others) and cards.event(events, spot) return what the card over a resident or a
// chronicle note should say. Without them there is no card.
export function createMap(canvas, onSelect, cards) {
  const c = canvas.getContext('2d');
  const paper = document.createElement('canvas');
  const motion = createMotion();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let map = null, look = null, locations = {}, actors = [], selectedId = null, frame = 0, stale = true, moved = false, clock = 720;
  let w = 0, h = 0, dpr = 1, hits = [], hover = null;
  // The card shows whoever the pointer rests on, or else whoever was last clicked.
  let pinned = null, pointed = null, shown = null, cardStale = true, cardSize = [0, 0];
  // Notes mark where something lately happened. One may be held open, as a resident's card may.
  let marks = [], noteHits = [], pointedMark = null, pinnedMark = null, awaiting = null;
  const card = cards ? document.createElement('div') : null, cardBody = document.createElement('div');
  if (card) {
    const close = document.createElement('button'), hint = document.createElement('p');
    card.className = 'map-card'; card.hidden = true; card.setAttribute('role', 'group'); card.setAttribute('aria-label', 'Resident on the map');
    close.type = 'button'; close.className = 'map-card-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => { pinned = pinnedMark = null; schedule(); });
    hint.className = 'map-card-hint'; hint.textContent = 'Click to keep this open';
    card.append(close, cardBody, hint);
    canvas.parentElement.append(card);
  }
  // The weather over the village now, and the houses that got no firewood this morning.
  let wx = null, cold = [], world = null, cattle = [];
  const view = { x: 80, y: 60, scale: 6 };
  // The sheet is repainted when the day changes or snow settles or goes.
  function seasonal() {
    if (!map || !look) return;
    wx = skyOver(clock, map.seed);
    const key = Math.floor(clock / 1440) + ':' + Math.round(wx.lying * 4);
    if (key === look.key) return;
    look.key = key; look.year = yearLook(clock); look.snow = Math.round(wx.lying * 4) / 4; stale = true;
  }
  const pointers = new Map();
  let drag = null, engaged = false;
  // What the sheet is keeping in view for a watcher: a resident, a spot, or the whole village.
  let watching = null;

  const least = () => Math.max(w / (map?.w || 160), h / (map?.h || 120));
  function clampView() {
    view.scale = Math.min(34, Math.max(least(), view.scale));
    if (!map) return;
    const hx = w / 2 / view.scale, hy = h / 2 / view.scale;
    view.x = Math.min(map.w - hx, Math.max(hx, view.x));
    view.y = Math.min(map.h - hy, Math.max(hy, view.y));
  }
  // Frames everything people have built, with a margin of open country.
  let whole = 0;
  function framed() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of map.places) {
      const r = p.kind === 'wood' ? p.r * 0.7 : p.w ? Math.max(p.w, p.d) / 2 : 2;
      x0 = Math.min(x0, p.x - r); y0 = Math.min(y0, p.y - r); x1 = Math.max(x1, p.x + r); y1 = Math.max(y1, p.y + r);
    }
    return [(x0 + x1) / 2, (y0 + y1) / 2, Math.min(w / (x1 - x0 + 14), h / (y1 - y0 + 12))];
  }
  function fit() {
    if (!map || !w) return;
    [view.x, view.y, view.scale] = framed();
    clampView();
    whole = view.scale;
  }
  // Eases the sheet towards what is being watched. Once a resident is in the middle the sheet rests,
  // and it moves again only when they come near its edge, so a walk is followed in a few unhurried pans.
  function follow(time) {
    if (!map || !w) return;
    let gx, gy, gs;
    if (watching.whole) [gx, gy, gs] = framed();
    else {
      const p = watching.id ? motion.at(watching.id, time) : watching;
      if (!p) return;
      gx = p.x; gy = p.y; gs = Math.min(34, Math.max(least(), (whole || view.scale) * (watching.id ? 2 : 2.2)));
      const [sx, sy] = toScreen(gx, gy);
      if (watching.settled && Math.abs(sx - w / 2) < w * 0.22 && Math.abs(sy - h / 2) < h * 0.22) return;
    }
    const dt = Math.min(0.1, Math.max(0.016, (time - (watching.at ?? time)) / 1000)), k = reduced.matches ? 1 : 1 - Math.exp(-dt * 2.6);
    const was = [view.x, view.y, view.scale];
    watching.at = time;
    view.x += (gx - view.x) * k; view.y += (gy - view.y) * k; view.scale *= Math.pow(gs / view.scale, k);
    clampView();
    // The edge of the parish can keep the subject off centre. Then this is as far as the sheet goes.
    const still = Math.abs(view.x - was[0]) < 0.004 && Math.abs(view.y - was[1]) < 0.004 && Math.abs(view.scale / was[2] - 1) < 0.0006;
    watching.settled = still;
    if (!still) { moved = true; stale = true; }
  }
  // The reader has taken the sheet in hand, so a watch lets go of it.
  function steered() { if (watching) { watching = null; cards?.steered?.(); } }
  const toScreen = (x, y) => [(x - view.x) * view.scale + w / 2, (y - view.y) * view.scale + h / 2];
  const toWorld = (sx, sy) => [(sx - w / 2) / view.scale + view.x, (sy - h / 2) / view.scale + view.y];

  const face = '"IM Fell English", Georgia, serif';
  function label(text, x, y, size, italic = true, angle = 0) {
    c.save(); c.translate(x, y); c.rotate(angle);
    c.font = (italic ? 'italic ' : '') + size + 'px ' + face;
    c.lineWidth = 3.6; c.strokeStyle = '#efe6cde6'; c.lineJoin = 'round'; c.strokeText(text, 0, 0);
    c.fillStyle = '#37331f'; c.fillText(text, 0, 0);
    c.restore();
  }

  // A point a given fraction of the way down the river.
  function alongRiver(f) {
    const pts = map.terrain.river, at = Math.max(0, Math.min(0.9999, f)) * (pts.length - 1), i = Math.floor(at), k = at - i;
    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
  }

  // Everything that moves or changes with the hour, drawn over the paper and under the residents.
  function ambient(time, sky, lit) {
    const k = view.scale;
    const cover = wx ? wx.cloud : 0.3;
    if (sky.bright > 0.05 && cover > 0.05) {
      // Cloud shadows cross the parish from the west, heavier the more cloud there is.
      for (let i = 0; i < 3; i++) {
        const cx = ((i * 71 + time * 0.0016 * (1 + i * 0.3)) % (map.w + 90)) - 45, cy = 18 + i * 37 + Math.sin(time * 0.00004 + i * 2) * 8;
        const [x, y] = toScreen(cx, cy), r = (24 + i * 5) * k;
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(58,52,34,' + (0.13 * sky.bright * (0.45 + cover * 1.1)).toFixed(3) + ')'); g.addColorStop(1, 'rgba(58,52,34,0)');
        c.save(); c.translate(x, y); c.scale(1, 0.55); c.translate(-x, -y); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); c.restore();
      }
    }
    // The current: long broken lines that travel downstream, each at its own pace.
    const rw = map.terrain.riverWidth, calm = 0.5 + 0.5 * sky.bright;
    c.lineCap = 'round';
    look.flow ??= [-0.3, -0.12, 0.07, 0.25, 0.36].map(f => beside(map.terrain.river, f * rw));
    look.flow.forEach((pts, i) => {
      c.beginPath();
      pts.forEach(([wx, wy], n) => {
        const [x, y] = toScreen(wx, wy);
        if (!n) c.moveTo(x, y);
        else { const [px, py] = toScreen(pts[n - 1][0], pts[n - 1][1]); c.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2); }
      });
      c.setLineDash([k * (1.1 + i * 0.35), k * (1.9 + (i % 2)), k * 0.45, k * (2.6 - i * 0.2)]);
      c.lineDashOffset = -time * 0.0011 * k * (0.75 + i * 0.13);
      c.strokeStyle = 'rgba(240,249,243,' + ((i % 2 ? 0.5 : 0.36) * calm).toFixed(3) + ')';
      c.lineWidth = Math.max(0.9, k * (i === 2 ? 0.085 : 0.06));
      c.stroke();
    });
    c.setLineDash([]);
    // Sun on the water, when there is sun.
    if (sky.bright > 0.3 && cover < 0.7) {
      for (let i = 0; i < 9; i++) {
        const blink = Math.sin(time * 0.0013 + i * 2.4);
        if (blink < 0.55) continue;
        const [wx, wy] = alongRiver((i * 0.113 + Math.floor(time / 4200 + i) * 0.37) % 1);
        const [x, y] = toScreen(wx + Math.sin(i * 5.1) * rw * 0.3, wy), r = k * 0.2 * (blink - 0.45) * 2;
        c.strokeStyle = 'rgba(255,255,246,' + ((blink - 0.5) * 1.6).toFixed(3) + ')'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(x - r, y); c.lineTo(x + r, y); c.moveTo(x, y - r); c.lineTo(x, y + r); c.stroke();
      }
    }
    // White water below the mill wheel.
    for (const p of map.places) {
      if (p.kind !== 'mill' || p.stage !== 2) continue;
      const side = (p.at[0] - p.x) * -Math.sin(p.a) + (p.at[1] - p.y) * Math.cos(p.a) > 0 ? 1 : -1;
      const fx = p.x + Math.sin(p.a) * side * (p.d / 2 + 0.75), fy = p.y - Math.cos(p.a) * side * (p.d / 2 + 0.75);
      for (let i = 0; i < 4; i++) {
        const f = (time * 0.0005 + i / 4) % 1, [x, y] = toScreen(fx + Math.sin(i * 2.1) * 0.25, fy + 0.5 + f * 2.2);
        c.strokeStyle = 'rgba(250,253,248,' + ((1 - f) * 0.75 * calm).toFixed(3) + ')'; c.lineWidth = Math.max(1, k * 0.09);
        c.beginPath(); c.arc(x, y, k * (0.22 + f * 0.4), Math.PI * 0.15, Math.PI * 0.85); c.stroke();
      }
    }
    // Smoke from every hearth with someone at it.
    for (const p of lit) {
      const cx = p.x + Math.cos(p.a) * p.w * 0.32, cy = p.y + Math.sin(p.a) * p.w * 0.32;
      for (let i = 0; i < 5; i++) {
        const f = (time * 0.00016 + i / 5 + (tag(p.id) % 10) / 10) % 1;
        const [x, y] = toScreen(cx + f * 2.6 + Math.sin(f * 6 + i) * 0.25, cy - f * 2.1);
        c.fillStyle = 'rgba(246,240,224,' + ((1 - f) * 0.5).toFixed(3) + ')';
        c.beginPath(); c.arc(x, y, (0.22 + f * 0.75) * k, 0, TAU); c.fill();
      }
    }
  }

  // Cloud takes the warmth out of the light, and rain or snow greys it further.
  function overcast(sky) {
    const k = wx ? Math.max(wx.cloud * 0.5, wx.rain * 0.85, wx.snow * 0.6) * (0.35 + 0.65 * sky.bright) : 0;
    if (k < 0.02) return;
    c.save();
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = blend('#ffffff', '#b4bcc4', k); c.fillRect(0, 0, w, h);
    c.restore();
  }

  // Rain slants across the sheet from the west. Snow drifts down and sways.
  function falling(time) {
    if (!wx || !(wx.rain || wx.snow)) return;
    const spanX = w + 80, spanY = h + 60;
    if (wx.rain) {
      const n = Math.round(w * h / 4200 * (0.3 + wx.rain)), len = 9 + wx.rain * 10;
      c.strokeStyle = 'rgba(58,80,102,' + (0.3 + wx.rain * 0.22).toFixed(2) + ')'; c.lineWidth = 1.1; c.lineCap = 'round';
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const speed = 0.5 + hash2(7, i, 1) * 0.35;
        const y = (hash2(7, i, 2) * spanY + time * speed) % spanY - 30, x = (hash2(7, i, 3) * spanX + time * speed * 0.24) % spanX - 40;
        c.moveTo(x, y); c.lineTo(x + len * 0.24, y + len);
      }
      c.stroke();
      return;
    }
    const n = Math.round(w * h / 3600 * (0.3 + wx.snow));
    c.fillStyle = 'rgba(255,255,255,.96)'; c.strokeStyle = 'rgba(96,108,130,.42)'; c.lineWidth = 0.8;
    for (let i = 0; i < n; i++) {
      const speed = 0.026 + hash2(9, i, 1) * 0.03, sway = Math.sin(time * 0.0011 + i) * 9;
      const y = (hash2(9, i, 2) * spanY + time * speed) % spanY - 30, x = (hash2(9, i, 3) * spanX + time * speed * 0.3) % spanX - 40 + sway;
      c.beginPath(); c.arc(x, y, 1.1 + hash2(9, i, 4) * 1.5, 0, TAU); c.fill(); c.stroke();
    }
  }

  // Night falls as a wash over the whole sheet. Lit windows are added back on top of it.
  function nightfall(sky, lit) {
    if (sky.dark <= 0.01 && sky.dusk <= 0.01) return;
    c.save();
    c.globalCompositeOperation = 'multiply';
    const d = Math.pow(sky.dark, 1.15) * 0.9, mix = (a, b) => Math.round(a + (b - a) * d);
    c.fillStyle = 'rgb(' + mix(255, 84) + ',' + mix(255, 104) + ',' + mix(255, 164) + ')';
    c.fillRect(0, 0, w, h);
    if (sky.dusk > 0.01) { c.fillStyle = 'rgba(255,170,104,' + (sky.dusk * 0.32).toFixed(3) + ')'; c.fillRect(0, 0, w, h); }
    c.globalCompositeOperation = 'lighter';
    if (sky.dark > 0.25) {
      for (const p of lit) {
        const [x, y] = toScreen(p.x, p.y), r = 3.4 * view.scale, a = Math.min(1, (sky.dark - 0.25) * 1.6);
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,196,104,' + (0.62 * a).toFixed(3) + ')'); g.addColorStop(0.35, 'rgba(255,170,80,' + (0.2 * a).toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,160,70,0)');
        c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
        c.fillStyle = 'rgba(255,232,170,' + (0.9 * a).toFixed(3) + ')';
        const side = (p.at[0] - p.x) * -Math.sin(p.a) + (p.at[1] - p.y) * Math.cos(p.a) > 0 ? 1 : -1;
        const [wx, wy] = toScreen(p.x - Math.sin(p.a) * side * p.d * 0.5, p.y + Math.cos(p.a) * side * p.d * 0.5);
        c.beginPath(); c.arc(wx, wy, Math.max(1.4, view.scale * 0.16), 0, TAU); c.fill();
      }
    }
    c.restore();
  }

  function birds(time, sky) {
    const cycle = Math.floor(time / 47000), f = (time % 47000) / 47000;
    if (sky.bright < 0.5 || f > 0.42) return;
    const y0 = h * (0.16 + 0.5 * hash2(map.seed, cycle, 5)), x0 = -40 + (w + 80) * (f / 0.42), dir = cycle % 2 ? -1 : 1;
    c.strokeStyle = 'rgba(52,47,32,.62)'; c.lineWidth = 1.3; c.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const x = (dir > 0 ? x0 : w - x0) - dir * Math.abs(i - 2) * 13, y = y0 + (i - 2) * 8 + Math.sin(time * 0.002 + i) * 2, flap = 2.2 + Math.sin(time * 0.012 + i * 1.3) * 2.4;
      c.beginPath(); c.moveTo(x - 4.5, y - flap); c.quadraticCurveTo(x - 1.5, y - flap * 0.2, x, y + 1); c.quadraticCurveTo(x + 1.5, y - flap * 0.2, x + 4.5, y - flap); c.stroke();
    }
  }

  // A compass rose in the corner of the plate.
  function rose() {
    const x = w - 54, y = h - 58, R = 25;
    c.save(); c.translate(x, y);
    c.strokeStyle = '#4d4631'; c.fillStyle = '#efe6cdcc'; c.lineWidth = 1;
    c.beginPath(); c.arc(0, 0, R * 0.62, 0, TAU); c.fill(); c.stroke();
    c.beginPath(); c.arc(0, 0, R * 0.74, 0, TAU); c.setLineDash([1.5, 2.5]); c.stroke(); c.setLineDash([]);
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8, long = i % 2 === 0, len = long ? R : R * 0.55, wd = long ? R * 0.17 : R * 0.12;
      c.save(); c.rotate(a);
      c.beginPath(); c.moveTo(0, -len); c.lineTo(wd, 0); c.lineTo(0, 0); c.closePath(); c.fillStyle = '#4d4631'; c.fill();
      c.beginPath(); c.moveTo(0, -len); c.lineTo(-wd, 0); c.lineTo(0, 0); c.closePath(); c.fillStyle = '#f3ead0'; c.fill(); c.stroke();
      c.restore();
    }
    c.font = '13px "IM Fell English SC", Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 3; c.strokeStyle = '#efe6cde6'; c.strokeText('N', 0, -R - 9); c.fillStyle = '#37331f'; c.fillText('N', 0, -R - 9);
    c.restore();
  }

  // The village's name and size, as a surveyor would head the sheet.
  function title() {
    // The heading belongs to the whole sheet, so it fades once the reader leans in.
    const near = whole ? view.scale / whole : 1, show = Math.max(0, Math.min(1, (1.5 - near) / 0.3));
    if (w < 820 || !show) return;
    c.save(); c.globalAlpha = show; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    const write = (text, y, size, space, halo) => {
      if ('letterSpacing' in c) c.letterSpacing = space + 'px';
      c.font = size + 'px "IM Fell English SC", Georgia, serif';
      c.lineWidth = halo; c.strokeStyle = '#efe6cdd9'; c.strokeText(text, w / 2, y);
      c.fillStyle = '#2b271d'; c.fillText(text, w / 2, y);
    };
    write('Dalecrest', 40, 36, 5, 6);
    write('Pop. ' + actors.length, 68, 16, 2, 4);
    c.restore();
  }

  let lastPaint = 0;
  function paint(time) {
    frame = 0;
    if (!map || !w || canvas.offsetParent === null) { if (card) { card.hidden = true; shown = null; } return; }
    // The scene moves gently, so about twenty frames a second is plenty, except while the sheet itself is gliding.
    if (!stale && time - lastPaint < 46 && !reduced.matches && (!watching || watching.settled)) { schedule(); return; }
    lastPaint = time;
    if (watching) follow(time);
    if (stale) {
      stale = false;
      const p = paper.getContext('2d');
      p.setTransform(1, 0, 0, 1, 0, 0);
      p.fillStyle = ground; p.fillRect(0, 0, paper.width, paper.height);
      const k = dpr * view.scale;
      p.setTransform(k, 0, 0, k, dpr * (w / 2 - view.x * view.scale), dpr * (h / 2 - view.y * view.scale));
      paintPaper(p, map, look, view.scale);
    }
    const sky = light(clock), lit = hearths(map, actors, cold), still = reduced.matches ? 0 : time;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.drawImage(paper, 0, 0, w, h);
    for (const pile of look.parish.piles) drawWoodpile(c, pile, world, look.snow, toScreen, view.scale);
    for (const animal of look.parish.sheep) drawAnimal(c, animal, still, toScreen, view.scale);
    for (const animal of cattle) drawAnimal(c, animal, still, toScreen, view.scale);
    ambient(still, sky, lit);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (view.scale > 6.5) {
      for (const way of look.chains) {
        if (!way.name || way.pts.length < 5) continue;
        const i = way.pts.length >> 1, a = way.pts[i - 1], b = way.pts[i + 1];
        let angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
        const [x, y] = toScreen(way.pts[i][0], way.pts[i][1]);
        c.globalAlpha = 0.72; label(way.name, x, y - 9, 11.5, true, angle); c.globalAlpha = 1;
      }
    }
    // Buildings that stand close together, such as the oven and the storehouse, would write their names
    // over each other. A later name steps down a line until it is clear of those already written.
    const written = [];
    for (const p of map.places) {
      if (p.kind === 'cottage' || !p.name || (p.kind === 'well' && view.scale < 11)) continue;
      const [x, y] = toScreen(p.x, p.y);
      const drop = p.kind === 'field' ? 0 : p.kind === 'well' ? -1.3 * view.scale - 4 : p.kind === 'green' ? (p.ry + 1) * view.scale + 3 : ((p.d || 2.4) / 2 + 0.9) * view.scale + 4;
      const text = p.stage < 2 && p.kind !== 'field' ? p.name + ' (building)' : p.name, size = Math.max(13, Math.min(20, view.scale * 1.9));
      const half = text.length * size * 0.26;
      let at = y + drop;
      for (let i = 0; i < 4 && written.some(b => Math.abs(b.x - x) < b.half + half && Math.abs(b.y - at) < size); i++) at += size * 1.05;
      written.push({ x, y: at, half });
      label(text, x, at, size);
    }
    if (w > 560) rose();
    title();
    overcast(sky);
    nightfall(sky, lit);
    if (!reduced.matches && !(wx?.rain || wx?.snow)) birds(time, sky);
    notes(still);
    hits = [];
    const crowd = new Map(), markers = [];
    for (const [index, actor] of actors.entries()) {
      const p = motion.at(actor.id, time);
      if (!p) continue;
      const key = Math.round(p.x * 2) + ',' + Math.round(p.y * 2);
      const count = crowd.get(key) || 0;
      crowd.set(key, count + 1);
      const a = count * 2.4, spread = count ? 11 * Math.sqrt(count) : 0;
      const [sx, sy] = toScreen(p.x, p.y);
      markers.push({ actor, index, x: sx + Math.cos(a) * spread, y: sy + Math.sin(a) * spread * 0.7, p });
    }
    // Nearer figures overlap those behind them. The selected resident is drawn last of all.
    markers.sort((a, b) => Number(a.actor.id === selectedId) - Number(b.actor.id === selectedId) || a.y - b.y);
    const s = Math.max(11, Math.min(22, view.scale * 1.55));
    for (const { actor, index, x, y, p } of markers) {
      const chosen = actor.id === selectedId, inside = indoors(actor);
      if (chosen) {
        c.strokeStyle = '#9a4a2e'; c.fillStyle = 'rgba(246,231,180,.6)'; c.lineWidth = 1.6;
        c.beginPath(); c.ellipse(x, y + s * 0.02, s * 0.52, s * 0.2, 0, 0, TAU); c.fill(); c.stroke();
      }
      // Someone at home is out of sight. Their lit window stands in for them.
      if (!inside) {
        const activity = residentActivity(actor, p.moving);
        const heading = workHeading(p, activity, look.parish.common);
        drawMapFigure(c, { x, y, size: s, actor, activity, index, moving: p.moving, gone: p.gone, now: time,
          facing: Math.cos(heading) >= 0 ? 1 : -1, still: reduced.matches });
        if (actor.action?.kind === 'waiting') {
          const bx = x + s * 0.42, by = y - s * 1.06;
          disc(c, bx, by, Math.max(5.2, s * 0.3), '#fffdf2', '#5d5341', 0.9);
          c.font = '700 ' + Math.max(8, s * 0.42) + 'px Georgia, serif'; c.fillStyle = '#5d5341'; c.textAlign = 'center'; c.fillText('?', bx, by + 0.5);
        }
        hits.push({ id: actor.id, name: actor.name, x, y: y - s * 0.45 });
      }
      if (chosen) { c.textAlign = 'center'; label(actor.name.split(' ')[0] + (inside ? ' · indoors' : ''), x, y - (inside ? 14 : s + 9), 14, false); }
    }
    falling(still);
    placeCard(markers, s);
    if (hover) {
      c.textAlign = 'left';
      const width = c.measureText(hover.text).width;
      label(hover.text, Math.min(w - width - 8, hover.x + 12), Math.max(12, hover.y - 12), 14, false);
    }
    if (!reduced.matches || motion.busy) schedule();
  }
  // The card rides above whoever it describes, and turns below them when there is no room overhead.
  function placeCard(markers, s) {
    if (!card) return;
    // The pointer comes first: a resident, then a note. Otherwise whatever was last held open.
    const id = pointed ?? (pointedMark ? null : pinned), m = id && markers.find(k => k.actor.id === id);
    const note = m ? null : pointedMark ?? pinnedMark;
    if (!m && !note) { card.hidden = true; shown = null; return; }
    const key = m ? 'r:' + id : 'n:' + note.key, kept = m ? id === pinned : note.key === pinnedMark?.key;
    if (shown !== key || cardStale || card.classList.contains('pinned') !== kept) {
      const roof = m && indoors(m.actor) ? m.actor.action.target : null;
      cardBody.replaceChildren(m ? cards.resident(m.actor, roof ? actors.filter(a => a !== m.actor && indoors(a) && a.action.target === roof) : [])
        : cards.event?.(note.events, note) ?? '');
      card.classList.toggle('pinned', kept);
      shown = key; cardStale = false; card.hidden = false;
      cardSize = [card.offsetWidth, card.offsetHeight];
    }
    const [ax, ay] = m ? [m.x, m.y] : toScreen(note.x, note.y), rise = m ? s : 30;
    const [cw, ch] = cardSize, gap = 14;
    let top = ay - rise - gap - ch;
    const below = top < 8;
    if (below) top = Math.min(h - ch - 8, ay + gap);
    const left = Math.max(8, Math.min(w - cw - 8, ax - cw / 2));
    card.classList.toggle('below', below);
    card.style.transform = 'translate(' + Math.round(left + canvas.offsetLeft) + 'px,' + Math.round(top + canvas.offsetTop) + 'px)';
    card.style.setProperty('--notch', Math.max(18, Math.min(cw - 18, ax - left)) + 'px');
  }
  // A note is pinned beside the spot where something lately happened, or where the reader asked to look.
  function notes(time) {
    const all = pinnedMark && !marks.some(m => m.key === pinnedMark.key) ? [...marks, pinnedMark] : marks;
    noteHits = [];
    for (const m of all) {
      const [x, y] = toScreen(m.x, m.y), held = pinnedMark?.key === m.key, nx = x - 15, ny = y - 20;
      if (x < -24 || y < -24 || x > w + 24 || y > h + 24) continue;
      const faded = held ? 1 : Math.max(0.5, 1 - m.age / 120);
      c.globalAlpha = faded; c.strokeStyle = '#7a3b25'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, y); c.lineTo(nx + 3, ny + 6); c.stroke();
      disc(c, x, y, 2.2, '#9a4a2e');
      // News less than a quarter of an hour old, and the note being read, send out a ripple.
      if (held || m.age < 15) {
        const beat = time ? (time / 1700) % 1 : 0.5;
        c.globalAlpha = faded * (1 - beat); c.beginPath(); c.arc(x, y, 3 + beat * 12, 0, TAU); c.stroke(); c.globalAlpha = faded;
      }
      c.fillStyle = '#fbf6e6'; c.strokeStyle = held ? '#9a4a2e' : '#7a6c4a'; c.lineWidth = held ? 1.7 : 1;
      c.beginPath(); c.rect(nx - 6.5, ny - 7.5, 13, 15); c.fill(); c.stroke();
      c.strokeStyle = '#9a4a2e'; c.lineWidth = 1; c.beginPath();
      for (const dy of [-3.5, 0, 3.5]) { c.moveTo(nx - 3.5, ny + dy); c.lineTo(nx + (dy > 3 ? 1 : 3.5), ny + dy); }
      c.stroke(); c.globalAlpha = 1;
      noteHits.push({ mark: m, x: nx, y: ny });
    }
  }
  const noteAt = (sx, sy) => noteHits.find(n => Math.abs(sx - n.x) < 10 && Math.abs(sy - n.y) < 11)?.mark ?? null;
  // Turns the sheet to a spot from the chronicle and holds its note open.
  function focus(event) {
    if (!event?.place) return;
    if (!w || !map) { awaiting = event; return; }
    const { x, y, id } = event.place;
    pinned = pointed = pointedMark = null; watching = null;
    pinnedMark = { key: Math.round(x) + ',' + Math.round(y), x, y, id, age: clock - event.minute, events: [event] };
    view.x = x; view.y = y; view.scale = Math.min(34, Math.max(view.scale, (whole || view.scale) * 2.2));
    moved = true; cardStale = true; clampView(); redraw();
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(paint); }
  function redraw() { stale = true; schedule(); }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const first = !w;
    w = rect.width; h = rect.height;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = paper.width = Math.max(1, Math.round(w * dpr));
    canvas.height = paper.height = Math.max(1, Math.round(h * dpr));
    if (first || !moved) fit(); else clampView();
    if (awaiting && map) { const event = awaiting; awaiting = null; focus(event); }
    redraw();
  }
  function local(e) { const rect = canvas.getBoundingClientRect(); return [e.clientX - rect.left, e.clientY - rect.top]; }
  function nearest(sx, sy, reach) {
    let best = null, min = reach;
    for (const hit of hits) {
      const d = Math.hypot(sx - hit.x, sy - hit.y);
      if (d <= min) { best = hit; min = d; }
    }
    return best;
  }
  function zoom(factor, sx = w / 2, sy = h / 2) {
    steered();
    const [wx, wy] = toWorld(sx, sy);
    view.scale = Math.min(34, Math.max(least(), view.scale * factor));
    view.x = wx - (sx - w / 2) / view.scale; view.y = wy - (sy - h / 2) / view.scale;
    moved = true; clampView(); redraw();
  }
  function down(e) {
    engaged = true;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    drag = { x: view.x, y: view.y, from: local(e), far: false, pinch: pointers.size === 2 ? pinchSpan() : 0, scale: view.scale };
  }
  const pinchSpan = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
  function move(e) {
    const [sx, sy] = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [sx, sy]);
    if (drag && pointers.size === 2 && drag.pinch) {
      steered();
      view.scale = drag.scale * pinchSpan() / drag.pinch;
      drag.far = moved = true; clampView(); redraw(); return;
    }
    if (drag && pointers.size === 1) {
      const dx = sx - drag.from[0], dy = sy - drag.from[1];
      if (!drag.far && Math.hypot(dx, dy) < 5) return;
      if (!drag.far) { steered(); drag.x = view.x; drag.y = view.y; drag.from = [sx, sy]; drag.far = moved = true; return; }
      view.x = drag.x - dx / view.scale; view.y = drag.y - dy / view.scale;
      clampView(); canvas.style.cursor = 'grabbing'; redraw(); return;
    }
    const hit = nearest(sx, sy, 15), note = hit || !card ? null : noteAt(sx, sy), p = hit || note ? null : placeAt(sx, sy);
    const who = card ? hit?.id ?? lodger(p, false) : null;
    let text = who ? null : hit?.name;
    if (!text && !who && p) text = (locations[p.id]?.name || p.name || '') + (p.stage < 2 ? ' (being built)' : '');
    canvas.style.cursor = hit || who || note ? 'pointer' : 'grab';
    const next = text ? { text, x: sx, y: sy } : null;
    if (who !== pointed || note?.key !== pointedMark?.key) { pointed = who; pointedMark = note; schedule(); }
    if (next?.text !== hover?.text || next) { hover = next; schedule(); }
  }
  function placeAt(sx, sy) {
    if (!map) return null;
    const [wx, wy] = toWorld(sx, sy);
    return map.places.find(q => q.w ? Math.abs((wx - q.x) * Math.cos(q.a) + (wy - q.y) * Math.sin(q.a)) < q.w / 2 && Math.abs(-(wx - q.x) * Math.sin(q.a) + (wy - q.y) * Math.cos(q.a)) < q.d / 2 : q.kind === 'well' && Math.hypot(wx - q.x, wy - q.y) < 0.8) || null;
  }
  // Someone indoors is out of sight, so their house answers for them. A second click on the same
  // house moves on to the next person under its roof.
  function lodger(p, onward) {
    const inside = p ? actors.filter(a => indoors(a) && a.action.target === p.id) : [];
    if (!inside.length) return null;
    const i = inside.findIndex(a => a.id === pinned);
    return inside[i < 0 ? 0 : onward ? (i + 1) % inside.length : i].id;
  }
  function up(e) {
    const tapped = drag && !drag.far && pointers.size === 1;
    pointers.delete(e.pointerId);
    if (tapped) {
      const [sx, sy] = local(e), hit = nearest(sx, sy, e.pointerType === 'touch' ? 22 : 15);
      const note = hit || !card ? null : noteAt(sx, sy);
      const id = hit?.id ?? (card && !note ? lodger(placeAt(sx, sy), true) : null);
      // A click keeps the card open on that resident or note. A click on open ground puts it away.
      if (card) { pinned = id; pinnedMark = note; pointed = e.pointerType === 'mouse' ? id : null; pointedMark = null; cardStale = true; schedule(); }
      if (id) onSelect?.(id);
    }
    if (!pointers.size) drag = null;
    canvas.style.cursor = 'grab';
  }
  // The wheel belongs to the page until the map has been pressed, so scrolling past it is never trapped.
  function wheel(e) {
    if (!engaged && !e.ctrlKey) return;
    e.preventDefault();
    const [sx, sy] = local(e);
    zoom(Math.exp(-e.deltaY * 0.0016), sx, sy);
  }
  function leave() { engaged = false; if (hover || pointed || pointedMark) { hover = pointed = pointedMark = null; schedule(); } }
  function key(e) { if (e.key === 'Escape' && (pinned || pinnedMark)) { pinned = pinnedMark = null; schedule(); } }
  function home() { steered(); moved = false; fit(); redraw(); }

  canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.display = 'block'; canvas.style.touchAction = 'none'; canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('dblclick', home);
  if (card) document.addEventListener('keydown', key);
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  // Labels are set in a face that may still be loading when the map is first drawn.
  document.fonts?.ready.then(redraw);
  return {
    setMap(next, names = {}) {
      const grew = !map || next.places.length !== map.places.length;
      if (!look || next.seed !== map?.seed) look = prepare(next);
      map = next; locations = names;
      look.chains = chains(map);
      look.parish = parishLayout(map);
      cattle = strayCattle(map, world);
      // Trees are drawn north to south, so each crown overlaps the ones behind it.
      look.woods = [...map.trees].sort((a, b) => a[1] - b[1]);
      seasonal();
      if (grew && !moved) fit();
      redraw();
    },
    // extras.coldHearths lists the houses with no fire today, which show no smoke and no lit window.
    update(rows, id, names, motionMs, minute, extras) {
      if (Number.isFinite(minute)) clock = minute;
      cold = extras?.coldHearths || [];
      world = extras?.world;
      cattle = map ? strayCattle(map, world) : [];
      seasonal();
      actors = (rows || []).filter(a => Number.isFinite(a.position?.x));
      if (names) locations = names;
      const lodgers = actors.some(a => a.home === 'hall');
      if (look && look.lodgers !== lodgers) { look.lodgers = lodgers; stale = true; }
      motion.update(actors, performance.now(), motionMs, extras?.liveTick);
      // extras.events are the latest chronicle entries that have a place, newest first. Those that
      // happened on the same spot share one note.
      marks = [];
      for (const e of extras?.events || []) {
        if (!e.place) continue;
        const key = Math.round(e.place.x) + ',' + Math.round(e.place.y);
        let m = marks.find(k => k.key === key);
        if (!m) marks.push(m = { key, x: e.place.x, y: e.place.y, id: e.place.id, age: clock - e.minute, events: [] });
        if (m.events.length < 3) m.events.push(e);
      }
      // The card follows the map's own clicks. Choosing someone elsewhere on the page puts it away.
      if (pinned && pinned !== id) pinned = null;
      cardStale = true;
      selectedId = id; schedule();
    },
    zoom, home, redraw, focus,
    soundScene(now) {
      if (!map || !wx || !w || !h) return null;
      const radius = Math.max(8, Math.min(47, Math.min(w, h) / view.scale * 0.47));
      return { map, weather: wx, actors, cattle, sheep: look.parish.sheep,
        listener: { x: view.x, y: view.y, rightX: 1, rightY: 0, radius }, moving: id => motion.at(id, now)?.moving };
    },
    // Keeps a resident ({ id }), a spot ({ x, y }) or the whole village ({ whole: true }) in view until
    // told otherwise with watch(null), or until the reader moves the sheet, which calls cards.steered.
    // A card held open from before is put away when a watch begins: the caption speaks for the scene.
    watch(target) { watching = target ? { ...target } : null; if (target) pinned = pinnedMark = null; schedule(); },
    destroy() {
      observer.disconnect(); cancelAnimationFrame(frame);
      card?.remove(); document.removeEventListener('keydown', key);
      for (const [type, fn] of [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up], ['pointerleave', leave], ['wheel', wheel], ['dblclick', home]]) canvas.removeEventListener(type, fn);
    },
  };
}

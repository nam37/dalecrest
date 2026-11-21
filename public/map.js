// The plan view. Everything here is drawn from the village's stored map, so a new lane,
// field or cottage appears as soon as the residents have made it.
import { heightAt } from '/engine/terrain.mjs';
import { rectPoly, rng, hash2, TAU } from '/engine/geom.mjs';
import { createMotion } from '/motion.js';

const ink = '#524d3b', ground = '#e8e0bf';
export const villageColors = ['#976048', '#65785a', '#b27a4b', '#537470', '#797291', '#856144', '#527997', '#957050'];
const roofs = ['#a57456', '#a88c5d', '#aa7352', '#90907a', '#9c8259', '#b19769', '#a17c58', '#a96e50'];
const fieldTones = ['#c4b77e', '#cbbd87', '#c4b07c', '#b9b18a', '#c7bc8c', '#c9b67c'];
const leaf = ['#878e66', '#90946c', '#a0a17a', '#778460'], needle = ['#6f7d5c', '#667556', '#7a8663'];
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

function building(c, p, line, lodgers) {
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
  const roof = p.kind === 'hall' ? '#8e7459' : p.kind === 'mill' ? '#9b7858' : p.kind === 'granary' ? '#a8935f' : p.kind === 'alehouse' ? '#9a6a4c' : roofs[h % roofs.length];
  c.fillStyle = roof; c.fillRect(-hw, -hd, w, d);
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
  c.restore();
}

function paintPaper(c, map, look, scale) {
  const line = Math.max(0.085, 1.05 / scale);
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.fillStyle = ground; c.fillRect(-40, -40, map.w + 80, map.h + 80);
  for (const [x, y, r, warm] of look.washes) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, warm ? '#f7ebc74d' : '#a9ae7350'); g.addColorStop(1, '#e8e0bf00');
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Hachures run downhill and thicken with the slope.
  c.lineWidth = line * 0.8;
  for (const [x, y, dx, dy, alpha] of look.hachures) {
    c.strokeStyle = 'rgba(110,100,70,' + alpha + ')';
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + dx, y + dy); c.stroke();
  }
  if (scale > 5) {
    c.strokeStyle = '#93956866'; c.lineWidth = line * 0.8; c.fillStyle = '#837b5240';
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
    c.fillStyle = '#c9cf9a'; c.fill(); c.strokeStyle = '#9aa2767a'; c.lineWidth = line; c.stroke();
    c.restore();
  }
  // River: bank, shallows, water and a few ripples.
  const river = map.terrain.river, rw = map.terrain.riverWidth;
  for (const [width, color] of [[rw + 1.0, '#929c82'], [rw + 0.6, '#d0d7b3'], [rw, '#a7c4b8']]) { curve(c, river); c.strokeStyle = color; c.lineWidth = width; c.stroke(); }
  c.strokeStyle = '#d6e3d6'; c.lineWidth = line;
  for (let i = 1; i < river.length - 1; i++) {
    const [x, y] = river[i], k = (hash2(map.seed, i, 3) - 0.5) * rw * 0.5;
    c.beginPath(); c.moveTo(x + k, y - 0.7); c.quadraticCurveTo(x + k + 0.35, y, x + k, y + 0.8); c.stroke();
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
    trace(c, poly, true); c.fillStyle = f.stage === 1 ? '#c9b98f' : fieldTones[tag(f.id) % fieldTones.length]; c.fill();
    c.strokeStyle = '#998b6c'; c.lineWidth = line * 1.2; c.stroke(); c.clip();
    c.translate(f.x, f.y); c.rotate(f.a);
    const until = f.stage === 1 ? 0 : f.d / 2;
    for (let y = -f.d / 2 + 0.3; y < until; y += 0.5) {
      c.beginPath(); c.moveTo(-f.w / 2, y); c.lineTo(f.w / 2, y); c.strokeStyle = '#92865c80'; c.lineWidth = line * 0.8; c.stroke();
      c.beginPath(); c.moveTo(-f.w / 2, y + 0.14); c.lineTo(f.w / 2, y + 0.14); c.strokeStyle = '#e2d59d99'; c.lineWidth = line; c.stroke();
    }
    c.restore();
  });
  // Ways, narrowest first so the road lies over the lanes that join it.
  for (const kind of ['track', 'path', 'lane', 'road']) {
    const [width, fill] = WAYS[kind];
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
    c.fillStyle = '#b79a72'; c.fillRect(-0.05, -0.62, len + 0.1, 1.24);
    c.strokeStyle = '#7d6a4f'; c.lineWidth = line * 0.8; c.beginPath();
    for (let x = 0.2; x < len; x += 0.42) { c.moveTo(x, -0.6); c.lineTo(x, 0.6); }
    c.stroke();
    c.strokeStyle = '#675e48'; c.lineWidth = line * 2; c.beginPath(); c.moveTo(-0.05, -0.62); c.lineTo(len + 0.05, -0.62); c.moveTo(-0.05, 0.62); c.lineTo(len + 0.05, 0.62); c.stroke();
    c.restore();
  }
  // Shadows first, then buildings, then the trees that overhang them.
  c.fillStyle = '#5a53392e';
  for (const p of places) if (p.w && p.kind !== 'field' && p.stage === 2) { trace(c, rectPoly({ ...p, x: p.x + 0.3, y: p.y + 0.36 }), true); c.fill(); }
  for (const p of places) {
    if (p.kind === 'well') {
      if (p.stage < 2) { c.setLineDash([0.25, 0.22]); disc(c, p.x, p.y, 0.6, p.stage ? '#cbbf9c' : null, '#7b6d50', line); c.setLineDash([]); continue; }
      disc(c, p.x + 0.14, p.y + 0.17, 0.62, '#5a53392e'); disc(c, p.x, p.y, 0.58, '#beb294', ink, line * 1.2); disc(c, p.x, p.y, 0.32, '#6f7f7a', ink, line * 0.8);
      c.strokeStyle = '#6d6049'; c.lineWidth = line * 2; c.beginPath(); c.moveTo(p.x - 0.62, p.y); c.lineTo(p.x + 0.62, p.y); c.stroke();
    } else if (p.kind === 'oven' && p.stage === 2) {
      building(c, { ...p, w: p.w * 0.6, x: p.x - Math.cos(p.a) * p.w * 0.2, y: p.y - Math.sin(p.a) * p.w * 0.2 }, line);
      const ox = p.x + Math.cos(p.a) * p.w * 0.27, oy = p.y + Math.sin(p.a) * p.w * 0.27;
      disc(c, ox + 0.12, oy + 0.15, 0.62, '#5a53392e'); disc(c, ox, oy, 0.6, '#c2946e', ink, line * 1.2); disc(c, ox - 0.15, oy - 0.15, 0.2, '#d8b08a'); disc(c, ox, oy, 0.14, '#5f5142');
    } else if (p.w && p.kind !== 'field') building(c, p, line, look.lodgers);
  }
  for (const [x, y, r, pine] of map.trees) {
    const k = hash2(map.seed, x * 10, y * 10);
    disc(c, x + r * 0.28, y + r * 0.34, r * 0.92, '#5a533926');
    if (pine) {
      c.beginPath();
      for (let i = 0; i < 12; i++) { const a = i * TAU / 12 + k, rr = i % 2 ? r * 0.56 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      c.closePath(); c.fillStyle = needle[Math.floor(k * 3)]; c.fill(); c.strokeStyle = '#566247'; c.lineWidth = line * 0.9; c.stroke();
      disc(c, x, y, r * 0.16, '#55603f');
    } else {
      c.beginPath();
      for (let i = 0; i <= 7; i++) { const a = i * TAU / 7 + k * 6, rr = r * (0.86 + 0.16 * Math.sin(i * 2.3 + k * 9)); c.quadraticCurveTo(x + Math.cos(a - 0.45) * rr * 1.13, y + Math.sin(a - 0.45) * rr * 1.13, x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      c.closePath(); c.fillStyle = leaf[Math.floor(k * 4)]; c.fill(); c.strokeStyle = '#687051'; c.lineWidth = line * 0.9; c.stroke();
      c.beginPath(); c.arc(x - r * 0.15, y - r * 0.15, r * 0.45, 3.5, 5.2); c.strokeStyle = '#b4b78e99'; c.stroke();
    }
  }
}

// Decoration that depends only on the terrain is worked out once per map.
function prepare(map) {
  const rand = rng(map.seed + 3), look = { washes: [], hachures: [], specks: [] };
  for (let i = 0; i < 150; i++) look.washes.push([rand() * map.w, rand() * map.h, 5 + rand() * 13, i % 3 !== 0]);
  for (let y = 1; y < map.h; y += 2.4) {
    for (let x = 1; x < map.w; x += 2.4) {
      const px = x + (rand() - 0.5) * 1.6, py = y + (rand() - 0.5) * 1.6;
      const gx = heightAt(map, px + 0.8, py) - heightAt(map, px - 0.8, py), gy = heightAt(map, px, py + 0.8) - heightAt(map, px, py - 0.8);
      const steep = Math.hypot(gx, gy) / 1.6;
      if (steep < 0.028 || heightAt(map, px, py) < 0.05) continue;
      const len = Math.min(1.5, 0.35 + steep * 9);
      look.hachures.push([px, py, -gx / (steep * 1.6) * len, -gy / (steep * 1.6) * len, Math.min(0.42, steep * 4.5).toFixed(2)]);
    }
  }
  for (let i = 0; i < 5200; i++) look.specks.push([rand() * map.w, rand() * map.h, i % 6 === 0]);
  return look;
}

export function createMap(canvas, onSelect) {
  const c = canvas.getContext('2d');
  const paper = document.createElement('canvas');
  const motion = createMotion();
  let map = null, look = null, locations = {}, actors = [], selectedId = null, frame = 0, stale = true, moved = false;
  let w = 0, h = 0, dpr = 1, hits = [], hover = null;
  const view = { x: 80, y: 60, scale: 6 };
  const pointers = new Map();
  let drag = null, engaged = false;

  const least = () => Math.max(w / (map?.w || 160), h / (map?.h || 120));
  function clampView() {
    view.scale = Math.min(34, Math.max(least(), view.scale));
    if (!map) return;
    const hx = w / 2 / view.scale, hy = h / 2 / view.scale;
    view.x = Math.min(map.w - hx, Math.max(hx, view.x));
    view.y = Math.min(map.h - hy, Math.max(hy, view.y));
  }
  // Frames everything people have built, with a margin of open country.
  function fit() {
    if (!map || !w) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of map.places) {
      const r = p.kind === 'wood' ? p.r * 0.7 : p.w ? Math.max(p.w, p.d) / 2 : 2;
      x0 = Math.min(x0, p.x - r); y0 = Math.min(y0, p.y - r); x1 = Math.max(x1, p.x + r); y1 = Math.max(y1, p.y + r);
    }
    view.x = (x0 + x1) / 2; view.y = (y0 + y1) / 2;
    view.scale = Math.min(w / (x1 - x0 + 14), h / (y1 - y0 + 12));
    clampView();
  }
  const toScreen = (x, y) => [(x - view.x) * view.scale + w / 2, (y - view.y) * view.scale + h / 2];
  const toWorld = (sx, sy) => [(sx - w / 2) / view.scale + view.x, (sy - h / 2) / view.scale + view.y];

  function label(text, x, y, size, italic = true, angle = 0) {
    c.save(); c.translate(x, y); c.rotate(angle);
    c.font = (italic ? 'italic ' : '') + size + 'px Georgia, serif';
    c.lineWidth = 3.4; c.strokeStyle = '#e8e0bfe6'; c.lineJoin = 'round'; c.strokeText(text, 0, 0);
    c.fillStyle = '#474636'; c.fillText(text, 0, 0);
    c.restore();
  }

  function paint(time) {
    frame = 0;
    if (!map || !w) return;
    if (stale) {
      stale = false;
      const p = paper.getContext('2d');
      p.setTransform(1, 0, 0, 1, 0, 0);
      p.fillStyle = ground; p.fillRect(0, 0, paper.width, paper.height);
      const k = dpr * view.scale;
      p.setTransform(k, 0, 0, k, dpr * (w / 2 - view.x * view.scale), dpr * (h / 2 - view.y * view.scale));
      paintPaper(p, map, look, view.scale);
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.drawImage(paper, 0, 0, w, h);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (view.scale > 6.5) {
      for (const way of look.chains) {
        if (!way.name || way.pts.length < 5) continue;
        const i = way.pts.length >> 1, a = way.pts[i - 1], b = way.pts[i + 1];
        let angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
        const [x, y] = toScreen(way.pts[i][0], way.pts[i][1]);
        c.globalAlpha = 0.72; label(way.name, x, y - 9, 10.5, true, angle); c.globalAlpha = 1;
      }
    }
    for (const p of map.places) {
      if (p.kind === 'cottage' || !p.name || (p.kind === 'well' && view.scale < 11)) continue;
      const [x, y] = toScreen(p.x, p.y);
      const drop = p.kind === 'field' ? 0 : p.kind === 'well' ? -1.3 * view.scale - 4 : p.kind === 'green' ? p.ry * 0.55 * view.scale : ((p.d || 2.4) / 2 + 0.9) * view.scale + 4;
      label(p.stage < 2 && p.kind !== 'field' ? p.name + ' (building)' : p.name, x, y + drop, Math.max(11, Math.min(17, view.scale * 1.7)));
    }
    hits = [];
    const crowd = new Map(), markers = [];
    for (const [index, actor] of actors.entries()) {
      const p = motion.at(actor.id, time);
      if (!p) continue;
      const key = Math.round(p.x * 2) + ',' + Math.round(p.y * 2);
      const count = crowd.get(key) || 0;
      crowd.set(key, count + 1);
      const a = count * 2.4, spread = count ? 10 * Math.sqrt(count) : 0;
      const [sx, sy] = toScreen(p.x, p.y);
      markers.push({ actor, index, x: sx + Math.cos(a) * spread, y: sy + Math.sin(a) * spread });
    }
    markers.sort((a, b) => Number(a.actor.id === selectedId) - Number(b.actor.id === selectedId));
    for (const { actor, index, x, y } of markers) {
      const r = Math.max(4.2, Math.min(7.5, view.scale * 0.72));
      if (actor.id === selectedId) disc(c, x, y, r + 4, '#f3e4b1bb', '#594e38', 1.35);
      disc(c, x, y + 1, r + 1, '#483d3445');
      disc(c, x, y, r, actor.color || villageColors[index % villageColors.length], '#fff5d9', 1.8);
      disc(c, x, y, r + 1, null, '#5d5341', 0.85);
      hits.push({ id: actor.id, name: actor.name, x, y });
    }
    if (hover) {
      c.textAlign = 'left';
      const width = c.measureText(hover.text).width;
      label(hover.text, Math.min(w - width - 8, hover.x + 12), Math.max(12, hover.y - 12), 13, false);
    }
    if (motion.busy) schedule();
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
      view.scale = drag.scale * pinchSpan() / drag.pinch;
      drag.far = moved = true; clampView(); redraw(); return;
    }
    if (drag && pointers.size === 1) {
      const dx = sx - drag.from[0], dy = sy - drag.from[1];
      if (!drag.far && Math.hypot(dx, dy) < 5) return;
      drag.far = moved = true;
      view.x = drag.x - dx / view.scale; view.y = drag.y - dy / view.scale;
      clampView(); canvas.style.cursor = 'grabbing'; redraw(); return;
    }
    const hit = nearest(sx, sy, 15);
    let text = hit?.name;
    if (!text && map) {
      const [wx, wy] = toWorld(sx, sy);
      const p = map.places.find(q => q.w ? Math.abs((wx - q.x) * Math.cos(q.a) + (wy - q.y) * Math.sin(q.a)) < q.w / 2 && Math.abs(-(wx - q.x) * Math.sin(q.a) + (wy - q.y) * Math.cos(q.a)) < q.d / 2 : q.kind === 'well' && Math.hypot(wx - q.x, wy - q.y) < 0.8);
      if (p) text = (locations[p.id]?.name || p.name || '') + (p.stage < 2 ? ' (being built)' : '');
    }
    canvas.style.cursor = hit ? 'pointer' : 'grab';
    const next = text ? { text, x: sx, y: sy } : null;
    if (next?.text !== hover?.text || next) { hover = next; schedule(); }
  }
  function up(e) {
    const tapped = drag && !drag.far && pointers.size === 1;
    pointers.delete(e.pointerId);
    if (tapped) {
      const [sx, sy] = local(e), hit = nearest(sx, sy, e.pointerType === 'touch' ? 22 : 15);
      if (hit) onSelect?.(hit.id);
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
  function leave() { engaged = false; if (hover) { hover = null; schedule(); } }
  function home() { moved = false; fit(); redraw(); }

  canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.display = 'block'; canvas.style.touchAction = 'none'; canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('dblclick', home);
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  return {
    setMap(next, names = {}) {
      const grew = !map || next.places.length !== map.places.length;
      if (!look || next.seed !== map?.seed) look = prepare(next);
      map = next; locations = names;
      look.chains = chains(map);
      if (grew && !moved) fit();
      redraw();
    },
    update(rows, id, names) {
      actors = (rows || []).filter(a => Number.isFinite(a.position?.x));
      if (names) locations = names;
      const lodgers = actors.some(a => a.home === 'hall');
      if (look && look.lodgers !== lodgers) { look.lodgers = lodgers; stale = true; }
      motion.update(actors);
      selectedId = id; schedule();
    },
    zoom, home, redraw,
    destroy() {
      observer.disconnect(); cancelAnimationFrame(frame);
      for (const [type, fn] of [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up], ['pointerleave', leave], ['wheel', wheel], ['dblclick', home]]) canvas.removeEventListener(type, fn);
    },
  };
}

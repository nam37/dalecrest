// The walking view: the same stored map, raised into low-poly ground, buildings and trees,
// seen from just behind whichever resident is selected.
import * as THREE from '/vendor/three.module.min.js';
import { heightAt, isWater, TREE_LINE, WATER_LEVEL } from '/engine/terrain.mjs';
import { bridgeDecks } from '/engine/roads.mjs';
import { hash2, rng, fbm, rectPoly, TAU } from '/engine/geom.mjs';
import { createMotion } from '/motion.js';
import { chains } from '/map.js';
import { makeFigure, poseFigure } from '/figure.js';
import { light, hearths, indoors, yearLook, skyOver, blend } from '/ambient.js';
import { windAt } from '/engine/seasons.mjs';
import { cloudField, cloudsOver, cloudOverhead, cloudShade, cloudDrift } from './clouds.js';
import { puddleFill, puddles, rainRings, wetness } from './wet.js';
import { kinds } from '/card.js';
import { createPets } from './pets.js';
import { cartsOf } from './carts.js';
import { liveMinute, visitorsOf } from './travellers.js';
import { ricksOf } from './touches.js';
import { animalCoats, animalPose, appleSpots, createAnglers, createPlay, fenceSpans, logsIn, orchardFruit, ovenLoaves, parishLayout, raisedOf, strayCattle, visibleSheep, workHeading } from './parish.js';
import { isFarmSite } from '../engine/smallholding.mjs';
import { residentActivity, residentScale } from './resident-pose.js';
import { sameGround } from './village-update.js';

const roofs = ['#a57456', '#a88c5d', '#aa7352', '#90907a', '#9c8259', '#b19769', '#a17c58', '#a96e50'];
const fieldTones = ['#c4b77e', '#cbbd87', '#c4b07c', '#b9b18a', '#c7bc8c', '#c9b67c'];
const WIDTH = { road: 0.98, bridge: 0.98, lane: 0.66, path: 0.34, track: 0.22 };
const tag = id => { let h = 0; for (const ch of id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0; return h; };
const mix = (a, b, t) => a + (b - a) * t;

const materials = new Map();
// How a strip laid on the ground is drawn, so that it shows above the land it lies on.
const ON_GROUND = { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
function mat(color, extra) {
  const key = color + (extra ? JSON.stringify(extra) : '');
  if (!materials.has(key)) materials.set(key, new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra }));
  return materials.get(key);
}
function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  return m;
}

const animalShape = new THREE.SphereGeometry(1, 8, 6);

function makeAnimal(kind, coat) {
  const cow = kind === 'cattle', animal = new THREE.Group(), head = new THREE.Group();
  const wool = animalCoats[kind][coat], face = cow ? '#745038' : '#655746';
  function oval(parent, color, [x, y, z], [w, h, d]) {
    const m = new THREE.Mesh(animalShape, mat(color));
    m.position.set(x, y, z); m.scale.set(w, h, d); m.castShadow = true;
    parent.add(m);
  }
  oval(animal, wool, [0, 0.209, 0], [0.179, 0.094, 0.096]);
  if (cow) oval(animal, blend(wool, '#674630', 0.64), [-0.078, 0.225, 0], [0.087, 0.084, 0.095]);
  else oval(animal, blend(wool, '#fff6d9', 0.4), [-0.035, 0.251, 0], [0.144, 0.062, 0.086]);
  oval(animal, face, [-0.169, 0.213, 0], [0.046, 0.023, 0.027]);
  head.position.set(0.133, 0.233, 0);
  oval(head, face, [0.053, 0.022, 0], [0.062, 0.052, 0.048]);
  oval(head, cow ? '#a08270' : face, [0.094, 0.005, 0], [0.035, 0.028, 0.043]);
  for (const side of [-1, 1]) {
    oval(head, face, [0.029, 0.048, side * 0.048], [0.022, 0.013, 0.026]);
    if (cow) oval(head, '#ead4a2', [0.037, 0.063, side * 0.045], [0.014, 0.023, 0.012]);
  }
  animal.add(head);
  const legs = [];
  for (const x of [-0.105, 0.103]) {
    for (const z of [-0.06, 0.06]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.15, z);
      leg.add(box(0.031, 0.145, 0.033, face, 0, -0.072, 0));
      animal.add(leg); legs.push(leg);
    }
  }
  if (cow) animal.scale.set(1.8, 1.62, 1.48);
  return { animal, head, legs };
}
// A pony from beyond the parish: a longer neck and legs than the cattle, a tail, and panniers with a
// pack roped across its back while it carries a load. Faces +x.
const PONY_COATS = ['#7b5a3e', '#9a8a74'];
function makePony(coat) {
  const animal = new THREE.Group(), head = new THREE.Group(), load = new THREE.Group(), hide = PONY_COATS[coat || 0], dark = blend(hide, '#2a1f15', 0.5);
  function oval(parent, color, [x, y, z], [w, h, d]) {
    const m = new THREE.Mesh(animalShape, mat(color));
    m.position.set(x, y, z); m.scale.set(w, h, d); m.castShadow = true;
    parent.add(m);
  }
  oval(animal, hide, [0, 0.36, 0], [0.27, 0.12, 0.11]);
  oval(animal, hide, [0.23, 0.45, 0], [0.1, 0.07, 0.06]);
  oval(animal, dark, [0.22, 0.5, 0], [0.09, 0.03, 0.025]);
  oval(animal, dark, [-0.28, 0.3, 0], [0.04, 0.12, 0.03]);
  head.position.set(0.31, 0.5, 0);
  oval(head, hide, [0.06, 0, 0], [0.1, 0.045, 0.045]);
  for (const side of [-1, 1]) oval(head, dark, [-0.01, 0.05, side * 0.025], [0.015, 0.03, 0.012]);
  animal.add(head);
  const legs = [];
  for (const x of [-0.17, 0.17]) {
    for (const z of [-0.06, 0.06]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.3, z);
      leg.add(box(0.04, 0.29, 0.04, dark, 0, -0.145, 0));
      animal.add(leg); legs.push(leg);
    }
  }
  for (const side of [-1, 1]) load.add(box(0.26, 0.17, 0.08, '#8a6a44', -0.02, 0.36, side * 0.15));
  load.add(box(0.24, 0.12, 0.2, '#c9b48a', -0.02, 0.5, 0));
  animal.add(load);
  return { animal, head, legs, load };
}
// The peddler's goods on a cloth on the green: salt fish laid out, linen taken in trade piled at one
// end, and the pack set down at the corner. Faces +x across the cloth.
function makePitch(fish, linen) {
  const g = new THREE.Group();
  const cloth = box(1.32, 0.012, 0.8, '#d8cba6', 0, 0.006, 0); cloth.receiveShadow = true; g.add(cloth);
  g.add(box(1.16, 0.013, 0.03, '#a2453a', 0, 0.007, -0.32), box(1.16, 0.013, 0.03, '#a2453a', 0, 0.007, 0.32));
  for (let i = 0; i < fish; i++) {
    const f = new THREE.Mesh(animalShape, mat('#b9b8a6'));
    f.scale.set(0.09, 0.022, 0.035); f.position.set(-0.48 + (i % 4) * 0.22, 0.03, i < 4 ? -0.16 : 0.08); f.rotation.y = (i % 2 ? 1 : -1) * 0.15; f.castShadow = true; g.add(f);
  }
  for (let i = 0; i < linen; i++) {
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.26, 10), mat('#efe6cc'));
    bolt.rotation.z = Math.PI / 2; bolt.position.set(0.46, 0.06 + (i >= 3 ? 0.1 : 0), -0.22 + (i % 3) * 0.13); bolt.castShadow = true; g.add(bolt);
  }
  const pack = new THREE.Mesh(animalShape, mat('#8a6a44'));
  pack.scale.set(0.2, 0.14, 0.15); pack.position.set(0.74, 0.12, 0.38); pack.castShadow = true; g.add(pack);
  return g;
}
// A dog or cat: long and low, with a head held up, ears, four legs and a tail. Faces +x.
function makePet(kind, coat) {
  const dog = kind === 'dog', animal = new THREE.Group(), body = new THREE.Group(), head = new THREE.Group(), tail = new THREE.Group();
  const dark = blend(coat, '#2a2219', 0.4);
  function oval(parent, color, [x, y, z], [w, h, d]) {
    const m = new THREE.Mesh(animalShape, mat(color));
    m.position.set(x, y, z); m.scale.set(w, h, d); m.castShadow = true;
    parent.add(m);
  }
  const s = dog ? 1 : 0.62;
  body.position.y = 0.1 * s; animal.add(body);
  oval(body, coat, [0, 0, 0], [0.11 * s, 0.045 * s, 0.045 * s]);
  head.position.set(0.1 * s, 0.035 * s, 0); body.add(head);
  oval(head, coat, [0.02 * s, 0.01 * s, 0], [0.04 * s, 0.034 * s, 0.032 * s]);
  if (dog) oval(head, dark, [0.055, -0.004, 0], [0.03, 0.017, 0.018]);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.012 * (dog ? 1.3 : 1.6), dog ? 0.03 : 0.035, 4), mat(dark));
    ear.position.set(0.012 * s, (dog ? 0.03 : 0.045) * s, side * 0.019 * s); if (dog) ear.rotation.x = side * 0.9; head.add(ear);
  }
  tail.position.set(-0.1 * s, 0.015 * s, 0); body.add(tail);
  const tip = box(0.008 * s + 0.004, (dog ? 0.07 : 0.09) * s, 0.008 * s + 0.004, coat, 0, (dog ? 0.035 : 0.045) * s, 0); tail.add(tip);
  tail.rotation.z = dog ? 0.7 : 0.25;
  const legs = [];
  for (const x of [-0.07 * s, 0.07 * s]) for (const z of [-0.025 * s, 0.025 * s]) {
    const leg = new THREE.Group(); leg.position.set(x, 0.1 * s, z);
    leg.add(box(0.016 * s + 0.003, 0.1 * s, 0.016 * s + 0.003, dark, 0, -0.05 * s, 0)); animal.add(leg); legs.push(leg);
  }
  return { animal, body, head, tail, legs, scale: s };
}
// A gable roof with its ridge along x, eaves at y = 0.
function gable(w, d, rise, over = 0.16) {
  const hw = w / 2 + over, hd = d / 2 + over;
  const v = [[-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd], [-hw, rise, 0], [hw, rise, 0]];
  const faces = [[0, 4, 5], [0, 5, 1], [3, 2, 5], [3, 5, 4], [0, 3, 4], [1, 5, 2], [0, 1, 2], [0, 2, 3]];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(faces.flatMap(f => f.flatMap(i => v[i])), 3));
  g.computeVertexNormals();
  return g;
}
// Every roof material with the colour it was made in, so lying snow can whiten the roofs and leave again.
const roofed = new Map();
function roof(w, d, rise, color, y) {
  const m = new THREE.Mesh(gable(w, d, rise), mat(color, { side: THREE.DoubleSide }));
  roofed.set(m.material, color);
  m.position.y = y; m.castShadow = m.receiveShadow = true;
  return m;
}
function textSprite(text, italic = true) {
  const canvas = document.createElement('canvas'), c = canvas.getContext('2d');
  const font = (italic ? 'italic ' : '600 ') + '44px Georgia, serif';
  c.font = font;
  canvas.width = Math.ceil(c.measureText(text).width) + 28; canvas.height = 64;
  c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 9; c.lineJoin = 'round'; c.strokeStyle = '#f3ecd2e6'; c.strokeText(text, canvas.width / 2, 33);
  c.fillStyle = '#3d3b2d'; c.fillText(text, canvas.width / 2, 33);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true, fog: false }));
  sprite.userData.aspect = canvas.width / canvas.height;
  return sprite;
}
// The note that stands over a spot where something lately happened: the newest entry, in a few lines.
function noteSprite(events) {
  const canvas = document.createElement('canvas'), c = canvas.getContext('2d');
  const W = 430, pad = 20, lead = 35, body = '28px Georgia, serif', lines = [];
  c.font = body;
  let line = '';
  for (const word of events[0].text.split(/\s+/)) {
    const next = line ? line + ' ' + word : word;
    if (c.measureText(next).width <= W - pad * 2 || !line) { line = next; continue; }
    lines.push(line); line = word;
  }
  lines.push(line);
  if (lines.length > 3) { lines.length = 3; lines[2] = lines[2].replace(/[\s,;:.]*\S*$/, '') + '…'; }
  const more = events.length - 1, tail = 18;
  canvas.width = W; canvas.height = pad + 30 + lines.length * lead + (more ? 32 : 0) + pad - 6 + tail;
  const H = canvas.height - tail;
  c.fillStyle = '#fbf6e6'; c.strokeStyle = '#8f7f58'; c.lineWidth = 3; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(2, 2); c.lineTo(W - 2, 2); c.lineTo(W - 2, H); c.lineTo(W / 2 + 15, H); c.lineTo(W / 2, H + tail - 2); c.lineTo(W / 2 - 15, H); c.lineTo(2, H); c.closePath();
  c.fill(); c.stroke();
  c.textBaseline = 'alphabetic';
  c.font = '600 21px Georgia, serif'; c.fillStyle = '#9a4a2e';
  c.fillText((kinds[events[0].type] || events[0].type).toUpperCase().split('').join('\u200a'), pad, pad + 20);
  c.font = body; c.fillStyle = '#3d3b2d';
  lines.forEach((text, i) => c.fillText(text, pad, pad + 30 + (i + 1) * lead - 8));
  if (more) { c.font = 'italic 23px Georgia, serif'; c.fillStyle = '#6f684f'; c.fillText('and ' + more + ' more here', pad, pad + 30 + lines.length * lead + 22); }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true, fog: false }));
  sprite.center.set(0.5, 0);
  sprite.userData.aspect = canvas.width / canvas.height;
  sprite.userData.size = canvas.height * 0.0042; sprite.userData.reach = 34;
  return sprite;
}
function dispose(group) {
  group.traverse(o => {
    if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); }
    else if (o.geometry !== contactGeo && o.geometry !== animalShape) o.geometry?.dispose();
    if (o.isInstancedMesh) o.dispose();
    if (o.isLine) o.material.dispose();
  });
  group.clear();
}

const contactGeo = new THREE.CircleGeometry(0.115, 14);
const contactMat = new THREE.MeshBasicMaterial({ color: '#2b2618', transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

// The windows of a finished building, which flank its door on the wall that faces the lane. Gives
// how far along the wall each one sits and how high, in the building's own frame. A granary has none.
function panesOf(p) {
  const w = p.w || 1.3, tall = p.kind === 'hall' ? 0.85 : p.kind === 'mill' || p.kind === 'barn' ? 0.95 : p.kind === 'granary' ? 0.7 : p.kind === 'alehouse' || p.kind === 'storehouse' ? 0.75 : 0.62;
  const lift = p.kind === 'granary' ? 0.22 : 0, bw = p.kind === 'oven' ? w * 0.58 : w, bx = p.kind === 'oven' ? -w * 0.21 : 0;
  const along = p.a === undefined ? 0 : Math.max(-w / 2 + 0.3, Math.min(w / 2 - 0.3, (p.at[0] - p.x) * Math.cos(p.a) + (p.at[1] - p.y) * Math.sin(p.a)));
  const xs = p.kind === 'granary' || p.kind === 'barn' ? [] : [-1, 1].map(s => bx + (p.kind === 'oven' ? 0 : along) + s * Math.min(0.8, bw * 0.3)).filter(x => Math.abs(x - bx) <= bw / 2 - 0.2);
  return { xs, y: lift + tall * 0.62 };
}

// The walls and thatch inside a standing frame, as far as the work has gone: the walls rise over the
// first part of it and the thatch is laid from one gable over the rest.
function buildRising(p, map, raised) {
  const g = new THREE.Group(), w = p.w, d = p.d;
  g.position.set(p.x, heightAt(map, p.x, p.y), p.y); g.rotation.y = -(p.a || 0);
  const tall = p.kind === 'hall' ? 0.85 : p.kind === 'mill' || p.kind === 'barn' ? 0.95 : p.kind === 'granary' ? 0.7 : p.kind === 'alehouse' || p.kind === 'storehouse' ? 0.75 : 0.62;
  const rise = p.kind === 'granary' ? 0.75 : p.kind === 'hall' ? 0.8 : 0.6;
  const walls = Math.min(1, raised / 0.6), thatch = Math.max(0, (raised - 0.6) / 0.4);
  if (walls > 0.02) {
    const high = tall * walls;
    for (const [bw, bd, x, z] of [[w - 0.08, 0.06, 0, -d / 2], [w - 0.08, 0.06, 0, d / 2], [0.06, d - 0.08, -w / 2, 0], [0.06, d - 0.08, w / 2, 0]]) g.add(box(bw, high, bd, '#d8c8a0', x, high / 2, z));
  }
  if (thatch > 0.02) {
    const r = roof(w * thatch, d, rise, '#b59a66', tall); r.position.x = -w / 2 + w * thatch / 2; g.add(r);
  }
  return g;
}

function buildPlace(p, map, glow) {
  const g = new THREE.Group(), h = tag(p.id);
  const base = heightAt(map, p.x, p.y);
  g.position.set(p.x, base, p.y);
  g.rotation.y = -(p.a || 0);
  const w = p.w || 1.3, d = p.d || 1.3;
  const side = p.a === undefined ? 1 : ((p.at[0] - p.x) * -Math.sin(p.a) + (p.at[1] - p.y) * Math.cos(p.a) > 0 ? 1 : -1);
  const along = p.a === undefined ? 0 : Math.max(-w / 2 + 0.3, Math.min(w / 2 - 0.3, (p.at[0] - p.x) * Math.cos(p.a) + (p.at[1] - p.y) * Math.sin(p.a)));
  const timber = '#5f4e39';
  if (p.kind === 'well') {
    if (p.stage < 2) { g.add(box(0.9, 0.06, 0.9, '#8a7a5c', 0, 0.03, 0)); if (p.stage) g.add(box(0.07, 0.6, 0.07, timber, -0.5, 0.3, 0), box(0.07, 0.6, 0.07, timber, 0.5, 0.3, 0)); return g; }
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.54, 0.26, 12, 1, true), mat('#b9ae93', { side: THREE.DoubleSide }));
    ring.position.y = 0.13; ring.castShadow = true; g.add(ring);
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.48, 12), mat('#55706c')); water.rotation.x = -Math.PI / 2; water.position.y = 0.1; g.add(water);
    g.add(box(0.07, 0.75, 0.07, timber, -0.5, 0.37, 0), box(0.07, 0.75, 0.07, timber, 0.5, 0.37, 0), box(1.1, 0.05, 0.05, timber, 0, 0.6, 0), roof(1.0, 0.6, 0.25, '#9c8259', 0.72));
    return g;
  }
  if (p.stage === 0) {
    for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) g.add(box(0.05, 0.3, 0.05, '#7a6548', x, 0.15, z));
    const rope = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => new THREE.Vector3(x * w / 2, 0.24, z * d / 2))), new THREE.LineBasicMaterial({ color: '#8d7b5a' }));
    g.add(rope);
    for (let i = 0; i < 4; i++) g.add(box(1.5, 0.07, 0.09, '#9a7d55', -w * 0.15 + (i % 2) * 0.05, 0.05 + Math.floor(i / 2) * 0.08, d / 2 + 0.5 + (i % 2) * 0.11));
    return g;
  }
  const tall = p.kind === 'hall' ? 0.85 : p.kind === 'mill' || p.kind === 'barn' ? 0.95 : p.kind === 'granary' ? 0.7 : p.kind === 'alehouse' || p.kind === 'storehouse' ? 0.75 : 0.62;
  const rise = p.kind === 'granary' ? 0.75 : p.kind === 'hall' ? 0.8 : 0.6;
  const lift = p.kind === 'granary' ? 0.22 : 0;
  if (p.stage === 1) {
    // The frame stands: posts, plates, and bare rafters waiting for thatch.
    for (let x = -w / 2; x <= w / 2 + 0.01; x += w / Math.max(2, Math.round(w / 0.9))) {
      for (const z of [-d / 2, d / 2]) g.add(box(0.07, tall, 0.07, '#a98a5d', x, tall / 2, z));
      for (const s of [-1, 1]) {
        const rafter = box(0.05, Math.hypot(d / 2, rise), 0.05, '#a98a5d', x, tall + rise / 2, s * d / 4);
        // Each rafter leans in from its eave to meet the other at the ridge.
        rafter.rotation.x = -s * Math.atan2(d / 2, rise);
        g.add(rafter);
      }
    }
    g.add(box(w + 0.1, 0.07, 0.07, '#a98a5d', 0, tall, -d / 2), box(w + 0.1, 0.07, 0.07, '#a98a5d', 0, tall, d / 2), box(w + 0.1, 0.06, 0.06, '#a98a5d', 0, tall + rise, 0));
    g.add(box(0.07, 0.07, d, '#a98a5d', -w / 2, tall, 0), box(0.07, 0.07, d, '#a98a5d', w / 2, tall, 0));
    return g;
  }
  const wall = p.kind === 'mill' ? '#d8c9a4' : p.kind === 'granary' ? '#b99a6b' : p.kind === 'hall' ? '#dccb9f' : p.kind === 'storehouse' ? '#cbb68c' : p.kind === 'barn' ? '#a88b62' : '#e6d5a8';
  const top = p.kind === 'hall' ? '#8e7459' : p.kind === 'mill' ? '#9b7858' : p.kind === 'granary' ? '#a8935f' : p.kind === 'alehouse' ? '#9a6a4c' : p.kind === 'storehouse' ? '#7d6b52' : p.kind === 'barn' ? '#8a7656' : roofs[h % roofs.length];
  const bw = p.kind === 'oven' ? w * 0.58 : w, bx = p.kind === 'oven' ? -w * 0.21 : 0;
  g.add(box(bw, tall + 0.6, d, wall, bx, lift + tall / 2 - 0.3, 0));
  if (lift) for (const x of [-w / 2 + 0.25, 0, w / 2 - 0.25]) for (const z of [-d / 2 + 0.2, d / 2 - 0.2]) g.add(box(0.22, lift + 0.5, 0.22, '#aaa290', x, lift / 2 - 0.25, z));
  for (const x of [-bw / 2, bw / 2]) for (const z of [-d / 2, d / 2]) g.add(box(0.09, tall, 0.09, timber, bx + x, lift + tall / 2, z));
  g.add(box(bw + 0.05, 0.07, d + 0.05, timber, bx, lift + tall - 0.03, 0));
  if (p.kind !== 'granary') g.add(box(bw + 0.04, 0.05, d + 0.04, timber, bx, lift + tall * 0.5, 0));
  g.add(roof(bw, d, rise, top, lift + tall));
  // A barn has great doors, tall and wide enough for a laden cart.
  const doorH = p.kind === 'barn' ? tall * 0.85 : Math.min(0.46, tall * 0.72);
  g.add(box(p.kind === 'hall' ? 0.5 : p.kind === 'barn' ? 1.05 : 0.26, doorH, 0.05, '#4c3b29', bx + (p.kind === 'oven' ? 0 : along), lift + doorH / 2, side * d / 2));
  const panes = panesOf(p);
  for (const x of panes.xs) {
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.04), glow);
    pane.position.set(x, panes.y, side * (d / 2 + 0.005));
    g.add(pane);
  }
  if (p.kind === 'cottage' || p.kind === 'alehouse' || p.kind === 'hall') g.add(box(0.2, rise + 0.25, 0.2, '#8f8672', bw * 0.28, lift + tall + rise * 0.55, -side * d * 0.12));
  if (p.kind === 'alehouse') {
    g.add(box(0.05, 0.9, 0.05, timber, -w / 2 - 0.25, 0.45, side * (d / 2 + 0.3)), box(0.42, 0.26, 0.04, '#c9a45c', -w / 2 - 0.25, 0.75, side * (d / 2 + 0.3)));
    // The ale-stake: a pole out from the wall over the door, with a bush tied to its end.
    g.add(box(0.04, 0.04, 0.6, timber, along + 0.45, tall * 0.88, side * (d / 2 + 0.3)));
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), mat('#5f7a45')); bush.position.set(along + 0.45, tall * 0.88 - 0.12, side * (d / 2 + 0.62)); bush.castShadow = true; g.add(bush);
    // A loft door high in the gable, where the beds are.
    g.add(box(0.05, 0.22, 0.2, '#4c3b29', w / 2 + 0.005, tall + 0.18, 0));
  }
  // Barrels and a stack of sacks stand by the storehouse door.
  if (p.kind === 'storehouse') {
    for (const dx of [-0.7, -0.38]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.32, 10), mat('#8a6a44'));
      barrel.position.set(along + dx, 0.16, side * (d / 2 + 0.28)); barrel.castShadow = true; g.add(barrel);
    }
    g.add(box(0.36, 0.16, 0.24, '#c8b48a', along + 0.62, 0.08, side * (d / 2 + 0.26)), box(0.3, 0.14, 0.2, '#bfa87c', along + 0.6, 0.23, side * (d / 2 + 0.26)));
  }
  if (p.kind === 'oven') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 6, 0, TAU, 0, Math.PI / 2), mat('#c2946e'));
    dome.position.set(w * 0.27, 0.12, 0); dome.castShadow = true; g.add(dome);
    g.add(box(1.3, 0.3, 1.3, '#b08a66', w * 0.27, 0, 0), box(0.3, 0.26, 0.08, '#3f342a', w * 0.27, 0.27, side * 0.6), box(0.16, 0.5, 0.16, '#8f8672', w * 0.27, 0.8, 0));
  }
  if (p.kind === 'mill') {
    const wheel = new THREE.Group();
    wheel.position.set(0, 0.42, -side * (d / 2 + 0.24));
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.3, 14, 1, true), mat('#8a6d48', { side: THREE.DoubleSide }));
    rim.rotation.x = Math.PI / 2; rim.castShadow = true; wheel.add(rim);
    for (let i = 0; i < 7; i++) { const spoke = box(1.66, 0.06, 0.26, '#7a5f3f'); spoke.rotation.z = i * Math.PI / 7; wheel.add(spoke); }
    wheel.userData.spin = side;
    g.userData.wheel = wheel;
    g.add(wheel, box(0.12, 0.12, 0.6, timber, 0, 0.42, -side * (d / 2 + 0.1)));
  }
  return g;
}

export function createWalk(container, onSelect, onNote) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.append(renderer.domElement);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#d7e3e0');
  scene.fog = new THREE.Fog('#d7e3e0', 55, 190);
  // The sky is a dome that travels with the camera. Its two colours follow the hour.
  const heavens = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(392, 28, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#4f79b8') }, horizon: { value: new THREE.Color('#cfe2ea') } },
    vertexShader: 'varying float up; void main() { up = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying float up; void main() { float t = pow(clamp(up * 1.2 + 0.03, 0.0, 1.0), 0.6); gl_FragColor = vec4(mix(horizon, top, t), 1.0);\n#include <colorspace_fragment>\n}',
  }));
  const starAt = [], twinkle = rng(77);
  for (let i = 0; i < 520; i++) {
    const a = twinkle() * TAU, e = Math.asin(0.06 + twinkle() * 0.94);
    starAt.push(Math.cos(a) * Math.cos(e) * 380, Math.sin(e) * 380, Math.sin(a) * Math.cos(e) * 380);
  }
  const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starAt, 3)),
    new THREE.PointsMaterial({ color: '#e6ecff', size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  const orb = (radius, color) => new THREE.Mesh(new THREE.CircleGeometry(radius, 28), new THREE.MeshBasicMaterial({ color, fog: false, transparent: true, depthWrite: false, toneMapped: false }));
  const sunDisc = orb(15, '#fff3c4'), sunHalo = orb(46, '#ffe9a8'), moonDisc = orb(10, '#eef2ff'), moonHalo = orb(30, '#b9c8f5');
  sunHalo.material.opacity = 0.16; moonHalo.material.opacity = 0.14;
  heavens.add(dome, stars, sunHalo, sunDisc, moonHalo, moonDisc);
  scene.add(heavens);
  // Clouds drift high over the parish on the wind. They are the clouds whose shadows cross the plan,
  // so each lobe drawn there is a puff here.
  const CLOUDS = 900, cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, flatShading: true });
  const clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), cloudMat, CLOUDS);
  clouds.frustumCulled = false; clouds.count = 0; scene.add(clouds);
  // After rain, water standing in the hollows of the ways, and the rings of the drops on the river.
  const pools = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 18), new THREE.MeshBasicMaterial({ color: '#a9bcc2', transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }), 80);
  pools.frustumCulled = false; pools.count = 0; pools.renderOrder = 2; scene.add(pools);
  const dropRings = new THREE.InstancedMesh(new THREE.RingGeometry(0.88, 1, 24), new THREE.MeshBasicMaterial({ color: '#eef6f4', transparent: true, opacity: 0.5, depthWrite: false }), 260);
  dropRings.frustumCulled = false; dropRings.count = 0; dropRings.renderOrder = 2; scene.add(dropRings);
  const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), turned = new THREE.Quaternion(), upward = new THREE.Vector3(0, 1, 0);
  let hollows = null, hollowsOf = null;
  // The apples in the orchard, a few to a tree.
  const apples = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: '#c8402c', flatShading: true }), 40);
  apples.frustumCulled = false; apples.count = 0; apples.castShadow = true; scene.add(apples);
  // Hearth smoke and the glow of lit windows, drawn from small pools.
  const smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: '#efe9da', transparent: true, opacity: 0.3, depthWrite: false, flatShading: true }), 240);
  smoke.frustumCulled = false; smoke.count = 0; scene.add(smoke);
  const glowTexture = (() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const c = canvas.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,214,140,1)'); g.addColorStop(0.3, 'rgba(255,180,90,.45)'); g.addColorStop(1, 'rgba(255,160,70,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  })();
  const halos = [];
  for (let i = 0; i < 48; i++) {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    halo.visible = false; halos.push(halo); scene.add(halo);
  }
  const tint = new THREE.Color(), col = hex => tint.clone().set(hex), puffAt = new THREE.Matrix4(), puffTurn = new THREE.Quaternion(), puffPos = new THREE.Vector3(), puffSize = new THREE.Vector3();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.05, 420);
  const hemi = new THREE.HemisphereLight('#f3f1e4', '#8f8a66', 1.4);
  const sun = new THREE.DirectionalLight('#fff3d6', 2.6);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
  Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 320 });
  scene.add(hemi, sun, sun.target);
  const glow = new THREE.MeshLambertMaterial({ color: '#4b4234', emissive: '#ffb04a', emissiveIntensity: 0 });
  const land = new THREE.Group(), built = new THREE.Group(), people = new THREE.Group(), names = new THREE.Group();
  scene.add(land, built, people, names);
  const ringMark = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.21, 20), new THREE.MeshBasicMaterial({ color: '#f6e7b4', transparent: true, opacity: 0.9, depthWrite: false }));
  ringMark.rotation.x = -Math.PI / 2; ringMark.visible = false; scene.add(ringMark);
  // A chosen resident who is indoors is ringed on the front wall of their house instead, where its window glows after dark.
  const windowMark = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.27, 28), new THREE.MeshBasicMaterial({ color: '#b0502f', transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
  windowMark.visible = false; scene.add(windowMark);
  // A staff with a pennant and a note stands where the chronicle says something lately happened.
  const posted = new THREE.Group(), pennantGeo = new THREE.BufferGeometry();
  pennantGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.1, 0, 0, -0.1, 0, 0.32, 0, 0], 3)); pennantGeo.computeVertexNormals();
  const rippleGeo = new THREE.RingGeometry(0.86, 1, 28), rust = new THREE.MeshLambertMaterial({ color: '#b0502f', side: THREE.DoubleSide, flatShading: true });
  scene.add(posted);
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  let marks = [], postedKey = '', hold = null;

  const motion = createMotion();
  // Anglers step down from the landing to the water's edge.
  const anglers = createAnglers();
  // Children at play run about the green.
  const play = createPlay();
  const figures = new Map(), scenery = new Map(), wheels = [];
  let solids = [], grid = null, shadowSpan = 0;
  let map = null, actors = [], selectedId = null, active = false, frame = 0, last = 0, clock = 600;
  // The weather now, the houses with no fire today, and the parts of the scene the season recolours.
  let wx = null, cold = [], seasonKey = '', landSeasonKey = '', world = null, parish = null, cattle = [];
  // The wind, the cloud cover as it is drawn, the cloud there is to draw, and how far the spot being watched lies under it.
  let wind = null, cover = null, field = null, fieldSeed = null, under = 0;
  // How far the wind has carried the rain and the snow, kept as a running sum so a shift of wind bends their path without a jump.
  const blown = [0, 0];
  const piles = [], sheepModels = [], cattleModels = [];
  // Families' ox-carts and their oxen, built the first time each is needed.
  const cartModels = new Map();
  function makeCart() {
    const g = new THREE.Group(), wheels = [];
    g.add(box(0.82, 0.05, 0.5, '#9a7a52', 0, 0.3, 0));
    for (const side of [-1, 1]) g.add(box(0.82, 0.09, 0.03, '#8a6a45', 0, 0.36, side * 0.25), box(0.75, 0.03, 0.03, '#6b4f33', 0.75, 0.3, side * 0.12));
    for (const side of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 12), mat('#5f4a32'));
      wheel.rotation.x = Math.PI / 2; wheel.position.set(0, 0.24, side * 0.3); wheel.castShadow = true; g.add(wheel); wheels.push(wheel);
    }
    // The family's goods: sacks, a chest and a rolled bundle.
    for (const [x, z, s] of [[-0.22, -0.1, 1], [-0.22, 0.12, 0.9]]) { const sack = new THREE.Mesh(animalShape, mat('#d9cba3')); sack.scale.set(0.12 * s, 0.1 * s, 0.1 * s); sack.position.set(x, 0.42, z); sack.castShadow = true; g.add(sack); }
    g.add(box(0.24, 0.16, 0.2, '#6b4f33', 0.14, 0.41, -0.06));
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8), mat('#b6a37c')); roll.rotation.x = Math.PI / 2; roll.position.set(0.14, 0.38, 0.16); g.add(roll);
    return { object: g, wheels };
  }
  function moveCarts(now, dt) {
    const carts = cartsOf(map, world, actors, id => drawnAt.get(id) ?? motion.at(id, now), calm.matches ? 0 : now);
    for (const cart of carts) {
      let model = cartModels.get(cart.id);
      if (!model) {
        model = { ...makeCart(), oxen: [0, 1].map(() => makeAnimal('cattle', 1)) };
        for (const ox of model.oxen) {
          ox.animal.scale.multiplyScalar(1.08);
          for (const side of [-1, 1]) { const horn = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.07, 5), mat('#e6d7b4')); horn.position.set(0.04, 0.06, side * 0.045); horn.rotation.x = side * 0.9; ox.head.add(horn); }
          people.add(ox.animal);
        }
        cartModels.set(cart.id, model); people.add(model.object);
      }
      model.object.position.set(cart.x, ground(cart.x, cart.y), cart.y); model.object.rotation.y = -cart.heading;
      for (const wheel of model.wheels) wheel.rotation.y = -cart.gone / 0.24;
      cart.oxen.forEach((ox, i) => {
        const { animal, head, legs } = model.oxen[i];
        animal.position.set(ox.x, ground(ox.x, ox.y), ox.y); animal.rotation.y = -ox.heading;
        head.position.y = 0.233 - (ox.graze || 0) * 0.073; head.rotation.z = -(ox.graze || 0) * 1.24;
        const stride = ox.moving ? Math.sin(ox.gone * 9) * 0.32 : 0;
        legs.forEach((leg, j) => { leg.rotation.z = stride * (j === 0 || j === 3 ? 1 : -1); });
      });
    }
    for (const [id, model] of cartModels) if (!carts.some(c => c.id === id)) { people.remove(model.object); for (const ox of model.oxen) people.remove(ox.animal); cartModels.delete(id); }
  }
  // Visitors from beyond the parish, their beasts and the peddler's pitch, built the first time each is
  // needed. The tick lets them walk smoothly between village minutes.
  const visitorFigures = new Map(), beastModels = new Map();
  let pitchModel = null, pitchKey = '', tick = null;
  function moveVisitors(now, dt) {
    const visiting = visitorsOf(map, world, calm.matches ? clock : liveMinute(clock, tick, now), calm.matches ? 0 : now);
    for (const [i, v] of visiting.walkers.entries()) {
      let f = visitorFigures.get(v.id);
      if (!f) {
        f = makeFigure(v.actor, 40 + i);
        const patch = new THREE.Mesh(contactGeo, contactMat);
        patch.rotation.x = -Math.PI / 2; patch.position.y = 0.006; patch.renderOrder = 1; f.add(patch);
        f.userData.label = textSprite(v.name, false);
        f.userData.label.userData.reach = 14; f.userData.label.userData.size = 0.105;
        names.add(f.userData.label);
        visitorFigures.set(v.id, f); people.add(f);
      }
      const y = ground(v.x, v.y) + 0.012;
      f.position.set(v.x, y, v.y);
      let turn = -v.heading - f.rotation.y;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      f.rotation.y += turn * Math.min(1, dt * 8);
      poseFigure(f, { kind: 'visit', working: false, job: null, carry: v.carry, moving: v.moving, gone: v.gone, now, dt, still: calm.matches });
      f.userData.label.position.set(v.x, y + 0.56, v.y);
    }
    for (const [id, f] of visitorFigures) if (!visiting.walkers.some(v => v.id === id)) { people.remove(f); names.remove(f.userData.label); visitorFigures.delete(id); }
    for (const beast of visiting.animals) {
      let model = beastModels.get(beast.id);
      if (!model) {
        model = beast.kind === 'pony' ? makePony(beast.coat) : makeAnimal('cattle', beast.coat || 0);
        beastModels.set(beast.id, model); people.add(model.animal);
      }
      model.animal.position.set(beast.x, ground(beast.x, beast.y), beast.y); model.animal.rotation.y = -beast.heading;
      if (model.load) model.load.visible = Boolean(beast.laden);
      model.head.rotation.z = -(beast.graze || 0) * 1.1;
      const stride = beast.moving ? Math.sin(beast.gone * 9) * 0.32 : 0;
      model.legs.forEach((leg, j) => { leg.rotation.z = stride * (j === 0 || j === 3 ? 1 : -1); });
    }
    for (const [id, model] of beastModels) if (!visiting.animals.some(b => b.id === id)) { people.remove(model.animal); beastModels.delete(id); }
    const key = visiting.pitch ? [visiting.pitch.x, visiting.pitch.y, visiting.pitch.fish, visiting.pitch.linen].join() : '';
    if (key !== pitchKey) {
      pitchKey = key;
      if (pitchModel) { people.remove(pitchModel); pitchModel = null; }
      if (visiting.pitch) {
        pitchModel = makePitch(visiting.pitch.fish, visiting.pitch.linen);
        // Laid on the highest ground under it, so the slope of the green does not swallow a corner.
        const { x, y, a } = visiting.pitch, ca = Math.cos(a), sa = Math.sin(a);
        const lie = Math.max(...[[0, 0], [0.4, 0.66], [0.4, -0.66], [-0.4, 0.66], [-0.4, -0.66], [0.4, 0.9], [-0.4, 0.9]]
          .map(([u, v]) => ground(x + u * ca - v * sa, y + u * sa + v * ca)));
        pitchModel.position.set(x, lie + 0.004, y);
        pitchModel.rotation.y = -(visiting.pitch.a + Math.PI / 2);
        people.add(pitchModel);
      }
    }
  }
  // The haystack and the corn rick by the barn, rebuilt when what is in store changes their size.
  let rickModels = null, rickKey = '';
  function moveRicks() {
    const ricks = ricksOf(map, world), key = ricks.map(r => [r.kind, r.size, r.x, r.y].join(':')).join();
    if (key === rickKey) return;
    rickKey = key;
    if (rickModels) people.remove(rickModels);
    rickModels = new THREE.Group();
    for (const rick of ricks) {
      const g = new THREE.Group(), s = rick.size, y = ground(rick.x, rick.y);
      if (rick.kind === 'hay') {
        const r = 0.32 + 0.62 * s, tall = 0.35 + 0.75 * s;
        const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r, tall, 12), mat('#c9b268'));
        body.position.y = tall / 2; body.castShadow = body.receiveShadow = true; g.add(body);
        const top = new THREE.Mesh(new THREE.ConeGeometry(r * 1.02, tall * 0.7, 12), mat('#b59d58'));
        top.position.y = tall + tall * 0.35; top.castShadow = true; g.add(top);
      } else {
        const len = 0.6 + 1.1 * s, wid = 0.42 + 0.5 * s, tall = 0.3 + 0.55 * s;
        g.add(box(len, tall, wid, '#c8a457', 0, tall / 2, 0));
        // A three-sided prism laid along the rick with one edge up for the ridge.
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(wid * 0.62, wid * 0.62, len * 1.02, 3, 1, false, Math.PI / 2), mat('#b08c48'));
        roof.rotation.z = Math.PI / 2; roof.position.y = tall + wid * 0.31; roof.castShadow = true; g.add(roof);
        g.rotation.y = -rick.a;
      }
      g.position.set(rick.x, y, rick.y);
      rickModels.add(g);
    }
    people.add(rickModels);
  }
  // Dogs and cats, placed from where their owners are drawn, and the models that show them.
  const petsAt = createPets(), drawnAt = new Map(), petModels = new Map();
  function movePets(now, dt) {
    const placed = petsAt(map, world?.pets, actors, id => drawnAt.get(id) ?? motion.at(id, now), calm.matches ? 0 : now, light(clock).dark, calm.matches ? 10 : dt);
    for (const pet of placed) {
      let model = petModels.get(pet.id);
      if (!model) { model = makePet(pet.kind, pet.coat); petModels.set(pet.id, model); people.add(model.animal); }
      const { animal, body, head, tail, legs, scale } = model;
      animal.position.set(pet.x, ground(pet.x, pet.y), pet.y); animal.rotation.y = -pet.heading;
      const stride = pet.moving ? Math.sin(pet.gone * 18) * 0.7 : 0;
      legs.forEach((leg, i) => { leg.visible = !pet.lying; leg.rotation.z = (i === 0 || i === 3 ? 1 : -1) * stride; });
      body.position.y = (pet.lying ? 0.035 : 0.1) * scale;
      head.rotation.z = pet.lying ? -0.35 : 0.1;
      tail.rotation.x = pet.kind === 'dog' && !pet.lying && !calm.matches ? Math.sin(now * 0.018) * 0.6 : 0;
    }
    for (const [id, model] of petModels) if (!placed.some(p => p.id === id)) { people.remove(model.animal); petModels.delete(id); }
  }
  const dressed = { land: null, base: null, wet: null, fields: [], green: null, crowns: null, crownTones: [], cones: null, coneTones: [] };
  // Rain is drawn as short falling strokes and snow as drifting points, both in a box that travels with the camera.
  const DROPS = 900, FLAKES = 1100, SPAN = 26, TALL = 16;
  const scatter = rng(53), dropAt = new Float32Array(DROPS * 3), flakeAt = new Float32Array(FLAKES * 3);
  for (const list of [dropAt, flakeAt]) for (let i = 0; i < list.length; i += 3) { list[i] = scatter() * SPAN; list[i + 1] = scatter() * TALL; list[i + 2] = scatter() * SPAN; }
  const rain = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 6), 3)),
    new THREE.LineBasicMaterial({ color: '#c9d6e2', transparent: true, opacity: 0.5, depthWrite: false, fog: false }));
  const snowfall = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(FLAKES * 3), 3)),
    new THREE.PointsMaterial({ color: '#ffffff', size: 0.07, transparent: true, opacity: 0.95, depthWrite: false, fog: false }));
  rain.frustumCulled = snowfall.frustumCulled = false; rain.visible = snowfall.visible = false;
  scene.add(rain, snowfall);
  const look = { yaw: 2.2, pitch: 0.3, dist: 4.4, target: new THREE.Vector3(80, 0, 60), ready: false, touched: -1e9 };

  // The window of a building nearest the middle of its front wall, just proud of the wall, and the way
  // that wall faces. With no window, the middle of the wall. Null for a place with no walls.
  function windowOf(id) {
    const p = map.places.find(q => q.id === id);
    if (!p?.w || !p.at || p.a === undefined) return null;
    const side = (p.at[0] - p.x) * -Math.sin(p.a) + (p.at[1] - p.y) * Math.cos(p.a) > 0 ? 1 : -1;
    const nx = -Math.sin(p.a) * side, nz = Math.cos(p.a) * side, out = p.d / 2 + 0.06;
    const { xs, y } = panesOf(p), along = xs.length ? xs.reduce((a, b) => Math.abs(b) < Math.abs(a) ? b : a) : 0;
    return { x: p.x + Math.cos(p.a) * along + nx * out, y: heightAt(map, p.x, p.y) + (xs.length ? y : 0.42), z: p.y + Math.sin(p.a) * along + nz * out, nx, nz };
  }

  // Height of the drawn ground. The mesh is flat between its vertices, so the exact height function can sit
  // above or below it by a hand's breadth on a slope: enough to leave a figure hovering or wading.
  function ground(x, z) {
    if (!grid) return heightAt(map, x, z);
    const fi = (x + grid.margin) / grid.cell, fj = (z + grid.margin) / grid.cell;
    const i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= grid.nx || j >= grid.nz) return heightAt(map, x, z);
    const u = fi - i, v = fj - j, row = grid.nx + 1, a = j * row + i;
    const ha = grid.y[a], hb = grid.y[a + 1], hd = grid.y[a + row], he = grid.y[a + row + 1];
    return u + v <= 1 ? ha + u * (hb - ha) + v * (hd - ha) : he + (1 - u) * (hd - he) + (1 - v) * (hb - he);
  }

  function buildLand() {
    for (const child of land.children) child.material.dispose();
    dispose(land);
    const margin = 64, cell = 1.5, nx = Math.ceil((map.w + margin * 2) / cell), nz = Math.ceil((map.h + margin * 2) / cell);
    grid = { margin, cell, nx, nz, y: new Float32Array((nx + 1) * (nz + 1)) };
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3), col = new Float32Array(pos.length), index = [];
    const grass = new THREE.Color('#9fb267'), dry = new THREE.Color('#c8c486'), lush = new THREE.Color('#7c9a54'), mud = new THREE.Color('#b9ad88'), bed = new THREE.Color('#8d9a84'), rock = new THREE.Color('#9a9484'), scree = new THREE.Color('#b3ab96'), heath = new THREE.Color('#9c9a63'), c = new THREE.Color();
    for (let j = 0, k = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++, k += 3) {
        const x = -margin + i * cell, z = -margin + j * cell, y = heightAt(map, x, z);
        pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
        grid.y[k / 3] = y;
        const tone = fbm(map.seed + 19, x / 17, z / 17);
        c.copy(grass).lerp(tone > 0.5 ? dry : lush, Math.abs(tone - 0.5) * 1.5);
        if (y < 0.14) c.lerp(mud, Math.min(1, (0.14 - y) * 6));
        // The grass gives way to heath on the high moor, and that to bare rock above the tree line,
        // in two greys so the crags do not look poured.
        if (y > 3.6) c.lerp(heath, Math.min(0.75, (y - 3.6) / 4));
        if (y > TREE_LINE - 1.5) c.lerp(tone > 0.5 ? scree : rock, Math.min(1, (y - TREE_LINE + 1.5) / 3));
        if (y < WATER_LEVEL) c.lerp(bed, 0.8);
        col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      }
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1;
      index.push(a, d, b, b, d, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(index); g.computeVertexNormals();
    const ground = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    ground.receiveShadow = true;
    land.add(ground);
    dressed.land = ground; dressed.base = col.slice(); dressed.wet = grid.y.map(y => y < WATER_LEVEL ? 1 : 0); landSeasonKey = '';
    // The river is a ribbon just below the banks.
    const river = map.terrain.river, half = map.terrain.riverWidth / 2 + 1.4, wp = [], wi = [];
    for (let i = 0; i < river.length; i++) {
      const a = river[Math.max(0, i - 1)], b = river[Math.min(river.length - 1, i + 1)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), nx2 = -(b[1] - a[1]) / len, nz2 = (b[0] - a[0]) / len;
      wp.push(river[i][0] + nx2 * half, WATER_LEVEL, river[i][1] + nz2 * half, river[i][0] - nx2 * half, WATER_LEVEL, river[i][1] - nz2 * half);
      if (i) { const k = i * 2; wi.push(k - 2, k - 1, k, k, k - 1, k + 1); }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); wg.setIndex(wi); wg.computeVertexNormals();
    land.add(new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ color: '#6fa9c0', transparent: true, opacity: 0.88, side: THREE.DoubleSide })));
  }

  // A strip of ground-hugging geometry along a line of map points.
  function ribbon(pts, width, color, lift, deck = false) {
    const fine = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.9));
      for (let s = i === 1 ? 0 : 1; s <= n; s++) fine.push([mix(a[0], b[0], s / n), mix(a[1], b[1], s / n)]);
    }
    const pos = [], index = [];
    fine.forEach((p, i) => {
      const a = fine[Math.max(0, i - 1)], b = fine[Math.min(fine.length - 1, i + 1)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / len * width / 2, nz = (b[0] - a[0]) / len * width / 2;
      for (const s of [1, -1]) {
        const x = p[0] + nx * s, z = p[1] + nz * s;
        pos.push(x, deck ? lift : Math.max(ground(x, z), WATER_LEVEL) + lift, z);
      }
      if (i) { const k = i * 2; index.push(k - 2, k, k - 1, k, k + 1, k - 1); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(index); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat(color, ON_GROUND));
    m.receiveShadow = true;
    return m;
  }

  function draped(p, color, lift, texture) {
    const segW = Math.max(2, Math.round(p.w)), segD = Math.max(2, Math.round(p.d));
    const g = new THREE.PlaneGeometry(p.w, p.d, segW, segD), pos = g.attributes.position;
    const c = Math.cos(p.a), s = Math.sin(p.a);
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i), v = -pos.getY(i), x = p.x + u * c - v * s, z = p.y + u * s + v * c;
      pos.setXYZ(i, x, ground(x, z) + lift, z);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, texture ? new THREE.MeshLambertMaterial({ map: texture, color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
      : mat(color, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.receiveShadow = true;
    return m;
  }
  let furrows = null, gardenMaterial = null;
  function furrowTexture() {
    if (furrows) return furrows;
    const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 64;
    const c = canvas.getContext('2d');
    for (let y = 0; y < 64; y += 4) { c.fillStyle = (y / 4) % 2 ? '#ffffff' : '#c9c0a0'; c.fillRect(0, y, 8, 4); }
    furrows = new THREE.CanvasTexture(canvas);
    furrows.colorSpace = THREE.SRGBColorSpace; furrows.magFilter = THREE.NearestFilter;
    return furrows;
  }

  function buildGarden(garden) {
    const group = new THREE.Group();
    const bed = draped(garden, '#acaf77', 0.02);
    if (!gardenMaterial) {
      gardenMaterial = bed.material.clone();
      gardenMaterial.map = furrowTexture();
    }
    bed.material = gardenMaterial;
    group.add(bed);
    const posts = new Set();
    for (const [a, b] of fenceSpans(garden)) {
      const [x, z] = a, [bx, bz] = b, y = ground(x, z), by = ground(bx, bz);
      const level = Math.hypot(bx - x, bz - z);
      const span = new THREE.Group();
      span.position.set((x + bx) / 2, (y + by) / 2, (z + bz) / 2);
      span.rotation.y = -Math.atan2(bz - z, bx - x);
      for (const h of [0.14, 0.29]) {
        const rail = box(Math.hypot(level, by - y), 0.042, 0.052, '#9b7850', 0, h, 0);
        rail.rotation.z = Math.atan2(by - y, level);
        span.add(rail);
      }
      group.add(span);
      for (const [px, pz, py] of [[x, z, y], [bx, bz, by]]) {
        const key = px.toFixed(3) + ',' + pz.toFixed(3);
        if (posts.has(key)) continue;
        posts.add(key);
        group.add(box(0.071, 0.39, 0.071, '#745737', px, py + 0.185, pz));
      }
    }
    return group;
  }

  function buildPile(pile) {
    const stack = new THREE.Group();
    stack.position.set(pile.x, ground(pile.x, pile.y), pile.y);
    stack.rotation.y = -pile.a;
    for (const { u, v, height, length, radius } of pile.logs) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.92, radius, length, 7),
        [mat('#805b3e'), mat('#c9a575'), mat('#b28a61')]);
      log.position.set(u, height, v); log.rotation.z = Math.PI / 2;
      log.castShadow = log.receiveShadow = true;
      stack.add(log);
    }
    return stack;
  }

  // Hangs the apples the orchard now carries on its trees. Each sits just proud of its tree's crown.
  function hangApples() {
    const fruit = orchardFruit(world);
    let n = 0;
    if (fruit) {
      apples.material.color.set(blend('#a9b651', '#c8402c', fruit.red));
      const size = 0.05 * fruit.size;
      for (const tree of parish.appleTrees) {
        const [x, z, r] = tree, k = hash2(map.seed, x * 10, z * 10), mid = ground(x, z) + 1.17 * r, wide = r * 0.82, tall = r * (0.72 + k * 0.25);
        for (const [round, out, up] of appleSpots(tree, map.seed, fruit.each)) {
          if (n >= 40) break;
          // The bearing and the height fix a point on the crown. Lower fruit hangs further out.
          const rise = up * 0.75, reach = Math.sqrt(1 - rise * rise) * (0.83 + 0.08 * out);
          puffAt.compose(puffPos.set(x + Math.cos(round) * reach * wide, mid + rise * tall * 0.9, z + Math.sin(round) * reach * wide), puffTurn, puffSize.set(size, size, size));
          apples.setMatrixAt(n++, puffAt);
        }
      }
    }
    apples.count = n; apples.instanceMatrix.needsUpdate = true;
  }

  // Walls and thatch inside each standing frame, rebuilt as the work moves on, and the loaves by the oven.
  const rising = new Map();
  const loafBoard = new THREE.Group(), loaves = [];
  loafBoard.add(box(0.44, 0.025, 0.16, '#9a7a52', 0, 0.22, 0));
  for (const x of [-0.18, 0.18]) loafBoard.add(box(0.03, 0.21, 0.13, '#7a5f3f', x, 0.105, 0));
  for (let i = 0; i < 5; i++) { const loaf = new THREE.Mesh(new THREE.SphereGeometry(0.034, 10, 7), mat('#c98f55')); loaf.scale.set(1, 0.6, 1.3); loaf.position.set(-0.16 + i * 0.08, 0.245, 0); loaf.castShadow = true; loaves.push(loaf); loafBoard.add(loaf); }
  loafBoard.visible = false; scene.add(loafBoard);
  function showWork() {
    const standing = new Set();
    for (const p of map.places) {
      if (p.stage !== 1 || !p.w || p.kind === 'field' || isFarmSite(p.kind)) continue;
      const raised = Math.round(raisedOf(world, p.id) * 12) / 12, had = rising.get(p.id);
      standing.add(p.id);
      if (had?.raised === raised) continue;
      if (had) built.remove(had.group);
      const group = buildRising(p, map, raised);
      built.add(group); rising.set(p.id, { raised, group });
    }
    for (const [id, had] of rising) if (!standing.has(id)) { built.remove(had.group); rising.delete(id); }
    const bake = ovenLoaves(map, actors);
    loafBoard.visible = Boolean(bake?.count);
    if (bake) {
      loafBoard.position.set(bake.x, ground(bake.x, bake.y), bake.y); loafBoard.rotation.y = -bake.a;
      loaves.forEach((loaf, i) => { loaf.visible = i < bake.count; });
    }
  }

  function updateParish() {
    if (!map) return;
    cattle = strayCattle(map, world);
    hangApples();
    showWork();
    for (const { pile, stack } of piles) {
      const count = logsIn(pile, world);
      stack.children.forEach((log, index) => { log.visible = index < count; });
    }
  }

  function moveAnimals(models, animals, time) {
    models.forEach(({ animal, head, legs }, index) => {
      const spec = animals[index];
      animal.visible = Boolean(spec);
      if (!spec) return;
      const pose = animalPose(spec, time);
      // A lamb is about half its mother's size.
      if (spec.kind === 'sheep') animal.scale.setScalar(spec.lamb ? 0.55 : 1);
      animal.position.set(pose.x, ground(pose.x, pose.y), pose.y);
      animal.rotation.y = -pose.heading;
      head.position.y = 0.233 - pose.graze * 0.073;
      head.rotation.z = -pose.graze * 1.24;
      legs.forEach((leg, i) => { leg.rotation.z = pose.stride * (i === 0 || i === 3 ? 0.32 : -0.32); });
    });
  }

  function removeScenery(key, entry) {
    for (const object of [entry.object, entry.label]) {
      if (!object) continue;
      object.removeFromParent();
      dispose(object);
    }
    for (const material of entry.materials ?? []) material.dispose();
    scenery.delete(key);
  }

  // A stretch of deck runs on to the bank at the ends of the span and overlaps its neighbour where two meet.
  function bridge({ A, B, len, ux, uy, from, to }) {
    const start = from === 0 ? -0.4 : from, end = to === len ? len + 0.4 : to, middle = (start + end) / 2, deck = end - start;
    const span = new THREE.Group();
    span.position.set(A[0] + ux * middle, 0.2, A[1] + uy * middle); span.rotation.y = -Math.atan2(B[1] - A[1], B[0] - A[0]);
    span.add(box(deck, 0.1, 1.3, '#a98c63', 0, 0, 0), box(deck, 0.07, 0.07, '#6b5a43', 0, 0.36, 0.62), box(deck, 0.07, 0.07, '#6b5a43', 0, 0.36, -0.62));
    for (const along of [0, len / 3, len * 2 / 3, len]) {
      for (const z of [0.62, -0.62]) span.add(box(0.09, 1.1, 0.09, '#6b5a43', along - middle, -0.15, z));
    }
    return span;
  }

  function placeScenery(p) {
    const entry = {};
    if (p.kind === 'green') {
      const m = draped({ ...p, w: p.rx * 2, d: p.ry * 2 }, '#b3c08a', 0.012);
      m.material = m.material.clone();
      Object.assign(entry, { object: m, green: m, materials: [m.material] });
      const pos = m.geometry.attributes.position, c = Math.cos(p.a), s = Math.sin(p.a);
      // Pull the corners of the draped sheet in to an ellipse.
      for (let i = 0; i < pos.count; i++) {
        const dx = pos.getX(i) - p.x, dz = pos.getZ(i) - p.y, u = (dx * c + dz * s) / p.rx, v = (-dx * s + dz * c) / p.ry, r = Math.hypot(u, v);
        if (r > 1) { const x = p.x + (u / r * p.rx) * c - (v / r * p.ry) * s, z = p.y + (u / r * p.rx) * s + (v / r * p.ry) * c; pos.setXYZ(i, x, ground(x, z) + 0.012, z); }
      }
    } else if (p.kind === 'field') {
      if (p.stage === 0) {
        const group = new THREE.Group();
        for (const [x, z] of rectPoly(p)) group.add(box(0.06, 0.4, 0.06, '#7a6548', x, ground(x, z) + 0.2, z));
        entry.object = group;
      } else {
        const tone = p.stage === 1 ? '#b9a67c' : fieldTones[tag(p.id) % fieldTones.length];
        const mesh = draped(p, tone, 0.016, p.stage === 2 ? furrowTexture() : null);
        entry.object = mesh;
        if (p.stage === 2) Object.assign(entry, { field: { mesh, tone }, materials: [mesh.material] });
      }
    } else if (p.kind === 'orchard' || p.kind === 'pasture') {
      entry.object = draped(p, '#a9b584', 0.016);
    } else if (p.kind !== 'wood' && p.kind !== 'fishing' && !isFarmSite(p.kind)) {
      entry.object = buildPlace(p, map, glow);
      entry.wheel = entry.object.userData.wheel;
    }
    if (p.name && p.kind !== 'field' && p.kind !== 'wood' && p.kind !== 'green') {
      const sprite = textSprite(p.stage < 2 ? p.name + ' (building)' : p.name);
      const labelHeight = p.kind === 'fishing' || isFarmSite(p.kind) ? 0.8 : p.kind === 'well' ? 1.5 : 2.3;
      sprite.position.set(p.x, heightAt(map, p.x, p.y) + labelHeight, p.y);
      sprite.userData.reach = 46; sprite.userData.size = 0.34;
      entry.label = sprite;
    }
    return entry;
  }

  function updateScenery() {
    const live = new Set();
    function reuse(key, data, build) {
      live.add(key);
      const signature = JSON.stringify(data), before = scenery.get(key);
      if (before?.signature === signature) return before;
      if (before) removeScenery(key, before);
      const entry = { ...build(), signature };
      if (entry.object) { entry.object.name = key; built.add(entry.object); }
      if (entry.label) names.add(entry.label);
      scenery.set(key, entry);
      return entry;
    }
    wheels.length = piles.length = 0;
    dressed.fields = []; dressed.green = null; seasonKey = '';
    parish = parishLayout(map);
    solids = map.places.filter(p => p.w && p.kind !== 'field' && !isFarmSite(p.kind) && p.stage === 2).map(p => ({
      id: p.id, x: p.x, y: p.y, c: Math.cos(p.a), s: Math.sin(p.a), hw: p.w / 2 + 0.3, hd: p.d / 2 + 0.3, top: heightAt(map, p.x, p.y) + 1.75,
    }));
    for (const { pts, kind, road } of chains(map)) {
      const id = road >= 0 ? road : kind + ':' + pts.join(':');
      reuse('way:' + id, { pts, kind }, () => ({ object: ribbon(pts, WIDTH[kind], kind === 'road' ? '#dccaa2' : kind === 'lane' ? '#d6c39b' : '#cbbb92',
        kind === 'road' ? 0.022 : kind === 'lane' ? 0.02 : 0.016) }));
    }
    for (const deck of bridgeDecks(map)) {
      reuse('bridge:' + deck.a + ':' + deck.b, [deck.A, deck.B, deck.from, deck.to], () => ({ object: bridge(deck) }));
    }
    for (const p of map.places) {
      const { green, field, wheel } = reuse('place:' + p.id, p, () => placeScenery(p));
      if (green) dressed.green = green;
      if (field) dressed.fields.push(field);
      if (wheel) wheels.push(wheel);
    }
    for (const garden of parish.gardens) reuse('garden:' + garden.id, garden, () => ({ object: buildGarden(garden) }));
    // The chopping block and the chips about it.
    if (parish.block) reuse('block', parish.block, () => {
      const g = new THREE.Group(), { x, y, chips } = parish.block, base = ground(x, y);
      const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.24, 10), mat('#8a6d48')); stump.position.set(x, base + 0.12, y); stump.castShadow = true; g.add(stump);
      for (const [cx, cz, r, turn] of chips) { const chip = box(r * 2, 0.012, r * 0.9, '#d9c39a', cx, ground(cx, cz) + 0.01, cz); chip.rotation.y = turn; chip.castShadow = false; g.add(chip); }
      return { object: g };
    });
    for (const pile of parish.piles) {
      const { object: stack } = reuse('pile:' + pile.id, pile, () => ({ object: buildPile(pile) }));
      piles.push({ pile, stack });
    }
    for (const { kind, coat } of parish.sheep.slice(sheepModels.length)) {
      const model = makeAnimal(kind, coat);
      sheepModels.push(model); built.add(model.animal);
    }
    while (cattleModels.length < animalCoats.cattle.length) {
      const model = makeAnimal('cattle', cattleModels.length);
      cattleModels.push(model); built.add(model.animal);
    }
    reuse('trees', [map.trees, parish.appleTrees], buildTrees);
    for (const [key, entry] of scenery) if (!live.has(key)) removeScenery(key, entry);
    updateParish();
    post();
  }

  function buildTrees() {
    // Trees, with a ring of distant woods beyond the mapped parish so the horizon is not bare.
    const trees = [...map.trees, ...parish.appleTrees], rand = rng(map.seed + 41);
    for (let i = 0; i < 2600; i++) {
      const x = -60 + rand() * (map.w + 120), z = -60 + rand() * (map.h + 120), size = 0.7 + rand() * 0.6, pine = rand() < 0.5;
      if (x > 2 && z > 2 && x < map.w - 2 && z < map.h - 2) continue;
      const stand = heightAt(map, x, z);
      if (fbm(map.seed + 31, x / 26, z / 26) < 0.47 || stand < 0.12 || stand > TREE_LINE) continue;
      trees.push([x, z, size, pine ? 1 : 0]);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.06, 0.09, 0.6, 5), leafGeo = new THREE.IcosahedronGeometry(1, 0), pineGeo = new THREE.ConeGeometry(0.62, 1.9, 6);
    const trunks = new THREE.InstancedMesh(trunkGeo, mat('#6b5a44'), trees.length);
    const leafy = trees.filter(t => !t[3]), piney = trees.filter(t => t[3]);
    const crowns = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ flatShading: true }), leafy.length);
    const cones = new THREE.InstancedMesh(pineGeo, new THREE.MeshLambertMaterial({ flatShading: true }), piney.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), tint = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    dressed.crownTones = []; dressed.coneTones = [];
    let li = 0, pi = 0;
    trees.forEach(([x, z, r, pine], i) => {
      const y = ground(x, z), k = hash2(map.seed, x * 10, z * 10);
      q.setFromAxisAngle(up, k * TAU);
      m4.compose(v.set(x, y + 0.3 * r, z), q, sc.set(r, r, r)); trunks.setMatrixAt(i, m4);
      if (pine) {
        m4.compose(v.set(x, y + 0.45 * r + 0.95 * r, z), q, sc.set(r, r * (0.9 + k * 0.4), r)); cones.setMatrixAt(pi, m4);
        dressed.coneTones.push(['#6f7d5c', '#667556', '#7a8663'][Math.floor(k * 3)]);
        cones.setColorAt(pi++, tint.set(dressed.coneTones[dressed.coneTones.length - 1]));
      } else {
        m4.compose(v.set(x, y + 0.55 * r + 0.62 * r, z), q, sc.set(r * 0.82, r * (0.72 + k * 0.25), r * 0.82)); crowns.setMatrixAt(li, m4);
        dressed.crownTones.push([['#879266', '#909a6c', '#9da67a', '#77885f'][Math.floor(k * 4)], ['#b98a4e', '#c39c57', '#a9743f', '#b9a45c'][Math.floor(k * 4)], hash2(map.seed + 6, x * 10, z * 10)]);
        crowns.setColorAt(li++, tint.set(dressed.crownTones[dressed.crownTones.length - 1][0]));
      }
    });
    dressed.crowns = crowns; dressed.cones = cones;
    const group = new THREE.Group();
    for (const mesh of [trunks, crowns, cones]) { mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; group.add(mesh); }
    return { object: group, materials: [crowns.material, cones.material] };
  }

  // A spot inside a building is shown at its door, where a staff can stand and be seen.
  function outside(x, z) {
    const b = solids.find(b => { const dx = x - b.x, dz = z - b.y; return Math.abs(dx * b.c + dz * b.s) < b.hw - 0.2 && Math.abs(-dx * b.s + dz * b.c) < b.hd - 0.2; });
    const door = b && map.places.find(p => p.id === b.id)?.at;
    return door ? [door[0], door[1]] : [x, z];
  }
  // Sets out the staffs and notes for the latest chronicle entries, and for the one being held on.
  function post() {
    if (!map) return;
    const spots = [];
    for (const m of hold?.event && !marks.some(k => k.events.some(e => e.id === hold.event.id)) ? [{ ...hold.mark }, ...marks] : marks) {
      const [x, z] = outside(m.x, m.y), key = Math.round(x) + ',' + Math.round(z);
      const spot = spots.find(s => s.key === key);
      if (spot) spot.events = [...spot.events, ...m.events].sort((a, b) => b.minute - a.minute).slice(0, 3);
      else spots.push({ key, x, z, id: m.id, events: m.events.slice() });
    }
    const key = JSON.stringify(spots);
    if (key === postedKey) return;
    postedKey = key;
    for (const g of posted.children) {
      const { staff, note, ripple } = g.userData;
      staff.geometry.dispose(); note.material.map.dispose(); note.material.dispose(); ripple.material.dispose();
    }
    posted.clear();
    for (const s of spots) {
      const g = new THREE.Group(), staff = box(0.03, 0.84, 0.03, '#5f4e39', 0, 0.42, 0), pennant = new THREE.Mesh(pennantGeo, rust);
      pennant.position.set(0.015, 0.73, 0); pennant.castShadow = true;
      const ripple = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({ color: '#b0502f', transparent: true, opacity: 0, depthWrite: false }));
      ripple.rotation.x = -Math.PI / 2; ripple.position.y = 0.03;
      const note = noteSprite(s.events);
      note.position.y = 0.95;
      g.position.set(s.x, ground(s.x, s.z), s.z);
      g.userData = { ...s, staff, note, pennant, ripple, newest: s.events[0].minute };
      g.add(staff, pennant, ripple, note);
      posted.add(g);
    }
  }

  // Recolours the land for the day of the year and for lying snow. Called when either changes.
  function dress() {
    const year = yearLook(clock), snow = Math.round(wx.lying * 4) / 4, WHITE = '#f4f5f2';
    const snowed = (hex, k = 0.85) => snow ? blend(hex, WHITE, snow * k) : hex;
    if (dressed.land && landSeasonKey !== seasonKey) {
      landSeasonKey = seasonKey;
      const colors = dressed.land.geometry.attributes.color, a = colors.array, base = dressed.base;
      const dull = new THREE.Color('#b3ab84'), white = new THREE.Color(WHITE), c = new THREE.Color();
      for (let i = 0; i < a.length; i += 3) {
        c.setRGB(base[i], base[i + 1], base[i + 2]).lerp(dull, (1 - year.lush) * 0.8);
        if (snow && !dressed.wet[i / 3]) c.lerp(white, snow * 0.92);
        a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b;
      }
      colors.needsUpdate = true;
    }
    dressed.green?.material.color.set(snowed(blend('#b9b48c', '#b3c08a', year.lush)));
    for (const { mesh, tone } of dressed.fields) mesh.material.color.set(snowed(blend(year.barley, tone, 0.28)));
    gardenMaterial?.color.set(snowed(blend('#ad9270', '#acaf77', year.lush)));
    for (const [material, base] of roofed) material.color.set(snowed(base, 0.8));
    // Out of leaf, a crown is a head of bare twigs.
    dressed.crownTones.forEach(([green, russet, when], i) => {
      const turned = Math.min(1, Math.max(0, year.turn * 1.5 - when * 0.5));
      dressed.crowns.setColorAt(i, tint.set(snowed(blend('#8c7f68', blend(green, russet, turned), Math.min(1, year.leaf * 1.6)), 0.5)));
    });
    dressed.coneTones.forEach((green, i) => dressed.cones.setColorAt(i, tint.set(snowed(green, 0.55))));
    for (const mesh of [dressed.crowns, dressed.cones]) if (mesh?.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // Rain and snow fall through a box around the camera and wrap from its floor to its top.
  function precipitation(now, dt) {
    rain.visible = wx.rain > 0; snowfall.visible = wx.snow > 0;
    if (!rain.visible && !snowfall.visible) return;
    const push = 0.15 + wind.strength, across = wind.toward[0] * push, along = wind.toward[1] * push;
    blown[0] += across * dt; blown[1] += along * dt;
    const wrap = (v, span) => ((v % span) + span) % span;
    const ox = camera.position.x - SPAN / 2, oy = camera.position.y - TALL * 0.35, oz = camera.position.z - SPAN / 2, t = now / 1000;
    if (rain.visible) {
      const a = rain.geometry.attributes.position.array, n = Math.round(DROPS * (0.3 + 0.7 * wx.rain));
      for (let i = 0; i < n; i++) {
        const x = ox + wrap(dropAt[i * 3] - ox + blown[0] * 5, SPAN), y = oy + wrap(dropAt[i * 3 + 1] - oy - t * 13, TALL), z = oz + wrap(dropAt[i * 3 + 2] - oz + blown[1] * 5, SPAN);
        // Each stroke lies along the way the drop is falling: 13 units a second down, and sideways with the wind.
        a[i * 6] = x; a[i * 6 + 1] = y; a[i * 6 + 2] = z; a[i * 6 + 3] = x + across * 5 / 13 * 0.42; a[i * 6 + 4] = y - 0.42; a[i * 6 + 5] = z + along * 5 / 13 * 0.42;
      }
      rain.geometry.setDrawRange(0, n * 2); rain.geometry.attributes.position.needsUpdate = true;
    } else {
      const a = snowfall.geometry.attributes.position.array, n = Math.round(FLAKES * (0.3 + 0.7 * wx.snow));
      for (let i = 0; i < n; i++) {
        a[i * 3] = ox + wrap(flakeAt[i * 3] - ox + blown[0] * 1.3 + Math.sin(t * 0.9 + i) * 0.25, SPAN);
        a[i * 3 + 1] = oy + wrap(flakeAt[i * 3 + 1] - oy - t * (0.9 + (i % 5) * 0.12), TALL);
        a[i * 3 + 2] = oz + wrap(flakeAt[i * 3 + 2] - oz + blown[1] * 1.3, SPAN);
      }
      snowfall.geometry.setDrawRange(0, n); snowfall.geometry.attributes.position.needsUpdate = true;
    }
  }

  // Rain darkens the ground and the ways, fills the puddles and rings the river near the camera. Frozen
  // or snowy ground stays as it is.
  function rainfall(now, horizon) {
    const wet = wx.lying > 0.3 || wx.temp < 0 ? 0 : wetness(clock, map.seed);
    if (dressed.land) dressed.land.material.color.setScalar(1 - 0.16 * wet);
    for (const [base, dark] of [['#dccaa2', '#9c8865'], ['#d6c39b', '#978360'], ['#cbbb92', '#8f7f5e']]) mat(base, ON_GROUND).color.set(blend(base, dark, 0.8 * wet));
    if (hollowsOf !== map) { hollowsOf = map; hollows = puddles(map); }
    const cx = camera.position.x, cz = camera.position.z, near = (x, z) => Math.abs(x - cx) < 60 && Math.abs(z - cz) < 60;
    let n = 0;
    if (wet > 0.03) {
      pools.material.color.copy(horizon).lerp(col('#6d8a96'), 0.4);
      for (const [x, z, size, turn, lasts] of hollows) {
        const r = size * puddleFill(wet, lasts);
        if (r < 0.03 || !near(x, z) || n >= 80) continue;
        turned.setFromAxisAngle(upward, -turn).multiply(flat);
        puffAt.compose(puffPos.set(x, ground(x, z) + 0.03, z), turned, puffSize.set(r * 1.4, r * 0.72, 1));
        pools.setMatrixAt(n++, puffAt);
      }
    }
    pools.count = n; pools.instanceMatrix.needsUpdate = true;
    n = 0;
    for (const [x, z, age] of rainRings(map, calm.matches ? 0 : now, wx.rain)) {
      if (!near(x, z) || n >= 260) continue;
      const r = 0.05 + age * 0.3;
      puffAt.compose(puffPos.set(x, WATER_LEVEL + 0.012, z), flat, puffSize.set(r, r, 1));
      dropRings.setMatrixAt(n++, puffAt);
    }
    dropRings.count = n; dropRings.instanceMatrix.needsUpdate = true;
  }

  // The clouds within sight, a puff for each lobe. Returns how far the spot being watched lies under one.
  function overhead(now) {
    const drift = cloudDrift(calm.matches ? 0 : now, wind), far = 250, cx = camera.position.x, cz = camera.position.z;
    const near = cloudsOver(field, cover, drift, cx - far, cz - far, cx + far, cz + far);
    let n = 0;
    for (const { id, lobes } of near) {
      const base = 48 + hash2(map.seed, id, 311) * 24;
      for (const [x, z, r] of lobes) {
        if (n >= CLOUDS) break;
        const tall = r * 0.46;
        puffAt.compose(puffPos.set(x, base + tall * 0.55, z), puffTurn, puffSize.set(r * 1.08, tall, r * 1.08));
        clouds.setMatrixAt(n++, puffAt);
      }
    }
    clouds.count = n; clouds.instanceMatrix.needsUpdate = true;
    return cloudOverhead(near, look.target.x, look.target.z);
  }

  function sky(now, dt) {
    wx = skyOver(clock, map.seed);
    wind = windAt(clock, map.seed);
    if (fieldSeed !== map.seed) { fieldSeed = map.seed; field = cloudField(map.seed); }
    // The cover eases from one spell of weather to the next, and the light dims as a cloud comes over.
    cover = cover === null ? wx.cloud : cover + (wx.cloud - cover) * (1 - Math.exp(-dt * 0.3));
    const shaded = overhead(now) * cloudShade(cover);
    under += (shaded - under) * (1 - Math.exp(-Math.min(0.25, dt) * 2.5));
    const key = Math.floor(clock / 1440) + ':' + Math.round(wx.lying * 4);
    if (key !== seasonKey) { seasonKey = key; dress(); }
    const L = light(clock), lit = hearths(map, actors, cold);
    // Cloud greys the sky and the light. Rain and snow close the distance in.
    const murk = Math.max(wx.cloud * 0.75, wx.rain, wx.snow * 0.9), wet = Math.max(wx.rain, wx.snow);
    const grey = col('#1b2130').lerp(col('#aeb6ba'), L.bright);
    const top = col('#0a1230').lerp(col('#4c78ba'), L.bright).lerp(col('#6c6aa6'), L.dusk * 0.45).lerp(grey, murk * 0.85);
    const horizon = col('#263459').lerp(col('#cfe3ec'), L.bright).lerp(col('#f4b07a'), L.dusk * 0.8 * (1 - murk * 0.7)).lerp(grey, murk * 0.6);
    dome.material.uniforms.top.value.copy(top); dome.material.uniforms.horizon.value.copy(horizon);
    rainfall(now, horizon);
    scene.background.copy(horizon); scene.fog.color.copy(horizon);
    scene.fog.near = 55 - 15 * L.dark - 40 * wet; scene.fog.far = 190 - 20 * L.dark - 95 * wet;
    heavens.position.copy(camera.position);
    stars.material.opacity = Math.max(0, Math.min(1, (L.dark - 0.45) * 2.2)) * (1 - murk);
    const sunWay = new THREE.Vector3(Math.cos(Math.PI * L.p), Math.max(0.06, L.day * 0.95), 0.45 * Math.sin(Math.PI * L.p) + 0.2).normalize();
    const moonWay = new THREE.Vector3(-0.45, 0.72, 0.5).normalize();
    const clear = 1 - murk;
    for (const [disc, way, far, seen] of [[sunDisc, sunWay, 372, L.day > 0 ? clear : 0], [sunHalo, sunWay, 374, L.day > 0 ? (0.14 + 0.22 * L.dusk) * clear : 0],
      [moonDisc, moonWay, 372, Math.max(0, L.dark - 0.3) * 1.4 * clear], [moonHalo, moonWay, 374, Math.max(0, L.dark - 0.3) * 0.2 * clear]]) {
      disc.position.copy(way).multiplyScalar(far); disc.lookAt(0, 0, 0); disc.material.opacity = Math.min(1, seen); disc.visible = seen > 0.01;
    }
    sunDisc.material.color.copy(col('#ffb070').lerp(col('#fff6d2'), 1 - L.dusk));
    // By day the sun lights the parish. By night the same lamp is the moon, cool and bright enough to see by.
    // Under cloud the sun is weaker and the sky itself does more of the lighting.
    if (L.day > 0) { sun.position.copy(sunWay); sun.color.copy(col('#ffb877').lerp(col('#fff4dc'), 1 - L.dusk)); sun.intensity = (0.7 + 2.5 * L.bright) * (1 - murk * 0.7) * (1 - 0.5 * under); }
    else { sun.position.copy(moonWay); sun.color.set('#9fb6ee'); sun.intensity = 1.25 * (1 - murk * 0.6); }
    hemi.color.copy(col('#8094cc').lerp(col('#f3f1e4'), L.bright).lerp(col('#c4cace'), murk * 0.5 * L.bright));
    hemi.groundColor.copy(col('#2c3554').lerp(col('#8f8a66'), L.bright).lerp(col('#d9dcd8'), wx.lying * 0.6 * L.bright));
    hemi.intensity = 1.0 + 0.45 * L.bright + 0.25 * murk * L.bright;
    const nightly = Math.max(0, Math.min(1, (L.dark - 0.2) * 1.5));
    glow.emissiveIntensity = 1.15 * nightly;
    cloudMat.opacity = 0.9 - 0.35 * L.dark;
    cloudMat.color.copy(col('#ffffff').lerp(col('#9aa2a8'), murk * 0.8));
    precipitation(now, dt);
    // Smoke rises from every hearth with someone at it, and its window glows after dark.
    let n = 0;
    lit.forEach((p, i) => {
      const side = (p.at[0] - p.x) * -Math.sin(p.a) + (p.at[1] - p.y) * Math.cos(p.a) > 0 ? 1 : -1;
      const base = heightAt(map, p.x, p.y), cx = p.x + Math.cos(p.a) * p.w * 0.28, cz = p.y + Math.sin(p.a) * p.w * 0.28;
      // Smoke stands nearly straight up in still air and lies along the wind when it blows.
      const lean = 0.4 + 2.6 * wind.strength, rise = 2.9 * (1 - 0.5 * wind.strength);
      for (let j = 0; j < 5 && n < 240; j++) {
        const f = (now * 0.00012 + j / 5 + (i % 7) / 7) % 1, size = (0.07 + f * 0.3) * (1 - f * f);
        puffAt.compose(puffPos.set(cx + f * lean * wind.toward[0] + Math.sin(f * 6 + j) * 0.12, base + 1.5 + f * rise, cz + f * lean * wind.toward[1]), puffTurn, puffSize.set(size, size, size));
        smoke.setMatrixAt(n++, puffAt);
      }
      const halo = halos[i];
      if (halo) {
        halo.visible = nightly > 0.05;
        halo.position.set(p.x - Math.sin(p.a) * side * (p.d / 2 + 0.25), base + 0.45, p.y + Math.cos(p.a) * side * (p.d / 2 + 0.25));
        halo.scale.setScalar(2.4); halo.material.opacity = 0.34 * nightly;
      }
    });
    for (let i = lit.length; i < halos.length; i++) halos[i].visible = false;
    smoke.count = n; smoke.instanceMatrix.needsUpdate = true;
    sun.position.normalize().multiplyScalar(140).add(look.target);
    sun.target.position.copy(look.target);
    const span = Math.min(44, Math.max(9, (look.reach || look.dist) * 3.2));
    if (Math.abs(span - shadowSpan) > shadowSpan * 0.08) {
      shadowSpan = span;
      Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span });
      sun.shadow.camera.updateProjectionMatrix();
      // One texel of the shadow map, which is as far as a shadow may be pushed off its caster.
      sun.shadow.normalBias = span * 2 / 2048 * 0.7;
    }
  }

  // The building a resident is standing at is left out, or its wall would block half of every orbit.
  function inside(x, y, z, except) {
    for (const b of solids) {
      if (y > b.top || b.id === except) continue;
      const dx = x - b.x, dz = z - b.y;
      if (Math.abs(dx * b.c + dz * b.s) < b.hw && Math.abs(-dx * b.s + dz * b.c) < b.hd) return true;
    }
    return false;
  }

  function render(now) {
    frame = 0;
    if (!active || !map) return;
    const dt = Math.min(0.1, (now - last) / 1000 || 0.016); last = now;
    const crowd = new Map();
    let followed = null;
    anglers.begin(map, actors, id => motion.at(id, now));
    play.begin(map, actors, id => motion.at(id, now), calm.matches ? 0 : now);
    actors.forEach((actor, index) => {
      const at = motion.at(actor.id, now);
      if (!at) return;
      const p = play.place(actor.id, anglers.place(actor.id, at, calm.matches ? 10 : dt), calm.matches ? 10 : dt);
      let f = figures.get(actor.id);
      if (!f) {
        f = makeFigure(actor, index);
        // The sun's shadow is too coarse to reach the feet from far off, so a soft patch marks where they stand.
        const patch = new THREE.Mesh(contactGeo, contactMat);
        patch.rotation.x = -Math.PI / 2; patch.position.y = 0.006; patch.renderOrder = 1; f.add(patch);
        f.userData.id = actor.id;
        f.userData.child = Boolean(actor.child);
        f.userData.appearanceKey = JSON.stringify(actor.appearance);
        f.userData.label = textSprite(actor.name, false);
        f.userData.label.userData.reach = 14; f.userData.label.userData.size = 0.105;
        names.add(f.userData.label);
        figures.set(actor.id, f); people.add(f);
      }
      let x = p.x, z = p.y;
      if (!p.moving) {
        const key = Math.round(x * 2) + ',' + Math.round(z * 2), n = crowd.get(key) || 0;
        crowd.set(key, n + 1);
        if (n) { x += Math.cos(n * 2.4) * 0.3 * Math.sqrt(n); z += Math.sin(n * 2.4) * 0.3 * Math.sqrt(n); }
      }
      const y = isWater(map, x, z, 0.5) ? 0.25 : ground(x, z) + 0.012;
      f.position.set(x, y, z);
      drawnAt.set(actor.id, { ...p, x, y: z });
      const scale = residentScale(actor);
      f.scale.setScalar(scale);
      // Someone at home is indoors. Their smoke and lit window stand in for them.
      f.visible = !indoors(actor);
      f.userData.label.userData.hidden = !f.visible && actor.id !== selectedId;
      const activity = residentActivity(actor, p.moving);
      const heading = activity.working && activity.job === 'fish' ? p.heading : workHeading(p, activity, parish.common);
      let turn = -heading - f.rotation.y;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      f.rotation.y += turn * Math.min(1, dt * 8);
      poseFigure(f, { ...activity, moving: p.moving, gone: p.gone, now, dt, still: calm.matches });
      // The name of someone indoors hangs over the window that stands in for them.
      const home = f.visible ? null : windowOf(actor.action.target);
      if (home) f.userData.label.position.set(home.x, home.y + 0.48, home.z);
      else f.userData.label.position.set(x, y + 0.56 * scale, z);
      f.userData.label.userData.always = actor.id === selectedId;
      if (actor.id === selectedId) followed = { x, y, z, heading: p.heading, moving: p.moving, at: p.moving ? null : actor.action.target, home };
    });
    for (const [id, f] of figures) if (!actors.some(a => a.id === id)) { people.remove(f); names.remove(f.userData.label); figures.delete(id); }
    if (hold) {
      // Held on a place, the view keeps it in the middle and drifts slowly round it.
      const goal = new THREE.Vector3(hold.x, ground(hold.x, hold.z) + 0.5, hold.z);
      if (!look.ready || look.target.distanceTo(goal) > 40) { look.target.copy(goal); look.ready = true; }
      else look.target.lerp(goal, Math.min(1, dt * 2.5));
      if (now - look.touched > 3500 && !calm.matches) look.yaw += dt * 0.045;
      ringMark.visible = windowMark.visible = false;
      followed = null;
    } else if (followed) {
      const goal = new THREE.Vector3(followed.x, followed.y + 0.36, followed.z);
      if (!look.ready || look.target.distanceTo(goal) > 40) { look.target.copy(goal); look.ready = true; look.yaw = followed.heading + Math.PI; }
      else look.target.lerp(goal, Math.min(1, dt * 5));
      // Left alone, the view settles in behind whoever it follows.
      if (followed.moving && now - look.touched > 3500) {
        let d = followed.heading + Math.PI - look.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        look.yaw += d * Math.min(1, dt * 0.9);
      }
      const home = followed.home;
      ringMark.visible = !home; windowMark.visible = Boolean(home);
      if (home) { windowMark.position.set(home.x, home.y, home.z); windowMark.lookAt(home.x + home.nx, home.y, home.z + home.nz); }
      else ringMark.position.set(followed.x, followed.y + 0.02, followed.z);
    } else ringMark.visible = windowMark.visible = false;
    // A resident at a door has that building at their back. If the camera would sit behind its
    // wall, it swings round to the open side unless the visitor is steering.
    const at = hold ? hold.id : followed?.at, own = at && solids.find(b => b.id === at);
    if (own && !drag) {
      const flat = Math.cos(look.pitch);
      let behind = false;
      for (let s = 0.4; s < Math.min(look.dist, 4) && !behind; s += 0.2) {
        const dx = look.target.x + flat * Math.cos(look.yaw) * s - own.x, dz = look.target.z + flat * Math.sin(look.yaw) * s - own.y;
        behind = look.target.y + Math.sin(look.pitch) * s < own.top && Math.abs(dx * own.c + dz * own.s) < own.hw && Math.abs(-dx * own.s + dz * own.c) < own.hd;
      }
      if (behind) {
        let turn = Math.atan2(look.target.z - own.y, look.target.x - own.x) - look.yaw;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        look.yaw += turn * Math.min(1, dt * 2.5);
      }
    }
    const cp = Math.cos(look.pitch), dir = [cp * Math.cos(look.yaw), Math.sin(look.pitch), cp * Math.sin(look.yaw)];
    // Pull the camera in rather than let a wall or roof come between it and the resident.
    let reach = look.dist;
    for (let s = 0.5; s < look.dist; s += 0.25) {
      if (inside(look.target.x + dir[0] * s, look.target.y + dir[1] * s, look.target.z + dir[2] * s, at)) { reach = Math.max(0.45, s - 0.3); break; }
    }
    look.reach = look.reach === undefined ? reach : reach < look.reach ? reach : mix(look.reach, reach, Math.min(1, dt * 3));
    camera.position.set(look.target.x + look.reach * dir[0], look.target.y + look.reach * dir[1], look.target.z + look.reach * dir[2]);
    camera.position.y = Math.max(camera.position.y, ground(camera.position.x, camera.position.z) + 0.16);
    camera.lookAt(look.target);
    for (const s of names.children) {
      const d = s.position.distanceTo(camera.position);
      s.visible = !s.userData.hidden && (s.userData.always || d < s.userData.reach);
      // Names keep a steady size on screen: they shrink as the camera closes in and grow as it pulls away.
      const size = s.userData.size * (s.userData.reach > 20 ? Math.max(0.42, d / 11) : Math.max(0.3, d / 5));
      s.scale.set(size * s.userData.aspect, size, 1);
    }
    for (const g of posted.children) {
      const { note, pennant, ripple, newest, key } = g.userData, d = g.position.distanceTo(camera.position), held = hold?.key === key;
      const size = note.userData.size * Math.max(0.42, d / 7);
      note.visible = held || d < note.userData.reach;
      note.scale.set(size * note.userData.aspect, size, 1);
      // A note rides higher as the camera draws back, so it clears the roofs.
      note.position.y = 0.95 + Math.min(1.6, d * 0.035);
      pennant.rotation.y = calm.matches ? 0.3 : Math.sin(now / 420 + g.position.x) * 0.5;
      // News under a quarter of an hour old, and the note being read, send a ripple over the ground.
      const beat = held || clock - newest < 15 ? (calm.matches ? 0.5 : (now / 1700) % 1) : -1;
      ripple.visible = beat >= 0;
      if (ripple.visible) { ripple.scale.setScalar(0.25 + beat * 0.9); ripple.material.opacity = 0.75 * (1 - beat); }
    }
    const animalTime = calm.matches ? 0 : now;
    moveAnimals(sheepModels, visibleSheep(parish, world), animalTime);
    moveAnimals(cattleModels, cattle, animalTime);
    movePets(now, dt);
    moveCarts(now, dt);
    moveVisitors(now, dt);
    moveRicks();
    for (const wheel of wheels) wheel.rotation.z += dt * 0.7 * wheel.userData.spin;
    sky(now, dt);
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  }
  function start() { if (!frame && active && map) { last = performance.now(); frame = requestAnimationFrame(render); } }
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  const canvas = renderer.domElement, pointers = new Map(), ray = new THREE.Raycaster();
  // The wheel belongs to the page until the view has been pressed.
  let drag = null, engaged = false;
  const span = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
  function down(e) {
    engaged = true;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    drag = { x: e.clientX, y: e.clientY, yaw: look.yaw, pitch: look.pitch, far: false, pinch: pointers.size === 2 ? span() : 0, dist: look.dist };
  }
  function move(e) {
    if (!pointers.has(e.pointerId) || !drag) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    look.touched = performance.now();
    if (pointers.size === 2 && drag.pinch) { look.dist = Math.min(90, Math.max(0.9, drag.dist * drag.pinch / span())); drag.far = true; return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.far && Math.hypot(dx, dy) < 5) return;
    drag.far = true;
    look.yaw = drag.yaw + dx * 0.006;
    look.pitch = Math.min(1.45, Math.max(0.02, drag.pitch + dy * 0.005));
  }
  function up(e) {
    const tapped = drag && !drag.far && pointers.size === 1;
    pointers.delete(e.pointerId);
    if (!pointers.size) drag = null;
    if (!tapped) return;
    const rect = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), camera);
    // Figures are small, so pick whichever one the click passes closest to.
    let best = null, gap = 0.45;
    for (const f of figures.values()) {
      const d = ray.ray.distanceToPoint(new THREE.Vector3(f.position.x, f.position.y + 0.25, f.position.z));
      if (d < gap) { gap = d; best = f; }
    }
    if (best) { onSelect?.(best.userData.id); return; }
    // Failing a resident, a note: it is flat to the screen, so the click is tried against its outline there.
    const px = e.clientX - rect.left, py = e.clientY - rect.top, foot = new THREE.Vector3(), head = new THREE.Vector3();
    for (const g of posted.children) {
      const note = g.userData.note;
      if (!note.visible) continue;
      note.getWorldPosition(foot); head.copy(foot); head.y += note.scale.y;
      foot.project(camera); head.project(camera);
      if (foot.z > 1) continue;
      const x = (foot.x + 1) / 2 * rect.width, bottom = (1 - foot.y) / 2 * rect.height, top = (1 - head.y) / 2 * rect.height, half = (bottom - top) * note.userData.aspect / 2;
      if (px > x - half && px < x + half && py > top && py < bottom) { onNote?.({ ...g.userData, note: undefined, pennant: undefined, ripple: undefined }); return; }
    }
  }
  function wheel(e) {
    if (!engaged && !e.ctrlKey) return;
    e.preventDefault();
    look.dist = Math.min(90, Math.max(0.9, look.dist * Math.exp(e.deltaY * 0.0014)));
    look.touched = performance.now();
  }
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('pointerleave', () => { engaged = false; });
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  const visible = () => { if (!document.hidden) start(); };
  document.addEventListener('visibilitychange', visible);

  return {
    setMap(next) {
      if (sameGround(map, next)) return;
      const newTerrain = !map || map.seed !== next.seed || map.w !== next.w || map.h !== next.h
        || JSON.stringify(map.terrain) !== JSON.stringify(next.terrain);
      map = next;
      if (newTerrain) {
        for (const [key, entry] of scenery) removeScenery(key, entry);
        buildLand();
        postedKey = '';
      }
      updateScenery();
      start();
    },
    update(rows, id, minute, motionMs, extras) {
      cold = extras?.coldHearths || [];
      world = extras?.world;
      updateParish();
      actors = (rows || []).filter(a => Number.isFinite(a.position?.x));
      for (const actor of actors) {
        const figure = figures.get(actor.id);
        if (!figure || (figure.userData.child === Boolean(actor.child) && figure.userData.appearanceKey === JSON.stringify(actor.appearance))) continue;
        people.remove(figure);
        names.remove(figure.userData.label);
        figures.delete(actor.id);
      }
      motion.update(actors, performance.now(), motionMs, extras?.liveTick);
      tick = extras?.liveTick ?? null;
      // extras.events are the latest chronicle entries that have a place, newest first, as on the map.
      marks = [];
      for (const e of extras?.events || []) {
        if (!e.place) continue;
        const key = Math.round(e.place.x) + ',' + Math.round(e.place.y);
        let m = marks.find(k => k.key === key);
        if (!m) marks.push(m = { key, x: e.place.x, y: e.place.y, id: e.place.id, events: [] });
        if (m.events.length < 3) m.events.push(e);
      }
      post();
      if (id !== selectedId) look.touched = -1e9;
      selectedId = id;
      if (Number.isFinite(minute)) clock = minute;
    },
    setActive(on) { active = on; if (on) { resize(); start(); } },
    soundScene(now) {
      if (!active || !map || !wx || !look.ready) return null;
      const radius = Math.min(37, 6 + 0.66 * (look.reach ?? look.dist));
      return { map, weather: wx, actors, cattle, sheep: visibleSheep(parish, world), moving: id => motion.at(id, now)?.moving,
        listener: { x: look.target.x, y: look.target.z, rightX: Math.sin(look.yaw), rightY: -Math.cos(look.yaw), radius } };
    },
    // Holds the view on the place of a chronicle entry, or on any { place: { x, y, id } }, until it is
    // let go with hold(null). from gives a distance and a tilt to stand off at.
    hold(event, from) {
      const was = hold;
      if (!event?.place) {
        hold = null;
        if (was?.before && look.touched < was.since) Object.assign(look, was.before);
      } else {
        const { x, y, id } = event.place;
        const [sx, sz] = map ? outside(x, y) : [x, y];
        hold = { x, z: y, id, key: Math.round(sx) + ',' + Math.round(sz), since: performance.now(), before: was?.before ?? { dist: look.dist, pitch: look.pitch },
          event: event.text ? event : null, mark: { x, y, id, events: [event] } };
        look.dist = from?.dist ?? Math.min(9, Math.max(6, look.dist)); look.pitch = from?.pitch ?? Math.max(0.36, look.pitch);
        look.touched = -1e9;
      }
      post();
    },
    get holding() { return Boolean(hold); },
    scene,
    // For tools that want a still picture at a chosen distance and angle.
    frameFrom(dist, pitch, yaw) { look.dist = dist; look.pitch = pitch; if (yaw !== undefined) look.yaw = yaw; look.touched = performance.now() + 1e7; },
    destroy() {
      active = false; cancelAnimationFrame(frame); observer.disconnect();
      document.removeEventListener('visibilitychange', visible);
      for (const [key, entry] of scenery) removeScenery(key, entry);
      for (const child of land.children) child.material.dispose();
      dispose(scene); gardenMaterial?.dispose(); furrows?.dispose(); renderer.dispose(); canvas.remove();
    },
  };
}

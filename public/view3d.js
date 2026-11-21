// The walking view: the same stored map, raised into low-poly ground, buildings and trees,
// seen from just behind whichever resident is selected.
import * as THREE from '/vendor/three.module.min.js';
import { heightAt, isWater, WATER_LEVEL } from '/engine/terrain.mjs';
import { hash2, rng, fbm, TAU } from '/engine/geom.mjs';
import { createMotion } from '/motion.js';
import { villageColors, chains } from '/map.js';
import { makeFigure, poseFigure } from '/figure.js';
import { light, hearths, indoors, yearLook, skyOver, blend } from '/ambient.js';

const roofs = ['#a57456', '#a88c5d', '#aa7352', '#90907a', '#9c8259', '#b19769', '#a17c58', '#a96e50'];
const fieldTones = ['#c4b77e', '#cbbd87', '#c4b07c', '#b9b18a', '#c7bc8c', '#c9b67c'];
const WIDTH = { road: 0.98, bridge: 0.98, lane: 0.66, path: 0.34, track: 0.22 };
const tag = id => { let h = 0; for (const ch of id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0; return h; };
const mix = (a, b, t) => a + (b - a) * t;

const materials = new Map();
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
function dispose(group) {
  group.traverse(o => {
    if (o.geometry !== contactGeo) o.geometry?.dispose();
    if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); }
  });
  group.clear();
}

const contactGeo = new THREE.CircleGeometry(0.115, 14);
const contactMat = new THREE.MeshBasicMaterial({ color: '#2b2618', transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

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
  const tall = p.kind === 'hall' ? 0.85 : p.kind === 'mill' ? 0.95 : p.kind === 'granary' ? 0.7 : p.kind === 'alehouse' ? 0.75 : 0.62;
  const rise = p.kind === 'granary' ? 0.75 : p.kind === 'hall' ? 0.8 : 0.6;
  const lift = p.kind === 'granary' ? 0.22 : 0;
  if (p.stage === 1) {
    // The frame stands: posts, plates, and bare rafters waiting for thatch.
    for (let x = -w / 2; x <= w / 2 + 0.01; x += w / Math.max(2, Math.round(w / 0.9))) {
      for (const z of [-d / 2, d / 2]) g.add(box(0.07, tall, 0.07, '#a98a5d', x, tall / 2, z));
      for (const s of [-1, 1]) {
        const rafter = box(0.05, Math.hypot(d / 2, rise), 0.05, '#a98a5d', x, tall + rise / 2, s * d / 4);
        rafter.rotation.x = s * Math.atan2(d / 2, rise);
        g.add(rafter);
      }
    }
    g.add(box(w + 0.1, 0.07, 0.07, '#a98a5d', 0, tall, -d / 2), box(w + 0.1, 0.07, 0.07, '#a98a5d', 0, tall, d / 2), box(w + 0.1, 0.06, 0.06, '#a98a5d', 0, tall + rise, 0));
    g.add(box(0.07, 0.07, d, '#a98a5d', -w / 2, tall, 0), box(0.07, 0.07, d, '#a98a5d', w / 2, tall, 0));
    return g;
  }
  const wall = p.kind === 'mill' ? '#d8c9a4' : p.kind === 'granary' ? '#b99a6b' : p.kind === 'hall' ? '#dccb9f' : '#e6d5a8';
  const top = p.kind === 'hall' ? '#8e7459' : p.kind === 'mill' ? '#9b7858' : p.kind === 'granary' ? '#a8935f' : p.kind === 'alehouse' ? '#9a6a4c' : roofs[h % roofs.length];
  const bw = p.kind === 'oven' ? w * 0.58 : w, bx = p.kind === 'oven' ? -w * 0.21 : 0;
  g.add(box(bw, tall + 0.6, d, wall, bx, lift + tall / 2 - 0.3, 0));
  if (lift) for (const x of [-w / 2 + 0.25, 0, w / 2 - 0.25]) for (const z of [-d / 2 + 0.2, d / 2 - 0.2]) g.add(box(0.22, lift + 0.5, 0.22, '#aaa290', x, lift / 2 - 0.25, z));
  for (const x of [-bw / 2, bw / 2]) for (const z of [-d / 2, d / 2]) g.add(box(0.09, tall, 0.09, timber, bx + x, lift + tall / 2, z));
  g.add(box(bw + 0.05, 0.07, d + 0.05, timber, bx, lift + tall - 0.03, 0));
  if (p.kind !== 'granary') g.add(box(bw + 0.04, 0.05, d + 0.04, timber, bx, lift + tall * 0.5, 0));
  g.add(roof(bw, d, rise, top, lift + tall));
  const doorH = Math.min(0.46, tall * 0.72);
  g.add(box(p.kind === 'hall' ? 0.5 : 0.26, doorH, 0.05, '#4c3b29', bx + (p.kind === 'oven' ? 0 : along), lift + doorH / 2, side * d / 2));
  for (const s of [-1, 1]) {
    const x = bx + (p.kind === 'oven' ? 0 : along) + s * Math.min(0.8, bw * 0.3);
    if (Math.abs(x - bx) > bw / 2 - 0.2 || p.kind === 'granary') continue;
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.04), glow);
    pane.position.set(x, lift + tall * 0.62, side * (d / 2 + 0.005));
    g.add(pane);
  }
  if (p.kind === 'cottage' || p.kind === 'alehouse' || p.kind === 'hall') g.add(box(0.2, rise + 0.25, 0.2, '#8f8672', bw * 0.28, lift + tall + rise * 0.55, -side * d * 0.12));
  if (p.kind === 'alehouse') { g.add(box(0.05, 0.9, 0.05, timber, -w / 2 - 0.25, 0.45, side * (d / 2 + 0.3)), box(0.42, 0.26, 0.04, '#c9a45c', -w / 2 - 0.25, 0.75, side * (d / 2 + 0.3))); }
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

export function createWalk(container, onSelect) {
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
  // A few flat-bottomed clouds drift east, high over the parish.
  const clouds = new THREE.Group(), puff = new THREE.IcosahedronGeometry(1, 1), cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, flatShading: true });
  const drift = rng(31);
  for (let i = 0; i < 11; i++) {
    const cloud = new THREE.Group();
    for (let j = 0, n = 3 + Math.floor(drift() * 4); j < n; j++) {
      const ball = new THREE.Mesh(puff, cloudMat), r = 5 + drift() * 6;
      ball.position.set((j - n / 2) * 6 + drift() * 3, drift() * 2, drift() * 6 - 3); ball.scale.set(r, r * 0.42, r * 0.8);
      cloud.add(ball);
    }
    cloud.position.set(-260 + drift() * 680, 46 + drift() * 26, -200 + drift() * 520);
    cloud.userData.speed = 0.5 + drift() * 0.7;
    clouds.add(cloud);
  }
  scene.add(clouds);
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

  const motion = createMotion();
  const figures = new Map(), wheels = [];
  let solids = [], grid = null, shadowSpan = 0;
  let map = null, terrainSeed = null, actors = [], selectedId = null, active = false, frame = 0, last = 0, clock = 600;
  // The weather now, the houses with no fire today, and the parts of the scene the season recolours.
  let wx = null, cold = [], seasonKey = '';
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
    dispose(land);
    const margin = 64, cell = 1.5, nx = Math.ceil((map.w + margin * 2) / cell), nz = Math.ceil((map.h + margin * 2) / cell);
    grid = { margin, cell, nx, nz, y: new Float32Array((nx + 1) * (nz + 1)) };
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3), col = new Float32Array(pos.length), index = [];
    const grass = new THREE.Color('#9fb267'), dry = new THREE.Color('#c8c486'), lush = new THREE.Color('#7c9a54'), mud = new THREE.Color('#b9ad88'), bed = new THREE.Color('#8d9a84'), c = new THREE.Color();
    for (let j = 0, k = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++, k += 3) {
        const x = -margin + i * cell, z = -margin + j * cell, y = heightAt(map, x, z);
        pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
        grid.y[k / 3] = y;
        const tone = fbm(map.seed + 19, x / 17, z / 17);
        c.copy(grass).lerp(tone > 0.5 ? dry : lush, Math.abs(tone - 0.5) * 1.5);
        if (y < 0.14) c.lerp(mud, Math.min(1, (0.14 - y) * 6));
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
    dressed.land = ground; dressed.base = col.slice(); dressed.wet = grid.y.map(y => y < WATER_LEVEL ? 1 : 0); seasonKey = '';
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
    const m = new THREE.Mesh(g, mat(color, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
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
  let furrows = null;
  function furrowTexture() {
    if (furrows) return furrows;
    const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 64;
    const c = canvas.getContext('2d');
    for (let y = 0; y < 64; y += 4) { c.fillStyle = (y / 4) % 2 ? '#ffffff' : '#c9c0a0'; c.fillRect(0, y, 8, 4); }
    furrows = new THREE.CanvasTexture(canvas);
    furrows.colorSpace = THREE.SRGBColorSpace; furrows.magFilter = THREE.NearestFilter;
    return furrows;
  }

  function buildVillage() {
    dispose(built); dispose(names); wheels.length = 0;
    dressed.fields = []; dressed.crownTones = []; dressed.coneTones = []; seasonKey = '';
    solids = map.places.filter(p => p.w && p.kind !== 'field' && p.stage === 2).map(p => ({
      id: p.id, x: p.x, y: p.y, c: Math.cos(p.a), s: Math.sin(p.a), hw: p.w / 2 + 0.3, hd: p.d / 2 + 0.3, top: heightAt(map, p.x, p.y) + 1.75,
    }));
    for (const way of chains(map)) {
      const pts = way.pts;
      built.add(ribbon(pts, WIDTH[way.kind], way.kind === 'road' ? '#dccaa2' : way.kind === 'lane' ? '#d6c39b' : '#cbbb92', way.kind === 'road' ? 0.022 : way.kind === 'lane' ? 0.02 : 0.016));
    }
    for (const [a, b, kind] of map.edges) {
      if (kind !== 'bridge') continue;
      const A = map.nodes[a], B = map.nodes[b], len = Math.hypot(B[0] - A[0], B[1] - A[1]), angle = Math.atan2(B[1] - A[1], B[0] - A[0]);
      const span = new THREE.Group();
      span.position.set((A[0] + B[0]) / 2, 0.2, (A[1] + B[1]) / 2); span.rotation.y = -angle;
      span.add(box(len + 0.8, 0.1, 1.3, '#a98c63', 0, 0, 0), box(len + 0.8, 0.07, 0.07, '#6b5a43', 0, 0.36, 0.62), box(len + 0.8, 0.07, 0.07, '#6b5a43', 0, 0.36, -0.62));
      for (let x = -len / 2; x <= len / 2 + 0.01; x += len / 3) for (const z of [0.62, -0.62]) span.add(box(0.09, 1.1, 0.09, '#6b5a43', x, -0.15, z));
      built.add(span);
    }
    for (const p of map.places) {
      if (p.kind === 'green') {
        const disc = { x: p.x, y: p.y, w: p.rx * 2, d: p.ry * 2, a: p.a };
        // The green and each field get a material of their own, so the season can recolour them.
        const m = draped(disc, '#b3c08a', 0.012);
        m.material = m.material.clone(); dressed.green = m;
        const pos = m.geometry.attributes.position, c = Math.cos(p.a), s = Math.sin(p.a);
        // Pull the corners of the draped sheet in to an ellipse.
        for (let i = 0; i < pos.count; i++) {
          const dx = pos.getX(i) - p.x, dz = pos.getZ(i) - p.y, u = (dx * c + dz * s) / p.rx, v = (-dx * s + dz * c) / p.ry, r = Math.hypot(u, v);
          if (r > 1) { const x = p.x + (u / r * p.rx) * c - (v / r * p.ry) * s, z = p.y + (u / r * p.rx) * s + (v / r * p.ry) * c; pos.setXYZ(i, x, ground(x, z) + 0.012, z); }
        }
        built.add(m);
      } else if (p.kind === 'field') {
        if (p.stage === 0) {
          const c = Math.cos(p.a), s = Math.sin(p.a);
          for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const x = p.x + u * p.w / 2 * c - v * p.d / 2 * s, z = p.y + u * p.w / 2 * s + v * p.d / 2 * c; built.add(box(0.06, 0.4, 0.06, '#7a6548', x, ground(x, z) + 0.2, z)); }
        } else {
          const tone = p.stage === 1 ? '#b9a67c' : fieldTones[tag(p.id) % fieldTones.length];
          const m = draped(p, tone, 0.016, p.stage === 2 ? furrowTexture() : null);
          if (p.stage === 2) { m.material = m.material.clone(); dressed.fields.push({ mesh: m, tone }); }
          built.add(m);
        }
      } else if (p.kind !== 'wood') {
        const g = buildPlace(p, map, glow);
        if (g.userData.wheel) wheels.push(g.userData.wheel);
        built.add(g);
      }
      if (p.name && p.kind !== 'field' && p.kind !== 'wood' && p.kind !== 'green') {
        const sprite = textSprite(p.stage < 2 ? p.name + ' (building)' : p.name);
        sprite.position.set(p.x, heightAt(map, p.x, p.y) + (p.kind === 'well' ? 1.5 : 2.3), p.y);
        sprite.userData.reach = 46; sprite.userData.size = 0.34;
        names.add(sprite);
      }
    }
    // Trees, with a ring of distant woods beyond the mapped parish so the horizon is not bare.
    const trees = map.trees.slice(), rand = rng(map.seed + 41);
    for (let i = 0; i < 2600; i++) {
      const x = -60 + rand() * (map.w + 120), z = -60 + rand() * (map.h + 120), size = 0.7 + rand() * 0.6, pine = rand() < 0.5;
      if (x > 2 && z > 2 && x < map.w - 2 && z < map.h - 2) continue;
      if (fbm(map.seed + 31, x / 26, z / 26) < 0.47 || heightAt(map, x, z) < 0.12) continue;
      trees.push([x, z, size, pine ? 1 : 0]);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.06, 0.09, 0.6, 5), leafGeo = new THREE.IcosahedronGeometry(1, 0), pineGeo = new THREE.ConeGeometry(0.62, 1.9, 6);
    const trunks = new THREE.InstancedMesh(trunkGeo, mat('#6b5a44'), trees.length);
    const leafy = trees.filter(t => !t[3]), piney = trees.filter(t => t[3]);
    const crowns = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ flatShading: true }), leafy.length);
    const cones = new THREE.InstancedMesh(pineGeo, new THREE.MeshLambertMaterial({ flatShading: true }), piney.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), tint = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
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
    for (const mesh of [trunks, crowns, cones]) { mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; built.add(mesh); }
  }

  // Recolours the land for the day of the year and for lying snow. Called when either changes.
  function dress() {
    const year = yearLook(clock), snow = Math.round(wx.lying * 4) / 4, WHITE = '#f4f5f2';
    const snowed = (hex, k = 0.85) => snow ? blend(hex, WHITE, snow * k) : hex;
    if (dressed.land) {
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
  function precipitation(now) {
    rain.visible = wx.rain > 0; snowfall.visible = wx.snow > 0;
    if (!rain.visible && !snowfall.visible) return;
    const wrap = (v, span) => ((v % span) + span) % span;
    const ox = camera.position.x - SPAN / 2, oy = camera.position.y - TALL * 0.35, oz = camera.position.z - SPAN / 2, t = now / 1000;
    if (rain.visible) {
      const a = rain.geometry.attributes.position.array, n = Math.round(DROPS * (0.3 + 0.7 * wx.rain));
      for (let i = 0; i < n; i++) {
        const x = ox + wrap(dropAt[i * 3] - ox + t * 1.6, SPAN), y = oy + wrap(dropAt[i * 3 + 1] - oy - t * 13, TALL), z = oz + wrap(dropAt[i * 3 + 2] - oz, SPAN);
        a[i * 6] = x; a[i * 6 + 1] = y; a[i * 6 + 2] = z; a[i * 6 + 3] = x + 0.05; a[i * 6 + 4] = y - 0.42; a[i * 6 + 5] = z;
      }
      rain.geometry.setDrawRange(0, n * 2); rain.geometry.attributes.position.needsUpdate = true;
    } else {
      const a = snowfall.geometry.attributes.position.array, n = Math.round(FLAKES * (0.3 + 0.7 * wx.snow));
      for (let i = 0; i < n; i++) {
        a[i * 3] = ox + wrap(flakeAt[i * 3] - ox + t * 0.35 + Math.sin(t * 0.9 + i) * 0.25, SPAN);
        a[i * 3 + 1] = oy + wrap(flakeAt[i * 3 + 1] - oy - t * (0.9 + (i % 5) * 0.12), TALL);
        a[i * 3 + 2] = oz + wrap(flakeAt[i * 3 + 2] - oz, SPAN);
      }
      snowfall.geometry.setDrawRange(0, n); snowfall.geometry.attributes.position.needsUpdate = true;
    }
  }

  function sky(now, dt) {
    wx = skyOver(clock, map.seed);
    const key = Math.floor(clock / 1440) + ':' + Math.round(wx.lying * 4);
    if (key !== seasonKey) { seasonKey = key; dress(); }
    const L = light(clock), lit = hearths(map, actors, cold);
    // Cloud greys the sky and the light. Rain and snow close the distance in.
    const murk = Math.max(wx.cloud * 0.75, wx.rain, wx.snow * 0.9), wet = Math.max(wx.rain, wx.snow);
    const grey = col('#1b2130').lerp(col('#aeb6ba'), L.bright);
    const top = col('#0a1230').lerp(col('#4c78ba'), L.bright).lerp(col('#6c6aa6'), L.dusk * 0.45).lerp(grey, murk * 0.85);
    const horizon = col('#263459').lerp(col('#cfe3ec'), L.bright).lerp(col('#f4b07a'), L.dusk * 0.8 * (1 - murk * 0.7)).lerp(grey, murk * 0.6);
    dome.material.uniforms.top.value.copy(top); dome.material.uniforms.horizon.value.copy(horizon);
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
    if (L.day > 0) { sun.position.copy(sunWay); sun.color.copy(col('#ffb877').lerp(col('#fff4dc'), 1 - L.dusk)); sun.intensity = (0.7 + 2.5 * L.bright) * (1 - murk * 0.7); }
    else { sun.position.copy(moonWay); sun.color.set('#9fb6ee'); sun.intensity = 1.25 * (1 - murk * 0.6); }
    hemi.color.copy(col('#8094cc').lerp(col('#f3f1e4'), L.bright).lerp(col('#c4cace'), murk * 0.5 * L.bright));
    hemi.groundColor.copy(col('#2c3554').lerp(col('#8f8a66'), L.bright).lerp(col('#d9dcd8'), wx.lying * 0.6 * L.bright));
    hemi.intensity = 1.0 + 0.45 * L.bright + 0.25 * murk * L.bright;
    const nightly = Math.max(0, Math.min(1, (L.dark - 0.2) * 1.5));
    glow.emissiveIntensity = 1.15 * nightly;
    cloudMat.opacity = 0.9 - 0.35 * L.dark;
    cloudMat.color.copy(col('#ffffff').lerp(col('#9aa2a8'), murk * 0.8));
    clouds.visible = wx.cloud > 0.12;
    precipitation(now);
    for (const cloud of clouds.children) { cloud.position.x += cloud.userData.speed * dt; if (cloud.position.x > 430) cloud.position.x = -270; }
    // Smoke rises from every hearth with someone at it, and its window glows after dark.
    let n = 0;
    lit.forEach((p, i) => {
      const side = (p.at[0] - p.x) * -Math.sin(p.a) + (p.at[1] - p.y) * Math.cos(p.a) > 0 ? 1 : -1;
      const base = heightAt(map, p.x, p.y), cx = p.x + Math.cos(p.a) * p.w * 0.28, cz = p.y + Math.sin(p.a) * p.w * 0.28;
      for (let j = 0; j < 5 && n < 240; j++) {
        const f = (now * 0.00012 + j / 5 + (i % 7) / 7) % 1, size = (0.07 + f * 0.3) * (1 - f * f);
        puffAt.compose(puffPos.set(cx + f * 1.5 + Math.sin(f * 6 + j) * 0.12, base + 1.5 + f * 2.6, cz - f * 0.7), puffTurn, puffSize.set(size, size, size));
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
    actors.forEach((actor, index) => {
      const p = motion.at(actor.id, now);
      if (!p) return;
      let f = figures.get(actor.id);
      if (!f) {
        f = makeFigure(actor, index);
        // The sun's shadow is too coarse to reach the feet from far off, so a soft patch marks where they stand.
        const patch = new THREE.Mesh(contactGeo, contactMat);
        patch.rotation.x = -Math.PI / 2; patch.position.y = 0.006; patch.renderOrder = 1; f.add(patch);
        f.userData.id = actor.id;
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
      // Someone at home is indoors. Their smoke and lit window stand in for them.
      f.visible = !indoors(actor);
      f.userData.label.userData.hidden = !f.visible && actor.id !== selectedId;
      let turn = -p.heading - f.rotation.y;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      f.rotation.y += turn * Math.min(1, dt * 8);
      const working = !p.moving && actor.action.phase === 'working' && actor.action.kind === 'work';
      poseFigure(f, { moving: p.moving, gone: p.gone, now, dt, kind: actor.action.kind, job: actor.action.job, working });
      f.userData.label.position.set(x, y + 0.56 + (crowd.size % 2) * 0, z);
      f.userData.label.userData.always = actor.id === selectedId;
      if (actor.id === selectedId) followed = { x, y, z, heading: p.heading, moving: p.moving, at: p.moving ? null : actor.action.target };
    });
    for (const [id, f] of figures) if (!actors.some(a => a.id === id)) { people.remove(f); names.remove(f.userData.label); figures.delete(id); }
    if (followed) {
      const goal = new THREE.Vector3(followed.x, followed.y + 0.36, followed.z);
      if (!look.ready || look.target.distanceTo(goal) > 40) { look.target.copy(goal); look.ready = true; look.yaw = followed.heading + Math.PI; }
      else look.target.lerp(goal, Math.min(1, dt * 5));
      // Left alone, the view settles in behind whoever it follows.
      if (followed.moving && now - look.touched > 3500) {
        let d = followed.heading + Math.PI - look.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        look.yaw += d * Math.min(1, dt * 0.9);
      }
      ringMark.visible = true; ringMark.position.set(followed.x, followed.y + 0.02, followed.z);
    } else ringMark.visible = false;
    // A resident at a door has that building at their back. If the camera would sit behind its
    // wall, it swings round to the open side unless the visitor is steering.
    const own = followed?.at && solids.find(b => b.id === followed.at);
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
      if (inside(look.target.x + dir[0] * s, look.target.y + dir[1] * s, look.target.z + dir[2] * s, followed?.at)) { reach = Math.max(0.45, s - 0.3); break; }
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
    if (best) onSelect?.(best.userData.id);
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
      const fresh = terrainSeed !== next.seed;
      map = next; terrainSeed = next.seed;
      if (fresh) buildLand();
      buildVillage();
      start();
    },
    update(rows, id, minute, motionMs, extras) {
      cold = extras?.coldHearths || [];
      actors = (rows || []).filter(a => Number.isFinite(a.position?.x));
      motion.update(actors, performance.now(), motionMs, extras?.liveTick);
      if (id !== selectedId) look.touched = -1e9;
      selectedId = id;
      if (Number.isFinite(minute)) clock = minute;
    },
    setActive(on) { active = on; if (on) { resize(); start(); } },
    scene,
    // For tools that want a still picture at a chosen distance and angle.
    frameFrom(dist, pitch, yaw) { look.dist = dist; look.pitch = pitch; if (yaw !== undefined) look.yaw = yaw; look.touched = performance.now() + 1e7; },
    destroy() {
      active = false; cancelAnimationFrame(frame); observer.disconnect();
      document.removeEventListener('visibilitychange', visible);
      dispose(scene); renderer.dispose(); canvas.remove();
    },
  };
}

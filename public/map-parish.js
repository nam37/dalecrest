import { animalCoats, animalPose, fenceSpans, logsIn } from './parish.js';
import { blend, PLAIN_LIGHT } from './ambient.js';

const tau = Math.PI * 2;

export function drawGarden(c, garden, year, snow, line) {
  const { x, y, w, d, a } = garden;
  c.save();
  c.translate(x, y); c.rotate(a);
  c.fillStyle = blend(blend('#ad9270', '#acaf77', year.lush), '#f5f4ec', snow * 0.76);
  c.fillRect(-w / 2, -d / 2, w, d);
  c.strokeStyle = '#75684999'; c.lineWidth = line * 0.74; c.beginPath();
  for (let u = -w / 2 + 0.26; u < w / 2 - 0.08; u += 0.37) {
    c.moveTo(u, -d * 0.37); c.lineTo(u, d * 0.37);
  }
  c.stroke(); c.restore();

  for (const [[ax, ay], [bx, by]] of fenceSpans(garden)) {
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by);
    c.strokeStyle = '#6d563a'; c.lineWidth = line * 1.36; c.stroke();
    c.strokeStyle = blend('#ad8c60', '#f5f4ec', snow * 0.7); c.lineWidth = line * 0.52; c.stroke();
    c.fillStyle = '#6c5035';
    for (const [px, py] of [[ax, ay], [bx, by]]) c.fillRect(px - line * 0.8, py - line * 0.8, line * 1.6, line * 1.6);
  }
}

export function drawWoodpile(c, pile, world, snow, toScreen, scale) {
  const count = logsIn(pile, world);
  if (!count) return;
  const [x, y] = toScreen(pile.x, pile.y);
  c.save(); c.translate(x, y); c.rotate(pile.a); c.scale(scale, scale);
  c.lineWidth = Math.max(0.04, 0.6 / scale);
  c.fillStyle = '#4b403539';
  c.fillRect(-pile.w * 0.43, -pile.d * 0.45, pile.w, pile.d * 1.1);
  const bark = blend('#9a7050', '#e8e5d7', snow * 0.7);
  for (let i = 0; i < count; i++) {
    const { u, v, height, length, radius } = pile.logs[i];
    const left = u - length / 2, top = v - radius - height * 0.46;
    c.fillStyle = bark;
    c.strokeStyle = '#5e4531'; c.fillRect(left, top, length, radius * 2); c.strokeRect(left, top, length, radius * 2);
    c.fillStyle = '#c7a278'; c.beginPath(); c.ellipse(left + length, top + radius, radius * 0.58, radius, 0, 0, tau); c.fill(); c.stroke();
  }
  c.restore();
}

// The shadow an animal throws: its own outline moved away from the light. Drawn about the animal's
// place on the sheet, before the sheet is turned to its heading.
export function animalShade(c, sun, heading, size, rx, ry) {
  if (sun.depth < 0.02) return;
  c.save();
  c.translate(-sun.toward[0] * sun.reach * size * 0.5, -sun.toward[1] * sun.reach * size * 0.5);
  c.rotate(heading);
  c.beginPath(); c.ellipse(0, 0, rx * size, ry * size, 0, 0, tau);
  c.fillStyle = 'rgba(74,69,44,' + (0.24 * sun.depth).toFixed(3) + ')'; c.fill();
  c.restore();
}

export function drawAnimal(c, animal, time, toScreen, scale, sun = PLAIN_LIGHT) {
  const { x, y, heading, graze } = animalPose(animal, time);
  const cattle = animal.kind === 'cattle';
  const [sx, sy] = toScreen(x, y), size = Math.max(cattle ? 5.5 : 3.8, scale * (cattle ? 0.44 : 0.25));
  const wool = animalCoats[animal.kind][animal.coat], face = cattle ? '#71523d' : '#665746';
  c.save(); c.translate(sx, sy);
  animalShade(c, sun, heading, size, 1, 0.55);
  c.rotate(heading); c.scale(size, size);
  const oval = (u, v, a, b, color, edge) => {
    c.beginPath(); c.ellipse(u, v, a, b, 0, 0, tau); c.fillStyle = color; c.fill();
    if (edge) { c.strokeStyle = edge; c.lineWidth = 0.15; c.stroke(); }
  };
  oval(0, 0, 0.91, cattle ? 0.52 : 0.58, wool, '#61543c');
  if (!cattle) {
    oval(-0.27, -0.17, 0.52, 0.29, blend(wool, '#fff9e3', 0.48));
    oval(0.15, 0.18, 0.44, 0.24, blend(wool, '#fff9e3', 0.32));
  } else {
    oval(-0.36, 0.12, 0.36, 0.34, blend(wool, '#60422d', 0.56));
  }
  const nose = 0.85 + graze * 0.19;
  for (const side of [-1, 1]) oval(nose - 0.11, side * 0.28, 0.16, 0.1, cattle ? '#dfc9a0' : face);
  oval(nose, 0, 0.32, 0.24, face);
  c.restore();
}

// A dog or cat seen from above, at its true size, with a lift of its legs as it trots. Lying down it
// curls up. pet comes from createPets in pets.js.
export function drawPet(c, pet, toScreen, scale, sun = PLAIN_LIGHT) {
  const dog = pet.kind === 'dog', [sx, sy] = toScreen(pet.x, pet.y), size = Math.max(dog ? 3 : 2.3, scale * (dog ? 0.17 : 0.11));
  const dark = blend(pet.coat, '#2a2219', 0.45), stride = pet.moving ? Math.sin(pet.gone * 14) : 0;
  c.save(); c.translate(sx, sy);
  animalShade(c, sun, pet.heading, size, pet.lying ? 0.7 : 1, 0.5);
  c.rotate(pet.heading); c.scale(size, size);
  const oval = (u, v, a, b, color, edge, turn = 0) => {
    c.beginPath(); c.ellipse(u, v, a, b, turn, 0, tau); c.fillStyle = color; c.fill();
    if (edge) { c.strokeStyle = edge; c.lineWidth = 0.14; c.stroke(); }
  };
  if (pet.lying) {
    // Curled round, nose to tail.
    oval(0, 0, 0.62, 0.48, pet.coat, '#3d3324');
    oval(0.34, 0.2, 0.26, 0.2, dark);
    c.strokeStyle = dark; c.lineWidth = dog ? 0.16 : 0.12; c.lineCap = 'round';
    c.beginPath(); c.arc(0, 0, 0.5, 0.6, 2.6); c.stroke();
  } else {
    // Legs show at the corners as it goes.
    for (const [u, v, s] of [[0.42, 0.32, 1], [0.42, -0.32, -1], [-0.42, 0.32, -1], [-0.42, -0.32, 1]]) oval(u + stride * s * 0.12, v, 0.1, 0.08, dark);
    oval(0, 0, 0.62, dog ? 0.3 : 0.26, pet.coat, '#3d3324');
    oval(0.7, 0, dog ? 0.26 : 0.22, dog ? 0.22 : 0.2, pet.coat, '#3d3324');
    for (const side of [-1, 1]) oval(dog ? 0.66 : 0.72, side * (dog ? 0.2 : 0.16), dog ? 0.12 : 0.07, 0.06, dark, null, side * 0.5);
    if (dog) oval(0.94, 0, 0.1, 0.08, dark);
    c.strokeStyle = pet.coat; c.lineWidth = dog ? 0.14 : 0.1; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-0.6, 0); c.quadraticCurveTo(-0.9, (dog ? 0.25 : 0.4) * (pet.moving ? Math.sin(pet.gone * 9) : 0.6), -1.05, dog ? 0.1 : 0.35); c.stroke();
  }
  c.restore();
}

// An ox from above, given where it stands and which way it faces, in the colour of a working ox.
export function drawOx(c, ox, toScreen, scale, sun = PLAIN_LIGHT) {
  const [sx, sy] = toScreen(ox.x, ox.y), size = Math.max(5.5, scale * 0.44), coat = '#6f4a33', face = '#4f3424';
  c.save(); c.translate(sx, sy);
  animalShade(c, sun, ox.heading, size, 1, 0.55);
  c.rotate(ox.heading); c.scale(size, size);
  const oval = (u, v, a, b, color, edge) => {
    c.beginPath(); c.ellipse(u, v, a, b, 0, 0, tau); c.fillStyle = color; c.fill();
    if (edge) { c.strokeStyle = edge; c.lineWidth = 0.15; c.stroke(); }
  };
  oval(0, 0, 0.91, 0.5, coat, '#3e2c1e');
  oval(-0.36, 0.12, 0.36, 0.32, blend(coat, '#3a2618', 0.5));
  const nose = 0.85 + (ox.graze || 0) * 0.19;
  // Horns, then the head.
  c.strokeStyle = '#e6d7b4'; c.lineWidth = 0.1; c.lineCap = 'round';
  c.beginPath(); c.moveTo(nose - 0.12, -0.18); c.quadraticCurveTo(nose - 0.05, -0.5, nose + 0.12, -0.46); c.moveTo(nose - 0.12, 0.18); c.quadraticCurveTo(nose - 0.05, 0.5, nose + 0.12, 0.46); c.stroke();
  oval(nose, 0, 0.32, 0.24, face);
  c.restore();
}

// A two-wheeled cart from above, its bed laden with a family's goods, shafts forward.
export function drawCart(c, cart, toScreen, scale, sun = PLAIN_LIGHT) {
  const [sx, sy] = toScreen(cart.x, cart.y), k = Math.max(2.5, scale);
  c.save(); c.translate(sx, sy);
  animalShade(c, sun, cart.heading, k, 0.6, 0.38);
  c.rotate(cart.heading); c.scale(k, k);
  c.lineWidth = 0.035; c.strokeStyle = '#3e3020';
  // Shafts reach forward to the yoke.
  c.beginPath(); c.moveTo(0.3, -0.18); c.lineTo(1.05, -0.12); c.moveTo(0.3, 0.18); c.lineTo(1.05, 0.12); c.stroke();
  // Wheels stand out at either side of the bed.
  c.fillStyle = '#4c3b29';
  for (const side of [-1, 1]) c.fillRect(-0.24, side * 0.3 - 0.04, 0.48, 0.08);
  c.fillStyle = '#9a7a52'; c.fillRect(-0.45, -0.26, 0.82, 0.52); c.strokeRect(-0.45, -0.26, 0.82, 0.52);
  // The load: sacks, a chest and a rolled bundle.
  const oval = (u, v, a, b, color) => { c.beginPath(); c.ellipse(u, v, a, b, 0, 0, tau); c.fillStyle = color; c.fill(); c.stroke(); };
  oval(-0.22, -0.1, 0.14, 0.1, '#d9cba3'); oval(-0.22, 0.12, 0.13, 0.1, '#cdbd94');
  c.fillStyle = '#6b4f33'; c.fillRect(0.02, -0.17, 0.26, 0.2); c.strokeRect(0.02, -0.17, 0.26, 0.2);
  oval(0.15, 0.15, 0.15, 0.06, '#b6a37c');
  c.restore();
}

// A duck on the water: a small boat-shaped body, the drake with a dark green head and the duck brown,
// with a little wake spreading behind while it paddles or drifts.
export function drawDuck(c, duck, toScreen, k, time) {
  const [x, y] = toScreen(duck.x, duck.y), s = Math.max(3.2, k * 0.2);
  c.save(); c.translate(x, y); c.rotate(duck.heading);
  c.strokeStyle = 'rgba(244,250,247,' + (duck.paddling ? 0.55 : 0.35).toFixed(2) + ')'; c.lineWidth = Math.max(0.6, s * 0.12);
  const spread = duck.paddling ? 1.3 : 0.9, run = time ? (time * 0.002) % 1 : 0.5;
  c.beginPath(); c.moveTo(-s * 0.7, -s * 0.25); c.lineTo(-s * (1.6 + run), -s * spread * (0.55 + run * 0.4));
  c.moveTo(-s * 0.7, s * 0.25); c.lineTo(-s * (1.6 + run), s * spread * (0.55 + run * 0.4)); c.stroke();
  c.fillStyle = duck.drake ? '#b8b4a6' : '#8f7556'; c.strokeStyle = '#3f3a2e'; c.lineWidth = Math.max(0.5, s * 0.1);
  c.beginPath(); c.ellipse(0, 0, s * 0.75, s * 0.42, 0, 0, Math.PI * 2); c.fill(); c.stroke();
  c.fillStyle = duck.drake ? '#2f5a3c' : '#7a6046';
  c.beginPath(); c.arc(s * 0.62, 0, s * 0.3, 0, Math.PI * 2); c.fill(); c.stroke();
  c.fillStyle = '#d9a63e'; c.beginPath(); c.moveTo(s * 0.86, -s * 0.09); c.lineTo(s * 1.12, 0); c.lineTo(s * 0.86, s * 0.09); c.fill();
  c.restore();
}

// A visitor's beast where it has been placed: a pony, with panniers when it carries a pack, or one of
// a neighbour's cattle being taken home. beast comes from visitorsOf in travellers.js.
const PONIES = ['#7b5a3e', '#9a8a74'];
export function drawBeast(c, beast, toScreen, scale, sun = PLAIN_LIGHT) {
  const pony = beast.kind === 'pony', [sx, sy] = toScreen(beast.x, beast.y), size = Math.max(pony ? 4.6 : 5.5, scale * (pony ? 0.36 : 0.44));
  const coat = pony ? PONIES[beast.coat || 0] : animalCoats.cattle[beast.coat || 0], dark = blend(coat, '#2a1f15', 0.45);
  const step = beast.moving ? Math.sin(beast.gone * 9) * 0.06 : 0;
  c.save(); c.translate(sx, sy);
  animalShade(c, sun, beast.heading, size, 1, 0.5);
  c.rotate(beast.heading); c.scale(size, size);
  const oval = (u, v, a, b, color, edge) => {
    c.beginPath(); c.ellipse(u, v, a, b, 0, 0, tau); c.fillStyle = color; c.fill();
    if (edge) { c.strokeStyle = edge; c.lineWidth = 0.13; c.stroke(); }
  };
  oval(step, 0, 0.88, pony ? 0.4 : 0.52, coat, '#3e2c1e');
  const nose = (pony ? 0.95 : 0.85) + (beast.graze || 0) * 0.19;
  if (pony) {
    // The mane down the neck, and the head held out long.
    c.strokeStyle = dark; c.lineWidth = 0.16; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0.35, 0); c.lineTo(nose - 0.2, 0); c.stroke();
    oval(nose, 0, 0.34, 0.18, coat, '#3e2c1e');
    c.strokeStyle = dark; c.lineWidth = 0.14; c.beginPath(); c.moveTo(-0.86, 0); c.lineTo(-1.22, Math.sin((beast.gone || 0) * 3) * 0.08); c.stroke();
    if (beast.laden) {
      // Panniers hung either side and the pack roped across the back.
      oval(-0.05, -0.47, 0.42, 0.17, '#8a6a44', '#4f3a25'); oval(-0.05, 0.47, 0.42, 0.17, '#8a6a44', '#4f3a25');
      oval(-0.05, 0, 0.36, 0.3, '#c9b48a', '#6f5a3a');
    }
  } else {
    oval(-0.36, 0.12, 0.36, 0.34, blend(coat, '#60422d', 0.56));
    for (const side of [-1, 1]) oval(nose - 0.11, side * 0.28, 0.16, 0.1, '#dfc9a0');
    oval(nose, 0, 0.32, 0.24, '#71523d');
  }
  c.restore();
}

// The peddler's goods set out on a cloth on the green: salt fish laid in a row, the lengths of linen
// taken in trade piled at one end, and the empty pack beside. pitch comes from visitorsOf.
export function drawPitch(c, pitch, toScreen, scale, sun = PLAIN_LIGHT) {
  const [sx, sy] = toScreen(pitch.x, pitch.y), k = Math.max(3, scale);
  c.save(); c.translate(sx, sy); c.rotate(pitch.a + Math.PI / 2); c.scale(k, k);
  c.fillStyle = 'rgba(60,52,36,' + (0.2 * Math.max(0.3, sun.depth)).toFixed(3) + ')'; c.fillRect(-0.62, -0.36, 1.3, 0.8);
  c.fillStyle = '#d8cba6'; c.strokeStyle = '#6f6248'; c.lineWidth = 0.035;
  c.fillRect(-0.66, -0.42, 1.32, 0.8); c.strokeRect(-0.66, -0.42, 1.32, 0.8);
  c.strokeStyle = '#a2453a88'; c.lineWidth = 0.04; c.strokeRect(-0.58, -0.34, 1.16, 0.64);
  for (let i = 0; i < pitch.fish; i++) {
    const u = -0.48 + (i % 4) * 0.22, v = i < 4 ? -0.16 : 0.08;
    c.save(); c.translate(u, v); c.rotate(0.15 * ((i % 2) ? 1 : -1));
    c.beginPath(); c.ellipse(0, 0, 0.09, 0.035, 0, 0, tau); c.fillStyle = '#b9b8a6'; c.fill(); c.strokeStyle = '#5f5d4e'; c.lineWidth = 0.02; c.stroke();
    c.beginPath(); c.moveTo(-0.08, 0); c.lineTo(-0.13, -0.035); c.lineTo(-0.13, 0.035); c.closePath(); c.fillStyle = '#9c9a88'; c.fill();
    c.restore();
  }
  for (let i = 0; i < pitch.linen; i++) {
    const v = -0.22 + (i % 3) * 0.13, lift = i >= 3 ? -0.05 : 0;
    c.beginPath(); c.ellipse(0.46, v + lift, 0.13, 0.055, 0, 0, tau); c.fillStyle = '#efe6cc'; c.fill(); c.strokeStyle = '#8f8466'; c.lineWidth = 0.02; c.stroke();
  }
  // The pack, unloaded and set down at the corner of the cloth.
  c.beginPath(); c.ellipse(0.72, 0.36, 0.2, 0.15, 0.4, 0, tau); c.fillStyle = '#8a6a44'; c.fill(); c.strokeStyle = '#4f3a25'; c.lineWidth = 0.035; c.stroke();
  c.beginPath(); c.moveTo(0.58, 0.3); c.lineTo(0.86, 0.43); c.strokeStyle = '#c9b48a'; c.lineWidth = 0.03; c.stroke();
  c.restore();
}

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

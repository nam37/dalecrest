import { animalCoats, animalPose, fenceSpans, logsIn } from './parish.js';
import { blend } from './ambient.js';

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

export function drawAnimal(c, animal, time, toScreen, scale) {
  const { x, y, heading, graze } = animalPose(animal, time);
  const cattle = animal.kind === 'cattle';
  const [sx, sy] = toScreen(x, y), size = Math.max(cattle ? 5.5 : 3.8, scale * (cattle ? 0.44 : 0.25));
  const wool = animalCoats[animal.kind][animal.coat], face = cattle ? '#71523d' : '#665746';
  c.save(); c.translate(sx, sy); c.rotate(heading); c.scale(size, size);
  const oval = (u, v, a, b, color, edge) => {
    c.beginPath(); c.ellipse(u, v, a, b, 0, 0, tau); c.fillStyle = color; c.fill();
    if (edge) { c.strokeStyle = edge; c.lineWidth = 0.15; c.stroke(); }
  };
  oval(0.03, 0.26, 1, 0.55, '#4a452c3d');
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

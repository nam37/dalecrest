// Drawing the wild creatures of the plan. wildlife.js says where each of them lives.
import { TAU, hash2, smooth } from '/engine/geom.mjs';
import { animalPose } from './parish.js';
import { blend } from './ambient.js';
import { animalShade } from './map-parish.js';

const oval = (c, x, y, rx, ry, fill, edge, turn = 0) => {
  c.beginPath(); c.ellipse(x, y, rx, ry, turn, 0, TAU); c.fillStyle = fill; c.fill();
  if (edge) { c.strokeStyle = edge; c.lineWidth = 0.1; c.stroke(); }
};

// Game is shy. It lifts its head when someone comes near and is away into the trees before they arrive.
// walkers are the positions of everyone out of doors.
export function drawGame(c, animal, time, toScreen, scale, look, walkers) {
  let near = Infinity;
  for (const p of walkers) near = Math.min(near, Math.hypot(p.x - animal.x, p.y - animal.y));
  const seen = smooth(3.5, 6.5, near);
  if (seen < 0.02) return;
  const pose = animalPose(animal, time), graze = pose.graze * smooth(7, 11, near), deer = animal.kind === 'deer';
  const [sx, sy] = toScreen(pose.x, pose.y);
  const size = deer ? Math.max(4.2, scale * 0.31) * (animal.young ? 0.66 : animal.buck ? 1.1 : 1) : Math.max(2.3, scale * 0.13);
  c.save(); c.globalAlpha = seen; c.translate(sx, sy);
  animalShade(c, look.sun, pose.heading, size, deer ? 0.95 : 0.9, deer ? 0.36 : 0.55);
  c.rotate(pose.heading); c.scale(size, size); c.lineCap = 'round';
  if (deer) {
    // Foxy red in summer and grey-brown through the winter.
    const coat = blend('#8c7b66', '#b07a4c', look.year?.lush ?? 1), dark = blend(coat, '#4a3524', 0.5), nose = 1.04 + graze * 0.24;
    oval(c, 0, 0, 0.95, 0.36, coat, '#5a4633');
    oval(c, -0.08, 0, 0.6, 0.13, blend(coat, '#4a3524', 0.24));
    oval(c, -0.86, 0, 0.16, 0.24, '#efe5cc');
    if (animal.young) for (const [u, v] of [[-0.35, 0.13], [0.05, -0.15], [0.4, 0.12], [-0.1, 0.17]]) oval(c, u, v, 0.07, 0.07, '#f1e7cfcc');
    c.strokeStyle = coat; c.lineWidth = 0.28; c.beginPath(); c.moveTo(0.72, 0); c.lineTo(nose - 0.12, 0); c.stroke();
    for (const side of [-1, 1]) oval(c, nose - 0.2, side * 0.2, 0.17, 0.07, dark, null, side * 2.3);
    oval(c, nose, 0, 0.25, 0.15, dark);
    if (animal.buck) {
      c.strokeStyle = '#efe4c6'; c.lineWidth = 0.08; c.beginPath();
      for (const side of [-1, 1]) {
        c.moveTo(nose - 0.12, side * 0.08); c.lineTo(nose - 0.4, side * 0.36);
        c.moveTo(nose - 0.27, side * 0.22); c.lineTo(nose - 0.1, side * 0.36);
      }
      c.stroke();
    }
  } else {
    oval(c, 0, 0, 0.9, 0.55, '#a8906c', '#5f503a');
    oval(c, -0.82, 0, 0.2, 0.2, '#f1ead6');
    // The ears lie back along the shoulders.
    for (const side of [-1, 1]) oval(c, 0.42, side * 0.2, 0.44, 0.11, '#8c7556', null, -side * 0.22);
    oval(c, 0.95, 0, 0.33, 0.26, '#9a8260', '#5f503a');
  }
  c.restore();
}

// Fish are dark shapes under the water, each holding its place against the current. They are drawn
// at their true size, so they come into view only as the reader leans in over the bank.
export function drawFish(c, shoal, time, toScreen, scale, sky, weather) {
  if (!shoal.length) return;
  const iced = weather?.lying > 0.3, t = time * 0.001;
  for (const f of shoal) {
    const px = f.len * scale, seen = smooth(2.2, 4.6, px) * (iced ? 0.55 : 1);
    if (seen < 0.02) continue;
    const drift = Math.sin((t + f.phase) * 0.31) * 0.4 + Math.sin((t + f.phase) * 0.073) * 0.5, side = Math.sin((t + f.phase) * 0.47) * 0.12;
    const [sx, sy] = toScreen(f.x + f.tx * drift - f.ty * side, f.y + f.ty * drift + f.tx * side);
    const wag = Math.sin((t + f.phase) * 6.5) * 0.11;
    // The head is upstream and the tail works from side to side.
    c.save(); c.translate(sx, sy); c.rotate(Math.atan2(-f.ty, -f.tx)); c.scale(px, px);
    c.fillStyle = 'rgba(28,54,60,' + (0.64 * seen).toFixed(3) + ')';
    c.beginPath(); c.moveTo(0.5, 0); c.quadraticCurveTo(0.12, -0.21, -0.26, -0.045 + wag * 0.3);
    c.lineTo(-0.5, -0.15 + wag); c.lineTo(-0.42, wag); c.lineTo(-0.5, 0.15 + wag); c.lineTo(-0.26, 0.045 + wag * 0.3);
    c.quadraticCurveTo(0.12, 0.21, 0.5, 0); c.fill();
    c.restore();
  }
  // Now and then one comes up to take a fly and leaves a ring that widens and is gone. They rise most
  // freely in the evening, and not at all in rain or under snow.
  if (!time || iced || weather?.rain > 0.1 || sky.bright < 0.04) return;
  const span = 5200, turn = Math.floor(time / span), f = (time % span) / span / 0.62;
  if (f >= 1 || hash2(17, turn, 9) > 0.4 + 0.5 * sky.dusk) return;
  const fish = shoal[Math.floor(hash2(17, turn, 3) * shoal.length)], shown = smooth(3.5, 6, scale);
  const [x, y] = toScreen(fish.x, fish.y);
  c.lineWidth = 1;
  for (const lag of [0, 0.28]) {
    const g = f - lag;
    if (g <= 0) continue;
    c.strokeStyle = 'rgba(244,251,246,' + ((1 - g) * 0.7 * shown).toFixed(3) + ')';
    c.beginPath(); c.ellipse(x, y, (0.1 + g * 0.72) * scale, (0.1 + g * 0.72) * scale * 0.8, 0, 0, TAU); c.stroke();
  }
}

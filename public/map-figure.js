import { appearanceOf } from '../engine/appearance.mjs';
import { aprons, residentPose, toolFor } from './resident-pose.js';

const outline = '#423628', wood = '#89633f', iron = '#b8c3c3', tau = Math.PI * 2;

function oval(c, x, y, rx, ry, fill, edge = outline) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, tau);
  c.fillStyle = fill;
  c.fill();
  if (edge) { c.strokeStyle = edge; c.lineWidth = 0.04; c.stroke(); }
}

function stroke(c, points, color, width) {
  c.beginPath();
  points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
}

// Tools are drawn at the hand's origin, on the same scale as the figure.
function drawTool(c, tool, angle) {
  c.save();
  if (tool !== 'pail') c.rotate(angle + 0.72);
  switch (tool) {
    case 'axe':
    case 'mallet':
      stroke(c, [[-0.09, 0], [0.37, 0]], outline, 0.09);
      stroke(c, [[-0.09, 0], [0.37, 0]], wood, 0.05);
      c.fillStyle = tool === 'axe' ? iron : '#9e7752';
      c.beginPath();
      c.moveTo(0.29, 0.02); c.lineTo(0.41, 0.02);
      c.lineTo(0.44, -0.17); c.lineTo(tool === 'axe' ? 0.23 : 0.27, -0.17);
      c.closePath(); c.fill(); c.strokeStyle = outline; c.lineWidth = 0.04; c.stroke();
      break;
    case 'sickle':
    case 'hoe':
      stroke(c, [[-0.06, 0], [tool === 'hoe' ? 0.45 : 0.23, 0]], wood, 0.075);
      if (tool === 'hoe') {
        stroke(c, [[0.44, -0.02], [0.51, 0.13]], outline, 0.1);
        stroke(c, [[0.44, -0.02], [0.51, 0.13]], iron, 0.058);
      } else {
        c.beginPath(); c.moveTo(0.2, 0); c.quadraticCurveTo(0.49, 0.04, 0.47, -0.22);
        c.strokeStyle = outline; c.lineWidth = 0.1; c.stroke();
        c.strokeStyle = iron; c.lineWidth = 0.062; c.stroke();
      }
      break;
    case 'peel':
      stroke(c, [[-0.14, 0], [0.62, 0]], outline, 0.09);
      stroke(c, [[-0.14, 0], [0.62, 0]], wood, 0.05);
      oval(c, 0.59, 0, 0.18, 0.087, '#c59c66');
      break;
    case 'pail':
      stroke(c, [[-0.115, 0.15], [-0.09, 0.03], [0.09, 0.03], [0.115, 0.15]], outline, 0.04);
      c.fillStyle = wood; c.fillRect(-0.137, 0.14, 0.274, 0.19);
      c.strokeStyle = outline; c.lineWidth = 0.04; c.strokeRect(-0.137, 0.14, 0.274, 0.19);
      oval(c, 0, 0.14, 0.137, 0.046, '#96b2b5');
      break;
    case 'rod':
      c.rotate(-angle * 0.52);
      stroke(c, [[-0.1, 0], [0.83, 0]], wood, 0.054);
      stroke(c, [[0.83, 0], [0.75, 0.33]], '#ebe4cd', 0.029);
      break;
    case 'sack':
      oval(c, 0.1, -0.04, 0.15, 0.2, '#d6c49a');
      stroke(c, [[-0.01, -0.17], [0.21, -0.17]], wood, 0.035);
      break;
    case 'shuttle':
      oval(c, 0.15, 0, 0.19, 0.055, '#e6d7b2');
      break;
    case 'board':
      c.fillStyle = '#e5d3a8'; c.fillRect(-0.02, -0.16, 0.25, 0.27);
      c.strokeStyle = wood; c.lineWidth = 0.05; c.strokeRect(-0.02, -0.16, 0.25, 0.27);
      stroke(c, [[0.05, -0.08], [0.16, -0.08]], wood, 0.025);
      break;
    case 'bundle':
      for (const y of [-0.09, 0, 0.09]) stroke(c, [[-0.09, y], [0.26, y]], wood, 0.08);
      break;
  }
  c.restore();
}

export function drawMapFigure(c, { x, y, size, actor, activity, index, moving, gone, now, facing, still }) {
  const { cloth: [cloth, clothShade], skin: [skin], hair: [hair], headwear } = appearanceOf(actor);
  const pose = residentPose({ ...activity, moving, gone, now, index, still });
  const tool = toolFor(activity);
  const step = pose.legSwing * 0.26;

  c.save();
  c.translate(x, y);
  c.scale(facing * size, size);
  c.lineCap = c.lineJoin = 'round';
  oval(c, 0.04, 0.02, 0.34, 0.115, '#2822144d', null);
  stroke(c, [[-0.1, -0.23], [-0.1 + step, -Math.max(0, -step) * 0.32]], outline, 0.1);
  stroke(c, [[0.09, -0.23], [0.09 - step, -Math.max(0, step) * 0.32]], outline, 0.1);

  c.translate(0, -0.25 - pose.lift * 5);
  c.rotate(-pose.lean * 0.59 + pose.sway);
  function arm(x, angle, held, reach = 0) {
    const length = 0.27 + reach;
    const hx = x - Math.sin(angle) * length, hy = -0.34 + Math.cos(angle) * length;
    stroke(c, [[x, -0.34], [hx, hy]], outline, 0.152);
    stroke(c, [[x, -0.34], [hx, hy]], cloth, 0.106);
    if (held) {
      c.save(); c.translate(hx, hy); drawTool(c, held, angle); c.restore();
    }
    oval(c, hx, hy, 0.064, 0.064, skin);
  }
  arm(0.115, pose.armL, null);
  c.beginPath(); c.moveTo(-0.23, 0.09);
  c.quadraticCurveTo(-0.22, -0.34, -0.1, -0.39); c.lineTo(0.105, -0.39);
  c.quadraticCurveTo(0.2, -0.34, 0.21, 0.09); c.closePath();
  c.fillStyle = cloth; c.fill(); c.strokeStyle = outline; c.lineWidth = 0.046; c.stroke();
  if (aprons[actor.trade]) {
    c.fillStyle = aprons[actor.trade];
    c.fillRect(0.075, -0.24, 0.09, 0.29);
  }
  stroke(c, [[-0.18, -0.12], [0.18, -0.12]], '#533f2d', 0.045);
  const hx = 0.025 + pose.nod * 0.13, hy = -0.55 + pose.nod * 0.065;
  oval(c, hx, hy, 0.16, 0.17, skin);
  oval(c, hx + 0.103, hy - 0.012, 0.022, 0.025, outline, null);
  if (headwear === 'straw') {
    oval(c, hx, hy - 0.13, 0.128, 0.092, '#ba9053');
    oval(c, hx, hy - 0.09, 0.245, 0.057, '#d6b477');
  } else if (headwear === 'cap') {
    oval(c, hx - 0.012, hy - 0.13, 0.17, 0.092, clothShade);
    stroke(c, [[hx - 0.17, hy - 0.1], [hx + 0.15, hy - 0.12]], cloth, 0.045);
  } else {
    const color = headwear === 'hood' ? cloth : headwear === 'coif' ? '#e6d9b8' : hair;
    c.beginPath(); c.arc(hx - 0.028, hy, 0.173, Math.PI * 0.9, Math.PI * 1.95);
    c.lineTo(hx - 0.076, hy + (headwear === 'bare' ? 0.03 : 0.09)); c.closePath();
    c.fillStyle = color; c.fill(); c.stroke();
  }
  arm(-0.116, pose.armR, tool, -pose.spreadR * 0.10);
  c.restore();
}

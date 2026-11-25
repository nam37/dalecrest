// A resident in the walking view: a small jointed figure in a belted tunic, with a face, hands and
// shoes, a hat, hood or coif, an apron for the trades that wear one, and the tool of whatever work
// they are doing. poseFigure moves it: a stride, a movement for each trade, and a thoughtful stance
// while deciding. The figure faces +x and stands on y = 0. About 0.47 units tall, which is 1.9 m.
import * as THREE from '/vendor/three.module.min.js';
import { appearanceOf, appearanceVariation } from '../engine/appearance.mjs';
import { aprons, residentPose, toolFor } from './resident-pose.js';

const TAU = Math.PI * 2;
const hose = ['#5b4d3c', '#4f5546', '#6b5a43', '#4d4c56'];

const materials = new Map();
function soft(color, extra) {
  const key = color + (extra ? JSON.stringify(extra) : '');
  if (!materials.has(key)) materials.set(key, new THREE.MeshLambertMaterial({ color, ...extra }));
  return materials.get(key);
}
// Geometry is shared by every figure.
const shapes = {
  leg: new THREE.CapsuleGeometry(0.021, 0.135, 3, 8),
  shoe: new THREE.BoxGeometry(0.074, 0.026, 0.042),
  arm: new THREE.CapsuleGeometry(0.0185, 0.1, 3, 8),
  hand: new THREE.SphereGeometry(0.019, 8, 6),
  neck: new THREE.CylinderGeometry(0.017, 0.02, 0.034, 8),
  head: new THREE.SphereGeometry(0.046, 14, 10),
  eye: new THREE.SphereGeometry(0.0062, 6, 5),
  cap: new THREE.SphereGeometry(0.0495, 14, 8, 0, TAU, 0, 1.9),
  capBand: new THREE.CylinderGeometry(0.044, 0.048, 0.009, 14),
  cowl: new THREE.SphereGeometry(0.054, 14, 8, 0, TAU, 0, 2.05),
  cape: new THREE.CylinderGeometry(0.034, 0.082, 0.07, 14, 1, true),
  brim: new THREE.CylinderGeometry(0.084, 0.09, 0.008, 18),
  crown: new THREE.CylinderGeometry(0.034, 0.047, 0.042, 12),
  bun: new THREE.SphereGeometry(0.024, 8, 6),
  belt: new THREE.CylinderGeometry(0.0535, 0.0535, 0.016, 14),
  // A tunic is turned on a lathe: hem, waist, chest, shoulders, neck.
  tunic: hem => new THREE.LatheGeometry([[0.079, hem], [0.083, hem + 0.02], [0.064, 0.0], [0.051, 0.06], [0.056, 0.105], [0.059, 0.14], [0.047, 0.166], [0.024, 0.18], [0, 0.182]]
    .map(([r, y]) => new THREE.Vector2(r, y)), 14),
};
const tunics = new Map();

function mesh(geometry, material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z); m.castShadow = shadow;
  return m;
}

// The tool of each kind of work, held in the right hand and pointing forward from it.
function tool(kind) {
  const g = new THREE.Group(), wood = soft('#8a6a45'), iron = soft('#9aa0a2');
  const shaft = (length, radius = 0.006) => { const m = mesh(new THREE.CylinderGeometry(radius, radius, length, 6), wood, length / 2, 0, 0); m.rotation.z = Math.PI / 2; return m; };
  if (kind === 'axe') g.add(shaft(0.17), mesh(new THREE.BoxGeometry(0.03, 0.045, 0.009), iron, 0.155, -0.012, 0));
  else if (kind === 'mallet') g.add(shaft(0.11), mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.044, 8), soft('#6f5a3e'), 0.11, 0, 0));
  else if (kind === 'sickle') {
    const blade = mesh(new THREE.TorusGeometry(0.034, 0.0042, 4, 10, 2.5), iron, 0.075, 0, 0);
    blade.rotation.set(Math.PI / 2, 0, 0.5);
    g.add(shaft(0.05), blade);
  } else if (kind === 'peel') g.add(shaft(0.27), mesh(new THREE.BoxGeometry(0.075, 0.006, 0.064), soft('#b89366'), 0.3, 0, 0));
  else if (kind === 'pail') {
    const pail = mesh(new THREE.CylinderGeometry(0.031, 0.025, 0.046, 10, 1, true), soft('#8a6a45', { side: THREE.DoubleSide }), 0.01, -0.045, 0);
    g.add(pail, mesh(new THREE.CircleGeometry(0.03, 10), soft('#6f8f96'), 0.01, -0.034, 0, false));
    g.children[1].rotation.x = -Math.PI / 2;
  } else if (kind === 'rod') {
    const rod = shaft(0.6, 0.007);
    const line = mesh(new THREE.CylinderGeometry(0.001, 0.001, 0.25, 4), soft('#c4b994'), 0.59, -0.125, 0);
    g.add(rod, line);
  } else if (kind === 'sack') { const sack = mesh(shapes.hand, soft('#d9cba3'), 0.03, 0.01, -0.06); sack.scale.set(2.6, 3.4, 2.4); g.add(sack); }
  else if (kind === 'shuttle') { const wool = mesh(shapes.hand, soft('#e9e3d0'), 0.15, 0, 0); wool.scale.set(1.5, 1.1, 1.1); g.add(shaft(0.17, 0.0045), wool); }
  else if (kind === 'hoe') g.add(shaft(0.23), mesh(new THREE.BoxGeometry(0.032, 0.009, 0.06), iron, 0.22, -0.02, 0));
  else if (kind === 'board') g.add(mesh(new THREE.BoxGeometry(0.085, 0.012, 0.064), wood, 0.04, 0, 0),
    mesh(new THREE.BoxGeometry(0.075, 0.003, 0.052), soft('#ede2be'), 0.04, 0.008, 0));
  else if (kind === 'bundle') {
    for (let i = 0; i < 3; i++) g.add(mesh(new THREE.BoxGeometry(0.105, 0.025, 0.024), wood, 0.03, 0, (i - 1) * 0.024));
  }
  return g;
}

export function makeFigure(actor, index) {
  const g = new THREE.Group(), appearance = appearanceOf(actor);
  const { cloth: [cloth, clothShade], skin: [skinColor], hair: [hairColor], headwear } = appearance;
  const skin = soft(skinColor), hair = soft(hairColor), tunicColor = soft(cloth);
  const hoseColor = soft(hose[Math.floor(appearanceVariation(appearance, 'hose') * hose.length)]);
  // Legs hang from the hips and carry a shoe that points the way the figure faces.
  const legs = [0.031, -0.031].map(z => {
    const pivot = new THREE.Group(); pivot.position.set(0, 0.2, z);
    pivot.add(mesh(shapes.leg, hoseColor, 0, -0.098, 0), mesh(shapes.shoe, soft('#3a2f25'), 0.016, -0.187, 0));
    g.add(pivot);
    return pivot;
  });
  // Everything above the hips leans and turns together.
  const body = new THREE.Group(); body.position.y = 0.2; g.add(body);
  const hem = appearanceVariation(appearance, 'hem') < 0.5 ? -0.118 : -0.086;
  if (!tunics.has(hem)) tunics.set(hem, shapes.tunic(hem));
  const tunic = mesh(tunics.get(hem), tunicColor); tunic.scale.set(0.8, 1, 1); body.add(tunic);
  const belt = mesh(shapes.belt, soft('#4a3a2a'), 0, 0.058, 0, false); belt.scale.set(0.8, 1, 1); body.add(belt);
  const apron = aprons[actor.trade];
  if (apron) { const bib = mesh(new THREE.BoxGeometry(0.012, 0.15, 0.074), soft(apron), 0.046, 0.0, 0, false); bib.rotation.z = -0.1; body.add(bib); }
  const arms = [1, -1].map(side => {
    const pivot = new THREE.Group(); pivot.position.set(0, 0.152, side * 0.066); pivot.rotation.x = -side * 0.13;
    pivot.add(mesh(shapes.arm, tunicColor, 0, -0.068, 0), mesh(shapes.hand, skin, 0, -0.14, 0, false));
    body.add(pivot);
    return pivot;
  });
  body.add(mesh(shapes.neck, skin, 0, 0.192, 0, false));
  const head = new THREE.Group(); head.position.y = 0.238; body.add(head);
  const face = mesh(shapes.head, skin); face.scale.set(0.95, 1.08, 0.92); head.add(face);
  for (const z of [0.0165, -0.0165]) head.add(mesh(shapes.eye, soft('#2e2620'), 0.0395, 0.006, z, false));
  // Hair and headwear are tipped back so the face shows.
  const tipped = (geometry, material, tilt) => { const m = mesh(geometry, material, -0.003, 0.004, 0); m.rotation.z = tilt; return m; };
  if (headwear === 'straw') {
    head.add(tipped(shapes.cap, hair, 0.5));
    const brim = mesh(shapes.brim, soft('#d6b477'), -0.004, 0.036, 0), crown = mesh(shapes.crown, soft('#ba9053'), -0.004, 0.058, 0);
    brim.rotation.z = crown.rotation.z = 0.08; head.add(brim, crown);
  } else if (headwear === 'hood') {
    head.add(tipped(shapes.cowl, tunicColor, 0.52));
    const cape = mesh(shapes.cape, soft(clothShade, { side: THREE.DoubleSide }), 0, 0.158, 0); cape.scale.set(0.84, 1, 1); body.add(cape);
  } else if (headwear === 'coif') {
    head.add(tipped(shapes.cap, soft('#e6d9b8'), 0.62), mesh(shapes.bun, hair, -0.044, -0.012, 0, false));
  } else if (headwear === 'cap') {
    head.add(tipped(shapes.cap, hair, 0.5));
    const cap = mesh(shapes.cap, soft(clothShade), -0.004, 0.013, 0);
    cap.scale.y = 0.8;
    const band = mesh(shapes.capBand, tunicColor, -0.004, 0.025, 0);
    head.add(cap, band);
  } else {
    head.add(tipped(shapes.cap, hair, 0.5));
  }
  g.userData.rig = { legs, arms, body, head, tools: new Map(), held: null, index };
  return g;
}

const ease = (current, target, k) => current + (target - current) * k;

// Poses a figure for this frame. state: { moving, gone, now, dt, kind, job, working }.
export function poseFigure(figure, state) {
  const { moving, dt } = state;
  const rig = figure.userData.rig, [right, left] = rig.arms, k = Math.min(1, dt * 9);
  // The tool for the job in hand, made the first time it is needed.
  const want = toolFor(state);
  if (rig.held !== want) {
    if (rig.held) rig.tools.get(rig.held).visible = false;
    if (want && !rig.tools.has(want)) {
      const made = tool(want);
      made.position.set(0, -0.14, 0);
      (want === 'sack' ? rig.body : right).add(made);
      if (want === 'sack') made.position.set(0.02, 0.1, 0);
      rig.tools.set(want, made);
    }
    if (want) rig.tools.get(want).visible = true;
    rig.held = want;
  }
  const { legSwing, armR, armL, spreadR, lean, sway, nod, lift } = residentPose({ ...state, index: rig.index });
  // A stride follows the ground exactly; everything else eases into place.
  const q = moving ? 1 : k;
  rig.legs[0].rotation.z = ease(rig.legs[0].rotation.z, legSwing, q);
  rig.legs[1].rotation.z = ease(rig.legs[1].rotation.z, -legSwing, q);
  right.rotation.z = ease(right.rotation.z, armR, q); left.rotation.z = ease(left.rotation.z, armL, q);
  right.rotation.x = ease(right.rotation.x, spreadR, k);
  rig.body.rotation.z = ease(rig.body.rotation.z, lean, k);
  rig.body.rotation.x = ease(rig.body.rotation.x, sway, k);
  rig.body.position.y = 0.2 + lift;
  rig.head.rotation.z = ease(rig.head.rotation.z, -nod, k);
}

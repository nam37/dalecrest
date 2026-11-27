import { appearanceOf, appearanceVariation } from '../engine/appearance.mjs';

export function portrait(actor) {
  const canvas = document.createElement('canvas');
  canvas.className = 'portrait';
  canvas.width = 144;
  canvas.height = 156;
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  if (context) drawPortrait(context, appearanceOf(actor), { man: actor.sex === 'm' && !actor.child, child: Boolean(actor.child) });
  return canvas;
}

// Hand-drawn face shapes in drawing units, facing right. A resident gets one and a small variation of it,
// so every face is one of a few that were checked, never an unlucky mix of extremes.
// tip: the nose tip; lip: the front of the upper lip; chin: the bottom of the chin and how far forward it comes;
// jaw: where the jaw turns back (lower is broader); brow: the height of the brow.
const FACES = [
  { name: 'round', brow: 34, tip: 54.6, noseY: 40.6, lip: 52, mouthGap: 6.2, chin: 55, chinX: 49, jaw: 33 },
  { name: 'long', brow: 33.5, tip: 55.4, noseY: 41.2, lip: 52.4, mouthGap: 6.4, chin: 57.4, chinX: 49.4, jaw: 35 },
  { name: 'broad', brow: 34.5, tip: 54.4, noseY: 40.6, lip: 52.6, mouthGap: 6, chin: 55.6, chinX: 50, jaw: 31.5 },
  { name: 'fine', brow: 33.5, tip: 55, noseY: 40.4, lip: 51.6, mouthGap: 6, chin: 54.8, chinX: 48.6, jaw: 35.5 },
  { name: 'strong', brow: 34, tip: 55.8, noseY: 41, lip: 52.6, mouthGap: 6.4, chin: 56.6, chinX: 50.6, jaw: 32.5 },
  { name: 'soft', brow: 34.5, tip: 54, noseY: 40.4, lip: 51.8, mouthGap: 5.8, chin: 54.4, chinX: 48.4, jaw: 34.5 },
];
const YOUNG = ['round', 'fine', 'soft'];

// A small printed bust with two canvas pixels per drawing unit.
function drawPortrait(c, appearance, { man, child }) {
  const variation = feature => appearanceVariation(appearance, feature);
  const n = (feature, min, max) => min + (max - min) * variation(feature);
  const [cloth, clothShade, clothLight] = appearance.cloth;
  const [skin, skinShade, skinLight] = appearance.skin;
  const [hair, hairLight] = appearance.hair;
  const { headwear } = appearance;
  const ink = '#3d2c23', linen = '#e6d9b8', linenShade = '#a99a76';
  const faces = child ? FACES.filter(face => YOUNG.includes(face.name)) : FACES;
  const shape = faces[Math.floor(variation('face') * faces.length)];
  const temple = n('temple', 25.5, 28.5), jaw = shape.jaw + n('jaw', -.8, .8);
  const brow = shape.brow + n('brow', -.5, .5), tip = shape.tip + n('nose', -.5, .5), noseY = shape.noseY;
  const lip = shape.lip, mouth = noseY + shape.mouthGap, chin = shape.chin + n('chin', -.5, .5), chinX = shape.chinX;
  // The corner of the mouth sits level or a little raised.
  const corner = n('expression', -1, .3);

  c.scale(2, 2);
  c.lineJoin = c.lineCap = 'round';
  const path = (d, fill, stroke = ink, width = 1.4) => {
    const shape = new Path2D(d);
    if (fill) { c.fillStyle = fill; c.fill(shape); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(shape); }
  };
  const line = (d, stroke = ink, width = 1.15) => path(d, null, stroke, width);
  const dot = (x, y, rx, ry, color) => {
    c.fillStyle = color;
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill();
  };
  c.fillStyle = '#ede1be';
  c.fillRect(0, 0, 72, 78);
  dot(36, 37, 30, 33, '#e2d2a8');
  dot(36, 35, 27, 30, '#e9d9b2');
  for (let row = 0; row < 13; row++) {
    for (let column = 0; column < 12; column++) {
      const x = column * 6 + n(`grain-x-${column}-${row}`, 0, 5);
      const y = row * 6 + n(`grain-y-${column}-${row}`, 0, 5);
      dot(x, y, .6, .35, (row + column) % 2 ? '#f5e9ca' : '#d8c699');
    }
  }
  if (variation('facing') < .5) { c.translate(72, 0); c.scale(-1, 1); }

  if (headwear === 'coif') path('M20 26 Q15 41 14 56 Q23 64 35 56 L36 24 Z', linenShade);
  else if (headwear === 'hood') path('M19 27 Q14 42 15 60 L28 63 L43 45 L42 21 Z', clothShade);
  else path('M20 25 Q14 35 18 50 Q20 57 33 53 L47 37 L43 21 Z', hair);

  path('M3 80 Q6 69 15 65 L30 57 Q39 54 48 60 L59 66 Q68 71 70 80 Z', cloth);
  path('M3 80 Q6 69 15 65 L25 61 Q22 68 28 76 L33 80 Z', clothShade, null);
  line('M9 76 Q14 69 23 66 M52 65 Q62 70 65 77 M57 72 L60 78', clothLight, 1.3);
  line('M13 74 L11 79 M17 73 L15 79 M21 72 L19 78 M53 72 L56 78', ink, .75);
  path('M29 48 Q38 50 46 51 L45 60 L49 62 Q45 69 37 69 Q29 68 25 62 L29 58 Z', skinShade);
  path('M34 53 L45 54 L44 61 Q42 65 37 66 L33 63 Z', skin, null);
  if (man) {
    path('M18 64 L23 61 L25 80 L19 80 Z', linen, ink, 1);
    path('M50 61 L55 64 L54 80 L48 80 Z', linen, ink, 1);
  } else {
    path('M24 61 Q30 69 37 69 Q44 68 49 61 L53 65 Q47 74 37 75 Q27 74 20 64 Z', linen);
    line('M24 65 Q36 77 49 66', linenShade, 1.1);
    line('M37 74 L39 80', ink, 1.5);
  }

  // Forehead, a rounded nose, the lips, the chin and the jaw, then the back of the head.
  const front = `M${temple} 27 Q33 18 46 24 Q52 26 52 ${brow} Q${52 + (tip - 52) * .45} ${brow + 3} ${tip} ${noseY}`
    + ` Q${tip + .7} ${noseY + 2.1} ${tip - 2} ${noseY + 2.5} Q${lip + .6} ${noseY + 2.8} ${lip} ${noseY + 4.4}`
    + ` Q${lip + .7} ${mouth} ${lip - .6} ${mouth + 1.6} Q${chinX + 1.4} ${chin - 3.2} ${chinX} ${chin - 1}`
    + ` Q${chinX - 1.6} ${chin} ${chinX - 6.5} ${chin} Q${jaw} ${chin} 28 50`;
  path(front + ' Q23 49 22 43 Q19 38 23 36 Z', skin);
  // The shaded side, light enough to keep the features on darker skin.
  c.globalAlpha = .7;
  path(`M${temple} 28 Q33 25 37 26 Q30 35 30.5 43 Q32 50 ${chinX - 7} ${chin} Q${jaw} ${chin} 28 50 Q23 49 22 43 Q19 38 23 36 Z`, skinShade, null);
  c.globalAlpha = 1;
  path(`M37 29 Q43 25 47 29 L49 ${brow} Q${tip - 2.5} ${noseY - 2} ${tip - 1.5} ${noseY} L47 ${noseY + 1.5} L46 38 Q39 38 36 36 Z`, skinLight, null);
  line('M24 40 Q28 37 29 42 L27 44', ink, .8);
  // Brows, the near eye with one lid line, and a smaller far eye beside the bridge of the nose.
  line(`M34 ${brow - .8} Q38 ${brow - 2.6} 42 ${brow - 1}`, ink, 1.35);
  line(`M47 ${brow - 1} Q48.6 ${brow - 1.8} 50.2 ${brow - 1}`, ink, 1.1);
  line(`M35.6 ${brow + 2.4} Q38.6 ${brow + 1} 41.4 ${brow + 2.6}`, ink, .95);
  dot(38.8, brow + 3.3, .95, 1.1, ink);
  line(`M47.4 ${brow + 2.3} Q48.7 ${brow + 1.5} 50 ${brow + 2.3}`, ink, .8);
  dot(48.8, brow + 3.2, .6, .8, ink);
  line(`M${tip - 3.6} ${noseY + 1.4} Q${tip - 2.8} ${noseY + 2.6} ${tip - 1.6} ${noseY + 2.3}`, ink, 1);
  line(`M${lip - 9} ${mouth + .4 + corner} Q${lip - 5} ${mouth + 1.1} ${lip - .9} ${mouth + .3}`, ink, 1.15);
  line(`M${lip - 7.5} ${mouth + 3.6} Q${lip - 4.5} ${mouth + 4.4} ${lip - 2.2} ${mouth + 3.4}`, skinShade, .9);
  line(front, ink, 1.4);
  // Some men are unshaven. Freckled faces are left clear so the two never crowd each other.
  if (man && variation('stubble') > .55 && variation('freckles') <= .57) {
    c.globalAlpha = .6;
    for (let i = 0; i < 7; i++) dot(33 + i * 2.3, chin - 5.5 + n(`stubble-${i}`, -1, 1.2) + (i > 3 ? i - 3 : 0), .45, .45, skinShade);
    c.globalAlpha = 1;
  }
  if (headwear === 'bare' || headwear === 'cap') {
    path('M20 38 Q14 30 21 21 Q24 15 34 16 Q43 11 50 18 Q57 22 52 29 Q46 24 43 26 Q38 22 32 28 Q29 32 25 31 L25 37 Z', hair);
    line('M20 31 Q21 23 29 21 M24 28 Q31 21 37 21 M34 23 Q42 16 49 22', hairLight, 1.3);
    if (headwear === 'cap') {
      path('M18 26 Q16 18 25 14 Q34 7 46 12 Q54 15 56 23 Q41 21 30 25 L20 29 Z', clothShade);
      path('M18 25 Q34 20 55 20 L56 24 Q36 23 19 29 Z', cloth);
      line('M24 20 Q33 13 43 14', clothLight, 1.15);
    }
  } else if (headwear === 'straw') {
    path('M22 23 L26 13 Q35 8 45 13 L51 22 Z', '#ba9053');
    path('M25 19 Q34 16 49 18 L51 22 Q37 20 24 23 Z', '#775339');
    path('M12 27 Q15 22 33 21 Q51 18 61 22 Q64 25 56 27 Q29 28 16 31 Q11 31 12 27 Z', '#d6b477');
    line('M15 28 Q34 24 58 24 M28 15 L36 13 M30 17 L40 15', '#987143', .9);
  } else if (headwear === 'coif') {
    path('M16 40 Q14 32 18 22 Q25 12 39 15 Q47 17 50 25 Q35 21 28 30 Q28 41 22 48 L17 53 Z', linen);
    line('M20 25 Q30 16 42 19 M20 32 Q23 25 28 23 M19 45 L23 34', linenShade, 1.15);
    line('M24 47 Q27 53 33 55 Q29 55 27 59 M33 55 L35 60', linenShade, 1.35);
  } else {
    path('M15 53 Q13 41 18 26 Q23 12 36 13 Q47 14 53 26 Q44 22 35 27 Q26 34 26 48 Q26 55 32 62 L23 65 Q14 62 10 57 Z', cloth);
    line('M16 49 Q16 30 27 21 Q35 15 44 19 M16 55 Q20 60 25 61', clothLight, 1.3);
    line('M19 57 Q19 47 22 40 M24 59 Q24 55 23 52', clothShade, 1.3);
  }
  if (variation('freckles') > .57) {
    for (let i = 0; i < 4; i++) {
      dot(33 + i * 2.2, 41.5 + n(`freckle-${i}`, -1, 2), .6, .55, skinShade);
    }
  }
}

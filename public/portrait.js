import { appearanceOf, appearanceVariation } from '../engine/appearance.mjs';

export function portrait(actor) {
  const canvas = document.createElement('canvas');
  canvas.className = 'portrait';
  canvas.width = 144;
  canvas.height = 156;
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  if (context) drawPortrait(context, appearanceOf(actor), actor.sex === 'm' && !actor.child);
  return canvas;
}

// A small printed bust with two canvas pixels per drawing unit.
function drawPortrait(c, appearance, suspenders) {
  const variation = feature => appearanceVariation(appearance, feature);
  const n = (feature, min, max) => min + (max - min) * variation(feature);
  const [cloth, clothShade, clothLight] = appearance.cloth;
  const [skin, skinShade, skinLight] = appearance.skin;
  const [hair, hairLight] = appearance.hair;
  const { headwear } = appearance;
  const ink = '#3d2c23', linen = '#e6d9b8', linenShade = '#a99a76';
  const temple = n('temple', 25, 29), jaw = n('jaw', 31, 38), chin = n('chin', 53, 60);
  const brow = n('brow', 31, 35), nose = n('nose', 53, 58), cheek = n('cheek', 48, 55);
  const mouth = n('mouth', 46, 49), mouthEnd = n('expression', -1.4, 1.4);

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
  if (suspenders) {
    path('M18 64 L23 61 L25 80 L19 80 Z', linen, ink, 1);
    path('M50 61 L55 64 L54 80 L48 80 Z', linen, ink, 1);
  } else {
    path('M24 61 Q30 69 37 69 Q44 68 49 61 L53 65 Q47 74 37 75 Q27 74 20 64 Z', linen);
    line('M24 65 Q36 77 49 66', linenShade, 1.1);
    line('M37 74 L39 80', ink, 1.5);
  }

  const face = `M${temple} 27 Q33 18 46 24 Q52 26 52 ${brow} L${nose} 40 Q58 43 ${cheek} 44 Q54 48 51 51 Q48 ${chin} 42 ${chin} Q${jaw} ${chin} 28 50 Q23 49 22 43 Q19 38 23 36 Z`;
  path(face, skin);
  path(`M${temple} 28 Q33 25 37 26 Q30 35 31 44 Q33 52 42 ${chin} Q${jaw} ${chin} 28 50 Q23 49 22 43 Q19 38 23 36 Z`, skinShade, null);
  path(`M37 29 Q43 25 47 29 L49 ${brow} L${nose - 1.5} 40 L47 42 L46 38 Q39 38 36 36 Z`, skinLight, null);
  line('M24 40 Q28 37 29 42 L27 44', ink, .8);
  line(`M34 ${brow - 1} Q38 ${brow - 3} 42 ${brow - 1} M47 ${brow - 1} L50 ${brow - 1}`, ink, 1.7);
  line(`M35 ${brow + 3} Q38 ${brow + 1} 41 ${brow + 3} M47 ${brow + 2} L50 ${brow + 2}`, ink, 1.05);
  dot(39, brow + 3.15, 1.05, 1.25, ink);
  line(`M${nose - 4} 42 L${nose - 2} 42.7 M42 ${mouth} Q46 ${mouth + 1} 50 ${mouth + mouthEnd}`, ink, 1.2);
  line(`M41 ${mouth + 4.2} Q45 ${mouth + 5} 48 ${mouth + 3.5}`, skinShade, 1);
  line('M31 45 L34 49 M33 45 L36 49 M35 45 L37 48', skinShade, .8);
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

// The ox-carts families come with, for both views. A family arrives walking beside a two-wheeled cart
// drawn by a pair of oxen, with their goods on it. Once they are home, whether that is a cottage, the
// barn or the alehouse loft, the cart stands at the end of the house and the oxen graze close by.
import { animalPose } from './parish.js';

// Each cart as { id, x, y, heading, moving, gone, oxen: [{ x, y, heading, moving, gone, graze }] }.
// at(id) is where a resident is drawn ({ x, y, heading, moving, gone }); time is in milliseconds.
export function cartsOf(map, world, actors, at, time) {
  const out = [];
  for (const [index, family] of (world?.familyArrivals ?? []).entries()) {
    if (!family.cart) continue;
    const id = 'cart-' + index, parents = actors.filter(a => family.parents?.includes(a.id));
    const leader = parents.find(a => a.action?.kind === 'arrive' && a.action.phase === 'travelling'), lead = leader && at(leader.id);
    if (lead) {
      // On the road: the oxen beside whoever leads them, and the cart behind.
      const h = lead.heading ?? 0, ux = Math.cos(h), uy = Math.sin(h), nx = -uy, ny = ux;
      const ox = lead.x + ux * 0.3 + nx * 0.55, oy = lead.y + uy * 0.3 + ny * 0.55, moving = Boolean(lead.moving);
      out.push({ id, x: ox - ux * 1.15, y: oy - uy * 1.15, heading: h, moving, gone: lead.gone ?? 0,
        oxen: [-1, 1].map(s => ({ x: ox + nx * s * 0.2, y: oy + ny * s * 0.2, heading: h, moving, gone: (lead.gone ?? 0) + s, graze: 0 })) });
      continue;
    }
    const home = map.places.find(p => p.id === family.home);
    if (!home?.w) continue;
    // At home: the cart at the gable end, shafts down, and the oxen grazing a little beyond it.
    const ux = Math.cos(home.a), uy = Math.sin(home.a), reach = home.w / 2 + 0.85;
    const cx = home.x + ux * reach, cy = home.y + uy * reach;
    out.push({ id, x: cx, y: cy, heading: home.a, moving: false, gone: 0,
      oxen: [0, 1].map(i => {
        const pose = animalPose({ x: cx + ux * 1.4 + (i ? 0.5 : -0.4) * -uy, y: cy + uy * 1.4 + (i ? 0.5 : -0.4) * ux, phase: index * 2.3 + i * 4.1 }, time);
        return { x: pose.x, y: pose.y, heading: pose.heading, moving: Math.abs(pose.stride) > 0.02, gone: time / 400, graze: pose.graze };
      }) });
  }
  return out;
}

// The colour of a pair of oxen: a dark red-brown.
export const OX = '#6f4a33';

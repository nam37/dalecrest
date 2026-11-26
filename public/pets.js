// Where the village's dogs and cats are drawn, for both views. The engine keeps who owns each pet
// and which house it belongs to; the views place it from where its owner is. A dog keeps at its
// owner's heels when they are out, lies down near them while they work, and now and then trots off
// to sniff about before coming back. When its owner is indoors it lies by their door. A cat keeps to
// its own house: on the doorstep by day, and prowling round the walls after dark.
import { hash2, TAU } from '../engine/geom.mjs';
import { indoors } from './ambient.js';

export const petCoats = { dog: ['#8a6a45', '#3b3530', '#c9b48a', '#a0522d'], cat: ['#7d7a74', '#c98d4f', '#2f2b28', '#d9d1c2'] };

// The ground just outside a building's door.
function doorstep(p, out = 0.4) {
  const side = (p.at[0] - p.x) * -Math.sin(p.a) + (p.at[1] - p.y) * Math.cos(p.a) > 0 ? 1 : -1;
  const along = Math.max(-p.w / 2 + 0.3, Math.min(p.w / 2 - 0.3, (p.at[0] - p.x) * Math.cos(p.a) + (p.at[1] - p.y) * Math.sin(p.a)));
  const reach = p.d / 2 + out;
  return [p.x + Math.cos(p.a) * along - Math.sin(p.a) * side * reach, p.y + Math.sin(p.a) * along + Math.cos(p.a) * side * reach, Math.atan2(Math.cos(p.a) * side, -Math.sin(p.a) * side)];
}

// Make one for each view. Each frame, call it with the map, the pets, the actors, a lookup from an
// actor's id to where they are drawn ({ x, y, heading, moving }), the time in milliseconds, how dark it
// is from 0 to 1, and the seconds since the last frame. It gives each pet as { id, kind, coat, x, y,
// heading, moving, gone, lying }.
export function createPets() {
  const stood = new Map();
  return function placePets(map, pets, actors, at, time, dark, dt) {
    const out = [];
    for (const pet of pets ?? []) {
      const owner = actors.find(a => a.id === pet.owner), house = map.places.find(p => p.id === pet.home);
      const where = owner && at(owner.id), k = hash2(map.seed, pet.came ?? 0, 37);
      let tx, ty, face, lying = false, pace = 1.9;
      if (pet.kind === 'cat') {
        if (!house?.w) continue;
        const [dx, dy, out] = doorstep(house, 0.35);
        if (dark > 0.5) {
          // After dark the cat goes round the walls, slowly, stopping now and then.
          const a = time * 0.00012 + k * TAU, r = Math.max(house.w, house.d) * 0.5 + 0.45;
          tx = house.x + Math.cos(a) * r * (house.w / Math.max(house.w, house.d) + 0.2); ty = house.y + Math.sin(a) * r * (house.d / Math.max(house.w, house.d) + 0.2);
          pace = Math.sin(time * 0.0007 + k * 9) > 0.2 ? 0.5 : 0;
        } else { tx = dx + Math.cos(out + 1.6) * 0.25; ty = dy + Math.sin(out + 1.6) * 0.25; face = out; lying = true; }
      } else if (!owner || !where) {
        continue;
      } else if (indoors(owner)) {
        // Lies by the door of wherever its owner has gone in.
        const inside = map.places.find(p => p.id === owner.action.target) ?? house;
        if (!inside?.w) { tx = where.x; ty = where.y; } else { const [dx, dy, out] = doorstep(inside, 0.5); tx = dx; ty = dy; face = out; }
        lying = true;
      } else if (where.moving) {
        // At the owner's heels, a step behind and to one side.
        const h = where.heading ?? 0;
        tx = where.x - Math.cos(h) * 0.5 - Math.sin(h) * 0.22; ty = where.y - Math.sin(h) * 0.5 + Math.cos(h) * 0.22;
        pace = 2.6;
      } else {
        // While the owner works the dog lies nearby, and every so often goes off to sniff about.
        const span = 45000, turn = Math.floor((time + k * span) / span), f = ((time + k * span) % span) / span;
        const roving = f > 0.7 && hash2(map.seed, turn, 41 + (pet.came ?? 0)) < 0.7;
        const a = hash2(map.seed, turn, 43) * TAU, r = roving ? 1.6 + hash2(map.seed, turn, 47) * 1.6 : 0.75;
        tx = where.x + Math.cos(a) * r; ty = where.y + Math.sin(a) * r;
        if (roving) { const wob = Math.sin(time * 0.002) * 0.4; tx += Math.cos(a + 1.6) * wob; ty += Math.sin(a + 1.6) * wob; pace = 1.2; }
        else { lying = true; face = Math.atan2(where.y - ty, where.x - tx); }
      }
      const was = stood.get(pet.id), cur = was ?? { x: tx, y: ty, gone: 0, heading: face ?? 0 };
      const gap = Math.hypot(tx - cur.x, ty - cur.y), step = gap > 8 ? gap : Math.min(gap, dt * Math.max(pace, gap > 1.5 ? 3 : 0));
      if (gap) { cur.x += (tx - cur.x) / gap * step; cur.y += (ty - cur.y) / gap * step; cur.gone += step; }
      const moving = gap - step > 0.04 && step > 0;
      if (moving) cur.heading = Math.atan2(ty - cur.y, tx - cur.x);
      else if (face !== undefined) cur.heading = face;
      stood.set(pet.id, cur);
      out.push({ id: pet.id, kind: pet.kind, coat: petCoats[pet.kind][pet.coat ?? 0] ?? petCoats[pet.kind][0], name: pet.name,
        x: cur.x, y: cur.y, heading: cur.heading, moving, gone: cur.gone, lying: lying && !moving });
    }
    for (const id of stood.keys()) if (!out.some(p => p.id === id)) stood.delete(id);
    return out;
  };
}

export const SHOE_WEAR = 160;
export const shoeJob = 'repairShoes';
export const shoeRepair = { label: 'Mending my shoes', task: 'shoe repair', duration: 36,
  takes: { leather: 1 }, makes: {}, indoors: true };

export const wornShoes = actor => (actor.shoeWear ?? 0) >= SHOE_WEAR;

export function walkingFatigue(actor, distance) {
  const wear = actor.shoeWear ?? 0;
  actor.shoeWear = Math.min(SHOE_WEAR, wear + distance);
  // Only the part of the walk made on worn soles adds this extra fatigue.
  return 0.05 * Math.max(0, wear + distance - SHOE_WEAR);
}

// Raw portions age from the moment they enter the hall's stocks. Work uses the oldest first.
export const FRESH_LIFE = 30 * 60;
const RAW_FOOD = ['fish', 'game', 'meat'];

export function trackFreshChange(world, item, change) {
  const batches = world.freshFood?.[item];
  if (!batches || !change) return;
  if (change > 0) {
    const expires = world.minute + FRESH_LIFE;
    const latest = batches.at(-1);
    if (latest?.expires === expires) latest.quantity += change;
    else batches.push({ expires, quantity: change });
    return;
  }
  let used = -change;
  while (used > 0 && batches.length) {
    const batch = batches[0];
    if (used < batch.quantity) {
      batch.quantity -= used;
      break;
    }
    used -= batch.quantity;
    batches.shift();
  }
}

export function normalizeFreshFood(world) {
  const food = world.freshFood ??= {};
  for (const item of RAW_FOOD) {
    const batches = food[item] ??= [];
    const recorded = batches.reduce((quantity, batch) => quantity + batch.quantity, 0);
    // Legacy stock has no catch time. Give it a full interval from migration.
    trackFreshChange(world, item, world.supplies[item] - recorded);
  }
}

export function nextFreshExpiry(world, item) {
  return world.freshFood?.[item]?.[0]?.expires;
}

export function spoilFreshFood(world) {
  const spoiled = {};
  for (const item of RAW_FOOD) {
    const batches = world.freshFood[item];
    let loss = 0;
    while (batches[0]?.expires <= world.minute) loss += batches.shift().quantity;
    if (loss) {
      world.supplies[item] -= loss;
      spoiled[item] = loss;
    }
  }
  return spoiled;
}

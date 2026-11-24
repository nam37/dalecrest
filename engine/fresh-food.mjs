// Stock totals serve the existing stores and menus. Batches keep the origins and age of each portion.
export const FRESH_LIFE = 30 * 60;
export const produceFoods = { peas: 'a bowl of peas', apples: 'an apple' };
const LIFE = { fish: FRESH_LIFE, game: FRESH_LIFE, meat: FRESH_LIFE, mutton: FRESH_LIFE, peas: 3 * 1440, apples: 45 * 1440 };
const TRACKED = [...Object.keys(LIFE), 'cooked', 'preserved'];
export const larderFoods = ['peas', 'apples', 'preserved'];
const UNKNOWN = { unknown: 1 };

export const batchTotal = batches => (batches || []).reduce((total, batch) => total + batch.quantity, 0);

export function cottageBatches(cottage, item, create = false) {
  if (!create) return item === 'preserved' ? cottage?.preservedFood : cottage?.produce?.[item];
  if (item === 'preserved') return cottage.preservedFood ??= [];
  return (cottage.produce ??= {})[item] ??= [];
}

const expiry = (world, item) => LIFE[item] ? world.minute + LIFE[item] : undefined;

export function foodMix(amounts) {
  const sources = Object.keys(amounts).sort();
  const total = sources.reduce((sum, source) => sum + amounts[source], 0);
  if (total) return Object.fromEntries(sources.map(source => [source, amounts[source] / total]));
}

function sameMix(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([source, share]) => b[source] === share);
}

export function putFoodBatch(batches, quantity, origins, expires) {
  if (!quantity) return;
  const last = batches.at(-1);
  if (last && last.expires === expires && sameMix(last.origins, origins)) {
    last.quantity += quantity;
  } else {
    batches.push({ quantity, ...(expires != null && { expires }), ...(origins && { origins }) });
  }
}

export function takeFoodBatches(batches, quantity, destination) {
  const amounts = {};
  let remaining = quantity;
  while (remaining > 0 && batches.length) {
    const batch = batches[0], taken = Math.min(remaining, batch.quantity);
    for (const [source, share] of Object.entries(batch.origins ?? UNKNOWN)) {
      amounts[source] = (amounts[source] || 0) + share * taken;
    }
    if (destination) putFoodBatch(destination, taken, batch.origins, batch.expires);
    remaining -= taken;
    batch.quantity -= taken;
    if (batch.quantity === 0) batches.shift();
  }
  if (remaining > 0) {
    amounts.unknown = (amounts.unknown || 0) + remaining;
    if (destination) putFoodBatch(destination, remaining);
  }
  return amounts;
}

export function addStock(world, item, quantity, origins) {
  world.supplies[item] += quantity;
  const batches = world.freshFood?.[item];
  if (batches) putFoodBatch(batches, quantity, origins, expiry(world, item));
}

export function takeStock(world, item, quantity, destination) {
  world.supplies[item] -= quantity;
  const batches = world.freshFood?.[item];
  if (batches) return takeFoodBatches(batches, quantity, destination);
  return item === 'bread' ? { bread: quantity } : {};
}

export function normalizeFreshFood(world) {
  const food = world.freshFood ??= {};
  for (const item of TRACKED) {
    const batches = food[item] ??= [];
    const difference = world.supplies[item] - batchTotal(batches);
    // Existing portions keep their recorded expiry. Only unrecorded raw stock gets a new one.
    if (difference > 0) putFoodBatch(batches, difference, undefined, expiry(world, item));
    if (difference < 0) takeFoodBatches(batches, -difference);
  }
}

export function nextFreshExpiry(world, item) {
  return world.freshFood?.[item]?.[0]?.expires;
}

export function spoilFreshFood(world) {
  const spoiled = {};
  for (const item of Object.keys(LIFE)) {
    const loss = expireBatches(world.freshFood[item], world.minute);
    if (loss) {
      world.supplies[item] -= loss;
      spoiled[item] = loss;
    }
  }
  return spoiled;
}

function expireBatches(batches, minute) {
  let loss = 0;
  for (let i = batches.length - 1; i >= 0; i--) {
    if (!(batches[i].expires <= minute)) continue;
    loss += batches[i].quantity;
    batches.splice(i, 1);
  }
  return loss;
}

export function spoilCottageProduce(world) {
  for (const cottage of Object.values(world.cottages || {})) {
    if (!cottage.produce) continue;
    for (const [item, batches] of Object.entries(cottage.produce)) {
      expireBatches(batches, world.minute);
      if (!batches.length) delete cottage.produce[item];
    }
    if (!Object.keys(cottage.produce).length) delete cottage.produce;
  }
}

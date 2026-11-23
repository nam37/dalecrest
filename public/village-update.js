const sections = ['eventVersion', 'locations', 'affairs', 'planner', 'tickMinutes', 'tickMs'];
const lists = ['actors', 'events'];
const equal = (a, b) => a === b ||
  (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));
export const sameGround = (a, b) => a?.seed === b?.seed && a?.revision === b?.revision;

function changedFields(before, after) {
  const set = Object.fromEntries(Object.entries(after).filter(([key, value]) => !equal(before[key], value)));
  const remove = Object.keys(before).filter(key => !Object.hasOwn(after, key));
  if (Object.keys(set).length || remove.length) return { set, ...(remove.length && { remove }) };
}

function changedRows(before, after) {
  const old = new Map(before.map(row => [row.id, row]));
  const rows = [];
  for (const row of after) {
    const change = changedFields(old.get(row.id) ?? {}, row);
    if (change) rows.push({ id: row.id, ...change });
  }
  const reordered = before.length !== after.length || before.some((row, i) => row.id !== after[i].id);
  if (reordered || rows.length) return { ...(reordered && { order: after.map(row => row.id) }), rows };
}

export function villageChanges(before, after) {
  const changes = {};
  if (!sameGround(before.map, after.map)) changes.map = after.map;
  const world = changedFields(before.world, after.world);
  if (world) changes.world = world;
  for (const key of lists) {
    const change = changedRows(before[key], after[key]);
    if (change) changes[key] = change;
  }
  for (const key of sections) if (!equal(before[key], after[key])) changes[key] = after[key];
  return changes;
}

function applyFields(before, { set, remove }) {
  const after = { ...before, ...set };
  for (const key of remove ?? []) delete after[key];
  return after;
}

function applyRows(before, { order, rows }) {
  const byId = new Map(before.map(row => [row.id, row]));
  for (const row of rows) byId.set(row.id, applyFields(byId.get(row.id), row));
  return (order ?? before.map(row => row.id)).map(id => {
    if (!byId.has(id)) throw new Error('The village stream is missing a record.');
    return byId.get(id);
  });
}

export function applyVillageChanges(before, changes) {
  const after = { ...before };
  for (const key of sections) if (Object.hasOwn(changes, key)) after[key] = changes[key];
  for (const key of lists) if (changes[key]) after[key] = applyRows(before[key], changes[key]);
  if (changes.world) after.world = applyFields(before.world, changes.world);
  if (changes.map) after.map = changes.map;
  return after;
}

const fabrics = [
  ['#879472', '#526447', '#b2ba89'], ['#b87652', '#87472e', '#d29365'],
  ['#82918b', '#465d5c', '#a8b5a4'], ['#bd9659', '#84623d', '#dfbc79'],
  ['#a38a91', '#705961', '#bf9da0'], ['#8a6b4e', '#604732', '#b58b63'],
  ['#a96959', '#774538', '#d5967e'], ['#7e8899', '#535a70', '#a3a9b1'],
];
const complexions = [
  ['#e3b58c', '#b77c5a', '#f4d4a5'], ['#cd9b73', '#9c6448', '#e7b88d'],
  ['#b98258', '#87513a', '#d3a073'], ['#9a684b', '#694333', '#bf8864'],
  ['#dca481', '#a46751', '#f3c19e'], ['#e6bd97', '#ab7760', '#f6d9b0'],
];
const hairColors = [
  ['#49392e', '#826047'], ['#734b35', '#a86e4c'], ['#342c29', '#645247'],
  ['#a0764e', '#c79864'], ['#6d6456', '#a89a82'], ['#574435', '#8c6a4d'],
];
const headwear = ['straw', 'coif', 'hood', 'bare', 'cap'];

// Each feature has its own deterministic value so adding a feature does not change the others.
export function appearanceVariation({ version, seed }, feature) {
  const key = `dalecrest-portrait-v${version}/${seed}/${feature}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x100000000;
}

export function createAppearance({ id, arrived }) {
  // A later traveller may reuse a departed resident's id.
  const seed = arrived == null ? id : `${id}@${arrived}`;
  const identity = { version: 1, seed };
  const pick = (feature, options) => options[Math.floor(appearanceVariation(identity, feature) * options.length)];
  return {
    ...identity,
    cloth: [...pick('fabric', fabrics)],
    skin: [...pick('complexion', complexions)],
    hair: [...pick('hair', hairColors)],
    headwear: pick('headwear-style', headwear),
  };
}

// Old snapshots can still be drawn before the simulation saves their initial appearance.
export const appearanceOf = person => person.appearance ?? createAppearance(person);

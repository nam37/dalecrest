const woodcut = (file, caption, alt) => ({ src: '/daily-art/' + file + '.webp', caption, alt: 'Woodcut of ' + alt });

export const dailyIllustrations = {
  oven: [
    woodcut('oven', 'The common oven', 'round loaves and a baker’s peel beside the domed oven.'),
    woodcut('oven-workbench', 'At the baking bench', 'flour-dusted hands scoring loaves with the oven behind them.'),
    woodcut('oven-cooling-rack', 'Fresh loaves on the rack', 'three loaves cooling by an open shutter.'),
  ],
  mill: [
    woodcut('mill', 'The riverside mill', 'a timber mill and its wooden waterwheel beside the millrace.'),
    woodcut('millstones', 'The millstones', 'a millstone, wooden grain hopper, and tied sack inside the mill.'),
    woodcut('mill-sluice', 'The millrace sluice', 'water rushing beneath a wooden sluice gate.'),
  ],
  fields: [
    woodcut('fields', 'The barley fields', 'barley stalks and bound sheaves looking out over the village fields.'),
    woodcut('field-furrows', 'The barley furrows', 'a wooden hoe at the edge of furrows and young barley.'),
    woodcut('barley-cart', 'Loading the barley cart', 'a cart of barley sheaves with a sickle in the foreground.'),
  ],
  hall: [
    woodcut('hall', 'The village hall', 'the timber village hall and its footpath from the common.'),
    woodcut('hall-benches', 'Inside the village hall', 'a trestle table and benches beneath the hall’s timber beams.'),
  ],
  storehouse: [
    woodcut('storehouse', 'The storehouse shelves', 'loaves, a sack, and folded linen beside a wooden tally board.'),
    woodcut('storehouse-doorway', 'At the storehouse door', 'a sack and a crate outside the storehouse’s open plank doors.'),
  ],
  well: [
    woodcut('well', 'The village well', 'a bucket and rope on a round stone well.'),
    woodcut('well-buckets', 'Drawing water', 'hands pouring from a wooden bucket by the stone well.'),
  ],
  wood: [
    woodcut('coppice', 'At the coppice', 'stacked logs and a chopping block among the trees.'),
    woodcut('hazel-rods', 'Hazel rods from the coppice', 'tied hazel rods leaning against a sprouting stump.'),
  ],
  orchard: [
    woodcut('orchard', 'The apple orchard', 'apple trees with russet fruit and a woven picking basket.'),
    woodcut('orchard-blossoms', 'Apple blossom', 'flowering apple trees over a woven fence.'),
  ],
  cottage: [woodcut('thatched-cottage', 'A village cottage', 'a thatched cottage with a wicker basket by the door.')],
  granary: [woodcut('threshing-barn', 'The threshing floor', 'barley sheaves and a flail inside a grain barn.')],
};

export function dailyIllustrationImage(day, illustration) {
  const subject = illustration?.subject;
  if (!Object.hasOwn(dailyIllustrations, subject)) return null;
  const images = dailyIllustrations[subject];
  return images.find(image => image.src === illustration.asset) ?? images[(day - 1) % images.length];
}

const subjectsByText = [
  ['oven', /\b(?:oven|bak(?:e|es|ed|ing))\b/i],
  ['mill', /\b(?:mill|millstones?|ground barley|grinding barley)\b/i],
  ['granary', /\b(?:barns?|granary|granaries|thresh(?:es|ed|ing)?)\b/i],
  ['fields', /\b(?:fields?|barley strips?|furrows?|gathered barley|gathering barley)\b/i],
  ['orchard', /\b(?:orchard|apple trees?|apple saplings?|picked apples|picking apples)\b/i],
  ['well', /\b(?:(?:the|village|new) well|wellkeeper)\b/i],
  ['storehouse', /\b(?:storehouse|counted the shelves|bread shelf)\b/i],
  ['hall', /\b(?:the hall|village hall)\b/i],
  ['cottage', /\bcottages?\b/i],
  ['wood', /\b(?:coppice|woodcut(?:ter|ting)?|firewood|billets?)\b/i],
];
const reportingKinds = new Set(['work', 'fieldnote', 'build', 'civic', 'observation']);

function placeSubject(id) {
  const kind = id?.replace(/-\d+$/, '');
  if (kind === 'field') return 'fields';
  if (kind === 'apple-orchard') return 'orchard';
  if (kind === 'barn') return 'granary';
  return Object.hasOwn(dailyIllustrations, kind) ? kind : undefined;
}

export function chooseDailyIllustration(lead, sources) {
  const byId = new Map(sources.map(record => [record.id, record]));
  const citations = new Set(lead.flatMap(paragraph => paragraph.sources));
  const candidates = new Map();
  for (const id of citations) {
    const record = byId.get(id);
    if (!record || record.kind === 'intention') continue;
    const subject = placeSubject(record.workSite) ?? placeSubject(record.placeId)
      ?? subjectsByText.find(([, pattern]) => pattern.test(record.text))?.[0];
    if (!subject) continue;
    const weight = reportingKinds.has(record.kind) ? 2 : 1;
    const candidate = candidates.get(subject) ?? { subject, sourceId: id, weight, score: 0 };
    if (weight > candidate.weight) { candidate.sourceId = id; candidate.weight = weight; }
    candidate.score += weight;
    candidates.set(subject, candidate);
  }
  // Ties follow the order of the first supporting citation in the lead.
  const best = [...candidates.values()].sort((a, b) => b.score - a.score)[0];
  return best ? { subject: best.subject, sourceId: best.sourceId } : null;
}

export const dailyIllustrations = {
  oven: { src: '/daily-art/oven.webp', caption: 'The common oven', alt: 'Woodcut of round loaves and a baker’s peel beside the domed oven.' },
  mill: { src: '/daily-art/mill.webp', caption: 'The riverside mill', alt: 'Woodcut of a timber mill and its wooden waterwheel beside the millrace.' },
  fields: { src: '/daily-art/fields.webp', caption: 'The barley fields', alt: 'Woodcut of barley stalks and bound sheaves looking out over the village fields.' },
  hall: { src: '/daily-art/hall.webp', caption: 'The village hall', alt: 'Woodcut of the timber village hall and its footpath from the common.' },
  storehouse: { src: '/daily-art/storehouse.webp', caption: 'The storehouse shelves', alt: 'Woodcut of loaves, a sack, and folded linen beside a wooden tally board.' },
};

const subjectsByText = [
  ['oven', /\b(?:oven|bak(?:e|es|ed|ing))\b/i],
  ['mill', /\b(?:mill|millstones?|ground barley|grinding barley)\b/i],
  ['fields', /\b(?:fields?|barley strips?|furrows?|gathered barley|gathering barley)\b/i],
  ['storehouse', /\b(?:storehouse|counted the shelves|bread shelf)\b/i],
  ['hall', /\b(?:the hall|village hall)\b/i],
];
const reportingKinds = new Set(['work', 'fieldnote', 'build', 'civic', 'observation']);

function placeSubject(id) {
  const kind = id?.replace(/-\d+$/, '');
  if (kind === 'field') return 'fields';
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

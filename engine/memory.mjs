// A resident's memory. Each memory is something they saw, did or were told, with when and where it
// happened, who it concerned, where they had it from and how much it mattered. A resident keeps up to
// sixty. When there is no room, the least memorable old one goes: small things fade first, and a
// promise broken or a child born is kept. Recall for a request picks what bears on the people and place
// at hand, weighed against how recent and how important each memory is.

export const MEMORY_HOLDS = 60;
const DAY = 1440;

// How much a memory matters, from 1 to 10.
export function importanceOf(kind, details = {}) {
  if (Number.isFinite(details.importance)) return details.importance;
  if (kind === 'life') return 9;
  if (kind === 'goal') return 7;
  if (details.exchange && ['ask', 'accept', 'decline', 'release'].includes(details.exchange)) return 7;
  if (details.requestId) return 6;
  if (details.shortage) return 6;
  if (details.concern) return 5;
  if (kind === 'observation') return 4;
  if (kind === 'social') return 3;
  if (kind === 'fieldnote') return 1;
  return 2;
}

export function remember(actor, minute, text, actorIds, kind, details = {}) {
  const { importance, source, ...rest } = details;
  actor.memorySeq = (actor.memorySeq || 0) + 1;
  const at = actor.action?.phase === 'working' ? actor.action.target : null;
  actor.memories.push({ id: actor.memorySeq, minute, text, actorIds, kind, importance: importanceOf(kind, details),
    source: source || (rest.toldBy ? 'told' : kind === 'social' ? 'conversation' : 'witnessed'), ...(at && { place: at }), ...rest });
  while (actor.memories.length > MEMORY_HOLDS) forgetOne(actor, minute);
}

// Drops the least memorable memory, weighing importance against age. The newest is always kept.
function forgetOne(actor, minute) {
  let worst = 0, value = Infinity;
  actor.memories.forEach((m, i) => {
    if (i === actor.memories.length - 1) return;
    const v = (m.importance ?? 2) * 2 - (minute - m.minute) / DAY;
    if (v < value) { value = v; worst = i; }
  });
  actor.memories.splice(worst, 1);
}

// The memories that bear on a moment: what concerns these people or this place, what matters, and
// what is recent. Returned oldest first.
export function recall(actor, { minute, people = [], place = null, limit = 6 } = {}) {
  const scored = (actor.memories || []).map(m => {
    const recency = Math.exp(-(minute - m.minute) / (2 * DAY));
    const relevance = (people.some(id => m.actorIds?.includes(id) && id !== actor.id) ? 0.6 : 0) + (place && m.place === place ? 0.3 : 0);
    return { m, score: (m.importance ?? 2) / 10 + recency + relevance };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.m).sort((a, b) => a.minute - b.minute);
}

// Gives memories kept before they had ids and weights their ids, importance and source. Safe to repeat.
export function normalizeMemories(actor) {
  for (const m of actor.memories || []) {
    if (m.id != null) continue;
    actor.memorySeq = (actor.memorySeq || 0) + 1;
    m.id = actor.memorySeq;
    m.importance ??= importanceOf(m.kind, m);
    m.source ??= m.kind === 'social' ? 'conversation' : 'witnessed';
  }
}

// A key that names one memory across the village: the resident and the memory's number.
export const memoryKey = (actor, m) => actor.id + ':' + m.id;

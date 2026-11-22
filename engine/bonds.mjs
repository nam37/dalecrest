// What residents feel for one another, in two parts. Warmth is fondness: company and kindness raise it,
// and it fades between people who stop meeting. Trust is how far one would rely on the other: it moves
// on promises asked, kept and missed, as far as the resident knows of them. Both can fall. Mabel can stay
// fond of Oswin and still be slower to rely on him after a promise she believes he missed.
//
// actor.relationships holds warmth, as it always has. actor.trust holds trust. actor.evidence keeps the
// recorded moments behind either, so a goal about another resident can be weighed on what happened.

const clamp = (n, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
export const TRUST_START = 40;
// Warmth between residents who have not met for this long drifts back towards an acquaintance's.
const FADES_AFTER = 5 * 1440, ACQUAINTED = 25;
const EVIDENCE_KEPT = 40;

export const warmthOf = (actor, id) => actor.relationships?.[id] ?? 0;
export const trustOf = (actor, id) => actor.trust?.[id] ?? TRUST_START;

function note(actor, about, minute, kind, text, change) {
  if (!text) return;
  actor.evidence ??= [];
  actor.evidence.push({ minute, about, kind, text, ...change });
  if (actor.evidence.length > EVIDENCE_KEPT) actor.evidence.shift();
}

// A warm moment counts for less between people who are already close, so nobody simply fills up.
export function warm(actor, id, delta, minute, text) {
  const before = warmthOf(actor, id);
  const step = delta > 0 ? delta * Math.max(0.15, 1 - before / 110) : delta;
  actor.relationships ??= {};
  actor.relationships[id] = Math.round(clamp(before + step) * 100) / 100;
  (actor.met ??= {})[id] = minute;
  note(actor, id, minute, 'warmth', text, { warmth: Math.round((actor.relationships[id] - before) * 10) / 10 });
}

export function rely(actor, id, delta, minute, text) {
  const before = trustOf(actor, id);
  actor.trust ??= {};
  actor.trust[id] = Math.round(clamp(before + delta) * 100) / 100;
  note(actor, id, minute, 'trust', text, { trust: Math.round((actor.trust[id] - before) * 10) / 10 });
}

// Getting to know someone builds a little trust on its own, up to what an acquaintance earns. Beyond
// that, trust is earned by promises kept.
export function familiar(actor, id, minute) {
  if (trustOf(actor, id) < 58) rely(actor, id, 0.4, minute);
}

// At dawn, warmth between people who have not met for some days slips back a little.
export function fade(actor, minute) {
  for (const [id, value] of Object.entries(actor.relationships || {})) {
    const last = actor.met?.[id] ?? -Infinity;
    if (minute - last < FADES_AFTER || value <= ACQUAINTED) continue;
    actor.relationships[id] = Math.round((value - (value - ACQUAINTED) * 0.03) * 100) / 100;
  }
}

// What a resident's request to the action model says about someone else.
export const standingWith = (actor, id) => ({ warmth: Math.round(warmthOf(actor, id)), trust: Math.round(trustOf(actor, id)) });

// The recorded moments between this resident and another, newest last.
export const evidenceAbout = (actor, id) => (actor.evidence || []).filter(e => e.about === id);

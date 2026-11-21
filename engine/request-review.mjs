// A request belongs to both parties. Evidence about whether it is still needed belongs to the requester.
export const requestIsOpen = r => r?.status === 'asked' || r?.status === 'accepted';

export function ovenFact(actor, seen) {
  return { id: ['oven', actor.id, seen.minute].join('-'), topic: 'oven', observer: actor.name, observerId: actor.id,
    minute: seen.minute, text: seen.place + ' held ' + seen.flour + ' flour and ' + seen.wood + ' firewood.',
    site: seen.site, flour: seen.flour, wood: seen.wood };
}

function produced(fact, item) {
  if (fact.produced) return fact.produced[item];
  // Older work accounts stored the engine's exact result sentence. These two had no reserve count.
  const oldResult = { wood: ' stacked three bundles of dry wood.', flour: ' ground two measures of barley into three of flour.' };
  if (oldResult[item] && fact.text === fact.observer + oldResult[item]) return 3;
}

function updateFrom(r, fact, learnedAt, speaker, trace) {
  if (!fact || learnedAt < r.since || fact.id === r.evidence) return;
  const originalMinute = r.basedOn?.minute ?? Number(r.evidence?.match(/-(\d+)$/)?.[1] ?? r.since);
  if (fact.minute <= originalMinute) return;
  const count = fact.topic === 'oven' ? fact[r.item] : fact.stock?.[r.item];
  const added = fact.topic === 'work' ? produced(fact, r.item) : undefined;
  if (!Number.isFinite(count) && !(added > 0)) return;
  return { factId: fact.id, topic: fact.topic, account: fact.text, observerId: fact.observerId, observer: fact.observer, observedAt: fact.minute, learnedAt,
    ...(speaker && { toldBy: speaker }), ...(trace != null && { learnedTrace: trace }),
    ...(count != null && { count }), ...(added > 0 && { added }) };
}

function later(candidate, previous) {
  if (!candidate) return false;
  if (!previous || candidate.observedAt !== previous.observedAt) return !previous || candidate.observedAt > previous.observedAt;
  // At the same minute the reserve count gives more information than a delivery of unknown balance.
  if ((candidate.count != null) !== (previous.count != null)) return candidate.count != null;
  if (candidate.factId === previous.factId) return false;
  if (Boolean(candidate.toldBy) !== Boolean(previous.toldBy)) return !candidate.toldBy;
  return candidate.factId > previous.factId;
}

// Existing villages can already have open requests and personal observations when this feature starts.
export function currentUpdate(actor, r) {
  if (r.askerId !== actor.id || !requestIsOpen(r)) return;
  let latest = r.update;
  if (latest) return latest;
  const seen = actor.observations?.ovenStores;
  const work = actor.observations?.lastWork;
  const personal = [seen && ovenFact(actor, seen), work].filter(Boolean);
  for (const fact of personal) {
    const candidate = updateFrom(r, fact, fact.minute);
    if (later(candidate, latest)) latest = candidate;
  }
  for (const { fact, from, heardAt } of Object.values(actor.reports || {})) {
    const candidate = updateFrom(r, fact, heardAt, from);
    if (later(candidate, latest)) latest = candidate;
  }
  return latest;
}

export function noticeForRequests(actor, fact, minute, speaker, trace) {
  for (const r of Object.values(actor.helpBook || {})) {
    if (r.askerId !== actor.id || !requestIsOpen(r) || minute > r.due) continue;
    const update = updateFrom(r, fact, minute, speaker, trace);
    const previous = currentUpdate(actor, r);
    if (previous && !r.update) r.update = previous;
    if (!later(update, previous)) continue;
    r.update = update;
    actor.lastRequestNews = minute;
    if (actor.action.kind === 'waiting') {
      actor.action.since = minute;
      actor.action.why = 'learned more about the ' + r.item + ' request';
    }
  }
}

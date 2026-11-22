import { remember } from './civic.mjs';
import { formatDate } from './calendar.mjs';
import { currentUpdate, noticeForRequests, ovenFact, requestIsOpen } from './request-review.mjs';
import { bedJob, bedRepairRequest } from './village-work.mjs';
import { rely, standingWith, warm } from './bonds.mjs';

const supplies = {
  wood: { job: 'cut', terms: 'stack three bundles of firewood', low: 3, units: 3 },
  flour: { job: 'mill', terms: 'grind three measures of flour', low: 3, units: 3 },
  grain: { job: 'harvest', terms: 'bring in three measures of barley', low: 6, units: 3 },
  water: { job: 'draw', terms: 'fill four buckets at the well', low: 8, units: 4 }
};

export function villageTime(minute) {
  const clock = [Math.floor(minute / 60) % 24, minute % 60].map(n => String(n).padStart(2, '0')).join(':');
  return formatDate(minute) + ' at ' + clock;
}

function firsthand(actor, topic, minute, text, extra = {}) {
  return { id: [topic, actor.id, minute].join('-'), topic, observer: actor.name, observerId: actor.id, minute, text, ...extra };
}

export function noteWork(actor, world, text, delta) {
  const stock = {};
  for (const item of ['water', 'grain']) {
    if (!(delta[item] > 0)) continue;
    stock[item] = world.supplies[item];
    const previous = actor.observations?.lastWork?.stock?.[item];
    if (stock[item] < supplies[item].low && !(previous < supplies[item].low)) {
      actor.lastLowCount = { minute: world.minute, item };
    }
  }
  const count = Object.entries(stock).map(([item, units]) => ' The ' + item + ' reserve then held ' + units + ' units.').join('');
  const produced = Object.fromEntries(Object.entries(delta).filter(([item, change]) => supplies[item] && change > 0));
  const fact = firsthand(actor, 'work', world.minute, text + count,
    { stock, produced, ...(actor.action.commitmentId && { requestId: actor.action.commitmentId }) });
  noticeForRequests(actor, fact, world.minute, null, actor.action.basis?.trace);
  actor.observations ??= {};
  actor.observations.lastWork = fact;
}

function knownFacts(actor) {
  const seen = actor.observations?.ovenStores;
  const ownOven = seen && ovenFact(actor, seen);
  return [newest(ownOven, actor.reports?.oven?.fact),
    newest(actor.observations?.lastWork, actor.reports?.work?.fact)].filter(Boolean);
}

const newest = (own, reported) => !own || (reported && reported.minute > own.minute) ? reported : own;

export function knownStores(actor) {
  return newest(actor.observations?.ovenStores, actor.reports?.oven?.fact);
}

export function socialContext(actor, minute) {
  const heard = Object.values(actor.reports || {}).map(({ fact, from, heardAt }) => ({
    account: fact.text, witnessedBy: fact.observer, observed: villageTime(fact.minute), toldBy: from, heard: villageTime(heardAt)
  }));
  const requests = Object.values(actor.helpBook || {}).filter(r => minute <= r.due).map(r => {
    const news = currentUpdate(actor, r);
    return { requester: r.asker, helper: r.helper, terms: r.terms, status: r.status, due: villageTime(r.due),
      ...(r.helperId === actor.id && r.status === 'accepted' && { minutesLeftToFinish: r.due - minute }),
      standing: standingWith(actor, r.askerId === actor.id ? r.helperId : r.askerId),
      ...(news && { reasonToReconsider: {
        item: r.item, ...(r.basedOn && { originalCount: r.basedOn.count, originalReading: villageTime(r.basedOn.minute) }),
        account: news.account, witnessedBy: news.observer, witnessed: villageTime(news.observedAt),
        ...(news.toldBy && { toldBy: news.toldBy, heard: villageTime(news.learnedAt) }),
        ...(news.count != null && { observedReserve: news.count }), ...(news.added && { quantityAdded: news.added }),
        ...(r.reviewedFact === news.factId && { keptOpenOnThisEvidence: true })
      } }) };
  });
  const last = actor.observations?.lastWork;
  const past = (actor.requestMemories || []).slice(-3).reverse().map(r => ({
    requester: r.asker, helper: r.helper, terms: r.terms, due: villageTime(r.due), status: r.status,
    ...(r.status === 'unconfirmed' && { account: 'The deadline passed without word of the outcome.' }),
    ...(r.confirmation && { witnessedBy: r.helper, witnessed: villageTime(r.confirmation.observedAt),
      toldBy: r.confirmation.toldBy, heard: villageTime(r.confirmation.heardAt) })
  }));
  return { ...(last && { lastWork: { account: last.text, witnessed: villageTime(last.minute) } }),
    ...(heard.length && { heard }), ...(requests.length && { helpRequests: requests }), ...(past.length && { pastRequests: past }) };
}

const near = (a, b) => Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) <= 3;
const awake = a => a.action.kind !== 'rest' && a.action.kind !== 'arrive';

export function bedConversationChoices(actor, { actors, world }, menu) {
  const request = bedRepairRequest(actor, world);
  if (world.cottages?.[actor.home]?.brokenBed && !request && actor.id !== 'thomas' && !actor.askedAbout?.thomas?.bed) {
    const thomas = actors.find(other => other.id === 'thomas');
    if (thomas && awake(thomas)) {
      const target = thomas.action.target;
      menu.set(['ask', thomas.id, 'bed', actor.home, target].join(':'), {
        kind: 'conversation', verb: 'ask', label: 'Ask ' + thomas.name + ' to repair my bed', target,
        friendId: thomas.id, onSpot: near(actor, thomas), remaining: 2, repairSite: actor.home
      });
    }
  }
  for (const r of Object.values(actor.helpBook || {})) {
    if (r.job !== bedJob || r.helperId !== actor.id || r.status !== 'asked' || r.due < world.minute) continue;
    const asker = actors.find(other => other.id === r.askerId);
    if (!asker || !awake(asker)) continue;
    for (const verb of ['accept', 'decline']) {
      menu.set([verb, asker.id, r.id, asker.action.target].join(':'), {
        kind: 'conversation', verb, label: verb === 'accept' ? 'Promise ' + asker.name + ' to repair the bed' : 'Tell ' + asker.name + ' I cannot repair the bed',
        target: asker.action.target, friendId: asker.id, onSpot: near(actor, asker), remaining: 2, requestId: r.id
      });
    }
  }
}

// Visiting a more distant neighbour is possible. Delivery is checked in person at the destination.
export function conversationChoices(actor, state, menu) {
  const { actors, world, map } = state;
  const facts = knownFacts(actor).sort((a, b) => b.minute - a.minute);
  const shortages = facts.flatMap(fact => Object.entries(supplies).filter(([item, spec]) =>
    (fact.topic === 'oven' ? fact[item] : fact.stock?.[item]) < spec.low).map(([item, spec]) => ({ fact, item, spec })));
  const requests = Object.values(actor.helpBook || {}).filter(r => world.minute <= r.due);
  for (const other of actors) {
    if (other.id === actor.id) continue;
    const nearby = near(actor, other) && awake(other);
    const target = nearby ? map.places.find(p => p.stage === 2 &&
      Math.hypot(actor.position.x - p.at[0], actor.position.y - p.at[1]) <= 3)?.id : null;
    const destination = target || other.action.target || other.workplace;
    function offer(verb, label, data, key) {
      const id = [verb, other.id, key, destination].join(':');
      menu.set(id, { kind: 'conversation', verb, label, target: destination, friendId: other.id, onSpot: nearby, remaining: 2, ...data });
    }
    for (const fact of facts) {
      const report = actor.reports?.[fact.topic];
      if (fact.observerId === other.id || (report?.fact.id === fact.id && report.fromId === other.id) ||
          actor.told?.[other.id]?.[fact.topic] === fact.id) continue;
      offer('share', 'Tell ' + other.name + ' about ' + (fact.topic === 'oven' ? 'the oven count' : 'the work outcome') +
        ' witnessed by ' + fact.observer, { fact }, fact.id);
      if (!nearby) break;
    }
    // After another shift replaces lastWork, helpers can still report their own credited work.
    const records = [...requests, ...(actor.requestMemories || []).slice().reverse()];
    const receipt = records.find(r => r.askerId === other.id && r.proof && !r.reportedToAsker);
    if (receipt) offer('share', 'Tell ' + other.name + ' I completed the promised work to ' + receipt.terms,
      { fact: receipt.proof }, receipt.proof.id);
    for (const { fact, item, spec } of shortages) {
      if ((!nearby && other.trade !== spec.job) || (spec.job === 'mill' && other.trade !== 'mill')) continue;
      if (requests.some(r => r.askerId === actor.id && r.item === item && requestIsOpen(r)) ||
          requests.some(r => r.askerId === other.id && r.helperId === actor.id && r.item === item && requestIsOpen(r)) ||
          actor.askedAbout?.[other.id]?.[item] === fact.id) continue;
      offer('ask', 'Ask ' + other.name + ' (' + other.role + ') to ' + spec.terms +
        (fact.topic === 'oven' ? ' for the oven' : ' for the village'), { item, fact }, item + '-' + fact.id);
    }
    for (const r of requests.filter(r => !r.site && r.helperId === actor.id && r.askerId === other.id && r.status === 'asked')) {
      for (const verb of ['accept', 'decline']) {
        offer(verb, (verb === 'accept' ? 'Promise ' : 'Tell ') + other.name +
          (verb === 'accept' ? ' to ' : ' I decline to ') + r.terms,
          { requestId: r.id }, r.id);
      }
    }
    for (const r of requests.filter(r => r.askerId === actor.id && r.helperId === other.id)) {
      const update = currentUpdate(actor, r);
      if (!update || r.reviewedFact === update.factId) continue;
      const key = [r.id, r.status, update.factId].join(':');
      const review = { requestId: r.id, requestStatus: r.status, update };
      const here = { kind: 'review', onSpot: true, target: actor.action.target, remaining: 1, ...review };
      menu.set('retain:' + key, { ...here, verb: 'retain', label: 'Keep asking ' + other.name + ' to ' + r.terms });
      if (r.consideredFact !== update.factId) {
        menu.set('defer:' + key, { ...here, verb: 'defer', label: 'Set the request to ' + other.name + ' aside and decide about it later' });
      }
      offer('release', 'Tell ' + other.name + ' I no longer need help to ' + r.terms, review, key);
    }
  }
  for (const r of requests.filter(r => !r.site && r.helperId === actor.id && r.status === 'accepted')) {
    const shift = [...menu.values()].find(a => a.job === r.job && !a.commitmentId);
    if (shift) menu.set('help:' + r.id + ':' + shift.target, { ...shift, commitmentId: r.id,
      label: shift.label + ' for ' + r.asker + ' as promised' });
  }
}

// A new piece of evidence gets one explicit decision. Deferring returns the resident to their normal menu.
export function requestReviewMenu(actor, menu) {
  const pending = [...menu.values()].filter(a => a.verb === 'defer')
    .sort((a, b) => actor.helpBook[a.requestId].due - actor.helpBook[b.requestId].due);
  if (!pending.length) return menu;
  const first = pending[0];
  return new Map([...menu].filter(([, a]) => a.update && a.requestId === first.requestId));
}

function learn(actor, minute, why) {
  actor.lastSocialNews = minute;
  if (actor.action.kind === 'waiting') {
    actor.action.since = minute;
    actor.action.why = why;
  }
}

function receive(actor, speaker, fact, minute) {
  if (fact.observerId === actor.id) return;
  if (fact.kept && fact.topic === 'work') {
    const active = actor.helpBook?.[fact.requestId];
    const r = active || actor.requestMemories?.find(r => r.id === fact.requestId);
    if (r && actor.id === r.askerId && fact.observerId === r.helperId && fact.minute <= r.due &&
        ['accepted', 'released', 'unconfirmed'].includes(r.status)) {
      // Hearing late that a promise was kept makes up for having given it up.
      rely(actor, r.helperId, r.status === 'unconfirmed' ? 14 : 9, minute, r.helper + ' kept the promise to ' + r.terms + '.');
      warm(actor, r.helperId, 2, minute);
      r.status = 'kept';
      r.confirmation = { observedAt: fact.minute, heardAt: minute, toldBy: speaker.name };
      if (!active) storeRequestMemory(actor, r);
      learn(actor, minute, 'learned that ' + r.helper + ' had completed the promised work');
    }
  }
  noticeForRequests(actor, fact, minute, speaker.name, speaker.action.basis?.trace);
  const prior = actor.reports?.[fact.topic];
  if (prior && prior.fact.minute >= fact.minute) return;
  actor.reports ??= {};
  actor.reports[fact.topic] = { fact, from: speaker.name, fromId: speaker.id, heardAt: minute };
  learn(actor, minute, 'heard news from ' + speaker.name);
}

function saveRequest(actor, request) {
  actor.helpBook ??= {};
  const prior = actor.helpBook[request.id];
  actor.helpBook[request.id] = { ...request,
    ...(requestIsOpen(request) && prior?.update && { update: prior.update }),
    ...(requestIsOpen(request) && prior?.consideredFact && { consideredFact: prior.consideredFact }),
    ...(requestIsOpen(request) && prior?.reviewedFact && { reviewedFact: prior.reviewedFact }) };
}

function storeRequestMemory(actor, r) {
  const { id, askerId, asker, helperId, helper, terms, due, status, confirmation, proof, reportedToAsker } = r;
  const memory = { id, askerId, asker, helperId, helper, terms, due, status,
    ...(confirmation && { confirmation }), ...(proof && { proof, reportedToAsker: Boolean(reportedToAsker) }) };
  actor.requestMemories = [...(actor.requestMemories || []).filter(previous => previous.id !== id), memory].slice(-12);
}

function markSpoken(actor, recipient, bucket, key, id) {
  actor[bucket] ??= {};
  actor[bucket][recipient.id] ??= {};
  actor[bucket][recipient.id][key] = id;
}

function recordExchange(speaker, listener, minute, text, outcome, emit) {
  const ids = [speaker.id, listener.id];
  for (const participant of [speaker, listener]) {
    remember(participant, minute, text, ids, 'social', { exchange: outcome.verb, requestId: outcome.requestId });
    participant.lastChat = minute;
  }
  emit('social', text, ids, outcome);
}

export function missedConversation(actor, minute, emit, cause) {
  const { verb, label, friendId, requestId, basis } = actor.action;
  const text = actor.name + ' could not ' + label.replace(/^./, c => c.toLowerCase()) + ' because ' + cause + '.';
  remember(actor, minute, text, [actor.id], 'social');
  emit('social', text, [actor.id], { verb, delivered: false, to: friendId, cause, traceId: basis?.trace ?? null,
    ...(requestId && { requestId }), ...(actor.action.update && { evidence: actor.action.update }) });
}

export function finishConversation(actor, state, emit) {
  const { world } = state, minute = world.minute, { verb, fact, item, requestId, friendId, basis, repairSite } = actor.action;
  const other = state.actors.find(a => a.id === friendId);
  const traceId = basis?.trace ?? null;
  const request = world.helpRequests?.[requestId];
  if (!other || !awake(other) || !near(actor, other)) return missedConversation(actor, minute, emit, 'they did not meet');
  if (verb === 'release') {
    const alreadyKept = !request && other.helpBook?.[requestId]?.status === 'kept';
    if (!reviewStillApplies(actor, minute) || (!alreadyKept && request?.status !== actor.action.requestStatus)) {
      return missedConversation(actor, minute, emit, 'the request or the information behind the decision had changed');
    }
    if (request) {
      request.status = 'released';
      saveRequest(actor, request);
      saveRequest(other, request);
      delete world.helpRequests[requestId];
    } else {
      // The helper finished before this visit. Deliver the message without changing the credited shift.
      actor.helpBook[requestId].status = 'released';
    }
    learn(other, minute, 'was told that help was no longer needed');
    const text = actor.name + ' told ' + other.name + ' that help was no longer needed to ' + actor.helpBook[requestId].terms + '.';
    recordExchange(actor, other, minute, text, { verb, delivered: true, requestId, ...(request && { terms: { ...request } }),
      closedOpenRequest: Boolean(request), traceId, evidence: actor.action.update }, emit);
    return;
  }
  if (requestId && (!request || request.status !== 'asked' || request.due < minute)) {
    return missedConversation(actor, minute, emit, 'the request had closed');
  }
  let text, agreement;
  if (fact) {
    receive(other, actor, fact, minute);
    markSpoken(actor, other, 'told', fact.topic, fact.id);
  }
  if (verb === 'share') {
    if (fact.kept && fact.observerId === actor.id) {
      const receipt = actor.helpBook?.[fact.requestId] || actor.requestMemories?.find(r => r.id === fact.requestId);
      if (receipt?.askerId === other.id) receipt.reportedToAsker = true;
    }
    text = actor.name + ' told ' + other.name + ' what ' + fact.observer + ' witnessed on ' +
      villageTime(fact.minute) + '. ' + fact.text;
  } else if (verb === 'ask' && repairSite) {
    if (repairSite !== actor.home || !world.cottages?.[repairSite]?.brokenBed || bedRepairRequest(actor, world)) {
      return missedConversation(actor, minute, emit, 'the cottage no longer needed a new request');
    }
    const id = [actor.id, other.id, 'bed', minute].join('-');
    agreement = { id, askerId: actor.id, asker: actor.name, helperId: other.id, helper: other.name,
      item: 'bed', job: bedJob, site: repairSite, terms: 'repair the bed', since: minute, due: minute + 1440, status: 'asked' };
    world.helpRequests ??= {};
    world.helpRequests[id] = agreement;
    markSpoken(actor, other, 'askedAbout', 'bed', id);
    text = actor.name + ' asked ' + other.name + ' to repair the broken bed by ' + villageTime(agreement.due) + '.';
  } else if (verb === 'ask') {
    const id = [actor.id, other.id, item, minute].join('-');
    agreement = { id, askerId: actor.id, asker: actor.name, helperId: other.id, helper: other.name,
      item, job: supplies[item].job, quantity: supplies[item].units, terms: supplies[item].terms,
      since: minute, due: minute + 1440, status: 'asked', evidence: fact.id,
      basedOn: { minute: fact.minute, count: fact.topic === 'oven' ? fact[item] : fact.stock[item] } };
    world.helpRequests ??= {};
    world.helpRequests[id] = agreement;
    markSpoken(actor, other, 'askedAbout', item, fact.id);
    text = actor.name + ' told ' + other.name + ' about the ' + item + ' reserve and asked for help to ' +
      agreement.terms + ' by ' + villageTime(agreement.due) + '.';
  } else {
    request.status = verb === 'accept' ? 'accepted' : 'declined';
    agreement = request;
    if (verb === 'accept') rely(other, actor.id, 2, minute, actor.name + ' promised to ' + request.terms + '.');
    else {
      rely(other, actor.id, -3, minute, actor.name + ' declined to ' + request.terms + '.');
      warm(other, actor.id, -1.5, minute);
    }
    text = actor.name + (verb === 'accept' ? ' promised ' : ' declined ') + 'to ' +
      agreement.terms + ' for ' + other.name + ' by ' + villageTime(agreement.due) + '.';
  }
  if (agreement) {
    saveRequest(actor, agreement);
    saveRequest(other, agreement);
    learn(other, minute, verb === 'ask' ? 'was asked for help' : 'heard a reply');
    if (!requestIsOpen(agreement)) delete world.helpRequests[agreement.id];
  }
  recordExchange(actor, other, minute, text, { verb, delivered: true, traceId, ...(fact && { fact }),
    ...(verb === 'share' && fact.kept && { requestId: fact.requestId }),
    ...(agreement && { requestId: agreement.id, terms: { ...agreement } }) }, emit);
}

function reviewStillApplies(actor, minute) {
  const { requestId, requestStatus, update } = actor.action;
  const r = actor.helpBook?.[requestId];
  return r && r.status === requestStatus && minute <= r.due && currentUpdate(actor, r)?.factId === update.factId;
}

export function recordPrivateReview(actor, minute, emit) {
  const { verb, requestId, update, basis } = actor.action;
  if (!reviewStillApplies(actor, minute)) return;
  const r = actor.helpBook[requestId];
  r.update = update;
  if (verb === 'retain') r.reviewedFact = update.factId;
  const text = verb === 'retain' ? actor.name + ' decided to keep the request to ' + r.helper + ' to ' + r.terms + ' open.'
    : actor.name + ' put off deciding whether help from ' + r.helper + ' was still needed.';
  remember(actor, minute, text, [actor.id], 'social', { requestId });
  emit('social', text, [actor.id], { verb, requestId, evidence: update, traceId: basis?.trace ?? null });
}

export function settleHelp(actor, world, delta, emit) {
  const r = world.helpRequests?.[actor.action.commitmentId];
  if (!r || r.helperId !== actor.id || r.status !== 'accepted' || world.minute > r.due) return;
  const completed = r.job === bedJob ? actor.action.target === r.site && world.cottages?.[r.site]?.brokenBed === false : delta[r.item] >= r.quantity;
  if (!completed) return;
  r.status = 'kept';
  actor.observations.lastWork.kept = true;
  saveRequest(actor, r);
  actor.helpBook[r.id].proof = actor.observations.lastWork;
  delete world.helpRequests[r.id];
  const text = actor.name + ' completed the promised shift for ' + r.asker + '.';
  remember(actor, world.minute, text, [actor.id], 'work');
  emit('social', text, [actor.id], { verb: 'kept', requestId: r.id, terms: { ...r }, traceId: actor.action.basis?.trace ?? null });
}

export function expireHelp({ world, actors }, emit) {
  for (const r of Object.values(world.helpRequests || {})) {
    if (world.minute <= r.due) continue;
    r.status = r.status === 'asked' ? 'unanswered' : 'broken';
    const text = r.status === 'unanswered' ? r.asker + ' received no answer from ' + r.helper + ' before the request expired.'
      : r.helper + ' did not complete the promised shift for ' + r.asker + ' by the agreed time.';
    emit('social', text, [r.askerId, r.helperId], { verb: r.status, requestId: r.id, terms: { ...r } });
    delete world.helpRequests[r.id];
  }
  for (const a of actors) for (const r of Object.values(a.helpBook || {})) {
    if (world.minute <= r.due) continue;
    if (requestIsOpen(r)) {
      if (r.status === 'asked') r.status = 'unanswered';
      else r.status = a.id === r.helperId ? 'broken' : 'unconfirmed';
      if (a.id === r.askerId) {
        if (r.status === 'unanswered') rely(a, r.helperId, -5, world.minute, 'No answer came from ' + r.helper + ' before the request to ' + r.terms + ' ran out.');
        else rely(a, r.helperId, -10, world.minute, r.helper + ' promised to ' + r.terms + ', and no word came that it was done.');
      }
      learn(a, world.minute, 'reached the deadline for the request to ' + r.terms);
    }
    storeRequestMemory(a, r);
    delete a.helpBook[r.id];
  }
}

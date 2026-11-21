import { remember } from './civic.mjs';
import { formatDate } from './calendar.mjs';

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
  actor.observations ??= {};
  actor.observations.lastWork = firsthand(actor, 'work', world.minute, text + count,
    { stock, ...(actor.action.commitmentId && { requestId: actor.action.commitmentId }) });
}

function knownFacts(actor) {
  const seen = actor.observations?.ovenStores;
  const ownOven = seen && firsthand(actor, 'oven', seen.minute,
    seen.place + ' held ' + seen.flour + ' flour and ' + seen.wood + ' firewood.', { site: seen.site, flour: seen.flour, wood: seen.wood });
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
  const requests = Object.values(actor.helpBook || {}).filter(r => minute <= r.due).map(r => ({
    requester: r.asker, helper: r.helper, terms: r.terms, status: r.status, due: villageTime(r.due),
    relationship: actor.relationships[r.askerId === actor.id ? r.helperId : r.askerId] ?? 0
  }));
  const last = actor.observations?.lastWork;
  return { ...(last && { lastWork: { account: last.text, witnessed: villageTime(last.minute) } }),
    ...(heard.length && { heard }), ...(requests.length && { helpRequests: requests }) };
}

const near = (a, b) => Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) <= 3;
const awake = a => a.action.kind !== 'rest' && a.action.kind !== 'arrive';
const open = r => r.status === 'asked' || r.status === 'accepted';

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
    for (const { fact, item, spec } of shortages) {
      if ((!nearby && other.trade !== spec.job) || (spec.job === 'mill' && other.trade !== 'mill')) continue;
      if (requests.some(r => r.askerId === actor.id && r.item === item && open(r)) ||
          requests.some(r => r.askerId === other.id && r.helperId === actor.id && r.item === item && open(r)) ||
          actor.askedAbout?.[other.id]?.[item] === fact.id) continue;
      offer('ask', 'Ask ' + other.name + ' (' + other.role + ') to ' + spec.terms +
        (fact.topic === 'oven' ? ' for the oven' : ' for the village'), { item, fact }, item + '-' + fact.id);
    }
    for (const r of requests.filter(r => r.helperId === actor.id && r.askerId === other.id && r.status === 'asked')) {
      for (const verb of ['accept', 'decline']) {
        offer(verb, (verb === 'accept' ? 'Promise ' : 'Tell ') + other.name +
          (verb === 'accept' ? ' to ' : ' I decline to ') + r.terms,
          { requestId: r.id }, r.id);
      }
    }
  }
  for (const r of requests.filter(r => r.helperId === actor.id && r.status === 'accepted')) {
    const shift = [...menu.values()].find(a => a.job === r.job && !a.commitmentId);
    if (shift) menu.set('help:' + r.id + ':' + shift.target, { ...shift, commitmentId: r.id,
      label: shift.label + ' for ' + r.asker + ' as promised' });
  }
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
  if (fact.kept && actor.helpBook?.[fact.requestId]) actor.helpBook[fact.requestId].status = 'kept';
  const prior = actor.reports?.[fact.topic];
  if (prior && prior.fact.minute >= fact.minute) return;
  actor.reports ??= {};
  actor.reports[fact.topic] = { fact, from: speaker.name, fromId: speaker.id, heardAt: minute };
  learn(actor, minute, 'heard news from ' + speaker.name);
}

function saveRequest(actor, request) {
  actor.helpBook ??= {};
  actor.helpBook[request.id] = { ...request };
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
  emit('social', text, [actor.id], { verb, delivered: false, to: friendId, cause, traceId: basis?.trace ?? null, ...(requestId && { requestId }) });
}

export function finishConversation(actor, state, emit) {
  const { world } = state, minute = world.minute, { verb, fact, item, requestId, friendId, basis } = actor.action;
  const other = state.actors.find(a => a.id === friendId);
  const traceId = basis?.trace ?? null;
  const request = world.helpRequests?.[requestId];
  if (!other || !awake(other) || !near(actor, other)) return missedConversation(actor, minute, emit, 'they did not meet');
  if (requestId && (!request || request.status !== 'asked' || request.due < minute)) {
    return missedConversation(actor, minute, emit, 'the request had closed');
  }
  let text, agreement;
  if (fact) {
    receive(other, actor, fact, minute);
    markSpoken(actor, other, 'told', fact.topic, fact.id);
  }
  if (verb === 'share') {
    text = actor.name + ' told ' + other.name + ' what ' + fact.observer + ' witnessed on ' +
      villageTime(fact.minute) + '. ' + fact.text;
  } else if (verb === 'ask') {
    const id = [actor.id, other.id, item, minute].join('-');
    agreement = { id, askerId: actor.id, asker: actor.name, helperId: other.id, helper: other.name,
      item, job: supplies[item].job, quantity: supplies[item].units, terms: supplies[item].terms,
      since: minute, due: minute + 1440, status: 'asked', evidence: fact.id };
    world.helpRequests ??= {};
    world.helpRequests[id] = agreement;
    markSpoken(actor, other, 'askedAbout', item, fact.id);
    text = actor.name + ' told ' + other.name + ' about the ' + item + ' reserve and asked for help to ' +
      agreement.terms + ' by ' + villageTime(agreement.due) + '.';
  } else {
    request.status = verb === 'accept' ? 'accepted' : 'declined';
    agreement = request;
    text = actor.name + (verb === 'accept' ? ' promised ' : ' declined ') + 'to ' +
      agreement.terms + ' for ' + other.name + ' by ' + villageTime(agreement.due) + '.';
  }
  if (agreement) {
    saveRequest(actor, agreement);
    saveRequest(other, agreement);
    learn(other, minute, verb === 'ask' ? 'was asked for help' : 'heard a reply');
    if (!open(agreement)) delete world.helpRequests[agreement.id];
  }
  recordExchange(actor, other, minute, text, { verb, delivered: true, traceId, ...(fact && { fact }),
    ...(agreement && { requestId: agreement.id, terms: { ...agreement } }) }, emit);
}

export function settleHelp(actor, world, delta, emit) {
  const r = world.helpRequests?.[actor.action.commitmentId];
  if (!r || r.helperId !== actor.id || r.status !== 'accepted' || world.minute > r.due || !(delta[r.item] >= r.quantity)) return;
  r.status = 'kept';
  actor.observations.lastWork.kept = true;
  saveRequest(actor, r);
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
    if (world.minute > r.due) delete a.helpBook[r.id];
  }
}

import { agendaTitle, BYLAWS, concerns, isLodger, WORKS } from './civic.mjs';
import { remember } from './memory.mjs';
import { placeAt } from './roads.mjs';
import { isFamilyCottage } from './families.mjs';

// An issue can return to the moot. A witness to last year's motion knows nothing of this one yet.
const edition = p => p.since + ':' + p.key;
const accountOf = (actor, p) => actor.observations?.civic?.[edition(p)];
const farmer = actor => ['harvest', 'mill'].includes(actor.trade);
const nearby = (a, b) => Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) <= 3;
const siteOf = (actor, map) => placeAt(map, [actor.position.x, actor.position.y])?.id ?? null;

function motionsFor(actor, world) {
  const motions = world.proposals || [];
  if (!world.moot?.attendees?.includes(actor.id)) return motions;
  // Business that was read aloud stays on this voter's ballot until the moot ends.
  return [...motions, ...world.moot.agenda.filter(item => !motions.some(p => edition(p) === edition(item)))];
}

function terms(p) {
  const work = WORKS[p.kind];
  return work ? { shifts: work.need, wood: work.wood } : { adultBread: BYLAWS[p.kind].adultBread };
}

function termsText(claim) {
  return claim.adultBread != null ? claim.adultBread + ' loaves a day per adult'
    : claim.shifts + ' shifts of work and ' + claim.wood + ' bundles of wood';
}

function rememberNews(actor, p, state, news, text, speaker) {
  actor.observations ??= {};
  const book = actor.observations.civic ??= {};
  const current = new Set(motionsFor(actor, state.world).map(edition));
  for (const key of Object.keys(book)) if (!current.has(key)) delete book[key];
  const minute = state.world.minute;
  const observation = actor.id + ':' + ((actor.memorySeq || 0) + 1);
  news = { ...news, chain: [...news.chain, { resident: actor.id, minute, observation }] };
  remember(actor, minute, text, [...new Set([speaker.id, actor.id])], 'observation', {
    source: news.source, concern: p.key, civicNews: news,
    ...(speaker !== actor && { toldBy: speaker.id }), place: news.place ?? null,
  });
  book[edition(p)] = news;
  p.heard ??= [];
  if (!p.heard.includes(actor.id)) p.heard.push(actor.id);
  return news;
}

// The old proposal lists say who raised, backed or heard the matter. They kept neither the
// witness chain nor a record of terms read aloud. Record the recovery now, without backdating it.
export function normalizeCivicNews(state) {
  for (const p of state.world.proposals || []) {
    if (p.positions) continue;
    p.positions = {};
    const known = new Set([p.by, ...(p.supporters || []), ...(p.heard || [])]);
    for (const actor of state.actors) {
      if (!known.has(actor.id)) continue;
      const title = agendaTitle(p, state);
      const news = rememberNews(actor, p, state, { title, proposedBy: p.by, raised: p.since,
        origin: 'earlier proposal record', source: 'earlier proposal record', witness: null, observed: null,
        claim: null, chain: [] }, 'The earlier proposal record names ' + actor.name +
        ' among those who knew of the motion for ' + title + '.', actor);
      if (p.supporters?.includes(actor.id)) p.positions[actor.id] = { position: 'support',
        source: news.origin, minute: null, traceId: null, observationKeys: news.chain.map(hop => hop.observation) };
    }
  }
}

// Reading the motion at the hall also lets someone check a figure that came by word of mouth.
export function witnessProposal(actor, p, state, { speaker = actor, place, traceId, announcement } = {}) {
  const prior = accountOf(actor, p);
  if (prior?.source === 'witnessed') return prior;
  const title = agendaTitle(p, state), claim = terms(p);
  const news = { title, proposedBy: p.by, raised: p.since, witness: actor.id, observed: state.world.minute,
    source: 'witnessed', claim, chain: [], ...(place && { place }), ...(traceId != null && { traceId }) };
  if (p.grainCount) news.grainCount = { ...p.grainCount };
  // The reading settles the official terms. Keep what this voter heard on the way to the hall too.
  if (prior) news.previousReport = { claim: prior.claim, chain: prior.chain, toldBy: prior.toldBy,
    source: prior.source, ...(prior.origin && { origin: prior.origin }), witness: prior.witness };
  const text = announcement || actor.name + ' witnessed the motion for ' + title + ', calling for ' + termsText(claim) + '.';
  return rememberNews(actor, p, state, news, text, speaker);
}

// Called only at a real encounter. A second-hand estimate can gain four shifts in the telling.
// The motion and the first witness's observation keep their original figures.
export function shareProposalNews(a, b, state, random) {
  if (!nearby(a, b)) return null;
  for (const [speaker, listener] of [[a, b], [b, a]]) {
    for (const p of state.world.proposals) {
      const prior = accountOf(speaker, p);
      if (!prior || prior.chain.some(hop => hop.resident === listener.id)) continue;
      const known = accountOf(listener, p);
      if (known && (known.claim || !prior.claim) && known.chain.length <= prior.chain.length + 1) continue;
      if (known?.claim && !prior.claim) continue;
      const claim = prior.claim && { ...prior.claim };
      if (prior.source === 'told' && claim?.shifts != null && random() < 0.15) claim.shifts += 4;
      const text = speaker.name + ' told ' + listener.name + ' about the motion for ' + prior.title +
        (claim ? ', reckoned at ' + termsText(claim) : '') + '.';
      const { previousReport, ...report } = prior;
      const news = rememberNews(listener, p, state, { ...report, source: 'told', claim,
        toldBy: speaker.id, place: siteOf(speaker, state.map) }, text, speaker);
      return { key: p.key, text, listenerId: listener.id, details: { civic: 'news', proposalKey: p.key, title: prior.title, news } };
    }
  }
  return null;
}

export function civicContext(actor, world) {
  const reports = motionsFor(actor, world).flatMap(p => {
    const news = accountOf(actor, p);
    return news ? [{ proposalKey: p.key, ...news, ownPosition: p.positions?.[actor.id]?.position || null }] : [];
  });
  const grain = actor.observations?.grain;
  return { ...(reports.length && { civicNews: reports }), ...(grain && { lastGrainCount: grain }) };
}

export function civicObservationKeys(actor, world) {
  const { civicNews = [], lastGrainCount } = civicContext(actor, world);
  return [...new Set([lastGrainCount?.observation, ...civicNews.flatMap(news => [news.grainCount?.observation,
    ...[...news.chain, ...(news.previousReport?.chain || [])].map(hop => hop.observation)])].filter(Boolean))];
}

function possibleMotions(actor, state) {
  const { world, actors } = state;
  const motions = [];
  const add = (kind, localScore, key = kind) => {
    if (world.cooldown?.[key] > world.minute || world.proposals.some(p => p.key === key) ||
        world.projects.some(p => p.key === key)) return;
    motions.push({ key, kind, localScore });
  };
  const grain = actor.observations?.grain;
  const shortage = item => actor.memories.some(m => m.shortage === item && world.minute - m.minute <= 2880);
  const recentGrain = grain && world.minute - grain.minute <= 2880 ? grain : null;
  const lowGrain = shortage('grain') || Boolean(recentGrain && recentGrain.grain < actors.length);
  const knownWorld = { ...world, supplies: { ...world.supplies, grain: recentGrain?.grain ?? 0 },
    capacity: { ...world.capacity, grain: recentGrain?.capacity ?? world.capacity.grain },
    strain: { ...world.strain, grain: lowGrain ? 2 : 0 } };
  for (const c of concerns(actor, { ...state, world: knownWorld })) {
    // Public buildings and the number of neighbours can ground a case. A case about a reserve
    // also needs something this resident has handled or heard about.
    if (c.kind === 'cottage' && c.key !== 'cottage:' + actor.id && !isFamilyCottage(c.key)) continue;
    if (c.kind === 'field' && !farmer(actor)) continue;
    if (c.kind === 'granary' && (!farmer(actor) || !recentGrain)) continue;
    if (c.kind === 'well' && (actor.trade !== 'draw' || (world.capacity.water >= actors.length * 2 && !shortage('water')))) continue;
    if (c.kind === 'oven' && (actor.trade !== 'bake' || (world.capacity.bread >= actors.length * 2 && !shortage('bread')))) continue;
    if (c.kind === 'alehouse' && !actor.traits.includes('gregarious')) continue;
    add(c.kind, c.weight, c.key);
  }
  if (world.bylaws?.allowance == null) add('allowance', actor.trade === 'keep' ? 50 : 20);
  return motions.sort((a, b) => b.localScore - a.localScore);
}

const positions = { support: 'Speaking for', oppose: 'Speaking against', undecided: 'Reserving judgment on' };

function localPosition(actor, p, news, state) {
  if (p.kind === 'cottage' && farmer(actor) && state.world.proposals.some(other => other.kind === 'field' && accountOf(actor, other))) return 'oppose';
  if (p.kind === 'field' && isLodger(actor, state.map)) return 'oppose';
  if (news.source === 'told' && news.claim?.shifts > 30 && actor.traits.includes('reserved')) return 'undecided';
  return 'support';
}

export function civicChoices(actor, state, menu) {
  const target = siteOf(actor, state.map);
  for (const p of possibleMotions(actor, state)) {
    const title = agendaTitle(p, state);
    menu.set('civic:raise:' + p.key, { kind: 'civic', verb: 'raise', proposalKey: p.key, proposalKind: p.kind,
      label: 'Proposing ' + title + ' to the moot', onSpot: true, target, remaining: 1,
      localScore: p.localScore, reason: 'I can bring this matter before the village.' });
  }
  for (const p of state.world.proposals) {
    const news = accountOf(actor, p);
    if (!news || p.positions?.[actor.id]) continue;
    const preference = localPosition(actor, p, news, state);
    // A better report received while the decision was in flight requires a new choice.
    const reportKey = news.chain.at(-1).observation;
    for (const [position, label] of Object.entries(positions)) {
      menu.set('civic:position:' + edition(p) + ':' + reportKey + ':' + position, { kind: 'civic', verb: 'position',
        proposalKey: p.key, since: p.since, position, label: label + ' ' + news.title,
        onSpot: true, target, remaining: 1, localScore: position === preference ? 76 : 10,
        reason: 'I have heard the motion and can give my view.',
        observationKeys: [news.grainCount?.observation, ...news.chain.map(hop => hop.observation)].filter(Boolean) });
    }
  }
}

export function enactCivicChoice(actor, state, emit) {
  const { world } = state, action = actor.action;
  let p = world.proposals.find(p => p.key === action.proposalKey);
  const traceId = action.decisionTraceId ?? null;
  if (action.verb === 'raise') {
    if (!possibleMotions(actor, state).some(m => m.key === action.proposalKey && m.kind === action.proposalKind)) return;
    p = { key: action.proposalKey, kind: action.proposalKind, by: actor.id, since: world.minute, supporters: [], heard: [], positions: {} };
    if (['granary', 'field'].includes(p.kind) && actor.observations?.grain) p.grainCount = { ...actor.observations.grain };
    world.proposals.push(p);
  } else if (action.verb !== 'position' || !Object.hasOwn(positions, action.position) ||
      !p || p.since !== action.since || !accountOf(actor, p) || p.positions?.[actor.id]) return;
  const raised = action.verb === 'raise';
  const position = raised ? 'support' : action.position;
  const title = agendaTitle(p, state);
  const observationKeys = action.observationKeys || (p.grainCount ? [p.grainCount.observation] : []);
  p.positions ??= {};
  p.positions[actor.id] = { position, minute: world.minute, traceId, observationKeys };
  p.supporters = (p.supporters || []).filter(id => id !== actor.id);
  if (position === 'support') p.supporters.push(actor.id);
  const details = { civic: raised ? 'proposal' : 'position', proposalKey: p.key, title, position, traceId, observationKeys };
  const words = raised ? ' put forward ' : position === 'support' ? ' spoke for ' : position === 'oppose' ? ' spoke against ' : ' reserved judgment on ';
  const cited = raised && p.grainCount ? ', citing a count of ' + p.grainCount.grain + ' measures of barley' : '';
  const text = actor.name + words + title + (raised ? ', calling for ' + termsText(terms(p)) : '') + cited + '.';
  const witnesses = [actor];
  if (raised) witnessProposal(actor, p, state, { traceId, place: action.target, announcement: text });
  if (raised) for (const other of state.actors) {
    if (other === actor || other.action.kind === 'rest' || other.action.phase === 'travelling' || !nearby(actor, other)) continue;
    witnessProposal(other, p, state, { speaker: actor, place: action.target, traceId, announcement: text });
    witnesses.push(other);
  }
  if (!raised) remember(actor, world.minute, text, [actor.id], 'social', { ...details, concern: p.key });
  emit('civic', text, witnesses.map(person => person.id), details, action.target);
  return details;
}

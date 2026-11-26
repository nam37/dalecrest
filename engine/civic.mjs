// How the village changes itself. Residents voice concerns that come from their own circumstances,
// win neighbours over in conversation, settle the matter at a moot, and then build what was agreed.
import { dist, clamp } from './geom.mjs';
import { place, placesOf, addNode, addEdge, walkLength, clearWalk, touch, route, walkingSegment } from './roads.mjs';
import { FIELD_NAMES, addPlace, pickLot, extendLane, fieldSite } from './sites.mjs';
import { prepareCottage } from './village-work.mjs';
import { GRANARY, foodDays, keepStores, mouths, ripen, storeDays } from './stores.mjs';
import { witnessProposal } from './civic-news.mjs';
import { weatherAt } from './seasons.mjs';
import { familyCottageNeeded, isFamilyCottage, lodgingFamilyOf, lodgingName, moveFamilyIn } from './families.mjs';

// Shifts of labour and bundles of wood each kind of work needs.
export const WORKS = {
  cottage: { need: 22, wood: 10, crew: 3, a: 'a cottage', the: 'the cottage' },
  field: { need: 16, wood: 0, crew: 4, a: 'a new field', the: 'the new field' },
  granary: { need: 30, wood: 12, crew: 4, a: 'a granary', the: 'the granary' },
  well: { need: 14, wood: 4, crew: 2, a: 'another well', the: 'the new well' },
  oven: { need: 18, wood: 5, crew: 3, a: 'a bakehouse', the: 'the bakehouse' },
  alehouse: { need: 34, wood: 14, crew: 4, a: 'an alehouse', the: 'the alehouse' },
};
const ALEHOUSES = ['The Barley Mow', 'The Plough', 'The Green Man', 'The Wheatsheaf'];
const PATH_WEAR = 12;
const dayLength = 1440;
const attendanceWindow = 40;
const eveningMoot = minute => minute - minute % dayLength + 19 * 60;

export const BYLAWS = { allowance: { a: 'a daily bread allowance of one and a half loaves per adult', adultBread: 1.5 } };
export const isLodger = (actor, map) => place(map, actor.home)?.kind !== 'cottage';
export { remember } from './memory.mjs';
import { remember } from './memory.mjs';
const slots = actors => 1 + Math.floor(actors.length / 10);
const ready = (p, actors) => p.supporters.length >= (p.kind === 'cottage' ? Math.max(2, Math.ceil(actors.length / 4)) : Math.max(3, Math.ceil(actors.length / 3)));
const lane = (map, site) => map.roads[site.road]?.name;
const whereabouts = (map, site) => lane(map, site) ? ' on ' + lane(map, site) : '';

// A field regrows two measures of barley a day, which is bread for about six people.
export const fieldsFeed = map => map.places.filter(p => p.kind === 'field').length * 6.5;

// What this resident would change about the village, strongest first.
export function concerns(actor, state) {
  const { world, actors, map } = state;
  const out = [], pop = actors.length;
  const add = (key, weight, claim) => {
    if (weight < 25 || world.cooldown[key] > world.minute || world.projects.some(p => p.key === key)) return;
    out.push({ key, kind: key.split(':')[0], weight, claim });
  };
  if (isLodger(actor, map)) {
    // A couple lodging together ask once, for the family.
    const spouse = actors.find(a => a.id === actor.spouse), sharing = spouse && spouse.home === actor.home && isLodger(spouse, map);
    const lodging = place(map, actor.home), children = world.cottages?.[actor.home]?.children?.length || 0;
    if (!sharing || actor.id < spouse.id) add('cottage:' + actor.id, sharing ? 95 : 90, actor.home === 'storehouse' ? 'that a cot among the storehouse shelves is no home'
      : lodging?.kind === 'barn' || lodging?.kind === 'alehouse' ? 'that a family of ' + (children + (sharing ? 2 : 1)) + ' cannot go on living in ' + lodgingName(lodging)
      : 'that a corner of the hall is no home');
  }
  for (const other of actors) {
    if (other === actor || !isLodger(other, map)) continue;
    add('cottage:' + other.id, 24 + (actor.relationships[other.id] || 0) * 0.5 + (actor.traits.includes('generous') ? 14 : 0)
      + (actor.trade === 'mend' ? 10 : 0), 'that ' + other.name + ' needs a cottage');
  }
  const familyCottage = (actor.trade === 'mend' || actor.trade === 'keep') && familyCottageNeeded(state);
  if (familyCottage) add(familyCottage, 67, 'that a family expected in Dalecrest needs a cottage');
  const farms = actor.trade === 'harvest' || actor.trade === 'mill';
  // Farmers ask for land before the village outgrows it; everyone asks once the stores run short.
  if (world.strain.grain >= 2) add('field', (farms ? 68 : 40) + world.strain.grain * 4, 'that the strips cannot feed ' + pop + ' mouths');
  else if (fieldsFeed(map) < pop + 1) add('field', farms ? 60 : 28, 'that the strips are stretched to feed ' + pop + ' and could not feed one more');
  // Whatever is in store when the fields stop growing has to last until the next harvest.
  if (storeDays(world, pop) < 150 && world.supplies.grain >= world.capacity.grain * 0.5) {
    add('granary', farms ? 62 : 30, 'that the barn and granaries cannot see ' + pop + ' people through a winter');
  }
  if (world.strain.water >= 2 || world.capacity.water < pop * 2) add('well', actor.trade === 'draw' ? 66 : 32, 'that one well cannot water ' + pop + ' residents');
  if (world.strain.bread >= 2 || world.capacity.bread < pop * 2) add('oven', actor.trade === 'bake' ? 64 : 32, 'that the oven cannot keep ' + pop + ' people in bread');
  if (pop >= 11 && !map.places.some(p => p.kind === 'alehouse')) {
    add('alehouse', (actor.traits.includes('gregarious') ? 46 : 22) + (actor.needs.loneliness > 55 ? 12 : 0), 'that Dalecrest wants an alehouse for the long evenings');
  }
  return out.sort((a, b) => b.weight - a.weight);
}

export { shareProposalNews as discuss } from './civic-news.mjs';

function siteScore(kind, state, owner, random) {
  const { map, actors } = state, green = place(map, 'green'), G = [green.x, green.y];
  const spot = lot => [lot.x, lot.y];
  if (kind === 'cottage') {
    const work = owner && place(map, owner.workplace);
    const friends = owner ? actors.filter(a => (owner.relationships[a.id] || 0) >= 40).map(a => place(map, a.home)).filter(Boolean) : [];
    return lot => -dist(spot(lot), G) - (work ? 0.2 * dist(spot(lot), work.at) : 0)
      + (friends.some(f => dist(spot(lot), f.at) < 7) ? 3 : 0) + random() * 2.5;
  }
  if (kind === 'granary') {
    const mill = place(map, 'mill');
    return lot => -0.6 * dist(spot(lot), G) - 0.35 * dist(spot(lot), mill.at) + random() * 2;
  }
  if (kind === 'alehouse') return lot => -dist(spot(lot), G) + (lot.way === 'road' ? 5 : 0) + random() * 2;
  // A further well or oven goes where homes are worst served by the ones that exist.
  const same = map.places.filter(p => p.kind === kind);
  let worst = null, far = -1;
  for (const home of map.places.filter(p => p.kind === 'cottage')) {
    const nearest = Math.min(...same.map(s => dist(s.at, home.at)));
    if (nearest > far) { far = nearest; worst = home; }
  }
  const T = worst ? worst.at : G;
  return lot => -dist(spot(lot), T) - 0.2 * dist(spot(lot), G) - (same.some(s => dist(s.at, spot(lot)) < 10) ? 50 : 0) + random() * 2;
}

// Chooses ground for an agreed work and stakes it out. Returns the new project, or null if no ground suits.
function begin(state, proposal, random, emit) {
  const { world, actors, map } = state, kind = proposal.kind, green = place(map, 'green');
  const owner = kind === 'cottage' ? actors.find(a => a.id === proposal.key.split(':')[1]) : null;
  if (kind === 'cottage' && (isFamilyCottage(proposal.key)
    ? familyCottageNeeded(state) !== proposal.key : !owner || !isLodger(owner, map))) return null;
  let site, props = { stage: 0, founded: world.minute };
  if (kind === 'field') {
    site = fieldSite(map, random);
    if (!site) return null;
    const used = new Set(map.places.map(p => p.name));
    props.name = FIELD_NAMES.find(n => !used.has(n)) || 'New field';
  } else {
    const turned = kind === 'cottage' && random() < 0.25;
    const score = siteScore(kind, state, owner, random);
    const houses = placesOf(map, 'cottage', false).length;
    site = pickLot(map, kind, score, { turned });
    if (!site || dist([site.x, site.y], [green.x, green.y]) > 10 + 2.4 * Math.sqrt(houses)) {
      const road = extendLane(map, random);
      if (road >= 0) {
        emit('build', 'With the good ground along the old ways taken, the villagers staked out ' + map.roads[road].name + '.');
        site = pickLot(map, kind, score, { turned }) || site;
      }
    }
    if (!site) return null;
    props.road = site.road;
    if (kind === 'granary') props.name = 'Granary';
    if (kind === 'oven') props.name = 'Bakehouse';
    if (kind === 'well') props.name = (lane(map, site) || 'New') + ' well';
    if (kind === 'alehouse') props.name = ALEHOUSES[Math.floor(random() * ALEHOUSES.length)];
    if (kind === 'well') site = { x: site.x, y: site.y, at: site.at };
  }
  const made = addPlace(map, kind, site, props);
  const project = { key: proposal.key, kind, id: made.id, need: WORKS[kind].need, wood: WORKS[kind].wood, done: 0, used: 0, since: world.minute, backers: proposal.supporters.slice() };
  if (owner) project.for = owner.id;
  world.projects.push(project);
  return project;
}

function describe(project, state) {
  if (isFamilyCottage(project.key)) return 'a cottage for an arriving family';
  const owner = project.for && state.actors.find(a => a.id === project.for);
  return owner ? 'a cottage for ' + ownerWords(owner, state.world) : WORKS[project.kind].a;
}
// A lodging parent asks for a cottage for the whole family.
const ownerWords = (owner, world) => lodgingFamilyOf(world, owner.id) ? 'the ' + owner.name.split(' ').at(-1) + ' family' : owner.name;

export function agendaTitle(proposal, state) {
  if (proposal.kind === 'cottage') {
    if (isFamilyCottage(proposal.key)) return 'a cottage for an arriving family';
    const owner = state.actors.find(a => a.id === proposal.key.split(':')[1]);
    return 'a cottage for ' + (owner ? ownerWords(owner, state.world) : 'the lodger');
  }
  return (WORKS[proposal.kind] || BYLAWS[proposal.kind]).a;
}

const choices = ['support', 'oppose', 'abstain'];
const quorumFor = count => Math.max(3, Math.ceil(count * 0.4));
const jsonCopy = value => JSON.parse(JSON.stringify(value));

function eligible(p, state) {
  const { world, actors } = state;
  if (!ready(p, actors) || world.cooldown[p.key] > world.minute) return false;
  if (isFamilyCottage(p.key) && familyCottageNeeded(state) !== p.key) return false;
  if (Object.hasOwn(BYLAWS, p.kind)) return !world.bylaws?.[p.kind] && p.key === p.kind;
  return Object.hasOwn(WORKS, p.kind) && world.projects.length < slots(actors);
}

// Attendance and the order of business survive a save while a Decisions request is in flight.
function openMoot(state) {
  const { world, actors } = state, moot = world.moot;
  moot.id = 'moot-' + moot.at;
  moot.quorum = quorumFor(actors.length);
  moot.attendees = [];
  moot.ballots = [];
  moot.agenda = world.proposals.filter(p => eligible(p, state))
    .sort((a, b) => b.supporters.length - a.supporters.length || a.since - b.since)
    .map(p => ({ ...jsonCopy(p), title: agendaTitle(p, state) }));
}

// There is one question at a time per voter. A replayed reply cannot cast a second ballot.
export function ballotOffers(actor, { world }) {
  const moot = world.moot;
  if (!moot?.attendees?.includes(actor.id) || world.minute > moot.at + 100) return [];
  const item = moot.agenda.find(p => !moot.ballots.some(b => b.actorId === actor.id && b.proposalKey === p.key));
  if (!item) return [];
  return choices.map(choice => ({ mootId: moot.id, proposalKey: item.key, title: item.title, choice }));
}

export function recordBallot(actor, state, offer, trace) {
  const permitted = ballotOffers(actor, state).some(b => b.mootId === offer.mootId && b.proposalKey === offer.proposalKey && b.choice === offer.choice);
  if (!permitted || !trace) return null;
  const ballot = { actorId: actor.id, mootId: offer.mootId, proposalKey: offer.proposalKey,
    choice: offer.choice, minute: state.world.minute, trace: jsonCopy(trace) };
  state.world.moot.ballots.push(ballot);
  return ballot;
}

function localBallot(actor, proposal, agenda) {
  const position = proposal.positions?.[actor.id]?.position;
  if (position === 'oppose') return 'oppose';
  if (position === 'undecided') return 'abstain';
  if (proposal.supporters.includes(actor.id)) return 'support';
  const otherPriority = agenda.some(p => p !== proposal && p.supporters.includes(actor.id));
  return otherPriority ? 'abstain' : 'support';
}

function enroll(state, externalBallots) {
  const { world, actors } = state, moot = world.moot;
  for (const actor of actors) {
    if (moot.attendees.includes(actor.id) || actor.action.kind !== 'meeting' || actor.action.target !== 'hall' || actor.action.phase !== 'working') continue;
    moot.attendees.push(actor.id);
    for (const p of moot.agenda) {
      witnessProposal(actor, p, state, { place: 'hall' });
      if (externalBallots) continue;
      const choice = localBallot(actor, p, moot.agenda);
      recordBallot(actor, state, { mootId: moot.id, proposalKey: p.key, choice },
        { source: 'local', position: p.positions?.[actor.id]?.position || null, backedProposal: p.supporters.includes(actor.id) });
    }
  }
}

function settleItem(p, state, moot, emit, random) {
  const { world } = state, votes = moot.ballots.filter(b => b.proposalKey === p.key);
  const count = choice => votes.filter(b => b.choice === choice).length;
  const item = { key: p.key, kind: p.kind, title: p.title, by: p.by, status: 'postponed',
    support: count('support'), oppose: count('oppose'), abstain: count('abstain'), missing: moot.attendees.length - votes.length };
  if (moot.attendees.length < moot.quorum) item.reason = 'too few attended';
  else if (item.missing) item.reason = 'ballots outstanding';
  else if (item.oppose * 2 > moot.attendees.length) item.status = 'rejected';
  else if (item.support * 2 <= moot.attendees.length) item.reason = 'no majority';
  else if (Object.hasOwn(BYLAWS, p.kind)) {
    world.bylaws ??= {};
    world.bylaws[p.kind] = { adultBread: BYLAWS[p.kind].adultBread, enactedAt: world.minute, mootId: moot.id };
    item.status = 'enacted';
  } else if (world.projects.length >= slots(state.actors)) item.reason = 'all building crews committed';
  else {
    const backers = votes.filter(b => b.choice === 'support').map(b => b.actorId);
    const project = begin(state, { ...p, supporters: backers }, random, emit);
    if (project) {
      item.status = 'agreed';
      item.projectId = project.id;
    } else item.reason = 'no suitable site';
  }
  if (item.status !== 'postponed') world.proposals = world.proposals.filter(other => other.key !== p.key || other.since !== p.since);
  if (item.status === 'rejected') world.cooldown[p.key] = world.minute + 2880;
  if (item.status === 'postponed' && moot.attendees.length >= moot.quorum) world.cooldown[p.key] = world.minute + 1440;
  const positions = Object.entries(p.positions || {}).map(([actorId, entry]) =>
    ({ actorId, name: state.actors.find(a => a.id === actorId)?.name || actorId, position: entry.position }));
  const tally = item.support + ' in support, ' + item.oppose + ' opposed and ' + item.abstain + ' abstained';
  const verb = item.status === 'agreed' || item.status === 'enacted' ? 'agreed to ' : item.status === 'rejected' ? 'rejected ' : 'postponed ';
  emit('civic', 'The moot ' + verb + p.title + ' (' + tally + (item.missing ? ', ' + item.missing + ' unreturned' : '') + ')'
    + (item.reason ? ' — ' + item.reason : '') + '.', moot.attendees.slice(),
    { civic: 'resolution', mootId: moot.id, at: moot.at, proposalKey: p.key, ...item, positions,
      attendees: moot.attendees.slice(), quorum: moot.quorum, ballots: votes }, 'hall');
  return item;
}

function closeMoot(state, emit, random) {
  const { world, actors } = state, moot = world.moot, ids = moot.attendees;
  const items = moot.agenda.map(p => settleItem(p, state, moot, emit, random));
  (world.mootHistory ??= []).push({ id: moot.id, at: moot.at, closedAt: world.minute, attendees: ids,
    quorum: moot.quorum, status: ids.length < moot.quorum || (items.length && items.every(i => i.status === 'postponed')) ? 'postponed' : 'resolved',
    ballots: moot.ballots, items });
  if (world.mootHistory.length > 10) world.mootHistory.splice(0, world.mootHistory.length - 10);
  for (const a of actors.filter(a => ids.includes(a.id))) {
    if (a.action.kind === 'meeting') a.action.remaining = 1;
    a.needs.loneliness = clamp(a.needs.loneliness - 22, 0, 100);
    remember(a, world.minute, a.name + ' attended the moot at the hall.', [a.id], 'social', { place: 'hall', mootId: moot.id });
  }
  world.moot = null;
  if (ids.length < moot.quorum && !moot.tries) {
    world.moot = { at: eveningMoot(moot.at + dayLength), tries: 1 };
    emit('civic', 'Only ' + ids.length + ' came to the hall. The moot will meet again tomorrow evening.', ids,
      { mootId: moot.id, civic: 'closing', status: 'postponed', quorum: moot.quorum }, 'hall');
  } else if (!items.length) emit('civic', 'The moot met at the hall but found nothing left to settle.', ids,
    { mootId: moot.id, civic: 'closing', status: ids.length < moot.quorum ? 'postponed' : 'resolved', quorum: moot.quorum }, 'hall');
}

// What is being built and debated, in words, for whoever shows the village to a visitor.
export function affairs(state) {
  const { world, actors, map } = state;
  const title = (kind, key) => {
    const words = agendaTitle({ kind, key }, state);
    return words[0].toUpperCase() + words.slice(1);
  };
  return {
    moot: world.moot ? world.moot.at : null,
    mootHistory: (world.mootHistory || []).slice(-10),
    bylaws: world.bylaws || {},
    works: (world.projects || []).map(p => {
      const site = place(map, p.id);
      return { id: p.id, title: p.kind === 'field' ? site.name : title(p.kind, p.key), where: lane(map, site) || '', done: Math.min(p.need, Math.floor(p.done)), need: p.need, stage: site.stage };
    }),
    talk: (world.proposals || []).map(p => ({
      title: title(p.kind, p.key), voices: p.supporters.length,
      opposed: Object.values(p.positions || {}).filter(s => s.position === 'oppose').length,
      undecided: Object.values(p.positions || {}).filter(s => s.position === 'undecided').length,
      needed: p.kind === 'cottage' ? Math.max(2, Math.ceil(actors.length / 4)) : Math.max(3, Math.ceil(actors.length / 3)),
    })).sort((a, b) => b.voices / b.needed - a.voices / a.needed),
  };
}

// Called once a simulated minute.
export function tick(state, emit, random, onMootInterruption, { externalBallots = false } = {}) {
  const { world, actors } = state, minute = world.minute;
  if (minute % 20 === 0 && !world.moot) {
    world.proposals = world.proposals.filter(p => minute - p.since < 8640
      && (p.kind !== 'cottage' || (isFamilyCottage(p.key) ? familyCottageNeeded(state) === p.key
        : actors.some(a => a.id === p.key.split(':')[1] && isLodger(a, state.map)))));
    if (world.proposals.some(p => eligible(p, state))) {
      let at = eveningMoot(minute);
      if (at - minute < 90) at += dayLength;
      world.moot = { at, tries: 0 };
      emit('civic', 'Word goes round Dalecrest: a moot will meet at the hall ' + (at - minute < 720 ? 'this evening' : 'tomorrow evening') + '.',
        [], { mootId: 'moot-' + at, civic: 'scheduled' });
    }
  }
  if (!world.moot) return;
  // Shortly before the moot, wakeful residents reconsider unless they have already chosen to attend.
  if (minute === world.moot.at - 35) {
    for (const actor of actors) {
      const { action } = actor;
      if (action.kind === 'meeting' || action.remaining <= 0 || (action.kind === 'rest' && actor.needs.fatigue >= 60)) continue;
      onMootInterruption?.(actor);
      action.remaining = 0;
    }
  }
  if (minute < world.moot.at) return;
  const moot = world.moot;
  if (!moot.agenda) openMoot(state);
  const attendanceCloses = moot.at + attendanceWindow;
  if (minute <= attendanceCloses) enroll(state, externalBallots);
  if (minute >= attendanceCloses && (moot.ballots.length === moot.agenda.length * moot.attendees.length ||
      minute >= moot.at + 100)) closeMoot(state, emit, random);
}

export function canAttendMoot(actor, { world: { moot, minute }, map }) {
  if (!moot || minute < moot.at - 40 || minute > moot.at + 25 || moot.attendees?.includes(actor.id)) return false;
  const path = route(map, [actor.position.x, actor.position.y], 'hall');
  // Enrollment runs before movement, so even the last arrival needs one more tick to be counted.
  const walkingMinutes = moot.at + attendanceWindow - minute - 1;
  return Boolean(path && walkingSegment(actor, path.pts, walkingMinutes).passed === path.pts.length);
}

// The agreed work this resident would most readily put a shift into.
export function buildChoice(actor, state) {
  const { world, actors, map } = state;
  let best = null;
  for (const p of world.projects) {
    if (p.used < p.wood && world.supplies.wood < 1) continue;
    // A site only has room for so many hands at once.
    if (actors.filter(a => a !== actor && a.action.job === 'build' && a.action.target === p.id).length >= WORKS[p.kind].crew) continue;
    const score = 36 + (actor.trade === 'mend' ? 16 : 0) + (p.for === actor.id ? 24 : 0) + (p.backers.includes(actor.id) ? 9 : 0)
      + Math.min(10, (world.minute - p.since) / 300);
    if (!best || score > best.score) best = { project: p, score };
  }
  if (!best) return null;
  const p = best.project, site = place(map, p.id), the = p.for === actor.id ? 'my own cottage' : WORKS[p.kind].the;
  best.label = p.kind === 'field' ? 'Clearing ground for ' + site.name : site.stage === 0 ? 'Setting the footings of ' + the : 'Raising ' + the;
  best.reason = 'The moot agreed to ' + (p.kind === 'field' ? 'clear' : 'build') + ' ' + describe(p, state) + ', and '
    + Math.floor(p.done) + ' of ' + p.need + ' shifts are done.';
  return best;
}

function complete(project, state, emit) {
  const { world, actors, map } = state, site = place(map, project.id);
  const tell = (text, ids = []) => emit('build', text, ids, undefined, site.id);
  world.projects = world.projects.filter(p => p !== project);
  site.built = world.minute;
  if (project.kind === 'cottage') {
    const owner = actors.find(a => a.id === project.for), family = owner && lodgingFamilyOf(world, owner.id);
    const from = family && lodgingName(place(map, family.lodging)), moved = family ? moveFamilyIn(state, family, site) : [];
    if (moved.length) {
      tell('The cottage' + whereabouts(map, site) + ' is finished, and ' + moved.map(a => a.name).join(' and ') + ' have moved their family in from ' + from + '.', moved.map(a => a.id));
      for (const parent of moved) remember(parent, world.minute, parent.name + ' moved the family into a cottage of their own' + whereabouts(map, site) + '.', moved.map(a => a.id), 'work');
    } else if (owner && isLodger(owner, map)) {
      owner.home = site.id;
      prepareCottage(world, owner, site);
      tell('The cottage' + whereabouts(map, site) + ' is finished, and ' + owner.name + ' has moved in from the hall.', [owner.id]);
      remember(owner, world.minute, owner.name + ' moved into a cottage of their own' + whereabouts(map, site) + '.', [owner.id], 'work');
    } else tell('A cottage' + whereabouts(map, site) + ' is finished and stands empty.');
  } else if (project.kind === 'field') {
    world.fields[site.id] = 0;
    world.strain.grain = 0;
    if (site.felled) world.supplies.wood = Math.min(world.capacity.wood, world.supplies.wood + Math.min(4, site.felled));
    tell(site.name + ' is cleared and ploughed. Dalecrest now works ' + placesOf(map, 'field').length + ' fields.');
  } else if (project.kind === 'granary') {
    world.capacity.grain += GRANARY.grain; world.capacity.flour += GRANARY.flour;
    tell('The granary' + whereabouts(map, site) + ' is finished. The village can now store ' + world.capacity.grain + ' measures of barley.');
  } else if (project.kind === 'well') {
    world.capacity.water += 16;
    tell('Water has been struck at the new well' + whereabouts(map, site) + '.');
  } else if (project.kind === 'oven') {
    world.capacity.bread += 20;
    tell('The bakehouse' + whereabouts(map, site) + ' has fired its first loaves.');
  } else tell(site.name + ' has opened its door' + whereabouts(map, site) + '.');
}

// A finished shift on a building site.
export function labour(actor, state, emit) {
  const { world, map } = state;
  const project = world.projects.find(p => p.id === actor.action.target);
  if (!project) return;
  if (project.used < project.wood) {
    if (world.supplies.wood < 1) return;
    world.supplies.wood--;
    project.used++;
  }
  project.done += actor.trade === 'mend' ? 1.5 : 1;
  const site = place(map, project.id);
  const stage = project.done >= project.need ? 2 : project.done >= project.need * 0.35 ? 1 : 0;
  remember(actor, world.minute, actor.name + ' put in a shift on ' + (project.for === actor.id ? 'their own cottage' : describe(project, state)) + '.', [actor.id], 'work');
  if (stage === site.stage) return;
  site.stage = stage;
  touch(map);
  if (stage === 2) complete(project, state, emit);
  else emit('build', project.kind === 'field' ? 'The brush is cleared from ' + site.name + ' and the first furrows are cut.'
    : 'The frame of ' + describe(project, state) + ' stands' + whereabouts(map, site) + '.', [actor.id]);
}

// Daily reckoning, taken at dawn before the households draw on the stores.
export function dawn(state) {
  const { world, actors, map } = state, pop = actors.length;
  ripen(world, placesOf(map, 'field'), world.minute, world.barleyStrip?.site, map.seed, weatherAt(world.minute, map.seed));
  keepStores(world);
  const strain = (key, short) => { world.strain[key] = short ? Math.min(6, world.strain[key] + 1) : Math.max(0, world.strain[key] - 0.5); };
  strain('grain', foodDays(world, mouths(state)) < 2);
  strain('bread', world.supplies.bread < pop * 0.5 && world.supplies.flour >= 4);
  strain('water', world.supplies.water < pop);
  for (const key of Object.keys(world.wear)) if (--world.wear[key] <= 0) delete world.wear[key];
  for (const key of Object.keys(world.cooldown)) if (world.cooldown[key] <= world.minute) delete world.cooldown[key];
}

// Counts a walk straight across open ground. Enough of them wear a path into the map.
export function tread(state, fromId, toId, emit) {
  const { world, map } = state, key = [fromId, toId].sort().join('|');
  world.wear[key] = (world.wear[key] || 0) + 1;
  if (world.wear[key] < PATH_WEAR) return;
  delete world.wear[key];
  const a = place(map, fromId), b = place(map, toId);
  if (!a || !b || !clearWalk(map, a.at, b.at, [fromId, toId]) || walkLength(map, fromId, toId) < dist(a.at, b.at) * 1.25) return;
  const ends = [a, b].map(p => {
    if (dist(map.nodes[p.node], p.at) < 0.05) return p.node;
    const n = addNode(map, p.at[0], p.at[1]);
    addEdge(map, n, p.node, 'track');
    return p.node = n;
  });
  const length = dist(a.at, b.at), steps = Math.max(1, Math.round(length / 2.8));
  const road = map.roads.push({ name: null, kind: 'path' }) - 1, bend = (key.length % 2 ? 1 : -1) * length * 0.05;
  let last = ends[0];
  for (let i = 1; i < steps; i++) {
    const t = i / steps, k = Math.sin(t * Math.PI) * bend;
    const n = addNode(map, a.at[0] + (b.at[0] - a.at[0]) * t - (b.at[1] - a.at[1]) / length * k, a.at[1] + (b.at[1] - a.at[1]) * t + (b.at[0] - a.at[0]) / length * k);
    addEdge(map, last, n, 'path', road);
    last = n;
  }
  addEdge(map, last, ends[1], 'path', road);
  const label = p => p.kind === 'cottage' ? 'the cottages' : p.name.startsWith('The ') ? p.name : 'the ' + p.name.toLowerCase();
  emit('build', 'So many feet have crossed between ' + label(a) + ' and ' + label(b) + ' that a path is worn into the grass.');
}

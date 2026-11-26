// The card that opens over a resident on the map: who they are, what they are doing, and what the
// village records say about why. It reports what is stored and does not guess at motives.
import { dateOf, formatDate } from '../engine/calendar.mjs';
import { portrait } from './portrait.js';

const el = (tag, cls, value) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (value !== undefined) node.textContent = value;
  return node;
};
export const kinds = { village: 'Village', work: 'Work', meal: 'Meal', social: 'Encounter', observation: 'Observation', fieldnote: 'Robin’s notebook', plan: 'Decision', civic: 'Affairs', build: 'Building', arrival: 'Arrival',
  life: 'Lives', visit: 'Visitors', storm: 'Weather', herd: 'Strays', feast: 'Feast day', intention: 'In their words', goal: 'Goals' };

// Why a moment went to the model, in plain words. The engine's own phrases are kept as a fallback.
const whys = {
  'no instruction applies': 'Nothing already settled covers this moment.',
  'instruction lapsed': 'An earlier choice for this routine has run out.',
  'instruction goals changed': 'Their goals have changed since they last chose.',
  'instruction ran its course': 'They have repeated this often enough to think again.',
  'instructed action cannot start': 'They needed to choose again because the earlier option was no longer available.',
  'learned something new': 'They have heard something new.',
  'two urgent needs': 'Two needs are pressing at once.',
};
function placeReference({ name, kind }) {
  if (kind === 'cottage' && name.endsWith('’s cottage')) return name;
  const lower = name[0].toLowerCase() + name.slice(1);
  return lower.startsWith('the ') ? lower : 'the ' + lower;
}

function visitChangeText(change, names) {
  if (!change) return '';
  const from = names[change.from], to = names[change.to];
  if (!from?.name || !to?.name) return '';
  const earlier = placeReference(from), later = placeReference(to);
  if (earlier === later) return change.name + (to.kind === 'cottage' ? ' went to a different cottage.' : ' went to a different place.');
  return change.name + ' went from ' + earlier + ' to ' + later + '.';
}

export function whyText(why, visitChange, names = {}) {
  const move = visitChangeText(visitChange, names);
  if (move || !why) return move;
  return whys[why] || (why.startsWith('would run into') ? 'Their routine ' + why + '.' : why[0].toUpperCase() + why.slice(1) + '.');
}

export function choiceExplanation(activity, names = {}) {
  const { waited, visitChange } = activity.basis || {};
  const move = visitChangeText(visitChange, names);
  const followed = move && activity.kind === 'social' && activity.friendId === visitChange.friendId && activity.target === visitChange.to;
  const reason = followed ? move : [move, activity.reason].filter(Boolean).join(' ');
  if (!waited) return reason;
  return (reason + ' Took ' + waited + ' village ' + (waited === 1 ? 'minute' : 'minutes') + ' to decide.').trim();
}

// One line saying what a resident is doing, for cards and captions.
export function doing(actor, names = {}) {
  const activity = actor.action, at = names[activity.target]?.name || activity.target;
  if (activity.kind === 'waiting') return 'Deciding what to do next';
  return activity.phase === 'travelling' ? 'Walking to ' + at : activity.label;
}

const hour = minute => { const h = Math.floor(minute / 60) % 24; return (h % 12 || 12) + ':' + String(minute % 60).padStart(2, '0') + (h < 12 ? ' am' : ' pm'); };
const when = (minute, now) => formatDate(minute, dateOf(minute).year !== dateOf(now).year ? 'full' : 'day') + ' at ' + hour(minute);
const chip = (kind, text) => el('span', 'basis basis-' + kind, text);

// Most activity labels already begin with a participle. Requests and ballots are worded as menu commands.
const participles = { Ask: 'asking', Tell: 'telling', Promise: 'promising', Keep: 'keeping', Set: 'setting',
  Support: 'supporting', Oppose: 'opposing', Abstain: 'abstaining' };
function activityPhrase(label = '') {
  const words = /^(\w+)\b(.*)$/.exec(label.trim().replace(/[.!?]+$/, ''));
  if (!words) return '';
  const verb = /ing$/i.test(words[1]) ? words[1].toLowerCase() : participles[words[1]];
  if (!verb) return '';
  return (verb + words[2]).replace(/\bmy\b/g, 'their').replace(/\bme\b/g, 'them').replace(/\bI\b/g, 'they')
    .replace('aside and decide about it later', 'aside for later');
}

// The decision record keeps the preceding label in its reason once a wait ends.
function previousLabel(action) {
  if (action.kind === 'waiting') return action.previous?.label;
  if (action.reason === 'Chose this.') return '';
  const recorded = /^(?:Chose this|Selected by .+?) after (.+)\.$/.exec(action.reason)
    || /^Chose this\. The previous activity was “(.+)”\.$/.exec(action.reason);
  return recorded?.[1];
}

export function residentCaption(actor, names = {}) {
  const a = actor.action, recorded = previousLabel(a);
  const current = activityPhrase(a.label), previous = activityPhrase(recorded);
  const after = previous && previous !== current ? 'After ' + previous + ', ' : '';
  const travelling = a.phase === 'travelling';
  const friend = a.kind === 'social' && current.startsWith('visiting ') && current.slice('visiting '.length);
  let what;
  if (a.kind === 'waiting') what = 'is deciding what to do next';
  else if (friend) {
    if (travelling) what = 'is on the way to see ' + friend;
    else if (a.basis?.kind === 'standing') what = 'stayed a while longer with ' + friend;
    else what = after ? 'went to see ' + friend : 'is visiting ' + friend;
  } else if (travelling) {
    const to = names[a.target];
    what = a.target === actor.home ? 'is walking home' : to?.name ? 'is walking to ' + placeReference(to) : 'is on the way';
  } else if (current) what = 'is ' + current;
  const line = what ? after + actor.name + ' ' + what + '.' : [actor.name, a.label].filter(Boolean).join(' · ');

  let why = visitChangeText(a.blockedVisit || a.basis?.visitChange, names);
  if (!why && a.kind === 'waiting' && a.why !== 'no instruction applies') why = whyText(a.why);
  if (a.kind !== 'waiting' && !a.basis && recorded == null) why = a.reason || '';
  return { line, why };
}

// others are the residents under the same roof, when this one is indoors.
export function residentCard(actor, { names = {}, minute = 0, others = [], pets = [] } = {}) {
  const card = document.createDocumentFragment(), a = actor.action || {};
  const head = el('div', 'map-card-head'), title = el('div');
  title.append(el('h3', '', actor.name), el('p', 'role', actor.child ? 'Age ' + actor.age : actor.role));
  head.append(portrait(actor), title);

  const at = names[a.target]?.name || a.target, deciding = a.kind === 'waiting';
  const travelling = !deciding && a.phase === 'travelling', inside = (a.kind === 'rest' || a.indoors) && a.phase === 'working';
  const what = el('div', 'map-card-part');
  const where = at ? (inside ? 'Indoors at ' : 'At ') + at : 'Out in the parish';
  what.append(el('div', 'eyebrow', travelling ? 'On the way' : where), el('strong', 'activity', doing(actor, names)));
  if (travelling) what.append(el('p', 'reason', 'On arrival · ' + a.label));
  card.append(head, what);

  // The reason is whatever the records hold: a fresh choice, a routine resting on an earlier
  // choice, or the village's own rules speaking in the first person.
  const why = el('div', 'map-card-part'), context = el('div', 'map-card-context');
  context.append(el('span', 'eyebrow', 'Why'));
  why.append(context);
  const say = text => { if (text) why.append(el('p', 'reason', text)); };
  if (deciding) {
    say(a.reason);
    say(whyText(a.why, a.blockedVisit, names));
    if (Number.isFinite(a.since)) say('Since ' + when(a.since, minute));
  } else if (a.basis?.kind === 'standing') {
    context.append(chip('standing', 'Routine'));
    say('Following the choice made ' + when(a.basis.since, minute) + '.');
  } else {
    if (a.basis?.kind === 'fresh') {
      context.append(chip('fresh', 'Fresh choice'));
      if (!visitChangeText(a.basis.visitChange, names)) say(whyText(a.basis.why));
    }
    say(choiceExplanation(a, names));
  }
  if (actor.plan?.reason) say('Today’s intention: ' + actor.plan.reason);
  const pressing = Object.entries(actor.needs || {}).filter(([, value]) => value >= 60).sort((x, y) => y[1] - x[1]).slice(0, 2);
  if (pressing.length) say('Pressing now: ' + pressing.map(([need, value]) => need + ' ' + Math.round(value)).join(', ') + '.');

  if (why.children.length > 1 || context.children.length > 1) card.append(why);
  if (others.length) card.append(el('p', 'map-card-others', 'Also indoors here: ' + others.map(o => o.name.split(' ')[0]).join(', ') + '.'));
  const kept = pets.filter(p => p.owner === actor.id);
  if (kept.length) card.append(el('p', 'map-card-others', kept.map(p => (p.kind === 'dog' ? 'Dog: ' : 'Cat: ') + p.name).join(' · ')));
  return card;
}

// What the chronicle holds for one spot on the map, newest first. place is the id of a named place, if any.
export function eventCard(events, { names = {}, minute = 0, place } = {}) {
  const card = document.createDocumentFragment(), head = el('div', 'map-card-head'), title = el('div');
  title.append(el('div', 'eyebrow', 'From the chronicle'), el('h3', '', names[place]?.name ? 'At ' + names[place].name : 'Out of doors'));
  head.append(title);
  card.append(head);
  for (const e of events) {
    const part = el('div', 'map-card-part'), text = el('p', 'memory-text');
    text.append(el('span', 'kind kind-' + e.type, kinds[e.type] || e.type), document.createTextNode(e.text));
    part.append(el('time', 'journal-time', when(e.minute, minute)), text);
    if (e.account) part.append(el('p', 'civic-account', 'Model-written account · ' + e.account));
    card.append(part);
  }
  return card;
}

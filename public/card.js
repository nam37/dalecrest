// The card that opens over a resident on the map: who they are, what they are doing, and what the
// village records say about why. It reports what is stored and does not guess at motives.
import { dateOf, formatDate } from '/engine/calendar.mjs';

const el = (tag, cls, value) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (value !== undefined) node.textContent = value;
  return node;
};
const CLOTH = ['#946344', '#68764f', '#a8654c', '#456d65', '#827892', '#7c6043', '#567895', '#946e46'];
const SKIN = ['#c99873', '#bb9270', '#ce9d78', '#bc8e6c', '#bf926d', '#aa7a55', '#d6a77d', '#c59a70'];
const HAIR = ['#62503c', '#65594b', '#6b4733', '#584d3c', '#765c4a', '#67492e', '#524633', '#795b3c'];

// A small likeness, told apart by the resident's place in the register.
export function portrait(i) {
  const canvas = el('canvas', 'portrait');
  canvas.width = 30; canvas.height = 32; canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  const cloth = CLOTH[i % CLOTH.length], skin = SKIN[i % 8], hair = HAIR[i % 8];
  const r = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  r(0, 0, 30, 32, '#e3e1cd');
  for (let x = 0; x < 30; x += 3) r(x, 24 + (x % 4), 1, 8, '#d1d3b8');
  r(3, 28, 24, 4, cloth); r(6, 25, 18, 6, cloth); r(10, 23, 10, 6, cloth); r(12, 21, 6, 4, skin);
  r(8, 9, 14, 11, hair); r(10, 7, 11, 4, hair); r(10, 12, 11, 9, skin); r(12, 21, 7, 2, skin);
  r(18, 14, 4, 4, skin); r(19, 15, 1, 1, '#4e4538'); r(17, 20, 3, 1, '#996e53');
  r(8, 12, 3, 7, hair); r(11, 11, 6, 2, hair); r(10, 25, 2, 7, '#ddd0ad'); r(18, 25, 2, 7, '#ddd0ad');
  if (i % 3 === 0) { r(7, 9, 16, 3, '#bc985a'); r(9, 7, 12, 3, '#c3a467'); r(11, 5, 8, 3, '#c3a467'); }
  if (i % 3 === 1) { r(7, 9, 15, 3, cloth); r(9, 6, 11, 4, cloth); r(10, 18, 3, 5, hair); }
  if (i % 3 === 2) { r(8, 9, 12, 4, '#dfd7bb'); r(10, 7, 9, 3, '#e9e2cb'); r(7, 12, 4, 10, '#d2c7a8'); }
  return canvas;
}

export const kinds = { village: 'Village', work: 'Work', meal: 'Meal', social: 'Encounter', observation: 'Observation', fieldnote: 'Robin’s notebook', plan: 'Decision', civic: 'Affairs', build: 'Building', arrival: 'Arrival' };

// Why a moment went to the model, in plain words. The engine's own phrases are kept as a fallback.
const whys = {
  'no instruction applies': 'Nothing already settled covers this moment.',
  'instruction lapsed': 'An earlier choice for this routine has run out.',
  'instruction goals changed': 'Their goals have changed since they last chose.',
  'instruction ran its course': 'They have repeated this often enough to think again.',
  'instructed action cannot start': 'What they usually do here is not possible now.',
  'learned something new': 'They have heard something new.',
  'two urgent needs': 'Two needs are pressing at once.',
};
export const whyText = why => !why ? '' : whys[why] || (why.startsWith('would run into') ? 'Their routine ' + why + '.' : why[0].toUpperCase() + why.slice(1) + '.');

export function choiceExplanation(activity) {
  const waited = activity.basis?.waited, reason = activity.reason || '';
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

// One line of why, from the same records the card reads, for a caption that has room for no more.
export function whyLine(actor, minute) {
  const a = actor.action || {};
  if (a.kind === 'waiting') return whyText(a.why) || a.reason || '';
  if (a.basis?.kind === 'standing') return 'Routine, following the choice made ' + when(a.basis.since, minute) + '.';
  return (a.basis?.kind === 'fresh' ? 'A fresh choice. ' : '') + choiceExplanation(a);
}

// others are the residents under the same roof, when this one is indoors.
export function residentCard(actor, { index = 0, names = {}, minute = 0, others = [] } = {}) {
  const card = document.createDocumentFragment(), a = actor.action || {};
  const head = el('div', 'map-card-head'), title = el('div');
  title.append(el('h3', '', actor.name), el('p', 'role', actor.role));
  head.append(portrait(index), title);

  const at = names[a.target]?.name || a.target, deciding = a.kind === 'waiting';
  const travelling = !deciding && a.phase === 'travelling', inside = a.kind === 'rest' && a.phase === 'working';
  const what = el('div', 'map-card-part');
  what.append(el('div', 'eyebrow', travelling ? 'On the way' : (inside ? 'Indoors at ' : 'At ') + at), el('strong', 'activity', doing(actor, names)));
  if (travelling) what.append(el('p', 'reason', 'On arrival · ' + a.label));

  // The reason is whatever the records hold: a fresh choice, a routine resting on an earlier
  // choice, or the village's own rules speaking in the first person.
  const why = el('div', 'map-card-part');
  why.append(el('div', 'eyebrow', 'Why'));
  const say = text => { if (text) why.append(el('p', 'reason', text)); };
  if (deciding) {
    why.append(chip('waiting', 'Deciding'));
    say(a.reason);
    say(whyText(a.why));
    if (Number.isFinite(a.since)) say('Since ' + when(a.since, minute));
  } else if (a.basis?.kind === 'standing') {
    why.append(chip('standing', 'Routine'));
    say('Following the choice made ' + when(a.basis.since, minute) + '.');
  } else {
    if (a.basis?.kind === 'fresh') { why.append(chip('fresh', 'Fresh choice')); say(whyText(a.basis.why)); }
    say(choiceExplanation(a));
  }
  if (actor.plan?.reason) say('Today’s intention: ' + actor.plan.reason);
  const pressing = Object.entries(actor.needs || {}).filter(([, value]) => value >= 60).sort((x, y) => y[1] - x[1]).slice(0, 2);
  if (pressing.length) say('Pressing now: ' + pressing.map(([need, value]) => need + ' ' + Math.round(value)).join(', ') + '.');

  card.append(head, what, why);
  if (others.length) card.append(el('p', 'map-card-others', 'Also indoors here: ' + others.map(o => o.name.split(' ')[0]).join(', ') + '.'));
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
    card.append(part);
  }
  return card;
}

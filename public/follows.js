import { formatDate } from '../engine/calendar.mjs';
import { promiseLink } from './record-links.js';

export const promiseFollows = 'dalecrest.followedRequests.v1';
export const recordFollows = 'dalecrest.followedRecords.v1';
export const recordKinds = { residents: 'resident', households: 'household', moots: 'moot' };
export const promiseTitle = request => request.terms ? request.terms[0].toUpperCase() + request.terms.slice(1) : request.opening;

export function readFollows(key) {
  try { return new Map(JSON.parse(localStorage.getItem(key) || '[]')); }
  catch { return new Map(); }
}

export function writeFollows(key, follows) {
  try { localStorage.setItem(key, JSON.stringify([...follows])); return true; }
  catch { return false; }
}

export function newer(id, seen) {
  return /^\d+$/.test(id) && /^\d+$/.test(seen) && BigInt(id) > BigInt(seen);
}

export async function fetchRecord(path, params = new URLSearchParams()) {
  const query = params.size ? '?' + params : '';
  const response = await fetch('/api/records' + path + query, { signal: AbortSignal.timeout(9000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Could not read the village record.');
  return data;
}

export function followedTitle(kind, data) {
  if (kind === 'residents') return data.person.name;
  if (kind === 'households') {
    const { id, name } = data.household;
    return ['New cottage', 'Empty cottage'].includes(name) ? name + ' ' + id.split('-').at(-1) : name;
  }
  return 'Moot of ' + formatDate(data.at);
}

export function followSnapshot(kind, data) {
  if (kind === 'residents') return { role: data.person.role, home: data.household ?? null, left: data.person.left, how: data.person.how };
  if (kind === 'households') return {
    ready: data.stage >= 2, cold: data.cold,
    occupants: data.residents.map(person => [person.path, person.name, person.born]),
    children: data.children.map(child => [child.born + '/' + child.name, child.name, child.born]),
  };
  return {
    status: data.status, attendance: data.attendees.length,
    items: data.items.map(item => [item.key ?? item.title, {
      title: item.title, status: item.status, reason: item.reason, votes: item.votes.length, account: Boolean(item.account),
    }]),
  };
}

const mootStatus = {
  sitting: 'The moot opened.', resolved: 'The moot concluded.', postponed: 'The moot was postponed.',
};
const motionStatus = { agreed: 'agreed', enacted: 'enacted', rejected: 'rejected', postponed: 'postponed' };

export function recordChanges(kind, previous, next, events = []) {
  if (!previous) return [];
  const changes = [];
  if (kind === 'residents') {
    if (previous.home?.path !== next.home?.path && next.home && !events.some(event => event.life === 'moved')) {
      changes.push('Moved to ' + next.home.name + '.');
    }
    if (previous.role !== next.role && next.role) changes.push('Now working as ' + next.role.toLowerCase() + '.');
    if (previous.left == null && next.left != null && !events.some(event => ['left', 'died'].includes(event.life))) {
      changes.push(next.how === 'died' ? 'Died in Dalecrest.' : 'Left Dalecrest.');
    }
  } else if (kind === 'households') {
    if (!previous.ready && next.ready) changes.push('The household is ready to live in.');
    const oldOccupants = new Map(previous.occupants), occupants = new Map(next.occupants);
    for (const [key, name] of occupants) if (!oldOccupants.has(key)) changes.push(name + ' now lives here.');
    for (const [key, name] of oldOccupants) if (!occupants.has(key)) changes.push(name + ' no longer lives here.');
    const oldChildren = new Map(previous.children), children = new Map(next.children);
    for (const [key, name] of children) if (!oldChildren.has(key)) changes.push(name + ' joined the household.');
    for (const [key, name, born] of previous.children) {
      if (!children.has(key) && !next.occupants.some(([, resident, birth]) => birth === born && resident.startsWith(name + ' '))) {
        changes.push(name + ' left the household.');
      }
    }
    if (!previous.cold && next.cold) changes.push('The hearth went without firewood.');
  } else {
    if (previous.status !== next.status && mootStatus[next.status]) changes.push(mootStatus[next.status]);
    if (previous.attendance !== next.attendance) {
      const count = next.attendance + (next.attendance === 1 ? ' resident' : ' residents');
      changes.push(count + (next.status === 'sitting' ? ' recorded present so far.' : ' attended.'));
    }
    const oldItems = new Map(previous.items);
    for (const [key, item] of next.items) {
      const old = oldItems.get(key);
      if (motionStatus[item.status] && old?.status !== item.status) {
        changes.push(item.title + ' · ' + motionStatus[item.status] + (item.reason ? ' · ' + item.reason : '') + '.');
      } else if (!old) changes.push(item.title + ' was added to the agenda.');
      else if (next.status === 'sitting' && old.votes !== item.votes) {
        changes.push(item.title + ' · ' + item.votes + (item.votes === 1 ? ' ballot returned.' : ' ballots returned.'));
      }
      if (item.account && !old?.account) changes.push('An account was published for ' + item.title + '.');
    }
  }
  return changes;
}

export function updatesFor(kind, data, entry) {
  const state = followSnapshot(kind, data);
  const events = data.activity?.items ?? [];
  return { state, events, changes: recordChanges(kind, entry.state, state, events) };
}

export async function followedPromise(id, entry) {
  const { request, items } = await fetchRecord(promiseLink(id));
  return {
    title: promiseTitle(request) + ' · ' + request.asker,
    updates: items.filter(event => newer(event.id, entry.seen)).map(event => event.description),
  };
}

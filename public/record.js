import { formatDate } from '../engine/calendar.mjs';
import { ageOf } from '../engine/lives.mjs';
import { kinds } from './card.js';
import { copyLink, dayLink, mootLink, promiseLink, recordPath } from './record-links.js';
import { fetchRecord, followedTitle, followSnapshot, readFollows, recordFollows, recordKinds, updatesFor, writeFollows } from './follows.js';

const $ = id => document.getElementById('record-' + id);
const content = $('content'), actions = $('actions');
const label = { resolved: 'Concluded', sitting: 'In session', scheduled: 'Scheduled', recorded: 'Recorded', postponed: 'Postponed',
  rejected: 'Rejected', agreed: 'Agreed', enacted: 'Enacted' };
const voteLabel = { support: 'For', oppose: 'Against', abstain: 'Abstained' };
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const link = (text, href) => Object.assign(el('a', text), { href });
const time = minute => [Math.floor(minute / 60) % 24, minute % 60].map(n => String(n).padStart(2, '0')).join(':');
const dated = minute => link(formatDate(minute) + ' at ' + time(minute), dayLink(minute));

function title(kind, name, summary) {
  $('kind').textContent = kind;
  $('title').textContent = name;
  $('summary').textContent = summary;
  document.title = name + ' · Dalecrest';
}

function section(heading, ...children) {
  const area = el('section', null, 'record-part');
  area.append(el('h2', heading), ...children);
  content.append(area);
  return area;
}

function songJournal(journal) {
  const area = section('Robin’s Journal');
  area.id = 'journal';
  area.tabIndex = -1;
  const heading = area.firstElementChild;
  heading.id = 'journal-title';
  heading.className = 'journal-name';
  area.setAttribute('aria-labelledby', heading.id);

  const progress = { writing: 'In progress', finished: 'Finished', set_aside: 'Set aside' };
  const count = journal.verses.length;
  const song = el('article', null, 'journal-song');
  const head = el('header', null, 'journal-song-head');
  head.append(el('h3', journal.title || 'Robin’s song'), el('p', count
    ? progress[journal.status] + ' · ' + count + (count === 1 ? ' verse' : ' verses')
    : 'Waiting for a first verse', 'journal-meta'));
  song.append(head);

  const lyrics = el('blockquote', null, 'journal-lyrics');
  const notes = el('ol', null, 'journal-verse-notes');
  const sourceLabel = { fieldnote: 'Field note', observation: 'Observation', social: 'Conversation' };
  for (const verse of journal.verses) {
    const stanza = el('p', null, 'song-verse');
    verse.lines.forEach((line, index) => {
      if (index) stanza.append(el('br'));
      stanza.append(line);
    });
    lyrics.append(stanza);

    const note = el('li');
    const sources = el('ul');
    for (const source of verse.sources) {
      const item = el('li');
      const label = sourceLabel[source.kind] + ', ' + formatDate(source.minute);
      item.append(source.href ? link(label, source.href) : label);
      if (source.note) item.append(' · ', source.note);
      sources.append(item);
    }
    note.append(dated(verse.minute), sources);
    notes.append(note);
  }
  if (count) {
    const disclosure = el('details', null, 'journal-disclosure');
    disclosure.append(el('summary', 'Verse dates and sources'), notes);
    song.append(lyrics, disclosure);
  }
  area.append(song);

  if (journal.intentions.length) {
    const thoughts = el('section', null, 'journal-thoughts');
    thoughts.append(el('h3', 'In Robin’s own words'));
    for (const entry of journal.intentions) thoughts.append(dated(entry.minute), el('blockquote', entry.text));
    area.append(thoughts);
  }
  if (journal.entries.length) {
    const log = el('details', null, 'journal-disclosure journal-log');
    const list = el('ul', null, 'journal-entries');
    for (const entry of journal.entries) {
      const item = el('li');
      item.append(dated(entry.minute), el('span', entry.text));
      list.append(item);
    }
    log.append(el('summary', 'Writing log'),
      el('p', 'Worked on the green on ' + journal.composingDays + ' of the last ' + journal.windowDays + ' village days.', 'journal-meta'), list);
    area.append(log);
  }
}

function resident({ person, household, minute, journal }) {
  const living = person.left == null;
  title('Resident', person.name, person.role || (living ? 'Lives in Dalecrest' : 'Former resident'));
  if (living) {
    actions.append(link('View in the village', '/#village/' + encodeURIComponent(person.id)),
      link('Heat map', '/#village/' + encodeURIComponent(person.id) + '/heat'));
  }
  const life = [];
  const age = living ? Number.isFinite(person.born) && ageOf(person, minute) : person.age;
  if (Number.isFinite(age)) life.push(el('p', 'Age ' + Math.max(0, age)));
  if (person.arrived > 0) {
    const arrival = el('p', 'Joined the village ');
    arrival.append(dated(person.arrived));
    life.push(arrival);
  }
  if (!living) {
    const departure = el('p', person.how === 'died' ? 'Died ' : 'Left Dalecrest ');
    departure.append(dated(person.left));
    life.push(departure);
  }
  if (household) {
    const home = el('p', (living ? 'Home' : 'Last home') + ' · ');
    home.append(link(household.name, household.path));
    life.push(home);
  }
  if (life.length) section('Life in Dalecrest', ...life);
  if (person.backstory) section('Background', el('p', person.backstory));
  if (living && person.action?.label) section('Current activity', el('p', person.action.label));
  if (journal) songJournal(journal);
}

function household({ household, residents, children, stores, stage, cold, minute }) {
  title('Household', household.name, stage < 2 ? 'Under construction' : household.kind === 'cottage' ? 'Cottage' : 'Lodgings');
  const list = el('ul');
  for (const person of residents) {
    const item = el('li');
    item.append(link(person.name, person.path), person.role ? ' · ' + person.role : '');
    list.append(item);
  }
  for (const child of children) {
    const item = el('li');
    item.append(child.id ? link(child.name, '/#village/' + encodeURIComponent(child.id)) : child.name);
    if (Number.isFinite(child.born)) item.append(' · Age ' + Math.max(0, ageOf(child, minute)));
    if (child.activity) item.append(el('p', child.travelling && child.location ? 'Walking to ' + child.location + ' · ' + child.activity
      : child.activity + (child.location ? ' · ' + child.location : ''), 'reason'));
    list.append(item);
  }
  section('Who lives here', list.children.length ? list : el('p', 'Nobody lives here at present.', 'empty'));
  const provisions = [];
  if (Number.isFinite(stores?.wood)) provisions.push(el('p', Math.floor(stores.wood) + ' bundles of firewood'));
  if (Number.isFinite(stores?.bread)) provisions.push(el('p', stores.bread + (stores.bread === 1 ? ' loaf in the larder' : ' loaves in the larder')));
  if (Number.isFinite(stores?.allowance)) provisions.push(el('p', Math.floor(stores.allowance) + ' loaves due at the storehouse'));
  if (cold) provisions.push(el('p', 'The hearth went without firewood this morning.'));
  if (provisions.length) section('Household stores', ...provisions);
}

function moot({ at, closedAt, status, items, attendees, quorum, notes }) {
  const name = 'Moot of ' + formatDate(at);
  title('Village moot', name, (label[status] ?? label.recorded) + ' · Village hall · ' + time(at));
  actions.append(link('Village day', dayLink(at)));
  if (closedAt != null) {
    const closed = el('p', 'Closed ');
    closed.append(dated(closedAt));
    content.append(closed);
  }
  for (const note of notes) content.append(el('p', note, 'reason'));
  const agenda = section('Business of the moot');
  if (!items.length) agenda.append(el('p', status === 'scheduled' ? 'The agenda will be set when the moot opens.' : 'No motions are recorded for this moot.', 'empty'));
  for (const item of items) {
    const motion = el('div', null, 'request-entry');
    motion.append(el('h3', item.title));
    if (item.status) motion.append(el('p', (label[item.status] ?? item.status) + (item.reason ? ' · ' + item.reason : '')));
    if (item.support != null) motion.append(el('p', item.support + ' for, ' + item.oppose + ' against, ' + item.abstain +
      ' abstained' + (item.missing ? ', ' + item.missing + ' unreturned' : '') + '.'));
    if (item.account) motion.append(el('p', 'Model-written account · ' + item.account, 'civic-account'));
    if (attendees.length) {
      const roll = el('details', null, 'moot-roll'), votes = new Map(item.votes.map(v => [v.id, v.choice]));
      roll.append(el('summary', 'Roll call'));
      for (const person of attendees) {
        const row = el('p');
        row.append(person.path ? link(person.name, person.path) : person.name, ' · ', voteLabel[votes.get(person.id)] ?? 'Unreturned');
        roll.append(row);
      }
      motion.append(roll);
    }
    agenda.append(motion);
  }
  if (attendees.length || Number.isFinite(quorum)) {
    const names = el('ul');
    for (const person of attendees) {
      const li = el('li');
      li.append(person.path ? link(person.name, person.path) : person.name);
      names.append(li);
    }
    section('Attendance', el('p', attendees.length + ' present' + (quorum != null ? ' · Quorum ' + quorum : '')), names);
  }
}

function day({ day, current, edition, events }) {
  const at = (day - 1) * 1440;
  title('Village day', formatDate(at, 'long'), 'Day ' + day + ' since Dalecrest was founded');
  if (edition) actions.append(link('Read Dalecrest Daily', '/daily.html?day=' + day));
  if (day > 1) $('pages').append(link('← Previous day', dayLink(at - 1440)));
  if (day < current) $('pages').append(link('Next day →', dayLink(at + 1440)));
  const chronicle = section('Chronicle highlights');
  for (const event of events) {
    const row = el('div', null, 'request-entry');
    row.id = 'event-' + event.id;
    row.append(el('time', time(Number(event.minute)), 'journal-time'),
      el('span', kinds[event.type] || event.type, 'kind kind-' + event.type), el('p', event.text));
    if (event.requestId) row.append(link('Read the promise', promiseLink(event.requestId)));
    if (event.mootId) row.append(link('Read the moot', mootLink(event.mootId)));
    if (event.people.length) {
      const people = el('p', null, 'record-people');
      event.people.forEach((person, i) => people.append(i ? ' · ' : '', link(person.name, person.path)));
      row.append(people);
    }
    if (event.account) row.append(el('p', 'Model-written account · ' + event.account, 'civic-account'));
    chronicle.append(row);
  }
  if (!events.length) chronicle.append(el('p', 'No chronicle highlights were recorded for this day.', 'empty'));
}

const render = { residents: resident, households: household, moots: moot, days: day };
function highlightLocation() {
  content.querySelector('[aria-current="location"]')?.removeAttribute('aria-current');
  const journalLink = document.querySelector('.site-publications a[href$="#journal"]');
  journalLink?.removeAttribute('aria-current');
  if (location.hash === '#journal') {
    const journal = document.getElementById('journal');
    if (journal) {
      journalLink?.setAttribute('aria-current', 'location');
      journal.focus({ preventScroll: true });
      journal.scrollIntoView({ block: 'start' });
    }
    return;
  }
  if (!/^#event-\d+$/.test(location.hash)) return;
  const target = document.getElementById(location.hash.slice(1));
  if (target) {
    target.setAttribute('aria-current', 'location');
    target.scrollIntoView({ block: 'nearest' });
  }
}

function showUpdates(kind, data, entry) {
  const area = $('updates'), heading = el('h2', 'Since your last visit');
  heading.id = 'record-updates-title';
  const { state, changes, events } = updatesFor(kind, data, entry);
  const items = el('ul');
  items.append(...changes.map(change => el('li', change)));
  function appendEvents(batch) {
    for (const event of batch) {
      const row = el('li');
      row.append(link(formatDate(Number(event.minute), 'short') + ' · ' + time(Number(event.minute)),
        dayLink(event.minute) + '#event-' + event.id), ' · ', event.text);
      items.append(row);
    }
  }
  appendEvents(events);
  area.replaceChildren(heading, items.children.length ? items : el('p', 'No changes since your last visit.', 'empty'));
  area.hidden = false;
  if (data.activity?.next) {
    const more = el('button', 'Show earlier updates'), status = el('p', null, 'follow-notice');
    more.type = 'button';
    status.setAttribute('role', 'status');
    let before = data.activity.next;
    more.onclick = async () => {
      more.disabled = true;
      status.textContent = '';
      try {
        const { activity } = await fetchRecord(data.path, new URLSearchParams({ after: entry.cursor, before }));
        appendEvents(activity.items);
        before = activity.next;
        if (!before) status.textContent = 'All updates from this visit are shown.';
      } catch {
        status.textContent = 'Earlier updates could not be loaded. Try again.';
      } finally {
        more.hidden = !before;
        more.disabled = false;
      }
    };
    area.append(more, status);
  }
  return state;
}

function setupFollow(kind, data, entry) {
  const button = $('follow'), status = $('follow-status'), noun = recordKinds[kind];
  const state = entry ? showUpdates(kind, data, entry) : followSnapshot(kind, data);
  const baseline = { title: followedTitle(kind, data), state, cursor: data.cursor };
  const paint = () => { button.textContent = (readFollows(recordFollows).has(data.path) ? 'Unfollow ' : 'Follow ') + noun; };
  const follows = readFollows(recordFollows);
  if (entry && JSON.stringify(follows.get(data.path)) === JSON.stringify(entry)) {
    follows.set(data.path, baseline);
    if (!writeFollows(recordFollows, follows)) status.textContent = 'This browser could not remember the visit.';
  }
  paint();
  button.hidden = false;
  button.onclick = () => {
    const current = readFollows(recordFollows);
    const wasFollowing = current.delete(data.path);
    if (!wasFollowing) current.set(data.path, baseline);
    if (!writeFollows(recordFollows, current)) {
      status.textContent = 'This browser could not save your choice.';
      return;
    }
    paint();
    if (wasFollowing) $('updates').hidden = true;
    status.textContent = wasFollowing ? 'Removed from Following.' : 'Saved to Following in this browser.';
  };
  window.addEventListener('storage', event => {
    if (event.key !== recordFollows && event.key !== null) return;
    paint();
    if (!readFollows(recordFollows).has(data.path)) $('updates').hidden = true;
  });
}

async function load() {
  const path = location.pathname.replace(/\/$/, '');
  const address = recordPath(path), params = new URLSearchParams(location.search), follows = readFollows(recordFollows);
  const alias = params.has('at') || params.has('latest');
  const entryAtPath = !alias && follows.get(path);
  if (entryAtPath?.cursor != null) params.set('after', entryAtPath.cursor);
  let data = await fetchRecord(path, params);
  const entry = follows.get(data.path);
  if (entry?.cursor != null && !data.activity) {
    data = await fetchRecord(data.path, new URLSearchParams({ after: entry.cursor }));
  }
  render[address.kind](data);
  content.hidden = false;
  history.replaceState(null, '', data.path + location.hash);
  copyLink($('copy'), $('copied'), data.path);
  if (Object.hasOwn(recordKinds, address.kind)) setupFollow(address.kind, data, entry);
  highlightLocation();
}
window.addEventListener('hashchange', highlightLocation);
load().catch(error => {
  $('title').textContent = 'Record unavailable';
  $('summary').textContent = error instanceof SyntaxError ? 'Could not read the village record.' : error.message;
});

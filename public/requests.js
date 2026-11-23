import { formatDate } from '/engine/calendar.mjs';
import { copyLink, dayLink, promiseLink, recordPath, residentAtLink } from './record-links.js';
import { newer, promiseFollows, promiseTitle as titleOf, readFollows, writeFollows } from './follows.js';

const url = new URL(location.href);
const direct = recordPath(url.pathname);
const id = direct?.kind === 'promises' ? direct.id : url.searchParams.get('request');
const resident = url.searchParams.get('resident'), before = url.searchParams.get('before');
const records = document.getElementById('records'), summary = document.getElementById('summary');
const label = { asked: 'Awaiting a reply', accepted: 'Promised', declined: 'Declined', unanswered: 'No reply by the deadline',
  kept: 'Promise kept', broken: 'Promise missed', released: 'Help no longer needed' };
const node = (tag, value, cls) => {
  const result = document.createElement(tag);
  if (value != null) result.textContent = value;
  if (cls) result.className = cls;
  return result;
};
function link(text, href) {
  const a = node('a', text);
  a.href = href;
  return a;
}
function date(minute) {
  const clock = [Math.floor(minute / 60) % 24, minute % 60].map(n => String(n).padStart(2, '0')).join(':');
  return formatDate(Number(minute)) + ' at ' + clock;
}
const follows = () => readFollows(promiseFollows);
function renderSaved() {
  const area = document.getElementById('followed'), all = follows();
  area.replaceChildren();
  if (!all.size) return;
  const list = node('ul');
  for (const [key, entry] of all) {
    const row = node('li');
    row.append(link(entry.title, promiseLink(key)));
    list.append(row);
  }
  area.append(node('h2', 'Requests you follow'), list);
}
function followButton(r) {
  const button = node('button'), notice = node('span', '', 'follow-notice');
  notice.setAttribute('role', 'status');
  function paint(saved) {
    button.textContent = saved ? 'Unfollow request' : 'Follow request';
    button.setAttribute('aria-pressed', String(saved));
  }
  paint(follows().has(r.id));
  button.addEventListener('click', () => {
    const all = follows(), wasSaved = all.has(r.id);
    if (wasSaved) all.delete(r.id);
    else all.set(r.id, { title: titleOf(r) + ' · ' + r.asker, seen: r.lastEvent.id });
    if (writeFollows(promiseFollows, all)) {
      paint(!wasSaved);
      notice.textContent = wasSaved ? 'Removed from followed requests.' : 'Saved in this browser.';
    } else notice.textContent = 'This browser could not save your choice. You can bookmark this page.';
  });
  document.getElementById('followed').append(button, notice);
}
function parties(r) {
  const p = node('span', '', 'request-parties');
  p.append(link(r.asker, residentAtLink(r.askerId, r.opened)), ' asked ', link(r.helper, residentAtLink(r.helperId, r.opened)), ' for help.');
  return p;
}
function renderDetail({ request: r, items }) {
  document.getElementById('title').textContent = titleOf(r);
  document.title = titleOf(r) + ' · Dalecrest';
  copyLink(document.getElementById('copy-promise'), document.getElementById('copied-promise'), promiseLink(r.id));
  summary.replaceChildren(parties(r), node('span', (label[r.status] || 'Recorded') + (r.due != null ? ' · Due ' + date(r.due) : '')));
  followButton(r);
  records.append(node('h2', 'Recorded events'));
  const all = follows(), entry = all.get(r.id);
  const lastSeen = (before && url.searchParams.get('since')) || entry?.seen;
  for (const event of items) {
    const article = node('article', '', 'request-entry');
    const stamp = node('time', null, 'journal-time');
    stamp.append(link(date(event.minute), dayLink(event.minute)));
    article.append(stamp);
    if (entry && newer(event.id, lastSeen)) article.append(node('strong', 'New since your last visit', 'request-new'));
    article.append(node('p', event.description));
    records.append(article);
  }
  if (!items.length) records.append(node('p', 'No earlier events for this request.', 'empty'));
  if (!before && entry && newer(r.lastEvent.id, entry.seen)) {
    url.searchParams.set('since', entry.seen);
    all.set(r.id, { ...entry, seen: r.lastEvent.id });
    writeFollows(promiseFollows, all);
  }
}
function renderList({ items }) {
  const names = items[0];
  const name = resident && names ? (names.askerId === resident ? names.asker : names.helper) : resident;
  document.getElementById('title').textContent = name ? 'Help requests involving ' + name : 'Help requests';
  summary.textContent = 'Requests, replies and outcomes from the village chronicle.';
  if (!resident) renderSaved();
  const all = follows();
  records.append(node('h2', before ? 'Earlier requests' : 'Requests by date'));
  for (const r of items) {
    const row = node('article', '', 'request-entry'), heading = node('h3');
    heading.append(link(titleOf(r), promiseLink(r.id)));
    row.append(heading, parties(r), node('strong', label[r.status] || 'Recorded'));
    if (all.has(r.id) && newer(r.lastEvent.id, all.get(r.id).seen)) row.append(node('strong', 'New since your last visit', 'request-new'));
    row.append(node('p', r.lastEvent.description), node('time', date(r.lastEvent.minute), 'journal-time'));
    records.append(row);
  }
  if (!items.length) records.append(node('p', resident ? 'No requests recorded for this resident on this page.' : 'No requests recorded on this page.', 'empty'));
}

async function load() {
  const params = new URLSearchParams();
  if (resident && !id) params.set('resident', resident);
  if (before) params.set('before', before);
  if (id || resident || before) {
    const back = document.getElementById('back');
    back.href = '/requests.html';
    back.textContent = 'All help requests';
  }
  const response = await fetch('/api/requests' + (id ? '/' + encodeURIComponent(id) : '') + '?' + params);
  if (!response.ok) throw new Error(response.status === 404 ? 'This request could not be found.' : 'The village records could not be loaded.');
  const data = await response.json();
  if (id) renderDetail(data);
  else renderList(data);
  if (data.next) {
    const older = document.getElementById('older');
    url.searchParams.set('before', data.next);
    older.href = url.href;
    older.hidden = false;
  }
}
load().catch(error => { summary.textContent = error.message; });

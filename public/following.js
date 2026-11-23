import { promiseLink, recordPath } from './record-links.js';
import { fetchRecord, followedPromise, followedTitle, promiseFollows, readFollows, recordFollows, recordKinds,
  updatesFor, writeFollows } from './follows.js';

const records = document.getElementById('following-records');
const status = document.getElementById('following-status');
const empty = document.getElementById('following-empty');
let loadNumber = 0;

function lists() {
  const follows = [];
  for (const [path, entry] of readFollows(recordFollows)) {
    const kind = recordPath(path)?.kind;
    if (Object.hasOwn(recordKinds, kind) && entry) follows.push({ key: path, path, kind, entry, store: recordFollows });
  }
  for (const [id, entry] of readFollows(promiseFollows)) {
    const path = promiseLink(id);
    if (recordPath(path) && entry) follows.push({ key: id, path, kind: 'promises', entry, store: promiseFollows });
  }
  return follows;
}

async function check(follow) {
  if (follow.kind === 'promises') return followedPromise(follow.key, follow.entry);
  const params = new URLSearchParams();
  if (follow.entry.cursor != null) params.set('after', follow.entry.cursor);
  const data = await fetchRecord(follow.path, params);
  const { changes, events } = updatesFor(follow.kind, data, follow.entry);
  return { title: followedTitle(follow.kind, data), updates: [...changes, ...events.map(event => event.text)] };
}

function row(follow, result) {
  const article = document.createElement('article');
  article.className = 'following-row';
  const header = document.createElement('header'), heading = document.createElement('h2');
  const address = document.createElement('a'), kind = document.createElement('p'), unfollow = document.createElement('button');
  address.href = follow.path;
  address.textContent = result?.title ?? follow.entry.title ?? follow.path;
  heading.append(address);
  kind.className = 'eyebrow';
  const noun = recordKinds[follow.kind] ?? 'promise';
  kind.textContent = noun;
  const title = document.createElement('div');
  title.append(kind, heading);
  unfollow.type = 'button';
  unfollow.textContent = 'Unfollow';
  unfollow.setAttribute('aria-label', 'Unfollow ' + address.textContent);
  unfollow.onclick = () => {
    const current = readFollows(follow.store);
    current.delete(follow.key);
    if (!writeFollows(follow.store, current)) {
      status.textContent = 'This browser could not save your choice.';
      return;
    }
    article.remove();
    empty.hidden = records.children.length > 0;
    records.hidden = !empty.hidden;
    status.textContent = 'Removed ' + address.textContent + ' from Following.';
  };
  header.append(title, unfollow);
  article.append(header);
  const notice = document.createElement('p');
  if (result?.updates.length) {
    notice.className = 'following-new';
    notice.textContent = 'New since your last visit';
    const list = document.createElement('ul');
    for (const update of result.updates.slice(0, 3)) {
      const item = document.createElement('li');
      item.textContent = update;
      list.append(item);
    }
    article.append(notice, list);
    if (result.updates.length > 3) {
      const more = document.createElement('a');
      more.href = follow.path;
      more.textContent = 'Read all updates';
      article.append(more);
    }
  } else {
    notice.className = 'empty';
    notice.textContent = result ? 'No changes since your last visit.' : 'Updates are temporarily unavailable.';
    article.append(notice);
  }
  return article;
}

async function load() {
  const attempt = ++loadNumber, follows = lists(), checked = [];
  status.textContent = follows.length ? 'Checking for updates…' : '';
  empty.hidden = follows.length > 0;
  records.setAttribute('aria-busy', String(follows.length > 0));
  for (let i = 0; i < follows.length; i += 6) {
    const batch = follows.slice(i, i + 6);
    const results = await Promise.allSettled(batch.map(check));
    if (attempt !== loadNumber) return;
    checked.push(...batch.map((follow, j) => ({ follow, result: results[j].value })));
  }
  checked.sort((a, b) => Number(Boolean(b.result?.updates.length)) - Number(Boolean(a.result?.updates.length)));
  // A removal made while checks were running must not be put back on the page.
  const current = new Set(lists().map(follow => follow.path));
  records.replaceChildren(...checked.filter(({ follow }) => current.has(follow.path)).map(({ follow, result }) => row(follow, result)));
  records.hidden = records.children.length === 0;
  empty.hidden = !records.hidden;
  records.setAttribute('aria-busy', 'false');
  status.textContent = '';
}

window.addEventListener('storage', event => {
  if ([recordFollows, promiseFollows, null].includes(event.key)) load();
});
window.addEventListener('pageshow', event => { if (event.persisted) load(); });
load();

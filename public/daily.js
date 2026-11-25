import { formatDate } from '/engine/calendar.mjs';
import { dailyIllustrations } from '/engine/daily-illustrations.mjs';
import { dayLink, promiseLink } from './record-links.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const day = params.get('day');
const address = day => '/daily.html?day=' + day;
const link = (label, href) => Object.assign(document.createElement('a'), { textContent: label, href });
const editionDate = day => formatDate(day * 1440, 'long');
let displayedDay;
let listedDays = '';

function showEditionLocation() {
  $('edition').querySelector('[aria-current="location"]')?.removeAttribute('aria-current');
  if (!/^#(?:headline|(?:lead|briefs|since-yesterday|record)-\d+)$/.test(location.hash)) return;
  const target = $(location.hash.slice(1));
  if (target) {
    if (target.id.startsWith('record-')) $('records').open = true;
    target.setAttribute('aria-current', 'location');
    target.scrollIntoView({ block: 'nearest' });
  }
}

function showEditionNavigation(issue) {
  const { day, older, newer, publishedDays = [] } = issue ?? {};
  const previous = $('previous-edition'), next = $('next-edition');
  previous.hidden = !older;
  next.hidden = !newer;
  if (older) previous.href = address(older);
  if (newer) next.href = address(newer);
  const latest = $('latest-edition');
  latest.hidden = Boolean(issue && !newer);

  const picker = $('edition-picker'), dates = publishedDays.join(',');
  const selected = Number(picker.value);
  if (listedDays !== dates) {
    picker.replaceChildren(...publishedDays.map(day => new Option(editionDate(day), day)));
    listedDays = dates;
  }
  if (day !== undefined) {
    const choice = selected !== displayedDay && publishedDays.includes(selected) ? selected : day;
    if (Number(picker.value) !== choice) picker.value = choice;
  }
  $('edition-jump').hidden = publishedDays.length < 2;
}

function showIssue({ day, edition, older }) {
  if (displayedDay === day) return;
  displayedDay = day;
  const issueDate = editionDate(day);
  document.title = 'Dalecrest Daily · ' + issueDate;
  Object.assign($('edition-date'), { textContent: issueDate, href: address(day), hidden: false });
  const start = (day - 1) * 1440;
  $('coverage').replaceChildren('From ', link(formatDate(start, 'long'), dayLink(start)));
  $('headline').textContent = edition.headline;
  const numbers = new Map(edition.sources.map((source, index) => [source.id, index + 1]));
  const illustration = edition.illustration;
  const figure = $('lead-illustration');
  figure.hidden = true;
  if (illustration && Object.hasOwn(dailyIllustrations, illustration.subject) && numbers.has(illustration.sourceId)) {
    const { src, alt, caption } = dailyIllustrations[illustration.subject];
    Object.assign($('lead-image'), { src, alt });
    Object.assign($('lead-image-caption'), { textContent: caption, href: address(day) + '#record-' + illustration.sourceId });
    figure.hidden = false;
  }
  function paragraphs(id, items) {
    $(id).replaceChildren(...items.map((item, index) => {
      const p = document.createElement('p');
      p.id = id + '-' + (index + 1);
      p.append(item.text);
      const passage = document.createDocumentFragment();
      passage.append(p);
      let references = p;
      if (item.sources.length > 3) {
        references = document.createElement('details');
        references.className = 'paper-footnotes';
        const summary = document.createElement('summary');
        summary.textContent = item.sources.length + ' source records';
        references.append(summary);
        passage.append(references);
      }
      for (const source of item.sources) {
        const n = numbers.get(source);
        const citation = link('[' + n + ']', address(day) + '#record-' + source);
        citation.className = 'paper-citation';
        citation.setAttribute('aria-label', 'Read source ' + n);
        citation.addEventListener('click', () => { $('records').open = true; });
        references.append(citation);
      }
      return passage;
    }));
  }
  paragraphs('lead', edition.lead);
  paragraphs('briefs', edition.briefs);
  $('briefs-section').hidden = !edition.briefs.length;
  paragraphs('since-yesterday', edition.sinceYesterday);
  if (!edition.sinceYesterday.length) $('since-yesterday').textContent = older
    ? 'No follow-up was filed for this edition.' : 'The first edition. Follow-ups begin with the next issue.';
  $('sources').replaceChildren(...edition.sources.map(source => {
    const li = document.createElement('li');
    li.id = 'record-' + source.id;
    const stamp = document.createElement('strong');
    const clock = [Math.floor(source.minute / 60) % 24, source.minute % 60].map(n => String(n).padStart(2, '0')).join(':');
    stamp.textContent = (source.kind === 'fieldnote' ? 'Robin’s notebook' : 'Village record') + ' · ' + formatDate(source.minute, 'short') + ', ' + clock;
    li.append(stamp, ' ' + source.text);
    if (source.requestId) li.append(' ', link('Request history', promiseLink(source.requestId)));
    return li;
  }));
  $('records').hidden = !edition.sources.length;
  $('edition').hidden = false;
  showEditionLocation();
}

const searchSections = {
  headline: 'Headline', lead: 'Lead story', briefs: 'Village briefs',
  'since-yesterday': 'Since yesterday', record: 'Reporting record',
};

function showSearchResults({ query, page, matches, hasMore }) {
  const status = $('press-status'), list = $('search-results-list'), pages = $('search-results-pages');
  $('search-results-title').textContent = 'Results for “' + query + '”';
  $('edition-search-results').hidden = false;
  status.hidden = matches.length > 0;
  if (!matches.length) status.textContent = page === 1 ? 'No published editions match this search.' : 'No matches on this page.';

  let edition, passages;
  for (const result of matches) {
    const url = address(result.day);
    if (result.day !== edition) {
      edition = result.day;
      const group = document.createElement('li'), date = document.createElement('p'), title = document.createElement('h3');
      date.className = 'daily-search-date';
      date.textContent = editionDate(edition);
      title.append(link(result.headline, url));
      passages = document.createElement('ul');
      passages.className = 'daily-search-passages';
      group.append(date, title, passages);
      list.append(group);
    }
    const row = document.createElement('li'), highlight = document.createElement('mark');
    const section = document.createElement('span');
    section.className = 'daily-search-section';
    section.textContent = searchSections[result.section];
    highlight.textContent = result.match;
    const passage = link('', url + '#' + result.anchor);
    passage.append(section, ' · ', result.before, highlight, result.after);
    row.append(passage);
    passages.append(row);
  }
  const searchPage = number => '/daily.html?' + new URLSearchParams({ q: query, ...(number > 1 && { page: number }) });
  if (page > 1) pages.append(link('← Previous results', searchPage(page - 1)));
  if (hasMore) pages.append(link('More results →', searchPage(page + 1)));
}

async function searchArchive(query) {
  $('edition-search-query').value = query;
  showEditionNavigation(null);
  document.title = 'Dalecrest Daily · Search';
  const status = $('press-status'), search = new URLSearchParams({ q: query });
  const page = params.get('page');
  if (page !== null) search.set('page', page);
  status.textContent = 'Searching the archive…';
  try {
    const response = await fetch('/api/daily/search?' + search);
    const result = await response.json();
    if (response.ok) showSearchResults(result);
    else status.textContent = result.error;
  } catch {
    status.textContent = 'The archive search is temporarily unavailable.';
  }
}

async function refresh() {
  try {
    const response = await fetch('/api/daily' + (day === null ? '' : '?day=' + encodeURIComponent(day)));
    if (response.status === 400 || response.status === 404) {
      $('press-status').textContent = 'This edition is unavailable.';
      showEditionNavigation(null);
      return;
    }
    if (!response.ok) throw new Error();
    const { issue, pending, editorConfigured } = await response.json();
    if (issue) {
      showEditionNavigation(issue);
      showIssue(issue);
    }
    const status = $('press-status');
    status.hidden = Boolean(issue) && (day !== null || !pending);
    if (!status.hidden) status.textContent = pending
      ? (editorConfigured ? 'The next edition is at the editor’s desk.' : 'The edition is queued while the village editor is offline.')
      : 'The first edition goes to press at six on the morning after the founding day.';
  } catch {
    $('press-status').hidden = false;
    $('press-status').textContent = 'The village press is temporarily unavailable.';
  } finally {
    if (day === null || !displayedDay) setTimeout(refresh, 15000);
  }
}

$('lead-image-caption').addEventListener('click', () => { $('records').open = true; });
const searchTrigger = $('edition-search-trigger'), searchDialog = $('edition-search-dialog');
searchTrigger.addEventListener('click', () => searchDialog.showModal());
searchDialog.addEventListener('close', () => searchTrigger.focus());
window.addEventListener('hashchange', showEditionLocation);
const query = params.get('q');
if (query === null) refresh();
else searchArchive(query);

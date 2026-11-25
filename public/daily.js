import { formatDate } from '/engine/calendar.mjs';
import { dailyIllustrations } from '/engine/daily-illustrations.mjs';
import { dayLink, promiseLink } from './record-links.js';

const $ = id => document.getElementById(id);
const day = new URLSearchParams(location.search).get('day');
const address = day => '/daily.html?day=' + day;
const link = (label, href) => Object.assign(document.createElement('a'), { textContent: label, href });
const editionDate = day => formatDate(day * 1440, 'long');
let displayedDay;
let listedDays = '';

function showRecord() {
  document.querySelector('.paper-records [aria-current="location"]')?.removeAttribute('aria-current');
  if (!/^#record-\d+$/.test(location.hash)) return;
  const target = $(location.hash.slice(1));
  if (target) {
    $('records').open = true;
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
  const jump = $('edition-jump');
  jump.hidden = publishedDays.length < 2;
  $('edition-navigation').hidden = previous.hidden && next.hidden && latest.hidden && jump.hidden;
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
    $(id).replaceChildren(...items.map(item => {
      const p = document.createElement('p');
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
  showRecord();
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
window.addEventListener('hashchange', showRecord);
refresh();

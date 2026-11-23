import { formatDate } from '../engine/calendar.mjs';
import { createSurvey, surveyBounds } from './map.js';
import { dayLink } from './record-links.js';

const $ = id => document.getElementById('growth-' + id);
const canvas = $('map'), draw = createSurvey(canvas), cache = new Map();
const seek = $('seek'), controls = $('controls'), play = $('play'), previous = $('prev'), next = $('next');
const range = $('range'), status = $('status'), retry = $('retry');
let frames = [], bounds, shown, desired = 0, request = 0, playing = false, timer, retryLoad;

async function read(path) {
  const response = await fetch(path, { signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error('Archive request failed');
  return response.json();
}

function load(index) {
  const { revision } = frames[index];
  if (!cache.has(revision)) {
    cache.set(revision, read('/api/map/revisions?revision=' + revision).catch(error => {
      cache.delete(revision);
      throw error;
    }));
    if (cache.size > 16) cache.delete(cache.keys().next().value);
  }
  return cache.get(revision);
}

function printDate(minute) {
  const hour = Math.floor(minute / 60) % 24;
  return formatDate(minute) + ' · ' + (hour % 12 || 12) + ':' + String(minute % 60).padStart(2, '0') + (hour < 12 ? ' am' : ' pm');
}

function changedPlaces(map, before) {
  if (!before) return [];
  const older = new Map(before.places.map(place => [place.id, place]));
  return map.places.filter(place => {
    const last = older.get(place.id);
    return !last || ['stage', 'x', 'y', 'w', 'd', 'a'].some(key => place[key] !== last[key]);
  });
}

function redraw() {
  if (shown) draw(shown.map, { minute: shown.minute, bounds, changes: shown.changes });
}

function stop() {
  clearTimeout(timer);
  playing = false;
  play.textContent = 'Play';
}

async function show(index) {
  if (index < 0 || index >= frames.length) return;
  const token = ++request;
  clearTimeout(timer);
  desired = index;
  seek.value = index;
  seek.setAttribute('aria-valuetext', printDate(frames[index].minute));
  previous.disabled = index === 0;
  next.disabled = index === frames.length - 1;
  status.textContent = '';
  retry.hidden = true;
  try {
    const [frame, before] = await Promise.all([load(index), index ? load(index - 1) : null]);
    if (token !== request) return;
    const changes = changedPlaces(frame.map, before?.map);
    shown = { ...frame, changes };
    Object.assign($('date'), { textContent: printDate(frame.minute), href: dayLink(frame.minute) });
    $('count').textContent = (index + 1) + ' of ' + frames.length;
    const cottages = frame.map.places.filter(p => p.kind === 'cottage' && p.stage === 2).length;
    const fields = frame.map.places.filter(p => p.kind === 'field' && p.stage === 2).length;
    const ways = frame.map.roads.filter(road => road.name).length;
    $('details').textContent = [
      cottages + (cottages === 1 ? ' cottage' : ' cottages'), fields + (fields === 1 ? ' field' : ' fields'),
      ways + (ways === 1 ? ' named way' : ' named ways'), changes.length ? 'Changed sites outlined' : '',
    ].filter(Boolean).join(' · ');
    canvas.setAttribute('aria-label', 'Map of Dalecrest on ' + formatDate(frame.minute) + '. ' + $('details').textContent);
    redraw();
    if (playing && index < frames.length - 1) timer = setTimeout(() => show(index + 1), 1000);
    else stop();
  } catch {
    if (token !== request) return;
    stop();
    status.textContent = 'Could not open this revision.';
    retryLoad = () => show(index);
    retry.hidden = false;
  }
}

async function open() {
  retry.hidden = true;
  status.textContent = '';
  try {
    frames = await read('/api/map/revisions');
    if (!frames.length) { range.textContent = 'The archive has no saved maps yet.'; return; }
    const first = frames[0], last = frames.at(-1);
    const maps = await Promise.all([load(0), load(frames.length - 1)]);
    bounds = surveyBounds(maps.map(frame => frame.map));
    const from = formatDate(first.minute), to = formatDate(last.minute);
    range.textContent = frames.length > 1 ? (from === to ? from : from + ' – ' + to)
      : 'First saved map · New revisions appear here as the village changes.';
    seek.max = frames.length - 1;
    controls.hidden = frames.length < 2;
    await show(0);
  } catch {
    status.textContent = 'Could not open the village archive.';
    retryLoad = open;
    retry.hidden = false;
  }
}

play.addEventListener('click', () => {
  if (playing) { stop(); return; }
  playing = true;
  play.textContent = 'Pause';
  show(desired === frames.length - 1 ? 0 : desired);
});
seek.addEventListener('input', () => { stop(); show(Number(seek.value)); });
previous.addEventListener('click', () => { stop(); show(desired - 1); });
next.addEventListener('click', () => { stop(); show(desired + 1); });
retry.addEventListener('click', () => retryLoad?.());
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
new ResizeObserver(redraw).observe(canvas);
document.fonts?.ready.then(redraw);
open();

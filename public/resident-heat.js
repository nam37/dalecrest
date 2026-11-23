import { formatDate } from '../engine/calendar.mjs';
import { createSurvey } from './map.js';

export function createResidentHeat(root) {
  const panel = document.createElement('section');
  panel.className = 'resident-heat';
  panel.setAttribute('aria-label', 'Resident heat map');
  panel.innerHTML = `
    <label class="heat-filter">Recorded time <select>
      <option value="7">Last 7 village days</option><option value="30">Last 30 village days</option>
      <option value="all">All recorded time</option>
    </select></label>
    <div class="heat-plate" hidden><canvas role="img"></canvas></div>
    <div class="heat-legend" title="Time relative to the warmest area in this range" hidden><span>Less time</span><i aria-hidden="true"></i><span>More time</span></div>
    <p class="heat-coverage" role="status"></p><p class="heat-place"></p>
    <button type="button" class="where" hidden>Try again</button>`;
  const range = panel.querySelector('select'), canvas = panel.querySelector('canvas');
  const plate = canvas.parentElement, legend = panel.querySelector('.heat-legend'), coverage = panel.querySelector('.heat-coverage');
  const place = panel.querySelector('.heat-place'), retry = panel.querySelector('button');
  const draw = createSurvey(canvas);
  let subject, viewKey, loaded, pending, heat;

  function redraw() {
    if (subject && heat?.cells.length) draw(subject.map, { minute: subject.minute, heat });
  }
  new ResizeObserver(redraw).observe(canvas);

  function present() {
    const { cells, minutes, firstMinute, lastMinute, cellSize } = heat;
    plate.hidden = legend.hidden = !cells.length;
    if (!cells.length) {
      coverage.textContent = 'No village time has been recorded for this range yet.';
      place.textContent = '';
      return;
    }
    const first = formatDate(firstMinute), last = formatDate(lastMinute);
    coverage.textContent = minutes.toLocaleString() + (minutes === 1 ? ' recorded village minute' : ' recorded village minutes') +
      ' · ' + (first === last ? first : first + ' – ' + last);
    const [column, row, count] = cells[0], x = (column + 0.5) * cellSize, y = (row + 0.5) * cellSize;
    let nearest, distance = 4.5;
    for (const feature of Object.values(subject.locations)) {
      const d = Math.hypot(x - feature.x, y - feature.y);
      if (feature.name && d < distance) { nearest = feature.name; distance = d; }
    }
    const share = count / minutes * 100;
    place.textContent = 'Warmest area' + (nearest ? ' near ' + nearest : '') + ' · ' +
      (share < 1 ? '<1%' : Math.round(share) + '%') + ' of recorded time';
    canvas.setAttribute('aria-label', 'Heat map for ' + subject.actor.name + '. ' + coverage.textContent + '. ' + place.textContent);
    redraw();
  }

  function cancel() {
    pending?.controller.abort();
    pending = null;
  }

  async function refresh() {
    if (!subject) return;
    const key = subject.actor.id + ':' + range.value;
    if (viewKey !== key) {
      cancel();
      viewKey = key; heat = null; loaded = null;
      plate.hidden = legend.hidden = retry.hidden = true;
      coverage.textContent = 'Reading recorded locations…';
      place.textContent = '';
    }
    const bucket = heat?.minutes ? Math.floor(subject.minute / 15) : subject.minute;
    if (loaded === bucket || pending) return;
    const job = { controller: new AbortController() };
    pending = job;
    retry.hidden = true;
    try {
      const res = await fetch('/api/residents/' + encodeURIComponent(subject.actor.id) + '/heat-map?days=' + range.value,
        { signal: AbortSignal.any([job.controller.signal, AbortSignal.timeout(9000)]) });
      if (!res.ok) throw new Error('Heat map unavailable');
      const data = await res.json();
      if (pending !== job) return;
      heat = data;
      loaded = data.minutes ? Math.floor(subject.minute / 15) : subject.minute;
      present();
    } catch {
      if (pending !== job) return;
      coverage.textContent = 'Could not load the recorded locations.';
      retry.hidden = false;
    } finally {
      if (pending === job) pending = null;
    }
  }

  range.addEventListener('change', refresh);
  retry.addEventListener('click', refresh);
  return {
    show(next) {
      const changed = subject?.map !== next.map;
      subject = next;
      if (panel.parentElement !== root) root.replaceChildren(panel);
      refresh();
      if (changed && heat) present();
    },
    hide() { subject = null; cancel(); },
  };
}

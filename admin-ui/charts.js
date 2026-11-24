const count = new Intl.NumberFormat();
const seconds = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const realDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const resident = document.getElementById('chart-resident');
let activities;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function chart(id, rows, series, { format = count, axis = compact, stacked = false, extra } = {}) {
  const target = document.getElementById(id);
  if (!rows.length) {
    target.replaceChildren(node('p', 'No records yet.', 'chart-note'));
    return;
  }
  const high = Math.max(1, ...rows.map(row => {
    const values = series.map(item => row[item.key] ?? 0);
    return stacked ? values.reduce((sum, value) => sum + value, 0) : Math.max(...values);
  }));
  const magnitude = 10 ** Math.floor(Math.log10(high));
  const scale = [1, 2, 5, 10].map(step => step * magnitude).find(value => value >= high);
  const label = row => row.date + (row.partial ? ' · in progress' : '');
  const value = (row, item) => row[item.key] == null ? '—' : format.format(row[item.key]);
  const legend = node('ul', undefined, 'chart-legend');
  series.forEach((item, index) => {
    const key = node('li', item.label);
    key.dataset.series = index;
    legend.append(key);
  });
  if (rows.some(row => row.partial)) legend.append(node('li', '† In progress', 'chart-partial'));

  const scroll = node('div', undefined, 'chart-scroll');
  scroll.setAttribute('aria-hidden', 'true');
  const plot = node('div', undefined, 'chart-plot');
  const ticks = node('div', undefined, 'chart-ticks');
  ticks.append(...[scale, scale / 2, 0].map(mark => node('span', axis.format(mark))));
  const grid = node('div', undefined, 'chart-grid');
  grid.style.setProperty('--days', rows.length);
  rows.forEach((row, day) => {
    const column = node('div', undefined, row.partial ? 'chart-day partial' : 'chart-day');
    const bars = node('div', undefined, stacked ? 'chart-bars stacked' : 'chart-bars');
    column.title = [label(row), ...series.map(item => item.label + ' ' + value(row, item))].join('\n');
    series.forEach((item, index) => {
      const bar = node('span');
      bar.dataset.series = index;
      bar.style.height = ((row[item.key] ?? 0) * 100 / scale) + '%';
      bars.append(bar);
    });
    const tick = day === 0 || day === rows.length - 1 || (day % 3 === 0 && day < rows.length - 2);
    column.append(bars, node('div', tick ? row.label + (row.partial ? ' †' : '') : '', 'chart-date'));
    grid.append(column);
  });
  plot.append(ticks, grid);
  scroll.append(plot);

  const details = node('details', undefined, 'chart-values');
  details.open = target.querySelector('details')?.open ?? false;
  details.append(node('summary', 'View values'));
  const table = node('table');
  const head = table.createTHead().insertRow();
  ['Date', ...series.map(item => item.label), ...(extra ? [extra.label] : [])].forEach(text => {
    const cell = node('th', text);
    cell.scope = 'col';
    head.append(cell);
  });
  const body = table.createTBody();
  rows.forEach(row => {
    const line = body.insertRow();
    const date = node('th', label(row));
    date.scope = 'row';
    line.append(date);
    series.forEach(item => { line.insertCell().textContent = value(row, item); });
    if (extra) line.insertCell().textContent = count.format(row[extra.key]);
  });
  const tableScroll = node('div', undefined, 'table-scroll');
  tableScroll.append(table);
  details.append(tableScroll);
  target.replaceChildren(legend, scroll, details);
}

const activitySeries = [{ key: 'fresh', label: 'Fresh choices' }, { key: 'standing', label: 'Standing instructions' }];
function renderActivities() {
  const actor = activities?.actors.find(person => person.id === resident.value);
  const rows = actor ? activities.days.map((day, index) => ({ ...day, ...actor.starts[index] })) : [];
  chart('activity-chart', rows, activitySeries, { stacked: true });
}
resident.addEventListener('change', renderActivities);

function dated(rows) {
  return rows.map(row => ({ ...row, label: realDate.format(new Date(row.date + 'T00:00:00Z')) }));
}

export function renderCharts(data) {
  activities = data.activities;
  const selected = resident.value;
  resident.replaceChildren(...activities.actors.map(({ id, name }) => new Option(name, id)));
  resident.disabled = !activities.actors.length;
  if (activities.actors.some(actor => actor.id === selected)) resident.value = selected;
  renderActivities();
  chart('token-chart', dated(data.tokens), [{ key: 'openai', label: 'OpenAI' }, { key: 'anthropic', label: 'Anthropic' }]);
  chart('wait-chart', dated(data.waits), [{ key: 'median', label: 'Median' }, { key: 'p95', label: '95th percentile' }],
    { format: seconds, axis: seconds, extra: { key: 'count', label: 'Completed waits' } });
}

export function clearCharts() {
  activities = undefined;
  resident.replaceChildren();
  for (const id of ['token-chart', 'activity-chart', 'wait-chart']) document.getElementById(id).replaceChildren();
}

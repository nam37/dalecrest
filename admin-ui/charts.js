const count = new Intl.NumberFormat();
const seconds = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const realDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const resident = document.getElementById('chart-resident');
const waitRange = document.getElementById('wait-range');
const plots = new Map();
const resize = new ResizeObserver(entries => {
  for (const { target, contentRect } of entries) {
    if (contentRect.width > 0) window.echarts?.getInstanceByDom(target)?.resize();
  }
});
let activities, waits;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function disposePlot(id) {
  const plot = plots.get(id);
  if (!plot) return;
  resize.unobserve(plot.getDom());
  plot.dispose();
  plots.delete(id);
}

function chart(id, rows, series, { format = count, axis = compact, stacked = false, lines = false, horizontal = false, extra } = {}) {
  const target = document.getElementById(id);
  if (!rows.length) {
    disposePlot(id);
    target.replaceChildren(node('p', 'No records yet.', 'chart-note'));
    return;
  }
  const label = row => (row.date ?? row.label) + (row.partial ? ' · in progress' : '');
  const value = (row, item) => row[item.key] == null ? '—' : format.format(row[item.key]);
  let plot = plots.get(id);
  if (!plot) {
    const container = node('div', undefined, horizontal ? 'chart-plot chart-plot-residents' : 'chart-plot');
    target.replaceChildren(container);
    plot = window.echarts.init(container, null, { renderer: 'canvas' });
    plots.set(id, plot);
    resize.observe(container);
    if (rows.some(row => row.partial)) target.append(node('p', '† In progress', 'chart-partial'));
  }
  const names = series.map(item => item.label);
  const categories = {
    type: 'category', inverse: horizontal, data: rows.map(row => row.label + (row.partial ? ' †' : '')),
    axisLabel: { color: '#455b54', hideOverlap: true, showMinLabel: true, showMaxLabel: true,
      ...(horizontal && { width: 106, overflow: 'truncate' }) },
    axisLine: { lineStyle: { color: '#aebcaf' } },
  };
  const values = {
    type: 'value', minInterval: lines ? undefined : 1,
    axisLabel: { color: '#455b54', formatter: n => axis.format(n) },
    splitLine: { lineStyle: { color: '#dce4d9' } },
  };
  plot.setOption({
    animation: false,
    color: ['#287364', '#a4542d'],
    aria: { enabled: true },
    grid: { left: horizontal ? 118 : 50, right: 20, bottom: 35 },
    legend: { top: 4, left: 'center', data: names, textStyle: { color: '#455b54' } },
    media: [
      { query: { maxWidth: 270 }, option: { grid: { top: 62 } } },
      { option: { grid: { top: 44 } } },
    ],
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true,
      valueFormatter: n => n == null ? '—' : format.format(n) },
    xAxis: horizontal ? values : categories,
    yAxis: horizontal ? categories : values,
    series: series.map(item => ({
      name: item.label, type: lines ? 'line' : 'bar', stack: stacked ? 'total' : undefined,
      data: rows.map(row => row[item.key] ?? null), barMaxWidth: 18, symbolSize: 6,
    })),
  });

  let details = target.querySelector('details');
  if (!details) {
    details = node('details', undefined, 'chart-values');
    details.append(node('summary', 'View values'));
    details.append(node('div', undefined, 'table-scroll'));
    target.append(details);
  }
  const table = node('table');
  const head = table.createTHead().insertRow();
  [horizontal ? 'Resident' : 'Date', ...series.map(item => item.label), ...(extra ? [extra.label] : [])].forEach(text => {
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
  details.querySelector('.table-scroll').replaceChildren(table);
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

const tokenSeries = [{ key: 'openai', label: 'OpenAI' }, { key: 'anthropic', label: 'Anthropic' }];
const waitSeries = [{ key: 'median', label: 'Median' }, { key: 'p95', label: '95th percentile' }];
function renderWaits() {
  if (!waits) return;
  chart('wait-chart', waits.slice(-Number(waitRange.value)), waitSeries,
    { format: seconds, axis: seconds, lines: true, extra: { key: 'count', label: 'Completed waits' } });
}
waitRange.addEventListener('change', renderWaits);

export function renderCharts(data) {
  activities = data.activities;
  const selected = resident.value;
  resident.replaceChildren(...activities.actors.map(({ id, name }) => new Option(name, id)));
  resident.disabled = !activities.actors.length;
  if (activities.actors.some(actor => actor.id === selected)) resident.value = selected;
  renderActivities();
  chart('token-chart', dated(data.tokens), tokenSeries);
  chart('resident-token-chart', (data.residentTokens ?? []).map(row => ({ ...row, label: row.name })), tokenSeries,
    { horizontal: true, stacked: true, extra: { key: 'total', label: 'Total' } });
  waits = dated(data.waits);
  renderWaits();
}

export function clearCharts() {
  activities = undefined;
  waits = undefined;
  resident.replaceChildren();
  waitRange.selectedIndex = 0;
  for (const id of ['token-chart', 'resident-token-chart', 'activity-chart', 'wait-chart']) {
    disposePlot(id);
    document.getElementById(id).replaceChildren();
  }
}

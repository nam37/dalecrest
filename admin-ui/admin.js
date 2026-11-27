import { clearCharts, renderCharts } from './charts.js';

const $ = id => document.getElementById(id);
const show = (id, enabled) => { $(id).hidden = !enabled; };
const say = (id, content) => { $(id).textContent = content ?? ''; };
const labels = { '1x': '1× fixed', '2x': '2× fixed', 'day-night': 'Day/night' };
const lengths = { '1x': 12, '2x': 6, 'day-night': 5 };
const outcomes = { applying: 'Applying', verified: 'Verified', failed: 'Failed', unverified: 'Needs a check', interrupted: 'Interrupted' };
const clockForm = $('clock-form'), clockMode = clockForm.elements.mode;
const number = value => Number.isFinite(value) ? value.toLocaleString() : '—';
const date = value => value ? new Date(value).toLocaleString() : '—';
const ms = value => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' ms' : '—';
const bytes = value => {
  if (!Number.isFinite(value)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Math.abs(value), unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
  return (value < 0 ? '−' : '') + size.toLocaleString(undefined, { maximumFractionDigits: size < 10 ? 1 : 0 }) + ' ' + units[unit];
};
let current = null, user = null, restoring, active = null, sending = false, refreshing = false, generation = 0;
let historySignature = '';
let chartsChecked = 0, chartsLoading = false;

async function api(path, body) {
  const response = await fetch(new URL('./api/' + path, import.meta.url), body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
  return result;
}

function auth(viewer) {
  user = viewer;
  show('sign-in', !user);
  show('dashboard', Boolean(user));
  show('account', Boolean(user));
  show('target', Boolean(user));
  show('operator-controls', user?.role === 'operator');
  if (user) say('viewer', user.name + ' · ' + user.role);
  else {
    generation++;
    clockForm.reset();
    current = null;
    active = null;
    restoring = undefined;
    historySignature = '';
    $('changes').replaceChildren();
    chartsChecked = 0;
    clearCharts();
    show('charts', false);
    say('charts-message', '');
    say('clock-message', '');
  }
}

function clockSummary() {
  const desired = clockMode.value;
  const from = current?.clock.mode;
  const explanation = lengths[desired] + ' real hours per village day';
  say('pace-summary', (restoring ? 'Restoring the earlier setting · ' : '') + explanation
    + (from ? ' · Current pace ' + labels[from] : ''));
  $('apply').disabled = sending || Boolean(active) || !from || desired === from;
}

function renderHealth(status) {
  const { health, villageName, preview } = status;
  current = health;
  active = status.active;
  say('target', villageName + (preview ? ' · Preview village' : ' · Live village'));
  say('checked', health ? 'Checked ' + date(health.checkedAt) : '');
  say('health-message', health ? '' : active ? 'Waiting for the village after restart.' : 'Village health is temporarily unavailable.');
  const clock = health?.clock;
  const hour = clock ? Math.floor((clock.minute % 1440) / 60) : 0;
  const minute = clock ? clock.minute % 60 : 0;
  const villageTime = String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  say('pace', clock ? clock.period ? (clock.period === 'day' ? '2× · Day pace' : '4× · Night pace')
    : labels[clock.mode] || 'Custom pace' : '—');
  say('village-time', clock ? clock.date + ' · ' + villageTime : '—');
  say('next-period', clock?.overdueMs >= clock?.tickMs ? 'Tick overdue by ' + Math.floor(clock.overdueMs / 1000) + ' seconds'
    : clock?.period ? 'Next transition at ' + (clock.period === 'day' ? '22:00' : '06:00') : '');
  say('planner', health?.planner.state ?? '—');
  say('waiting', health ? number(health.planner.waiting) + ' residents waiting · ' + number(health.planner.pending) + ' open requests' : '—');
  say('oldest', Number.isFinite(health?.planner.oldestWaitMinutes) ? 'Oldest wait ' + number(health.planner.oldestWaitMinutes) + ' village minutes' : '');
  say('tokens', health ? number(health.actionTokens.used) + ' / ' + number(health.actionTokens.hourlyCap) : '—');
  say('release', health?.deployment.revision?.slice(0, 12) ?? '—');
  say('backup', health?.deployment.lastBackup ? 'Last backup ' + date(health.deployment.lastBackup) : 'Backup time unavailable');
  const ticks = health?.ticks?.lastTwoHours;
  const slowest = Object.entries(ticks?.phases ?? {}).filter(([name]) => name !== 'total')
    .sort(([, a], [, b]) => b.meanMs - a.meanMs)[0];
  say('tick-time', ticks?.ticks ? ms(ticks.meanMs) + ' mean' : '—');
  say('tick-worst', ticks?.ticks ? 'Worst ' + ms(ticks.maxMs) + ' over ' + number(ticks.ticks) + ' ticks in the last two hours' : 'No ticks timed yet');
  say('tick-phase', slowest ? 'Slowest part: ' + slowest[0] + ', ' + ms(slowest[1].meanMs) + ' mean' : '');
  const storage = health?.storage, largest = storage?.tables[0];
  say('database-size', storage ? bytes(storage.databaseBytes) : '—');
  say('database-growth', !storage ? 'Sizes not sampled yet' : storage.comparedOverDays === null ? 'Growth shows after an hour of samples'
    : bytes(storage.databaseGrowthPerDay) + ' a day · ' + bytes(storage.logWrittenPerDay) + ' of log a day');
  say('largest-table', largest ? 'Largest: ' + largest.name + ', ' + bytes(largest.bytes)
    + (Number.isFinite(largest.growthPerDay) ? ' (+' + bytes(largest.growthPerDay) + ' a day)' : '') : '');
  clockSummary();
}

function renderHistory(changes) {
  const signature = JSON.stringify([changes, user?.role, current?.clock.mode, Boolean(active)]);
  if (signature === historySignature) return;
  historySignature = signature;
  show('history-table', changes.length > 0);
  show('empty-history', changes.length === 0);
  $('changes').replaceChildren(...changes.map(change => {
    const row = document.createElement('tr');
    const effective = change.effective && change.effective !== change.requested ? ' · running ' + labels[change.effective] : '';
    const finished = change.finishedAt ? ' · ' + date(change.finishedAt) : '';
    const values = [date(change.requestedAt), change.requestedBy, labels[change.before] + ' → ' + labels[change.requested],
      (outcomes[change.status] ?? change.status) + effective + finished, change.reason];
    for (const value of values) row.insertCell().textContent = value;
    row.cells[3].className = change.status;
    const cell = row.insertCell();
    if (user.role === 'operator' && change.status === 'verified' && current?.clock.mode && current.clock.mode !== change.before && !active) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Restore ' + labels[change.before];
      button.addEventListener('click', () => {
        restoring = change.id;
        clockMode.value = change.before;
        clockForm.elements.reason.value = '';
        clockForm.elements.reason.focus();
        clockSummary();
      });
      cell.append(button);
    }
    return row;
  }));
}

async function refreshCharts() {
  if (chartsLoading || Date.now() - chartsChecked < 60000) return;
  const started = generation;
  chartsLoading = true;
  chartsChecked = Date.now();
  if ($('charts').hidden) say('charts-message', 'Loading village trends…');
  try {
    const data = await api('metrics');
    if (started !== generation) return;
    show('charts', true);
    renderCharts(data);
    say('charts-message', '');
  } catch {
    if (started === generation) say('charts-message', 'Village trends could not be refreshed.');
  } finally {
    chartsLoading = false;
  }
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  const started = generation;
  try {
    const status = await api('status');
    if (started !== generation) return;
    auth(status.viewer);
    renderHealth(status);
    void refreshCharts();
    const { changes } = await api('changes');
    if (started === generation) renderHistory(changes);
  } catch (error) {
    if (started !== generation) return;
    if (error.status === 401) auth(null);
    else if (user) say('health-message', 'The dashboard could not refresh.');
    else say('login-message', 'The admin panel could not be reached.');
  } finally {
    refreshing = false;
  }
}

$('login').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  say('login-message', '');
  const input = Object.fromEntries(new FormData(event.currentTarget));
  try {
    await api('session', input);
    $('login').reset();
    await refresh();
  } catch (error) { say('login-message', error.message); }
  finally { button.disabled = false; }
});

$('logout').addEventListener('click', async () => {
  try { await api('logout', {}); auth(null); }
  catch (error) { say('health-message', error.message); }
});

clockMode.addEventListener('change', () => { restoring = undefined; clockSummary(); });
clockForm.addEventListener('submit', async event => {
  event.preventDefault();
  sending = true;
  clockSummary();
  try {
    const { change } = await api('clock', {
      mode: clockMode.value, expected: current?.clock.mode, reason: clockForm.elements.reason.value,
      ...(restoring && { revert: restoring }),
    });
    active = change;
    restoring = undefined;
    clockForm.elements.reason.value = '';
    say('clock-message', 'Requested ' + labels[change.requested] + '. Follow the outcome in the change history.');
  } catch (error) { say('clock-message', error.message); }
  finally { sending = false; clockSummary(); await refresh(); }
});

await refresh();
setInterval(() => { if (user) refresh(); }, 5000);

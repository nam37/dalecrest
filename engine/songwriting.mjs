import { activeGoals, dueReview, MAX_GOALS, syncGoals } from './goals.mjs';
import { memoryKey, recall } from './memory.mjs';
import { place } from './roads.mjs';

const DAY = 1440;
const GOAL = 'songwriting';
const MAX_VERSES = 6;
const WRITING_OPENS = 17 * 60;
const WRITING_CLOSES = 20 * 60 + 20;
const OLD_BIO = 'Robin was hired for a single harvest and stayed. He still makes time after work to hear the old field songs on the green.';
const BIO = 'Robin was hired for a single harvest and stayed. In his spare hours he makes up songs about what he has seen or imagined.';
const reportedToday = (actor, day) => Object.values(actor.rounds ?? {}).some(last => Math.floor(last / DAY) === day);

export function prepareSongwriter(actor, world) {
  if (!world.songwritingPilot || actor.id !== 'robin' || (actor.arrived ?? 0) !== 0) return;
  if (actor.backstory === OLD_BIO) actor.backstory = BIO;
  const song = actor.songwriting ??= { since: world.minute, version: 0, status: 'writing', verses: [], used: [] };
  if (song.goalSeeded) return;
  if (activeGoals(actor).length >= MAX_GOALS) {
    if (!song.goalReviewRequested) {
      dueReview(actor, world.minute, 'I would like to make room for writing songs');
      song.goalReviewRequested = true;
    }
    return;
  }
  actor.goalBook.push({ id: GOAL, version: 1, kind: 'evidence', text: 'Make time after my rounds to write songs of my own',
    focus: 'rest', status: 'active', since: world.minute, source: 'pilot', basis: [], stored: false });
  syncGoals(actor);
  song.goalSeeded = true;
}

export function offerSongwriting(actor, { world, map }, offer, weary) {
  const song = actor.songwriting, minute = world.minute, day = Math.floor(minute / DAY), time = minute % DAY;
  if (!world.songwritingPilot || !song || !activeGoals(actor).some(goal => goal.id === GOAL) ||
      !reportedToday(actor, day) || song.lastSession >= day * DAY || time < WRITING_OPENS || time >= WRITING_CLOSES || place(map, 'green')?.stage !== 2) return;
  const daysSince = day - Math.floor((song.lastSession ?? song.since) / DAY);
  const score = 64 + Math.min(16, daysSince * 5) - weary;
  if (song.status !== 'writing') {
    offer('compose', 'Starting a new song', 'green', 40, score,
      'My last draft is put away. I have time to begin another song.', { songTask: 'begin', songVersion: song.version });
    return;
  }
  const lyrics = song.verses.length;
  if (lyrics < MAX_VERSES) offer('compose', lyrics ? 'Writing another verse' : 'Starting a song', 'green', 40, score,
    'My rounds are done for now. I have time to work on a song of my own.', { songTask: 'write', songVersion: song.version });
  if (lyrics) {
    offer('compose', 'Revising the last verse', 'green', 40, score - 12,
      'I have time to return to the verse I wrote.', { songTask: 'revise', songVersion: song.version });
    offer('compose', 'Finishing the song', 'green', 12, score - (lyrics >= 3 ? 3 : 20),
      'I can decide the song is ready as it stands.', { songTask: 'finish', songVersion: song.version });
    offer('compose', 'Setting the song aside', 'green', 12, score - 26,
      'I can put my draft aside and make time for something else on future evenings.', { songTask: 'set_aside', songVersion: song.version });
  }
}

export function songwritingContext(actor, world) {
  const song = actor.songwriting;
  if (!world.songwritingPilot || !song) return null;
  const day = Math.floor(world.minute / DAY);
  return { title: song.title ?? null, status: song.status, verses: song.verses.length, roundsToday: reportedToday(actor, day),
    eveningsSinceLastSession: song.lastSession == null ? null : day - Math.floor(song.lastSession / DAY) };
}

function writableDraft(actor, world) {
  const song = actor.songwriting;
  return world.songwritingPilot && actor.id === 'robin' && (actor.arrived ?? 0) === 0 &&
    song?.status === 'writing' && song.verses.length < MAX_VERSES && activeGoals(actor).some(goal => goal.id === GOAL) ? song : null;
}

function activeEveningPlan(song, minute) {
  const plan = song?.eveningPlan;
  return plan && plan.songStarted === (song.started ?? song.since) && plan.songVersion === song.version &&
    minute < plan.expiresAt && !(song.lastSession >= plan.startsAt) ? plan : null;
}

// Freeze the days and the draft offered to the review. Its reply may arrive after the village has moved on.
export function offerEveningPlan(actor, world) {
  const song = writableDraft(actor, world);
  if (!song || activeEveningPlan(song, world.minute)) return null;
  const day = Math.floor(world.minute / DAY) * DAY;
  const evenings = [{ evening: 'today', day }, { evening: 'tomorrow', day: day + DAY }]
    .map(option => ({ evening: option.evening, startsAt: option.day + WRITING_OPENS, expiresAt: option.day + WRITING_CLOSES }))
    .filter(option => world.minute < option.expiresAt && !(song.lastSession >= option.startsAt));
  return { songStarted: song.started ?? song.since, songVersion: song.version, evenings };
}

export function acceptEveningPlan(actor, world, offer, evening) {
  const song = writableDraft(actor, world);
  const window = offer?.evenings.find(option => option.evening === evening);
  if (!song || !window || activeEveningPlan(song, world.minute) || world.minute >= window.expiresAt ||
      song.lastSession >= window.startsAt || offer.songStarted !== (song.started ?? song.since) || offer.songVersion !== song.version) return null;
  return { startsAt: window.startsAt, expiresAt: window.expiresAt, songStarted: offer.songStarted, songVersion: offer.songVersion };
}

// Attach the source beside the stored request for matched replay. The action provider sees the same request.
export function eveningPlanAudit(actor, world, menu) {
  const plan = activeEveningPlan(writableDraft(actor, world), world.minute);
  if (!plan || Math.floor(world.minute / DAY) !== Math.floor(plan.startsAt / DAY)) return null;
  const writing = [...menu].find(([, action]) => action.kind === 'compose' && action.songTask === 'write');
  return { ...plan, offeredChoice: writing?.[0] ?? null, mootAt: world.moot?.at ?? null };
}

function material(actor, minute, used, revising) {
  const memories = actor.memories.filter(m => m.minute <= minute && m.source !== 'told' &&
    ((m.kind === 'fieldnote' && m.actorIds?.some(id => id !== actor.id)) ||
     (['observation', 'social'].includes(m.kind) && m.importance >= 4)) &&
    (revising || !used.includes(memoryKey(actor, m))));
  return recall({ ...actor, memories }, { minute, place: 'green' })
    .map(m => ({ key: memoryKey(actor, m), minute: m.minute, kind: m.kind, text: m.text }));
}

// Arrival starts the session. The completed session and any draft request are saved with the tick.
export function finishSongSession(actor, minute, emit, interrupted = false) {
  const song = actor.songwriting, action = actor.action;
  const { songTask: task, songStarted: started, songVersion: version, target, decisionTraceId } = action;
  if (!song || started == null) return;
  const beginning = task === 'begin';
  if (beginning !== (song.status !== 'writing')) return;
  const lifetime = actor.arrived ?? 0, id = [actor.id, lifetime, started].join(':');
  const details = { id, actorId: actor.id, lifetime, started, ended: minute, site: target, task,
    version, basis: action.basis?.kind ?? 'local', ...(decisionTraceId != null && { decisionTraceId }) };
  if (beginning) song.closedAt ??= song.lastSession;
  song.lastSession = minute;
  const record = (status, words, extra) => emit('song', actor.name + ' ' + words + '.', [actor.id],
    { song: { ...details, status, ...extra } }, target);
  if (interrupted) {
    record('interrupted', 'put down his writing to attend the moot');
    return;
  }
  if (song.version !== version) {
    record('stale_session', 'finished his writing session after the draft had changed');
    return;
  }
  if (task === 'finish' || task === 'set_aside') {
    song.status = task === 'finish' ? 'finished' : 'set_aside';
    song.closedAt = minute;
    song.version++;
    const manuscript = songManuscript(song);
    record(song.status, task === 'finish' ? 'finished his song' : 'set his song aside', manuscript && { manuscript });
    song.archived = Boolean(manuscript);
    return;
  }
  if (beginning) {
    // Earlier villages closed a draft without storing the lyrics on the event. Save it before starting a new one.
    const prior = !song.archived && songManuscript(song);
    if (prior) record('archive', 'saved the previous draft', { manuscript: prior });
    song.status = 'writing';
    song.started = started;
    song.verses = [];
    song.used = [];
    song.version++;
    delete song.title;
    delete song.closedAt;
    delete song.archived;
    record('started', 'started a new song on the green');
  }
  const sources = material(actor, minute, song.used, task === 'revise');
  const hasMaterial = sources.length > 0;
  record(hasMaterial ? 'session' : 'no_material', hasMaterial ? 'spent time writing on the green' :
    'spent time writing on the green without finding material for a verse');
  if (hasMaterial) return { ...details, task: task === 'revise' ? 'revise' : 'write', version: song.version,
    sources, title: song.title ?? null, verses: song.verses.map(verse => verse.lines) };
}

export function songManuscript(song) {
  if (!song.title || !song.verses.length) return null;
  return { title: song.title, status: song.status, closedAt: song.closedAt ?? song.lastSession,
    started: song.started ?? song.since, verses: song.verses };
}

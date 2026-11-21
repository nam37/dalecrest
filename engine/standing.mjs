// Standing instructions. A resident's routine follows a choice a model already made, for as long as
// the situation that choice answered still holds. Anything that is a real choice goes back to the model.
// See Stage 0 of docs/roadmap.md. Everything here is pure and uses only the village's own state.

// Pilot parameters, in village minutes unless noted. These are starting values to be tuned.
export const PILOT = {
  lasts: { sleep: 2880, meal: 2880, again: 240 },  // how long each kind of instruction stays valid
  repeats: 3,      // times in a row an activity may be repeated on one instruction
  mealAt: 50,      // hunger at which the meal routine applies
  urgent: 70,      // a need at or above this is urgent; two at once is a choice
  lookahead: 30,   // how far ahead of a commitment a routine is treated as running into it
  newsFor: 1440,   // hearing the same thing again within this long is not news
};

const isNight = minute => { const t = minute % 1440; return t >= 1260 || t < 340; };
// What an action is matched on when the menu is rebuilt: the job, or the place for anything else.
const matchOf = action => action.kind + ':' + (action.job || action.target);
const goalsKey = actor => JSON.stringify(actor.goals || []);

// The routine a chosen action answers, or null for something that is always a choice.
export function routineOf(action, minute) {
  if (!action || ['social', 'meeting', 'arrive', 'waiting', 'idle'].includes(action.kind)) return null;
  if (action.kind === 'rest' && isNight(minute)) return 'sleep';
  if (action.kind === 'food') return 'meal';
  return 'again:' + matchOf(action);
}

// Keeps a fresh choice as the standing instruction for its routine.
export function keep(actor, state, action, trace, pilot = PILOT) {
  const minute = state.world.minute, routine = routineOf(action, minute);
  if (!routine) return null;
  actor.instructions ??= {};
  const lasts = pilot.lasts[routine] ?? pilot.lasts.again;
  return actor.instructions[routine] = { match: matchOf(action), label: action.label, trace, since: minute, until: minute + lasts, uses: 0, goals: goalsKey(actor) };
}

// Things the resident has a stake in that fall due at a known time. Today that is only the moot.
// Promises between residents join this list in Stage 1.
function due(state) {
  const moot = state.world.moot;
  return moot ? [{ what: 'the moot', from: moot.at - 40, until: moot.at + 25 }] : [];
}

// Something heard since the last fresh choice that the resident had not heard in the past day.
function news(actor, pilot) {
  const since = actor.decidedAt ?? -Infinity;
  const key = m => m.concern ? 'concern:' + m.concern : m.shortage ? 'shortage:' + m.shortage : null;
  return actor.memories.some(m => m.minute > since && key(m)
    && !actor.memories.some(old => old.minute <= since && old.minute > m.minute - pilot.newsFor && key(old) === key(m)));
}

// Decides one activity boundary. Returns { follow } when a valid instruction covers the moment, or
// { fresh } naming why a new decision is needed. Either may carry instructions that have just ended.
export function consider(actor, state, menu, finished, pilot = PILOT) {
  const { world, map } = state, minute = world.minute, book = actor.instructions || {}, ended = [];
  const candidates = [];
  if (isNight(minute)) candidates.push('sleep');
  if (actor.needs.hunger >= pilot.mealAt) candidates.push('meal');
  const again = routineOf(finished, minute);
  if (again?.startsWith('again:')) candidates.push(again);
  // A stale instruction is never followed. It is dropped here, with the reason, before anything else.
  for (const routine of Object.keys(book)) {
    const ins = book[routine];
    const reason = ins.until <= minute ? 'lapsed' : ins.goals !== goalsKey(actor) ? 'goals changed'
      : routine.startsWith('again:') && ins.uses >= pilot.repeats && candidates.includes(routine) ? 'ran its course' : null;
    if (!reason) continue;
    ended.push({ routine, reason, trace: ins.trace });
    delete book[routine];
  }
  const routine = candidates.find(r => book[r]);
  const result = fresh => ({ fresh, ended });
  if (!routine) {
    const was = ended.find(e => candidates.includes(e.routine));
    return result(was ? 'instruction ' + was.reason : 'no instruction applies');
  }
  const ins = book[routine];
  const id = [...menu.keys()].find(key => matchOf(menu.get(key)) === ins.match);
  if (!id) return result('instructed action cannot start');
  if (news(actor, pilot)) return result('learned something new');
  if (Object.values(actor.needs).filter(n => n >= pilot.urgent).length >= 2) return result('two urgent needs');
  const action = menu.get(id), there = map.places.find(p => p.id === action.target);
  const walk = there ? Math.hypot(there.at[0] - actor.position.x, there.at[1] - actor.position.y) / 2.15 : 0;
  const busyUntil = minute + walk + action.remaining;
  const clash = due(state).find(d => minute <= d.until && busyUntil >= d.from - pilot.lookahead);
  if (clash) return result('would run into ' + clash.what);
  return { follow: { routine, id, action, instruction: ins }, ended };
}

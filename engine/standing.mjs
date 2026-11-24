// Standing instructions. A resident's routine follows a choice a model already made, for as long as
// the situation that choice answered still holds. Anything that is a real choice goes back to the model.
// See Stage 0 of docs/roadmap.md. Everything here is pure and uses only the village's own state.
import { place, route, walkingSpeed } from './roads.mjs';
import { nextOutdoorStart } from './seasons.mjs';
import { villageJobs } from './village-work.mjs';

// Pilot parameters, in village minutes unless noted. These are starting values to be tuned.
export const PILOT = {
  lasts: { sleep: 2880, meal: 2880, again: 240 },  // how long each kind of instruction stays valid
  repeats: 3,      // times in a row an activity may be repeated on one instruction
  mealAt: 50,      // hunger at which the meal routine applies
  urgent: 70,      // a need at or above this is urgent; two at once is a choice
  lookahead: 30,   // how far ahead of a commitment a routine is treated as running into it
  newsFor: 1440,   // hearing the same thing again within this long is not news
};

export const isNight = minute => { const t = minute % 1440; return t >= 1260 || t < 340; };
// What an action is matched on when the menu is rebuilt: the job, or the place for anything else. A
// visit is to one person, so it matches only the same friend in the same place.
const matchOf = action => action.kind + ':' + (action.job || action.target) + (action.meal ? ':' + action.meal : '')
  + (action.kind === 'social' && action.friendId ? ':' + action.friendId : '') + (action.company ? ':company' : '');
const goalsKey = actor => JSON.stringify(actor.goals || []);

// The routine a chosen action answers, or null for something that is always a choice. Staying on with
// the same friend is another stretch of the same visit. Choosing whom to visit stays a choice.
export function routineOf(action, minute) {
  if (!action || action.commitmentId || Object.hasOwn(villageJobs, action.job) || ['review', 'conversation', 'inspect', 'meeting', 'ballot', 'civic', 'arrive', 'waiting', 'idle'].includes(action.kind)) return null;
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

// Arrival also counts as the first minute of the activity. Use the same waypoints and pace as travel.
function activityMinutes(actor, map, from, action) {
  if (!action || action.onSpot) return action?.remaining ?? 0;
  const path = route(map, from, action.target);
  if (!path) return Infinity;
  let distance = 0, last = from;
  for (const point of path.pts) {
    distance += Math.hypot(point[0] - last[0], point[1] - last[1]);
    last = point;
  }
  return action.remaining + Math.max(0, Math.ceil(distance / walkingSpeed(actor)) - 1);
}

function promiseAtRisk(actor, state, menu, routine, lookahead) {
  const { world, map } = state;
  const promises = Object.values(actor.helpBook || {}).filter(r =>
    r.helperId === actor.id && r.status === 'accepted' && r.due >= world.minute).sort((a, b) => a.due - b.due);
  if (!promises.length) return;
  const here = [actor.position.x, actor.position.y];
  const after = routine && !routine.onSpot ? place(map, routine.target)?.at : here;
  const freeAt = world.minute + activityMinutes(actor, map, here, routine);
  for (const r of promises) {
    const shift = [...menu.values()].find(a => a.commitmentId === r.id);
    // An unavailable shift can still leave an imminent deadline worth discussing.
    const needed = shift && after ? activityMinutes(actor, map, after, shift) : 0;
    const canStart = r.job === 'cut' || r.job === 'harvest' ? nextOutdoorStart(freeAt) : freeAt;
    if (canStart + needed + lookahead > r.due) return 'would run into my promise to ' + r.asker + ' to ' + r.terms;
  }
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
  if ([...menu.values()].some(a => a.kind === 'ballot')) return result('casting a ballot at the moot');
  if ([...menu.values()].some(a => a.verb === 'defer')) return result('reconsidering a request for help');
  if (actor.lastRequestNews > (actor.decidedAt ?? -1)) return result('learned more about an open request');
  if (actor.lastLowCount?.minute > (actor.decidedAt ?? -1)) return result('found the ' + actor.lastLowCount.item + ' reserve low');
  if (actor.lastSocialNews > (actor.decidedAt ?? -1)) return result('heard news from a neighbour');
  if (actor.observations?.ovenStores?.minute > (actor.decidedAt ?? -1)) return result('checked the oven stores');
  if (!routine) {
    const was = ended.find(e => candidates.includes(e.routine));
    return result(promiseAtRisk(actor, state, menu, null, pilot.lookahead) || (was ? 'instruction ' + was.reason : 'no instruction applies'));
  }
  const ins = book[routine];
  const id = [...menu.keys()].find(key => matchOf(menu.get(key)) === ins.match);
  if (!id) {
    const verdict = result('instructed action cannot start');
    if (routine === again && finished.kind === 'social' && finished.friendId) {
      const friend = state.actors.find(other => other.id === finished.friendId);
      const visit = [...menu.values()].find(action => action.kind === 'social' && action.friendId === finished.friendId
        && action.target !== finished.target);
      if (friend) verdict.blockedVisit = { friendId: friend.id, name: friend.name, from: finished.target, ...(visit && { to: visit.target }) };
    }
    return verdict;
  }
  if (news(actor, pilot)) return result('learned something new');
  if (Object.values(actor.needs).filter(n => n >= pilot.urgent).length >= 2) return result('two urgent needs');
  const action = menu.get(id), there = map.places.find(p => p.id === action.target);
  const walk = there ? Math.hypot(there.at[0] - actor.position.x, there.at[1] - actor.position.y) / 2.15 : 0;
  const busyUntil = minute + walk + action.remaining;
  const moot = world.moot;
  if (moot && minute <= moot.at + 25 && busyUntil >= moot.at - 40 - pilot.lookahead) return result('would run into the moot');
  const promise = promiseAtRisk(actor, state, menu, action, pilot.lookahead);
  if (promise) return result(promise);
  return { follow: { routine, id, action, instruction: ins }, ended };
}

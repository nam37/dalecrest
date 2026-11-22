// The director decides what a visitor who is only watching should be shown: whoever is in the middle
// of something, or the place where something has just happened. It reads the same snapshot the page
// draws and changes nothing in the village. It has no model and no knowledge of its own.

// How much a chronicle entry is worth watching while it is news. Meals, shifts and a resident's own
// choices are the routine of the day and are left out.
const NEWS = { build: 10, civic: 10, arrival: 10, social: 7, observation: 6, village: 6, fieldnote: 5 };
// Village minutes for which an entry stays news.
export const NEWS_FOR = 30;

// A resident who is out of sight, as the views draw them.
const unseen = a => a?.phase === 'working' && (a.kind === 'rest' || a.indoors || a.job === 'repairBed');

// What a resident is in the middle of, and how much it is worth watching. The heading is written
// from the recorded activity alone. It names what they are doing, never why.
function standingOf(actor) {
  const a = actor.action || {};
  let weight, kicker;
  if (a.kind === 'waiting') [weight, kicker] = [6, 'Making up their mind'];
  else if (a.commitmentId != null) [weight, kicker] = [9, 'Keeping a promise'];
  else if (a.kind === 'conversation') [weight, kicker] = [8.5, 'A word with a neighbour'];
  else if (a.kind === 'meeting') [weight, kicker] = [8, 'At the moot'];
  else if (a.kind === 'arrive') [weight, kicker] = [8, 'A newcomer on the road'];
  else if (a.kind === 'work' && a.job === 'build') [weight, kicker] = [7.5, 'Building'];
  else if (a.kind === 'inspect') [weight, kicker] = [6.5, 'Counting the stores'];
  else if (a.kind === 'review') [weight, kicker] = [6, 'Thinking over a request'];
  else if (a.kind === 'report') [weight, kicker] = [5.5, 'Gathering the news'];
  else if (a.kind === 'social') [weight, kicker] = [5.5, 'Visiting'];
  else if (a.kind === 'work') [weight, kicker] = [5, 'At work'];
  else if (a.kind === 'food') [weight, kicker] = [3.5, 'A meal'];
  else if (a.kind === 'leisure') [weight, kicker] = [3, 'At leisure'];
  else if (a.kind === 'rest') [weight, kicker] = [1.5, 'At rest'];
  else [weight, kicker] = [2, 'About the village'];
  if (a.phase === 'travelling' && a.kind !== 'arrive') { weight *= 0.8; if (a.commitmentId == null) kicker = 'On the way'; }
  if (a.basis?.kind === 'fresh') weight += 0.6;
  if (Object.values(actor.needs || {}).some(n => n >= 75)) weight += 0.4;
  if (unseen(a)) weight *= 0.35;
  return { weight, kicker };
}

// Every scene worth showing in a snapshot, best first. A snapshot is what /api/village returns:
// { actors, events (newest first), world: { minute } }.
//   resident  someone to follow              { actorId, kicker, stamp }
//   event     a place where news happened    { event, actorId, age }
//   village   the whole parish, when nobody is about
export function scenes({ actors = [], events = [], world = {} } = {}) {
  const minute = world.minute ?? 0, list = [];
  for (const actor of actors) {
    if (!Number.isFinite(actor.position?.x)) continue;
    const { weight, kicker } = standingOf(actor);
    // Someone asleep behind a door is not a scene.
    if (weight < 1) continue;
    const a = actor.action || {};
    list.push({ key: 'r:' + actor.id, kind: 'resident', actorId: actor.id, kicker, weight, stamp: [a.kind, a.phase, a.target, a.label].join('|') });
  }
  for (const event of events) {
    const age = minute - event.minute, worth = NEWS[event.type];
    if (!worth || !event.place || age < 0 || age > NEWS_FOR) continue;
    const known = event.actorIds?.find(id => actors.some(a => a.id === id));
    list.push({ key: 'e:' + event.id, kind: 'event', event, age, weight: worth * (1 - 0.7 * age / NEWS_FOR), ...(known && { actorId: known }) });
  }
  const about = list.filter(s => s.kind === 'resident').length;
  list.push({ key: 'village', kind: 'village', weight: about ? 1.2 : 4, indoors: actors.filter(a => unseen(a.action)).length, residents: actors.length });
  return list.sort((x, y) => y.weight - x.weight || (x.key < y.key ? -1 : 1));
}

// Keeps a watch: holds on one scene for a while, then moves to the best one it has not lately shown.
// News that arrives during the watch cuts in. Times are real milliseconds.
//   dwell      how long to stay with a resident
//   newsDwell  how long to stay on a place where something happened
//   minHold    the least time any scene is given before news may cut in on it
//   memory     how long a scene just shown is passed over in favour of others
export function createDirector({ dwell = 13000, newsDwell = 16000, minHold = 5000, memory = 100000 } = {}) {
  let current = null, since = 0, primed = false, breaking = null;
  const shownAt = new Map(), told = new Set(), met = new Set();
  const take = (scene, now) => {
    current = scene; since = now; shownAt.set(scene.key, now);
    if (scene.kind === 'event') told.add(scene.key);
    return scene;
  };
  return {
    // The scene to show for this snapshot at this moment. The same key means stay where you are.
    pick(snapshot, now) {
      const list = scenes(snapshot);
      // News is breaking if it was not in the record the last time the director looked.
      const fresh = primed ? list.find(s => s.kind === 'event' && !met.has(s.key) && s.age <= 3) : null;
      for (const s of list) if (s.kind === 'event') met.add(s.key);
      primed = true;
      if (fresh) breaking = fresh.key;
      const still = current && list.find(s => s.key === current.key), held = now - since;
      // It cuts in once the scene on show has had its minimum hold, so nothing is snatched away half read.
      const cut = breaking && list.find(s => s.key === breaking && !told.has(s.key));
      if (!cut) breaking = null;
      else if (!still || held >= minHold) { breaking = null; return take(cut, now); }
      if (still) {
        // A resident who starts something new while being watched is stayed with a little longer.
        if (still.stamp !== current.stamp) since = Math.max(since, now - dwell / 2);
        if (now - since < (still.kind === 'event' ? newsDwell : dwell)) return current = still;
      }
      // Otherwise the best scene not lately shown. An entry from the chronicle is told once.
      let best = null, top = -Infinity;
      for (const s of list) {
        if (s.key === current?.key && list.length > 1) continue;
        if (s.kind === 'event' && told.has(s.key)) continue;
        const last = shownAt.get(s.key), score = s.weight - (last === undefined ? 0 : 6 * Math.max(0, 1 - (now - last) / memory));
        if (score > top) { top = score; best = s; }
      }
      return take(best || still || list[0], now);
    },
    reset() { current = null; since = 0; primed = false; breaking = null; shownAt.clear(); told.clear(); met.clear(); },
    get scene() { return current; },
  };
}

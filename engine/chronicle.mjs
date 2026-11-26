// What the public chronicle tells. Every event carries a salience from 0 to 10, set when it happens.
// Routine stays in each resident's own memory and in the full record, and the chronicle a visitor
// reads shows entries at PUBLIC or above.
export const PUBLIC = 3;

// A conversation that changes a request is news. Deciding privately about one is not.
const EXCHANGES = { ask: 6, accept: 6, decline: 6, kept: 7, broken: 7, unanswered: 5, unconfirmed: 4, release: 6, share: 3, retain: 2, defer: 1 };
const BY_TYPE = { meal: 0, plan: 1, fieldnote: 1, observation: 1, work: 1, village: 2, social: 2, civic: 6, build: 7, arrival: 8,
  life: 8, visit: 6, storm: 7, herd: 6, feast: 6, intention: 6, goal: 4, song: 1 };

// Kinds of entry that are news every time, however alike their wording.
const ALWAYS = new Set(['build', 'arrival', 'life', 'storm', 'civic', 'intention', 'goal']);
const SEEN_FOR = 3 * 1440;

// The same people doing the same thing again within three days is routine the second time. world.told
// remembers each public sentence, with its numbers taken out, for that long.
export function judge(world, events) {
  world.told ??= {};
  for (const event of events) {
    event.salience ??= salienceOf(event);
    // The first report or stance on a motion is news. Later echoes stay in the full record.
    const civic = event.outcome?.civic;
    const debate = event.type === 'civic' && (civic === 'news' || civic === 'position');
    if (event.salience < PUBLIC || (ALWAYS.has(event.type) && !debate)) continue;
    // Talk of the same shortage anywhere in the village is one piece of news.
    const talk = / discussed the dwindling (.+?) (reserve|stores)/.exec(event.text);
    const key = debate ? [civic, event.outcome.proposalKey, event.outcome.position].join(':')
      : talk ? 'talk:' + talk[1] : event.text.replace(/\d+/g, '#');
    if (world.told[key] > event.minute - SEEN_FOR) event.salience = PUBLIC - 1;
    else world.told[key] = event.minute;
  }
}

// Called at dawn: sentences told more than three days ago may be told again.
export function forgetTold(world) {
  for (const [key, minute] of Object.entries(world.told || {})) if (minute <= world.minute - SEEN_FOR) delete world.told[key];
}

export function salienceOf(event) {
  if (Number.isFinite(event.salience)) return event.salience;
  const { type, outcome = {}, text = '' } = event;
  if (outcome.lesson && outcome.first) return 6;
  if (outcome.flock) return 6;
  if (type === 'work') {
    if (outcome.commitmentId != null) return 5;
    if (outcome.status === 'completed' && ['harvestPeas', 'harvestApples', 'takeMutton'].includes(outcome.job)) return 4;
    // A shift that could not be finished for want of stores says something about the village. A full bin does not.
    return outcome.status === 'blocked' && ['bake', 'mill', 'build'].includes(outcome.job) && /too little (flour|wood|grain) |out of use/.test(outcome.reason || '') ? 3 : 1;
  }
  if (type === 'social') {
    // A walk that ended without finding the other person is the walker's own disappointment. It is news
    // only when a request for help hung on it.
    if (outcome.delivered === false) return outcome.requestId ? PUBLIC : PUBLIC - 1;
    if (outcome.verb) return EXCHANGES[outcome.verb] ?? 3;
    // A hand lent at someone else's work is the ordinary kindness of the day. It stays in their own memories.
    if (/ lent .+ a hand /.test(text)) return 2;
    if (/ divided a warm loaf/.test(text)) return 3;
    if (/ discussed the dwindling /.test(text)) return 4;
    return 1;
  }
  if (type === 'village') {
    if (outcome.hearths || outcome.hungry) return 6;
    if (/spoiled/.test(text)) return 2;
    return 2;
  }
  if (type === 'civic') {
    if (outcome.civic === 'ballot') return 2;
    return /^Word goes round/.test(text) ? 5 : 7;
  }
  return BY_TYPE[type] ?? 4;
}

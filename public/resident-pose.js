// Both views read the same action and animate the same trade, using their own drawing styles.
export const villageColors = ['#976048', '#65785a', '#b27a4b', '#537470', '#797291', '#856144', '#527997', '#957050'];
export const skins = ['#c99873', '#bb9270', '#ce9d78', '#bc8e6c', '#bf926d', '#aa7a55', '#d6a77d', '#c59a70'];
export const aprons = { bake: '#ebe4cf', mill: '#e2dac4', mend: '#8a6a45' };
export const residentScale = actor => actor.child ? 0.56 + Math.min(13, Math.max(0, actor.age)) * 0.026 : 1;

const tools = {
  cut: 'axe', build: 'mallet', mend: 'mallet', harvest: 'sickle', weed: 'hoe', bait: 'rod',
  bake: 'peel', draw: 'pail', waterBarley: 'pail', fish: 'rod', mill: 'sack', weave: 'shuttle',
  keep: 'board', report: 'board', fetchWood: 'bundle',
};

export function residentActivity(actor, moving) {
  const { kind, phase, job, queued, cast } = actor.action ?? {};
  const working = !moving && phase === 'working' && !queued && (kind === 'work' || kind === 'report');
  return { kind, working, job: kind === 'report' ? 'report' : job === 'fish' && !cast ? 'bait' : job };
}

export const toolFor = ({ working, job }) => working && Object.hasOwn(tools, job) ? tools[job] : null;

const chopRate = 0.75;
const actorTime = (now, index) => now / 1000 + index * 1.7;

export function chopDelay(now, index) {
  const phase = (actorTime(now, index) * chopRate) % 1;
  return ((0.98 - phase + 1) % 1) / chopRate;
}

export function residentPose({ moving, gone, now, index, kind, job, working, still = false }) {
  const t = actorTime(still ? 0 : now, index);
  let legSwing = 0, armR = 0, armL = 0, spreadR = -0.13, lean = 0, sway = 0, nod = 0, lift = 0;
  if (moving) {
    const stride = still ? 0 : Math.sin(gone * 9);
    legSwing = stride * 0.62; armR = -stride * 0.5; armL = stride * 0.5; lean = -0.07; lift = still ? 0 : Math.abs(Math.cos(gone * 9)) * 0.007;
  } else if (working && job === 'cut') {
    // Raise the tool slowly and bring it down fast.
    const s = (t * chopRate) % 1, up = s < 0.72 ? s / 0.72 : 1 - (s - 0.72) / 0.28;
    armR = -0.5 - 2.0 * up; armL = -0.4 - 0.9 * up; lean = -0.12 - 0.16 * (1 - up);
  } else if (working && (job === 'build' || job === 'mend')) {
    // Brace the piece in one hand and tap it with the mallet.
    const tap = Math.pow(Math.max(0, Math.sin(t * (job === 'build' ? 5 : 7))), 2);
    armR = -1.2 - 0.85 * tap; armL = -1.19; lean = -0.2; nod = 0.19;
  } else if (working && (job === 'harvest' || job === 'weed' || job === 'bait')) {
    // Bent to the corn, sweeping the sickle across.
    lean = -0.62; armR = -0.75 + Math.sin(t * 2.6) * 0.28; spreadR = -0.13 + Math.sin(t * 2.6) * 0.55; armL = -0.95; nod = 0.25;
  } else if (working && job === 'bake') {
    // Working the peel in and out of the oven mouth.
    const push = Math.sin(t * 1.9) * 0.24; armR = -1.3 + push; armL = -1.15 + push; lean = -0.1 - push * 0.25;
  } else if (working && job === 'draw') {
    // Hauling the rope hand over hand.
    armR = -1.25 + Math.sin(t * 3.2) * 0.5; armL = -1.25 - Math.sin(t * 3.2) * 0.5; lean = -0.08;
  } else if (working && job === 'waterBarley') {
    armR = -1.2 - Math.sin(t * 1.8) * 0.35; armL = -0.9; lean = -0.3;
  } else if (working && job === 'fish') {
    armR = -1.3 + Math.sin(t * 0.8) * 0.07; armL = -0.85; sway = Math.sin(t * 0.6) * 0.03;
  } else if (working && job === 'hunt') {
    lean = -0.18; nod = 0.22 + Math.sin(t * 1.1) * 0.1; sway = Math.sin(t * 1.3) * 0.09;
  } else if (working && job === 'mill') {
    armR = -1.0; armL = -1.0; lean = -0.14; sway = Math.sin(t * 1.3) * 0.04;
  } else if (working && job === 'weave') {
    armR = -1.05 + Math.sin(t * 5) * 0.14; armL = -1.0 - Math.sin(t * 5) * 0.14; lean = -0.1; nod = 0.18;
  } else if (working && job === 'keep') {
    armR = -0.87 - Math.max(0, Math.sin(t * 2.8)) * 0.75; armL = -1.02; nod = 0.21;
  } else if (working && job === 'report') {
    // Hold the board steady and make short marks with the other hand.
    armR = -1.35 + Math.sin(t * 4.4) * 0.16; armL = -1.02; nod = 0.3;
  } else if (working && job === 'fetchWood') {
    armR = -1.12; armL = -1.12; sway = Math.sin(t * 1.4) * 0.08; lean = -0.24;
  } else if (kind === 'waiting') {
    // A hand to the chin, and the weight shifting from foot to foot.
    armR = -2.25 + Math.sin(t * 0.8) * 0.06; armL = -0.2; nod = 0.14; sway = Math.sin(t * 0.7) * 0.05;
  } else if (kind === 'social' || kind === 'meeting') {
    // Talking with the hands, now and then.
    const speak = Math.max(0, Math.sin(t * 1.1)) * Math.max(0, Math.sin(t * 0.37 + 1));
    armR = -0.25 - speak * 0.95; armL = -0.1 - Math.max(0, Math.sin(t * 0.9 + 2)) * 0.25; sway = Math.sin(t * 0.6) * 0.03; nod = Math.sin(t * 1.4) * 0.05;
  } else {
    sway = Math.sin(t * 0.8) * 0.025; armR = Math.sin(t * 0.8) * 0.04; armL = -armR;
  }
  return { legSwing, armR, armL, spreadR, lean, sway, nod, lift };
}

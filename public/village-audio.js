import { chopDelay } from './resident-pose.js';
import { ambientBed, soundEffect, soundRate } from './sound-effects.js';
import { soundMix } from './sound-scene.js';

// Volume lives here so the same work stays at the same level when its view changes.
const cues = {
  sheep: [8, 17, 0.28], cattle: [10, 20, 0.29],
  chop: [1.25, 1.47, 0.30], mallet: [0.77, 1.48, 0.25], stalks: [1.7, 2.65, 0.24],
  peel: [2.2, 3.6, 0.28], bucket: [2.0, 3.5, 0.3], stone: [0.89, 1.3, 0.31],
  loom: [0.56, 0.85, 0.23], scratch: [1.6, 3.2, 0.12],
};
const interval = 120;
const between = (lo, hi) => lo + Math.random() * (hi - lo);

function makeMixer(context) {
  const master = context.createGain();
  master.gain.value = 0;
  master.connect(context.destination);
  const beds = new Map(), buffers = new Map(), due = new Map(), playing = new Set();
  let audible = false;

  function buffer(kind, make) {
    if (!buffers.has(kind)) {
      const samples = make(kind), b = context.createBuffer(1, samples.length, soundRate);
      b.copyToChannel(samples, 0);
      buffers.set(kind, b);
    }
    return buffers.get(kind);
  }

  function voice(name, make, volume, pan) {
    const source = context.createBufferSource(), gain = context.createGain(), stereo = context.createStereoPanner?.();
    source.buffer = buffer(name, make);
    source.connect(gain);
    gain.gain.value = volume;
    if (stereo) {
      stereo.pan.value = pan;
      gain.connect(stereo); stereo.connect(master);
    } else gain.connect(master);
    const nodes = { source, gain, stereo };
    playing.add(nodes);
    source.onended = () => {
      source.disconnect(); gain.disconnect(); stereo?.disconnect();
      playing.delete(nodes);
    };
    return nodes;
  }

  function silence(immediate = false) {
    if (!audible && !immediate) return;
    audible = false;
    const t = context.currentTime;
    master.gain.cancelScheduledValues(t);
    if (immediate) master.gain.setValueAtTime(0, t);
    else master.gain.setTargetAtTime(0, t, 0.05);
    for (const { source, gain } of playing) {
      gain.gain.setTargetAtTime(0, t, 0.05);
      source.stop(t + (immediate ? 0 : 0.22));
    }
    beds.clear(); due.clear();
  }

  function update(scene, now) {
    if (!scene) { silence(); return; }
    const t = context.currentTime;
    if (!audible) {
      audible = true;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(0.80, t, 0.14);
    }
    const mix = soundMix(scene, now);
    for (const [name, { volume, pan }] of Object.entries(mix.beds)) {
      if (!beds.has(name) && volume > 0) {
        const layer = voice(name, ambientBed, 0, pan);
        layer.source.loop = true;
        layer.source.start(t, between(0, layer.source.buffer.duration));
        beds.set(name, layer);
      }
      const layer = beds.get(name);
      layer?.gain.gain.setTargetAtTime(volume, t, 0.19);
      layer?.stereo?.pan.setTargetAtTime(pan, t, 0.16);
    }

    const heard = new Set();
    for (const cue of mix.cues) {
      const { key, kind, volume, pan } = cue, [lo, hi, level] = cues[kind];
      heard.add(key);
      const chop = cue.job === 'cut';
      const call = kind === 'sheep' || kind === 'cattle';
      if (!due.has(key)) due.set(key, t + (chop ? 0 : call ? between(0.85, 4) : between(0.1, 0.65)));
      if (due.get(key) > t) continue;
      const delay = chop ? chopDelay(now, cue.index) : 0;
      if (delay > (interval + 36) / 1000) continue;
      const { source } = voice(kind, soundEffect, volume * level * between(0.78, 1.0), pan);
      source.playbackRate.value = between(0.89, 1.12);
      source.start(t + delay);
      due.set(key, t + delay + (chop ? 0.74 : between(lo, hi)));
    }
    for (const key of due.keys()) if (!heard.has(key)) due.delete(key);
  }

  return { update, silence };
}

// One output per page. A click unlocks the browser's audio, then either view can feed it.
export function bindVillageSound(button, getScene) {
  const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Audio) {
    button.disabled = true;
    button.title = 'Ambient sound is unavailable in this browser.';
    return;
  }
  let context, mixer, timer, suspension, enabling = false, enabled = false;
  const title = button.title;
  const tick = () => {
    if (!enabled) return;
    const now = performance.now();
    const scene = !document.hidden && getScene(now);
    if (context.state === 'running') mixer.update(scene, now);
  };
  function visible() {
    if (!enabled) return;
    if (document.hidden) mixer.silence(true);
    else if (context.state !== 'running') context.resume().then(tick, () => {});
    else tick();
  }
  button.addEventListener('click', async () => {
    if (enabling) return;
    if (enabled) {
      enabled = false;
      button.setAttribute('aria-pressed', 'false');
      button.title = title;
      clearInterval(timer);
      mixer.silence();
      suspension = setTimeout(() => context.suspend().catch(() => {}), 260);
      return;
    }
    clearTimeout(suspension);
    enabling = true;
    try {
      context ??= new Audio();
      await context.resume();
      mixer ??= makeMixer(context);
      enabled = true;
      tick();
      button.setAttribute('aria-pressed', 'true');
      button.title = 'Mute ambient village sound.';
      timer = setInterval(tick, interval);
    } catch {
      enabled = false;
      mixer?.silence(true);
      button.title = 'Could not start ambient sound. Activate Sound to try again.';
    } finally {
      enabling = false;
    }
  });
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('pagehide', () => mixer?.silence(true));
  window.addEventListener('pageshow', visible);
}

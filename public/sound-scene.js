import { clamp, segDist, smooth } from '../engine/geom.mjs';
import { animalPose } from './parish.js';
import { residentActivity } from './resident-pose.js';

const jobs = {
  cut: 'chop', build: 'mallet', mend: 'mallet', repairBed: 'mallet', repairFloor: 'mallet',
  harvest: 'stalks', weed: 'stalks', sweep: 'stalks', bake: 'peel', draw: 'bucket', waterBarley: 'bucket',
  mill: 'stone', weave: 'loom', fetchWood: 'mallet', keep: 'scratch', report: 'scratch',
};

function nearestWater({ terrain }, listener) {
  const point = [listener.x, listener.y], river = terrain.river;
  let nearest = { d: Infinity };
  for (let i = 1; i < river.length; i++) {
    const hit = segDist(point, river[i - 1], river[i]);
    if (hit.d < nearest.d) nearest = hit;
  }
  return nearest;
}

function pan(listener, x, y, distance) {
  const across = (x - listener.x) * listener.rightX + (y - listener.y) * listener.rightY;
  return clamp(across / Math.max(listener.radius * 0.32, distance), -0.82, 0.82);
}

function placement(listener, x, y, reach) {
  const d = Math.hypot(x - listener.x, y - listener.y);
  return { volume: 1 - smooth(0, listener.radius * reach, d), pan: pan(listener, x, y, d) };
}

export function soundMix(scene, now) {
  const { map, weather, listener, actors, sheep, cattle, moving } = scene;
  const river = nearestWater(map, listener);
  const bank = Math.max(0, river.d - map.terrain.riverWidth / 2);
  const flow = 1 - smooth(0.4, listener.radius * 1.65, bank);
  const beds = {
    river: { volume: flow * (0.53 + weather.rain * 0.12) * (1 - weather.lying * 0.18),
      pan: pan(listener, river.x, river.y, river.d) * 0.77 },
    rain: { volume: Math.pow(weather.rain, 0.75) * 0.58, pan: 0 },
    wind: { volume: 0.065 + weather.cloud * 0.12 + weather.snow * 0.23, pan: 0 },
  };

  const work = [];
  for (const [index, actor] of actors.entries()) {
    const { working, job } = residentActivity(actor, false), kind = Object.hasOwn(jobs, job) && jobs[job];
    if (!working || !kind || actor.action.carrying || moving(actor.id)) continue;
    const { x, y } = actor.position ?? {};
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const sound = placement(listener, x, y, 0.95);
    if (actor.action.indoors) sound.volume *= 0.28;
    if (sound.volume > 0.035) work.push({ ...sound, kind, index, job, key: actor.id + ':' + job });
  }
  const calls = [];
  for (const [kind, group] of [['sheep', sheep], ['cattle', cattle]]) {
    let nearest = null;
    for (const animal of group) {
      const { x, y } = animalPose(animal, now);
      const sound = placement(listener, x, y, kind === 'cattle' ? 1.45 : 1.15);
      if (sound.volume > (nearest?.volume ?? 0.035)) nearest = { ...sound, kind, key: kind };
    }
    if (nearest) calls.push(nearest);
  }
  work.sort((a, b) => b.volume - a.volume);
  return { beds, cues: [...calls, ...work.slice(0, 5)] };
}

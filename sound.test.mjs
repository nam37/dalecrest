import test from 'node:test';
import assert from 'node:assert/strict';
import { soundMix } from './public/sound-scene.js';
import { ambientBed, soundEffect, soundRate } from './public/sound-effects.js';
import { chopDelay } from './public/resident-pose.js';

const fixture = {
  map: { terrain: { river: [[20, 0], [20, 40]], riverWidth: 4 } },
  weather: { cloud: 0.2, rain: 0, snow: 0, lying: 0 },
  listener: { x: 15, y: 20, radius: 10, rightX: 1, rightY: 0 },
  actors: [], sheep: [], cattle: [], moving: () => false,
};

test('the river follows the listener and rain and snow change the weather mix', () => {
  const dry = soundMix(fixture, 0).beds;
  assert.ok(dry.river.volume > 0.3 && dry.river.pan > 0);
  assert.equal(dry.rain.volume, 0);
  const far = soundMix({ ...fixture, listener: { ...fixture.listener, x: -20 } }, 0).beds;
  assert.equal(far.river.volume, 0);
  const turned = soundMix({ ...fixture, listener: { ...fixture.listener, rightX: -1 } }, 0).beds;
  assert.equal(turned.river.pan, -dry.river.pan);
  const wet = soundMix({ ...fixture, weather: { ...fixture.weather, rain: 0.7 } }, 0).beds;
  const snow = soundMix({ ...fixture, weather: { ...fixture.weather, snow: 0.7, lying: 0.8 } }, 0).beds;
  assert.ok(wet.rain.volume > 0 && wet.river.volume > dry.river.volume);
  assert.equal(snow.rain.volume, 0);
  assert.ok(snow.wind.volume > dry.wind.volume && snow.river.volume < dry.river.volume);
});

test('nearby livestock and active work supply cues, and queued, moving and distant workers stay quiet', () => {
  const worker = (id, job, x, changes = {}) => ({
    id, position: { x, y: 20 }, action: { kind: 'work', phase: 'working', job, ...changes },
  });
  const scene = { ...fixture, sheep: [{ x: 17, y: 20, phase: 1 }], cattle: [{ x: 17, y: 21, phase: 3 }],
    actors: [worker('oswin', 'cut', 14), worker('mabel', 'bake', 18), worker('runner', 'draw', 13),
      worker('queued', 'bake', 16, { queued: 123 }), worker('far', 'mend', 30), worker('carry', 'bake', 15, { carrying: 'bread' })],
    moving: id => id === 'runner' };
  const { cues } = soundMix(scene, 140);
  assert.deepEqual(cues.map(({ kind }) => kind), ['sheep', 'cattle', 'chop', 'peel']);
  assert.ok(cues[2].pan < 0 && cues[3].pan > 0);
  assert.ok(chopDelay(1200, 0) < 0.15);
  assert.equal(soundMix({ ...scene, cattle: [] }, 140).cues.some(s => s.kind === 'cattle'), false);
});

test('sounds are audible, bounded waveforms with seamless beds and tapered calls', () => {
  for (const kind of ['river', 'rain', 'wind', 'sheep', 'cattle', 'chop', 'mallet', 'stalks', 'peel', 'bucket', 'stone', 'loom', 'scratch']) {
    const loop = ['river', 'rain', 'wind'].includes(kind), pcm = loop ? ambientBed(kind) : soundEffect(kind);
    let squareSum = 0;
    for (const sample of pcm) {
      assert.ok(Math.abs(sample) <= 1, kind);
      squareSum += sample * sample;
    }
    assert.ok(Math.sqrt(squareSum / pcm.length) > 0.005, kind);
    if (loop) {
      assert.equal(pcm.length, soundRate * 10);
      assert.ok(Math.abs(pcm[0] - pcm.at(-1)) < 0.13, kind);
    } else assert.ok(Math.abs(pcm[0]) + Math.abs(pcm.at(-1)) < 0.005, kind);
  }
});

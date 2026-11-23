import { rng, TAU } from '../engine/geom.mjs';

const rate = 24000;
const lowpass = hz => 1 - Math.exp(-TAU * hz / rate);

// Draw a seamless bed. Each band uses the same noise, with its own response time.
export function ambientBed(kind) {
  const random = rng({ river: 305, rain: 409, wind: 207 }[kind]);
  const length = rate * 10, seam = Math.round(rate * 0.22), samples = new Float32Array(length + seam);
  const coefficients = [2.1, 84, 600, 2600].map(lowpass), history = [0, 0, 0, 0];
  let droplets = 0, bubble = 0, phase = 0;
  for (let i = 0; i < samples.length; i++) {
    const white = random() * 2 - 1;
    for (let j = 0; j < history.length; j++) history[j] += (white - history[j]) * coefficients[j];
    const [gust, bass, mid, fizz] = history;
    if (kind === 'river') {
      if (random() < 0.0028) { droplets = 0.15 + random() * 0.31; bubble = 480 + random() * 1050; }
      phase += TAU * bubble / rate;
      bubble *= 0.9991; droplets *= 0.993;
      const ripple = Math.sin(phase) * droplets * (0.5 + 0.5 * fizz);
      samples[i] = bass * 0.44 + (fizz - mid) * (0.22 + 2.8 * Math.abs(gust)) + mid * 0.23 + ripple * 0.24;
    } else if (kind === 'rain') {
      droplets *= 0.956;
      if (random() < 0.045) droplets = 0.20 + random() * 0.31;
      samples[i] = (white - fizz) * (0.046 + droplets * 0.15) + fizz * 0.14 + mid * 0.1;
    } else {
      const swell = 0.24 + 7.5 * Math.abs(gust) + 0.16 * Math.sin(TAU * 0.4 * i / rate) ** 2;
      samples[i] = (bass * 0.85 + (mid - bass) * 0.26 + (fizz - mid) * 0.04) * swell;
    }
  }
  for (let i = 0; i < seam; i++) {
    const blend = 0.5 - 0.5 * Math.cos(Math.PI * i / seam);
    samples[i] = samples[length + i] * (1 - blend) + samples[i] * blend;
  }
  return samples.subarray(0, length);
}

function animalCall(kind, random) {
  const cow = kind === 'cattle', duration = cow ? 1.85 : 0.91;
  const samples = new Float32Array(Math.round(duration * rate));
  let phase = 0, rasp = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate, f = t / duration;
    const tremor = Math.sin(TAU * (cow ? 4.1 : 11.8) * t);
    const rise = Math.sin(Math.PI * f) ** 0.65;
    const pitch = cow ? 79 + rise * 17 + tremor * 3 : 185 + rise * 69 - f * 33 + tremor * 11;
    phase += TAU * pitch / rate;
    // The strongest harmonics move as the mouth opens and closes.
    const mouth = Math.min(1, f * 3.8) * Math.min(1, (1 - f) * 3.8);
    const formant = cow ? 255 + mouth * 180 : 475 + mouth * 310;
    const throat = cow ? 700 + mouth * 120 : 1290 + mouth * 240;
    let voice = Math.sin(phase) * (cow ? 0.43 : 0.20);
    for (let h = 2; h <= (cow ? 16 : 10); h++) {
      const frequency = pitch * h;
      const resonance = 2 / (1 + ((frequency - formant) / 180) ** 2) + 1.2 / (1 + ((frequency - throat) / 240) ** 2);
      voice += Math.sin(phase * h) * resonance / h;
    }
    rasp += 0.21 * (random() * 2 - 1 - rasp);
    const edge = Math.min(1, f * 16, (1 - f) * 8);
    samples[i] = (voice * (0.61 + 0.24 * tremor) + rasp * 0.13) * edge * rise * (cow ? 0.44 : 0.67);
  }
  return samples;
}

// Short close-miked sounds for hands and tools. Tuned resonances provide the body of each impact.
const impacts = {
  chop: [0.33, 165, 460, 0.028, 0.065, 1.1],
  mallet: [0.18, 250, 830, 0.019, 0.033, 1.0],
  stalks: [0.31, 340, 1430, 0.061, 0.13, 0.19],
  peel: [0.48, 210, 680, 0.048, 0.18, 0.44],
  bucket: [0.50, 450, 1190, 0.045, 0.11, 0.54],
  stone: [0.68, 94, 280, 0.068, 0.23, 0.29],
  loom: [0.24, 370, 1160, 0.019, 0.07, 0.60],
  scratch: [0.22, 360, 1720, 0.061, 0.074, 0.10],
};

export function soundEffect(kind) {
  const random = rng([...kind].reduce((seed, char) => seed * 31 + char.charCodeAt(0), 7));
  if (kind === 'sheep' || kind === 'cattle') return animalCall(kind, random);
  const [duration, body, knock, resonance, decay, weight] = impacts[kind];
  const samples = new Float32Array(Math.round(rate * duration));
  let grit = 0, warm = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate, f = t / duration, noise = random() * 2 - 1;
    grit += 0.4 * (noise - grit);
    warm += 0.054 * (grit - warm);
    const strike = Math.sin(TAU * body * t) * 0.49 + Math.sin(TAU * knock * t) * 0.16;
    const rasp = (grit - warm) * (0.46 + 0.33 * Math.sin(TAU * t * (kind === 'bucket' ? 37 : 21)));
    const attack = Math.min(1, t * (weight > 0.6 ? 420 : 46)), tail = Math.min(1, (1 - f) * 6);
    samples[i] = (strike * weight * Math.exp(-t / resonance) + rasp * Math.exp(-t / decay)) * attack * tail;
  }
  return samples;
}

export const soundRate = rate;

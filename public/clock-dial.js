// The dial on the clock card. By day the sun rides an arc from sunrise on the left to sunset on the
// right, and by night the moon rides one of its own. The arc stands tall and wide when that half of
// the day is long and low and narrow when it is short, so midsummer and midwinter look different at
// a glance. Cloud, rain and snow are drawn over whichever of the two is up.
import { daylight } from '../engine/seasons.mjs';

const NS = 'http://www.w3.org/2000/svg', CX = 39, GROUND = 37;
const make = (tag, attrs = {}, parent) => {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  parent?.append(el);
  return el;
};

// Where things stand on the dial at a village minute.
//   up     true while the sun is above the horizon
//   along  how far whichever is up has travelled, from 0 at its rising to 1 at its setting
//   long   how long that half of the day is, from 0 (the shortest it gets) to 1 (the longest)
export function dialAt(minute) {
  const m = ((minute % 1440) + 1440) % 1440, { sunrise, sunset } = daylight(minute), day = sunset - sunrise;
  const share = Math.min(1, Math.max(0, (day - 440) / 560)), up = m >= sunrise && m <= sunset;
  if (up) return { up, along: (m - sunrise) / day, long: share };
  return { up, along: (m > sunset ? m - sunset : m + 1440 - sunset) / (1440 - day), long: 1 - share };
}

// Builds the dial inside an empty <svg> and returns a function that sets it to a minute and a sky.
export function createDial(svg) {
  svg.setAttribute('viewBox', '0 0 78 42');
  const clip = make('clipPath', { id: 'dial-sky' }, make('defs', {}, svg));
  make('rect', { x: -4, y: -8, width: 86, height: GROUND + 8 }, clip);
  const arc = make('path', { class: 'dial-arc' }, svg);
  const feet = [make('line', { class: 'dial-foot' }, svg), make('line', { class: 'dial-foot' }, svg)];
  // Whatever is rising or setting is cut off at the horizon.
  const sky = make('g', { 'clip-path': 'url(#dial-sky)' }, svg), orb = make('g', {}, sky);
  const sun = make('g', { class: 'dial-sun' }, orb);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, far = i % 2 ? 7.9 : 9, x = Math.cos(a), y = Math.sin(a);
    make('line', { x1: (x * 6).toFixed(2), y1: (y * 6).toFixed(2), x2: (x * far).toFixed(2), y2: (y * far).toFixed(2) }, sun);
  }
  make('circle', { r: 4.1 }, sun);
  const moon = make('path', { class: 'dial-moon', d: 'M1.2 -5.2 A5.2 5.2 0 1 0 1.2 5.2 A4.1 5.2 0 0 1 1.2 -5.2 Z' }, orb);
  const cloud = make('g', { class: 'dial-cloud' }, sky);
  make('path', { d: 'M-7.5 4.5 A3.4 3.4 0 0 1 -5.6 -1.6 A4.6 4.6 0 0 1 3 -3.2 A3.7 3.7 0 0 1 8 1.2 A2.6 2.6 0 0 1 7 4.5 Z' }, cloud);
  const rain = make('g', { class: 'dial-rain' }, cloud), snow = make('g', { class: 'dial-snow' }, cloud);
  for (const x of [-4, 0, 4]) {
    make('line', { x1: x, y1: 6.2, x2: x - 1.4, y2: 9.6 }, rain);
    make('circle', { cx: x, cy: 7.8, r: 0.95 }, snow);
  }
  make('line', { class: 'dial-ground', x1: 3, y1: GROUND, x2: 75, y2: GROUND }, svg);
  const show = (el, on) => { el.style.display = on ? '' : 'none'; };

  // weather is what skyOver gives: its sky is 'clear', 'fair', 'overcast', 'rain' or 'snow'.
  return (minute, weather) => {
    const { up, along, long } = dialAt(minute), wide = 28 * (0.6 + 0.4 * long), tall = 27 * (0.48 + 0.52 * long);
    arc.setAttribute('d', 'M' + (CX - wide).toFixed(1) + ' ' + GROUND + ' A' + wide.toFixed(1) + ' ' + tall.toFixed(1) + ' 0 0 1 ' + (CX + wide).toFixed(1) + ' ' + GROUND);
    feet.forEach((foot, i) => {
      const x = (CX + (i ? wide : -wide)).toFixed(1);
      foot.setAttribute('x1', x); foot.setAttribute('x2', x); foot.setAttribute('y1', GROUND - 3); foot.setAttribute('y2', GROUND + 3);
    });
    const x = CX - wide * Math.cos(Math.PI * along), y = GROUND - tall * Math.sin(Math.PI * along);
    orb.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')');
    show(sun, up); show(moon, !up);
    svg.classList.toggle('moonlit', !up);
    const kind = weather?.sky, wet = kind === 'rain', white = kind === 'snow', covered = wet || white || kind === 'overcast';
    // Under a grey sky the cloud sits over the sun or moon. In fair weather a smaller one stands off to one side.
    show(cloud, covered || kind === 'fair'); show(rain, wet); show(snow, white);
    // Rain and snow need room to fall, so a low cloud is lifted clear of the horizon.
    cloud.setAttribute('transform', covered ? 'translate(' + (x + 1.5).toFixed(1) + ' ' + Math.min(y + 1.5, wet || white ? GROUND - 12 : GROUND).toFixed(1) + ')'
      : 'translate(' + (x + 8).toFixed(1) + ' ' + (y + 4).toFixed(1) + ') scale(0.62)');
    svg.classList.toggle('dimmed', covered);
  };
}

export const DAY_START = 6 * 60;
export const NIGHT_START = 22 * 60;
const DAY_MINUTES = 24 * 60;

// The committed village minute sets the rate of the interval that follows it.
export function clockPace(minute, env) {
  const mode = env.VILLAGE_CLOCK_MODE || 'fixed';
  if (mode === 'day-night') {
    const at = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
    const day = at >= DAY_START && at < NIGHT_START;
    return { minutes: 1, seconds: day ? 15 : 7.5, period: day ? 'day' : 'night' };
  }
  if (mode !== 'fixed') throw new Error('Set VILLAGE_CLOCK_MODE to fixed or day-night.');

  const set = Number(env.VILLAGE_SECONDS_PER_MINUTE);
  const perMinute = Number.isFinite(set) && set > 0 ? set : env.PLANNER_PROVIDER === 'openai' ? 30 : 1;
  const minutes = Math.max(1, Math.round(3 / perMinute));
  return { minutes, seconds: minutes * perMinute, period: null };
}

import { route, walkingSegment } from '../engine/roads.mjs';

// Live views draw the walk up to the next tick. The manually stepped Sandbox interpolates
// between its last two snapshots using the waypoints passed along the way.
export function createMotion(span = 3100) {
  const tracks = new Map();
  const same = (a, b) => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;

  function sample(t, now) {
    if (!t.total) return;
    const walked = Math.max(0, Math.min(1, (now - t.start) / t.span)) * t.total;
    let rest = walked;
    for (let i = 1; i < t.pts.length; i++) {
      const a = t.pts[i - 1], b = t.pts[i], len = t.lens[i - 1];
      if (rest <= len || i === t.pts.length - 1) {
        const k = len ? Math.min(1, rest / len) : 1;
        t.x = a[0] + (b[0] - a[0]) * k; t.y = a[1] + (b[1] - a[1]) * k;
        if (len > 0.05) t.heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
        break;
      }
      rest -= len;
    }
    t.moving = walked < t.total;
    t.gone = t.base + walked;
  }

  function setSegment(t, pts, start, duration) {
    const lens = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const length = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      lens.push(length);
      total += length;
    }
    Object.assign(t, { x: pts[0][0], y: pts[0][1], pts, lens, total, moving: total > 0, start, base: t.gone, span: duration });
  }

  return {
    update(actors, now = performance.now(), duration = span, tick) {
      const live = new Set();
      for (const actor of actors) {
        if (!Number.isFinite(actor.position?.x)) continue;
        live.add(actor.id);
        const to = [actor.position.x, actor.position.y];
        const path = actor.action?.phase === 'travelling' && Array.isArray(actor.action.path) ? actor.action.path : [];
        let t = tracks.get(actor.id);
        if (!t || duration === 0) {
          t = { x: to[0], y: to[1], heading: t?.heading ?? Math.PI / 2, moving: false, gone: 0, base: 0, total: 0, pts: [to], lens: [], end: to, path, start: now, span: duration };
          tracks.set(actor.id, t);
          if (!tick || duration === 0) continue;
        }
        sample(t, now);
        if (tick) {
          const action = actor.action;
          // A stream update or selection change unrelated to the route leaves the walk in progress.
          const samePath = path.length === t.path.length && path.every((point, i) => same(point, t.path[i]));
          if (t.minute === tick.minute && t.tickMs === tick.ms && t.tickMinutes === tick.minutes
            && t.target === action.target && t.phase === action.phase && same(to, t.end)
            && t.traceId === action.decisionTraceId && t.remaining === action.remaining && samePath
            && (path.length || t.revision === tick.map?.revision)) continue;
          let points = [];
          if (action.phase === 'travelling' && action.remaining > 0) {
            const waypoints = action.path ?? route(tick.map, to, action.target)?.pts ?? [];
            points = walkingSegment(actor, waypoints, tick.minutes).points;
          }
          // An existing route is already partway through the clock interval when a viewer joins.
          // A fresh decision can arrive mid-tick, so begin that walk when we first see it.
          const start = action.path ? tick.endsAt - tick.ms : now;
          setSegment(t, [to, ...points], start, Math.max(1, tick.endsAt - start));
          Object.assign(t, { end: to, minute: tick.minute, tickMs: tick.ms, tickMinutes: tick.minutes, target: action.target, phase: action.phase, path,
            traceId: action.decisionTraceId, remaining: action.remaining, revision: tick.map?.revision });
          continue;
        }
        if (same(to, t.end)) { t.path = path; continue; }
        const used = t.path.length - path.length;
        const kept = used >= 0 && (path.length ? t.path[used] && same(path[0], t.path[used])
          : t.path.length && same(t.path.at(-1), to));
        const via = kept ? t.path.slice(0, used) : [];
        setSegment(t, [[t.x, t.y], ...via, to], now, duration);
        if (t.total > 30) setSegment(t, [to], now, duration);
        Object.assign(t, { end: to, path });
      }
      for (const id of tracks.keys()) if (!live.has(id)) tracks.delete(id);
    },
    // Where a resident is drawn right now: position, facing, whether walking and how far they have walked in all.
    at(id, now = performance.now()) {
      const t = tracks.get(id);
      if (!t) return null;
      sample(t, now);
      return t;
    },
    get busy() { for (const t of tracks.values()) if (t.moving) return true; return false; },
  };
}

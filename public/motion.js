// Turns the server's three-minute steps into continuous walking. Each resident's stored route
// tells us which waypoints they passed between two snapshots, so they follow the lanes, not a straight line.
export function createMotion(span = 3100) {
  const tracks = new Map();
  const same = (a, b) => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;

  function sample(t, now) {
    if (!t.total) return;
    const walked = Math.min(1, (now - t.start) / t.span) * t.total;
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

  return {
    update(actors, now = performance.now(), duration = span) {
      const live = new Set();
      for (const actor of actors) {
        if (!Number.isFinite(actor.position?.x)) continue;
        live.add(actor.id);
        const to = [actor.position.x, actor.position.y];
        const path = actor.action?.phase === 'travelling' && Array.isArray(actor.action.path) ? actor.action.path : [];
        let t = tracks.get(actor.id);
        if (!t || duration === 0) {
          tracks.set(actor.id, { x: to[0], y: to[1], heading: t?.heading ?? Math.PI / 2, moving: false, gone: 0, base: 0, total: 0, pts: [to], lens: [], end: to, path, start: now, span: duration });
          continue;
        }
        sample(t, now);
        if (same(to, t.end)) { t.path = path; continue; }
        const used = t.path.length - path.length;
        const kept = used >= 0 && (path.length ? t.path[used] && same(path[0], t.path[used])
          : t.path.length && same(t.path.at(-1), to));
        const via = kept ? t.path.slice(0, used) : [];
        const pts = [[t.x, t.y], ...via, to], lens = [];
        let total = 0;
        for (let i = 1; i < pts.length; i++) { lens.push(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); total += lens[i - 1]; }
        if (total > 30) { t.x = to[0]; t.y = to[1]; total = 0; }
        Object.assign(t, { pts, lens, total, moving: total > 0, end: to, path, start: now, base: t.gone, span: duration });
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

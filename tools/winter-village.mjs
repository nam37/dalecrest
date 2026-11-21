// Runs a preview village that wakes in the middle of its first winter, to look at short days, snow and
// the firewood running out without waiting four village months for them. From the project directory:
//   node --env-file=.env tools/winter-village.mjs
// Like the preview it runs on local decision rules and has a database of its own (dalecrest_winter),
// so it never touches the village in DATABASE_URL. It listens on port 4176 unless PORT is set.
process.env.PREVIEW_DATABASE ||= 'dalecrest_winter';
process.env.PORT ||= '4176';
await import('./preview-village.mjs');
const { pool } = await import('../db.mjs');
// A new village is founded on 1 August. Its clock is moved on to the first of January, once.
const days = 153;
const moved = await pool.query(`UPDATE dalecrest.world
  SET state = state || jsonb_build_object('minute', (state->>'minute')::bigint + $1, 'lastArrival', (state->>'lastArrival')::bigint + $1)
  WHERE id=1 AND (state->>'minute')::bigint < $1`, [days * 1440]);
if (moved.rowCount) console.log('The winter village has been moved on ' + days + ' days, to the turn of the year.');

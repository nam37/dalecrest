-- psql -v cutover=6220 -f tools/oven-waits.sql
-- Supply -v through=MINUTE to reproduce an earlier observation.
-- Completed village minutes use [start, end). Real wait durations use the activity timestamps.
\if :{?through}
\else
\set through 9223372036854775807
\endif
WITH clock AS (
  SELECT least((state->>'minute')::bigint, :'through'::bigint) AS now_minute,
    :'cutover'::bigint AS cutover FROM dalecrest.world
), first_seen AS (
  SELECT max(first_minute) AS start FROM (
    SELECT a.id, min(l.minute) AS first_minute FROM dalecrest.actors a
    JOIN dalecrest.activity_log l ON l.actor_id=a.id AND l.basis IN ('fresh','standing','waiting')
    WHERE coalesce((a.state->>'arrived')::bigint,-1) < (SELECT cutover FROM clock)
    GROUP BY a.id
  ) first_activity
), periods(label, start_minute, end_minute) AS (
  SELECT 'Earlier logged history', start, cutover FROM first_seen, clock
  UNION ALL SELECT 'Immediately before', greatest(start, cutover-(now_minute-cutover)), cutover FROM first_seen, clock
  UNION ALL SELECT 'After expansion', cutover, now_minute FROM clock
), transitions AS (
  SELECT actor_id, minute, recorded_at, basis, action->>'target' AS target,
    lead(minute) OVER w AS next_minute, lead(recorded_at) OVER w AS next_at,
    lead(basis) OVER w AS next_basis, lead(trace_id) OVER w AS next_trace
  FROM dalecrest.activity_log WHERE basis IN ('fresh','standing','waiting')
  WINDOW w AS (PARTITION BY actor_id ORDER BY id)
), located AS (
  SELECT t.*, CASE WHEN t.next_basis='fresh' THEN d.state_at_application->'position'
    WHEN t.next_minute IS NULL THEN a.state->'position' END AS position
  FROM transitions t JOIN dalecrest.actors a ON a.id=t.actor_id
  LEFT JOIN dalecrest.decision_traces d ON t.next_basis='fresh' AND d.id=t.next_trace
  WHERE t.basis='waiting'
), waits AS (
  SELECT l.*, CASE WHEN position->>'x' IS NULL THEN target='oven'
    ELSE abs((position->>'x')::numeric-(oven->>0)::numeric)<0.05
     AND abs((position->>'y')::numeric-(oven->>1)::numeric)<0.05 END AS at_oven
  FROM located l CROSS JOIN (
    SELECT p->'at' AS oven FROM dalecrest.map, jsonb_array_elements(state->'places') p WHERE p->>'id'='oven'
  ) site
), occupancy AS (
  SELECT p.label, m.minute, count(w.actor_id) AS waiting
  FROM periods p CROSS JOIN LATERAL generate_series(p.start_minute,p.end_minute-1) m(minute)
  LEFT JOIN waits w ON w.at_oven AND w.minute<=m.minute AND (w.next_minute IS NULL OR w.next_minute>m.minute)
  GROUP BY p.label,m.minute
), crowded AS (
  SELECT label, minute, minute-row_number() OVER (PARTITION BY label ORDER BY minute) AS run
  FROM occupancy WHERE waiting>=5
), runs AS (
  SELECT label,min(minute) AS start_minute,count(*) AS duration FROM crowded GROUP BY label,run
)
SELECT p.label, p.start_minute, p.end_minute, p.end_minute-p.start_minute AS village_minutes,
  coalesce(r.crowded_minutes,0) AS crowded_minutes, coalesce(r.stretches,0) AS stretches,
  coalesce(r.longest,0) AS longest_stretch_min, o.peak AS peak_at_minute_end,
  s.completed AS oven_waits, s.median_seconds, s.longest_seconds, s.unfinished AS unresolved_oven_waits,
  s.all_completed, s.village_median_seconds, r.bouts
FROM periods p
CROSS JOIN LATERAL (
  SELECT sum(duration) AS crowded_minutes, count(*) AS stretches, max(duration) AS longest,
    string_agg(start_minute || '+' || duration, ', ' ORDER BY start_minute) AS bouts FROM runs WHERE label=p.label
) r
CROSS JOIN LATERAL (SELECT max(waiting) AS peak FROM occupancy WHERE label=p.label) o
CROSS JOIN LATERAL (
  SELECT count(*) FILTER (WHERE at_oven AND next_minute<p.end_minute) AS completed,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM next_at-recorded_at))
      FILTER (WHERE at_oven AND next_minute<p.end_minute))::numeric,1) AS median_seconds,
    round(max(extract(epoch FROM next_at-recorded_at)) FILTER (WHERE at_oven AND next_minute<p.end_minute),1) AS longest_seconds,
    count(*) FILTER (WHERE at_oven AND (next_minute IS NULL OR next_minute>=p.end_minute)) AS unfinished,
    count(*) FILTER (WHERE next_minute<p.end_minute) AS all_completed,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM next_at-recorded_at))
      FILTER (WHERE next_minute<p.end_minute))::numeric,1) AS village_median_seconds
  FROM waits WHERE minute<p.end_minute
    AND (minute>=p.start_minute OR next_minute IS NULL OR next_minute>=p.end_minute)
) s
ORDER BY p.start_minute,p.end_minute;

-- Why activities needed a fresh choice instead of following a standing instruction, over the last day.
--   psql -v hours=24 -f tools/standing-coverage.sql
-- On the server: docker compose exec -T db psql -U postgres -d dalecrest -v hours=24 < tools/standing-coverage.sql
\if :{?hours}
\else
\set hours 24
\endif

\echo 'How activities began'
SELECT basis, count(*) AS n FROM dalecrest.activity_log
WHERE recorded_at > now() - make_interval(hours => :hours) GROUP BY 1 ORDER BY 2 DESC;

\echo 'Why a fresh choice was needed'
SELECT coalesce(reason, '(not recorded)') AS reason, count(*) AS n,
  round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
FROM dalecrest.activity_log WHERE basis = 'waiting' AND recorded_at > now() - make_interval(hours => :hours)
GROUP BY 1 ORDER BY 2 DESC;

\echo 'Standing instructions followed, by routine'
SELECT split_part(routine, ':', 1) || coalesce(':' || nullif(split_part(routine, ':', 2), ''), '') AS routine, count(*) AS n
FROM dalecrest.activity_log WHERE basis = 'standing' AND recorded_at > now() - make_interval(hours => :hours)
GROUP BY 1 ORDER BY 2 DESC;

\echo 'Instructions that ended, and why'
SELECT split_part(routine, ':', 1) AS routine, reason, count(*) AS n
FROM dalecrest.activity_log WHERE basis = 'instruction_ended' AND recorded_at > now() - make_interval(hours => :hours)
GROUP BY 1, 2 ORDER BY 3 DESC;

-- Each wait records the activity that just finished; the fresh row after it records what was chosen.
\echo 'What finished, and what the fresh choice was'
WITH rows AS (
  SELECT actor_id, basis, reason, action, recorded_at,
    lead(basis) OVER w AS next_basis, lead(action) OVER w AS next_action
  FROM dalecrest.activity_log WHERE basis IN ('waiting', 'fresh', 'standing') WINDOW w AS (PARTITION BY actor_id ORDER BY id))
SELECT action->>'kind' AS finished, next_action->>'kind' AS chose, count(*) AS n,
  count(*) FILTER (WHERE action->>'kind' = next_action->>'kind'
    AND coalesce(action->>'job', action->>'target') = coalesce(next_action->>'job', next_action->>'target')) AS same_again
FROM rows WHERE basis = 'waiting' AND next_basis = 'fresh' AND recorded_at > now() - make_interval(hours => :hours)
GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20;

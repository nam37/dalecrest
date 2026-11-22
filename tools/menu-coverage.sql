-- Stage 3b. Run with psql -X -v ON_ERROR_STOP=1 -v hours=24 -f tools/menu-coverage.sql.
-- Use -v since='2026-11-22 12:29:46-05' to compare from a known release instead.
\if :{?hours}
\else
\set hours 24
\endif
\if :{?since}
\else
SELECT now() - make_interval(hours => :hours) AS since \gset
\endif

BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';

WITH traces AS (
  SELECT t.id, t.actor_id, t.status, t.choice, t.observed_minute AS minute, t.token_charge,
    jsonb_array_length(opts) AS shown,
    length(opts::text)::numeric / length(t.request_body) AS menu_text_share,
    opts, nullif(to_jsonb(t)->'menu_audit', 'null'::jsonb) AS audit
  FROM dalecrest.decision_traces t
  CROSS JOIN LATERAL (VALUES (t.request_body::jsonb #> '{questions,0,choices}')) AS m(opts)
  WHERE t.requested_at >= :'since'::timestamptz AND t.decision_since IS NOT NULL
), options AS (
  SELECT t.id, o->>'value' AS id_shown
  FROM traces t CROSS JOIN LATERAL jsonb_array_elements(t.opts) AS rows(o)
), counts AS (
  SELECT id,
    count(*) FILTER (WHERE id_shown LIKE 'social:%') AS visits,
    count(*) FILTER (WHERE id_shown LIKE 'leisure:company:%') AS company,
    count(*) FILTER (WHERE id_shown LIKE 'share:%') AS news,
    count(*) FILTER (WHERE id_shown SIMILAR TO '(work|report|help):%') AS work,
    count(*) FILTER (WHERE id_shown SIMILAR TO 'work:(hunt|fish):%') AS outing
  FROM options GROUP BY id
), omitted AS (
  SELECT t.id, row->>'id' AS id_omitted, row->>'reason' AS reason
  FROM traces t CROSS JOIN LATERAL jsonb_array_elements(t.audit->'omitted') AS rows(row)
), hidden_counts AS (
  SELECT id,
    count(*) FILTER (WHERE id_omitted SIMILAR TO '(work|report|help):%') AS work,
    count(*) FILTER (WHERE id_omitted SIMILAR TO 'work:(hunt|fish):%') AS outing
  FROM omitted GROUP BY id
), protected_gaps AS (
  SELECT t.id, key FROM traces t CROSS JOIN LATERAL jsonb_object_keys(t.audit->'protected') AS p(key)
  WHERE NOT EXISTS (SELECT 1 FROM options o WHERE o.id=t.id AND o.id_shown=p.key)
), finishes AS (
  SELECT DISTINCT t.id FROM traces t JOIN dalecrest.decision_steps s ON s.trace_id=t.id
  JOIN dalecrest.events e ON e.id=s.event_id AND e.kind='work'
  WHERE t.status='applied' AND t.choice SIMILAR TO '(work|help):%'
    AND ((e.outcome->>'workerId'=t.actor_id AND e.outcome->>'status'='completed')
      OR (e.outcome IS NULL AND e.actor_ids=ARRAY[t.actor_id] AND EXISTS (
        SELECT 1 FROM dalecrest.decision_steps ended
        WHERE ended.trace_id=t.id AND ended.kind='activity_ended' AND ended.minute=e.minute
      )))
), totals AS (
  SELECT CASE WHEN t.audit IS NULL THEN 'full' ELSE 'curated' END AS policy,
    count(*) AS requests, count(*) FILTER (WHERE t.status='applied') AS applied,
    min(t.minute) AS first_minute, max(t.minute) AS last_minute,
    round(avg(t.shown),2) AS mean_menu, max(t.shown) AS max_menu,
    count(*) FILTER (WHERE t.shown > 12 AND t.audit IS NOT NULL) AS soft_cap_overflows,
    round(avg(t.token_charge),1) AS mean_charged_tokens,
    round(100 * avg(t.menu_text_share),1) AS menu_text_pct,
    round(avg(c.visits),2) AS visits_per_menu, round(avg(c.company),2) AS company_per_menu,
    round(avg(c.news),2) AS news_per_menu, round(avg(c.work),2) AS work_per_menu,
    round(100.0 * sum(c.visits+c.company+c.news) / nullif(sum(t.shown), 0),1) AS social_menu_pct,
    count(*) FILTER (WHERE t.status='applied' AND t.choice SIMILAR TO '(social:|share:|leisure:company:)%') AS social_choices,
    count(*) FILTER (WHERE c.work+coalesce(h.work,0)>0) AS work_feasible,
    count(*) FILTER (WHERE c.work>0) AS work_shown,
    count(*) FILTER (WHERE t.choice SIMILAR TO '(work|report|help):%') AS work_chosen,
    count(*) FILTER (WHERE t.status='applied' AND t.choice SIMILAR TO '(work|report|help):%') AS work_started,
    count(f.id) AS recorded_work_completions,
    count(*) FILTER (WHERE c.outing+coalesce(h.outing,0)>0) AS outing_feasible,
    count(*) FILTER (WHERE c.outing>0) AS outing_shown,
    count(*) FILTER (WHERE t.choice SIMILAR TO 'work:(hunt|fish):%') AS outing_chosen,
    count(*) FILTER (WHERE t.status='applied' AND t.choice SIMILAR TO 'work:(hunt|fish):%') AS outing_started,
    count(*) FILTER (WHERE f.id IS NOT NULL AND t.choice SIMILAR TO 'work:(hunt|fish):%') AS outing_completed
  FROM traces t JOIN counts c ON c.id=t.id LEFT JOIN hidden_counts h ON h.id=t.id LEFT JOIN finishes f ON f.id=t.id
  GROUP BY 1
)
SELECT jsonb_pretty(jsonb_build_object(
  'since', :'since'::timestamptz, 'measured_at', now(),
  'by_policy', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.policy) FROM totals t), '[]'::jsonb),
  'protected_omissions', (SELECT count(*) FROM protected_gaps),
  'omissions', coalesce((SELECT jsonb_object_agg(reason,n) FROM
    (SELECT reason,count(*) AS n FROM omitted GROUP BY reason) o), '{}'::jsonb),
  'own_trade', coalesce((SELECT jsonb_object_agg(reason,n) FROM (
    SELECT audit#>>'{ownTrade,status}' AS reason,count(*) AS n FROM traces
    WHERE audit#>>'{ownTrade,status}' IS NOT NULL GROUP BY 1
  ) o), '{}'::jsonb),
  'unavailable_replies', (SELECT count(*) FROM traces WHERE status='unavailable'),
  'activities', coalesce((SELECT jsonb_object_agg(basis,n) FROM (
    SELECT basis,count(*) AS n FROM dalecrest.activity_log WHERE recorded_at >= :'since'::timestamptz GROUP BY 1
  ) a), '{}'::jsonb)
));
COMMIT;

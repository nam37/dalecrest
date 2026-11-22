# Trace a villager’s decision

Every new attempt to ask `gpt-6-luna` for a decision has one row in `dalecrest.decision_traces`. An applied decision also has a timeline in `dalecrest.decision_steps`. Read both with a PostgreSQL connection that has SELECT access. These queries run against stored history and never call the model. Earlier village history predates tracing and has no retained model exchange.

## Find an exchange

In `psql`, list a resident’s attempts, then set `trace_id` to the ID you want to inspect. Remove the resident filter to see the whole village.

```sql
SELECT id, observed_minute, requested_at, status, http_status, choice, confidence
FROM dalecrest.decision_traces
WHERE actor_id = 'agnes'
ORDER BY id DESC
LIMIT 10;
```

```psql
\set trace_id 1
\x on
SELECT id, actor_id, model, endpoint, requested_at, observed_minute, request_body,
       response_at, http_status, provider_request_id, response_body,
       credential_redacted, choice, confidence, status, error
FROM dalecrest.decision_traces
WHERE id = :trace_id;
```

`request_body` is the serialized text posted to the endpoint, including the observation, question, instructions, and allowed choices. `response_body` stores the provider’s reply as text, preserving formatting, probability data, usage, unexpected fields, and non-JSON error bodies when returned. The Authorization header is never stored. If a provider echoes the server’s exact API key in its reply, Dalecrest masks it and sets `credential_redacted`.

`confidence` is the numeric confidence Luna supplied for its recorded answer. SQL NULL means no numeric confidence was available. The raw reply is the source for any additional scores or metadata. A confidence concerns the model’s choice. Whether a resident actually ate or rested is recorded by the simulation.

## Read what happened next

```sql
SELECT actor_id, choice, applied_minute, state_at_application->'action' AS already_doing,
       state_at_application->'needs' AS needs, until_minute, ended_minute, end_reason
FROM dalecrest.decision_traces
WHERE id = :trace_id;

SELECT s.minute, s.kind, s.details->'action'->>'kind' AS activity,
       s.details->'action'->>'label' AS action_label, s.details->'needs' AS needs,
       e.id AS event_id, e.description
FROM dalecrest.decision_steps AS s
LEFT JOIN dalecrest.events AS e ON e.id = s.event_id
WHERE s.trace_id = :trace_id
ORDER BY s.minute, s.id;
```

For a direct action trace, `decision_since` is the village minute the actor entered the queue. The stored question is named `next_action`. Compare its returned `choice` to `details->'action'->>'choiceId'` on the `selected` step. They are committed together with the resident's new activity. The selection carries a chronicle event ID. Read later steps to see arrival, activity end and any meal, work or encounter. A successful start can still encounter a later shortage. The trace closes when that activity ends. The waiting snapshot includes the previous activity under `action.previous`.

Older traces with a NULL `decision_since` used the priority planner. They show an intention and later activities until that intention expired or was replaced. Alice's original food priority is an example of that historical behavior.

## Understand incomplete attempts

| Status | Meaning |
| --- | --- |
| `requested` | The request body and its spending reservation were committed together. Delivery has not been confirmed. |
| `received` | The complete reply was saved. The planner can resume processing it after restart without calling Luna again. |
| `applied` | The selected action or historical priority was committed. Direct actions close with `activity_ended`. `end_reason` later records `expired` or `replaced`. |
| `stale`, `superseded`, `actor_missing`, `unavailable` | A valid answer arrived but the simulation could no longer apply it. |
| `http_error`, `refused`, `invalid_response` | An HTTP error, refusal, or unusable answer was retained for inspection. |
| `late_response` | A response arrived after its attempt timed out. The raw exchange is retained. |
| `transport_error` | The connection failed before a complete reply reached the application. |
| `unknown` | A request remained unresolved for five real minutes, for example after a process interruption. Delivery and response are unknown. |

## See how each activity began

A resident starts an activity in one of two ways: on a fresh choice from the Decisions API, or by routine on a standing instruction that an earlier choice set. `dalecrest.activity_log` records which, in the same transaction as the activity.

| `basis` | Meaning | Useful columns |
| --- | --- | --- |
| `waiting` | An activity ended and a fresh choice was needed. The resident began to wait. | `reason` says why this was a choice. `action` is what they had just finished. |
| `fresh` | A reply was applied and the activity started. | `trace_id` is the exchange. `waited_minutes` is village time spent waiting. `routine` is the routine this choice now stands for, if any. |
| `standing` | The activity started on a standing instruction. No request was made. | `trace_id` is the exchange that set the instruction. `waited_minutes` is above zero when the instruction came to cover a moment the resident was waiting in. |
| `instruction_ended` | An instruction was dropped before it could be followed. | `routine` and `reason`: lapsed, goals changed, or ran its course. |

`recorded_at` is wall-clock time, so the real length of a wait is the gap between a `waiting` row and the next `fresh` or `standing` row for the same resident. The resident's own record carries the same fact for the current activity under `action.basis`.

```sql
SELECT minute, basis, routine, reason, trace_id, waited_minutes, action->>'label' AS activity, recorded_at
FROM dalecrest.activity_log
WHERE actor_id = 'alice'
ORDER BY id DESC
LIMIT 30;
```

For the village as a whole, `node --env-file=.env tools/pilot-report.mjs 24` prints the share of activities by basis, fresh choices per resident per village day, why each was needed, real waiting time, spending, and how late the clock has ever run.

### Compare common oven waits across a release

Run `psql -v cutover=6220 -f tools/oven-waits.sql` against the village database. Minute 6220 was the expansion from eight residents to ten. Add `-v through=MINUTE` to reproduce a reading at a fixed endpoint.

The report counts completed village minutes when at least five people were waiting at the common oven. Cooking, eating, visiting and walking are active time. It also measures real seconds from entering a wait to the next activity. Completed waits must start and end inside the reporting window. The unresolved count shows waits still pending at its end. For a wait ending on a fresh choice, the resident's recorded position establishes the location. For a wait ending on a standing instruction, the report uses the logged target.

The first comparison window starts when each original resident has an entry in the activity log. The second looks back from the expansion for the same duration as the follow-up, up to the available history. A crowd that crosses a window boundary contributes only the minutes inside that window.

#### First village hour after the expansion

The live rollout began on 21 November 2026 at 6:25 p.m. Eastern. Reproduce the first village hour with `-v cutover=6220 -v through=6280`.

| Live window | Village minutes with five or more waiting | Crowd stretches | Completed individual oven waits | Median real wait | Longest real wait |
| --- | ---: | ---: | ---: | ---: | ---: |
| Earlier history, minutes 5925–6219 | 28 of 295 (9.5%) | 3 | 15 | 13 min 58 s | 24 min 27 s |
| Hour immediately before, 6160–6219 | 0 of 60 | 0 | 0 | — | — |
| Hour after, 6220–6279 | 0 of 60 | 0 | 5 | 1.4 s | 1.7 s |

The three earlier crowds lasted 8, 13 and 7 village minutes in chronological order. Measuring the overlaps from the activity timestamps gives real durations of 4 min 2 s, 6 min 32 s and 3 min 54 s. After the expansion, only one resident at a time waited at the oven. Individual waits cleared faster than in the longer baseline. Both adjacent hours had zero crowds, so the effect on crowd frequency is still uncertain.

In the first 30 real minutes, the planner applied 17 decisions for nine residents, including both newcomers. The API reported 12,688 uncached input tokens, with zero cache writes or output tokens. That cost about $0.00127 at $0.10 per million. The preceding 30 real minutes had four decisions and 2,898 tokens. [Decisions pricing](https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability)

## Inspect an oven or woodcutting shift

Each new baking or woodcutting shift ends with a `work` chronicle entry. Its `outcome` JSONB records the job, intended site, worker, helpers recorded during that shift, and signed changes to common stores. A blocked or interrupted shift records its cause and an empty stock change. The tick commits this event with the inventory and resident state. Older entries have SQL NULL for `outcome`.

```sql
SELECT e.minute, e.description, e.outcome->>'status' AS status,
       e.outcome->>'site' AS site, e.outcome->'helperIds' AS helpers,
       e.outcome->'stockDelta' AS stock_delta, e.outcome->>'reason' AS cause,
       e.outcome->>'basis' AS basis, t.id AS source_trace, t.choice
FROM dalecrest.events e
LEFT JOIN dalecrest.decision_traces t ON t.id = (e.outcome->>'traceId')::bigint
WHERE e.outcome->>'workerId' IN ('mabel', 'oswin')
ORDER BY e.id DESC
LIMIT 20;
```

For a standing instruction the trace belongs to the earlier choice that authorized the repeat. A shift that predates activity-basis logging may have only a trace ID. A local-rule shift has no model trace. A plain woodcutting outcome establishes who supplied wood. Crediting it to a specific promise will require a choice that names that commitment.

## Trace an oven inspection

An `observation` event records the count when a resident finishes checking a built oven in person. The same tick saves their latest reading in `actors.state.observations.ovenStores`. Each subsequent action request carries `lastOvenCheck`, including the place, observation minute and age. It is null before the first check. Counts refer to the shared village supplies available at that oven. If a remembered stock has run out by the time a baker tries to use it, the failed start and a new on-site count appear in the chronicle. Other residents keep their own readings.

This query pairs each reading with the first later request that actually included it. A pending next turn leaves the final two columns empty.

```sql
SELECT e.id, e.minute, e.outcome, next_turn.id AS next_trace, next_turn.choice
FROM dalecrest.events e
LEFT JOIN LATERAL (
  SELECT t.id, t.choice FROM dalecrest.decision_traces t
  WHERE t.actor_id = 'mabel' AND t.decision_since IS NOT NULL
    AND t.observed_minute >= e.minute
    AND (t.request_body::jsonb #>> '{input,0,content,0,data,lastOvenCheck,minute}')::bigint = e.minute
  ORDER BY t.id LIMIT 1
) next_turn ON true
WHERE e.kind = 'observation' AND e.actor_ids = ARRAY['mabel']
ORDER BY e.id DESC LIMIT 10;
```

## Trace a request and its reply

The query follows the latest request Mabel actually delivered to Oswin. It returns the original count, the ask, any reply, any credited work and the stored model exchanges behind those events. Change the two IDs for a different pair. An ordinary shift can produce wood while the request stays unanswered. A missed visit has `delivered: false` and creates no request.

```sql
WITH latest AS (
  SELECT outcome->>'requestId' AS request_id, outcome->'fact' AS fact
  FROM dalecrest.events
  WHERE outcome->>'verb' = 'ask' AND outcome->>'delivered' = 'true'
    AND actor_ids = ARRAY['mabel','oswin']
  ORDER BY id DESC LIMIT 1
)
SELECT e.minute, e.description, e.outcome, t.id AS trace, t.choice,
       t.confidence, t.request_body, t.response_body
FROM latest l
JOIN dalecrest.events e ON e.outcome->>'requestId' = l.request_id
  OR e.outcome->>'commitmentId' = l.request_id
  OR (e.kind = 'observation' AND l.fact->>'topic' = 'oven'
      AND e.actor_ids = ARRAY[l.fact->>'observerId']
      AND e.minute = (l.fact->>'minute')::bigint)
LEFT JOIN dalecrest.decision_traces t ON t.id = (e.outcome->>'traceId')::bigint
ORDER BY e.minute, e.id;
```

An actor's `reports` retains the latest account heard on each topic with the original witness, speaker and times. `helpBook` holds each party's last known request status through its deadline. The requester learns of completed work if someone reports it. The village's active requests live in `world.state.helpRequests`. The event history survives expiry and is committed with the participants' state. Events for a missed conversation identify just the resident who sought the meeting.

In an isolated rehearsal, Mabel counted nine measures of flour and no wood on 1 August 1312 at 07:04. Her fresh Luna choice was to visit Agnes (confidence 0.41). A scripted follow-up delivered the request to Oswin at 07:07. His own Luna choice was an ordinary woodcutting shift (confidence 0.51). He stacked three bundles at 10:14. His shift trace records the production, and the request trace still shows that Mabel was waiting for an answer.

There is no automatic pruning of decision traces. The normal PostgreSQL backup includes the trace tables and the activity log. Treat database access and backups as access to the complete model exchanges.

## Trace a reconsideration

The latest review by Mabel can be followed from what she learned to what she chose and whether her message arrived. A count is the reserve at the time of the reading. An amount added is the output of a particular shift. Retellings preserve the original witness and observation time. Change the resident ID to investigate another villager.

```sql
SELECT e.minute, e.description, e.outcome->>'requestId' AS request_id,
       e.outcome->'evidence' AS what_the_requester_knew,
       t.id AS decision_trace, t.request_body, t.choice, t.confidence, t.response_body,
       source.id AS learning_trace, source.choice AS how_the_news_arrived
FROM dalecrest.events e
LEFT JOIN dalecrest.decision_traces t ON t.id = (e.outcome->>'traceId')::bigint
LEFT JOIN dalecrest.decision_traces source
  ON source.id = (e.outcome #>> '{evidence,learnedTrace}')::bigint
WHERE e.actor_ids[1] = 'mabel' AND e.outcome->>'verb' IN ('retain','release','defer')
ORDER BY e.id DESC LIMIT 10;
```

The model sees the request's original count when available and the latest relevant evidence. A private decision to keep or defer changes only the requester's record. A delivered withdrawal closes an open request for both parties. A missed withdrawal leaves it open. Older saved villages can have an observation without a linked learning trace. A completed named shift retains its credit even if a withdrawal reaches the helper later.

In a copy of the earlier rehearsal, Oswin's ordinary woodcutting and its repeat had added six bundles. Mabel's original reading was zero. On 1 August 1312 at 10:53 a staged inspection found six. The live model selected withdrawal (trace 6, confidence 0.27). Mabel reached Oswin at 11:26, delivered the message and closed the request. Her inspection established how much wood was there. It gave her no evidence of who supplied it.

## Follow a goal

Every memory a resident forms is stored in `dalecrest.observations`, every version of every goal in `dalecrest.goal_versions`, and every goal review in `dalecrest.goal_reviews`. Keys name a memory as `resident:number` and a goal version as `resident:goal:version`. A goal version's `basis` lists the memory and evidence keys it rests on, and an action trace's `goal_keys` and `observation_keys` list what its request was given.

Read a resident's chain from what they saw to what came of it in one query:

```sql
SELECT observed_minute, observation, goal_id, goal_version, goal, review_id, trace_id, choice,
       outcome_event_id, outcome, witnessed_by
FROM dalecrest.goal_chain
WHERE actor_id = 'oswin'
ORDER BY observed_minute DESC, trace_id DESC;
```

See how a resident's goals have changed and what settled each:

```sql
SELECT goal_id, version, kind, status, text, condition, about, outcome->>'why' AS settled_by,
       since_minute, settled_minute, review_id, basis
FROM dalecrest.goal_versions
WHERE actor_id = 'mabel'
ORDER BY goal_id, version;
```

Read the latest reviews, what they cost and what they changed:

```sql
SELECT id, actor_id, why, status, token_charge, result->'applied' AS applied, result->'rejected' AS set_aside, statement
FROM dalecrest.goal_reviews
ORDER BY id DESC
LIMIT 20;
```

A review whose status is `applied` changed the resident's goals as its `result` shows. `superseded` means the resident's review had already been settled when the reply came, and `invalid`, `refused`, `http_error` or `transport_error` mean the goals were left as they were and the review stays due. A failed review is tried again after ten minutes.

## Follow a ballot

Each motion settled at the hall has a resolution event. Its roll call contains one entry per returned ballot. This query links each model vote to the request the voter received, including the exact versioned goals, observations and open obligations.

```sql
SELECT e.id AS resolution, e.outcome->>'mootId' AS moot, e.outcome->>'title' AS motion,
       b->>'actorId' AS voter, b->>'choice' AS vote,
       t.id AS trace, t.goal_keys, t.observation_keys,
       t.request_body::jsonb #> '{input,0,content,0,data}' AS voter_context
FROM dalecrest.events e
CROSS JOIN LATERAL jsonb_array_elements(e.outcome->'ballots') b
JOIN dalecrest.decision_traces t ON t.id::text = b #>> '{trace,traceId}'
WHERE e.outcome->>'civic' = 'resolution'
ORDER BY e.id DESC, t.id;
```

In the request, each entry in `civicNews` carries the motion's terms and a `chain` of residents, village minutes and observation keys. A corrected estimate keeps its earlier chain in `previousReport`. Look up a key in `dalecrest.observations` by matching `actor_id || ':' || seq`. A position event's `observationKeys` identifies the report on which the resident took that position. The resolution's `missing` count identifies ballots that never arrived.

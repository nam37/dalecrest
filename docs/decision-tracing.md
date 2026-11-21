# Trace a villager’s decision

Every new attempt to ask `gpt-6-luna` for a priority has one row in `dalecrest.decision_traces`. An applied priority also has a timeline in `dalecrest.decision_steps`. Read both with a PostgreSQL connection that has SELECT access. These queries run against stored history and never call the model. Earlier village history predates tracing and has no retained model exchange.

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

`confidence` is the numeric confidence Luna supplied for its priority answer. SQL NULL means no numeric confidence was available. The raw reply is the source for any additional scores or metadata. A confidence concerns the model’s choice. Whether a resident actually ate or rested is recorded by the simulation.

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

Start with the action already underway when the plan took effect. The first `selected` row is the resident’s next choice. `arrived` records reaching the destination, and `activity_ended` records the activity timer reaching zero. A `chronicle` row links the event and its actual participants or outcome. For example, if Luna chose food, a selection to fetch a loaf shows intent and a meal entry shows the villager actually ate. Read events in village-minute order. Several observations can share a minute. The action snapshots also include position.

The trace follows that resident until the priority expires or another plan replaces it. An ongoing trace can gain more steps after the query. A trace can close without a matching action. The original decision, any competing activities, and the ending remain available.

## Understand incomplete attempts

| Status | Meaning |
| --- | --- |
| `requested` | The request body and rate-limit slot were committed together. Delivery has not been confirmed. |
| `received` | The complete reply was saved. The planner can resume processing it after restart without calling Luna again. |
| `applied` | The plan and its start state were committed together. `end_reason` later records `expired` or `replaced`. |
| `stale`, `superseded`, `actor_missing` | A valid answer arrived but the simulation could no longer apply it. |
| `http_error`, `refused`, `invalid_response` | An HTTP error, refusal, or unusable answer was retained for inspection. |
| `transport_error` | The connection failed before a complete reply reached the application. |
| `unknown` | A request remained unresolved for five real minutes, for example after a process interruption. Delivery and response are unknown. |

There is no automatic pruning. The normal PostgreSQL backup includes both trace tables. Treat database access and backups as access to the complete model exchanges.

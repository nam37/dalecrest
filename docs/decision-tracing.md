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

There is no automatic pruning. The normal PostgreSQL backup includes both trace tables. Treat database access and backups as access to the complete model exchanges.

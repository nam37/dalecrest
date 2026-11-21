# Dalecrest design decisions

These decisions describe the running village. When a change alters a decision, record the reason here and update any affected operator instructions.

### 1. The village clock belongs to the server

Villagers should be able to finish a shift or meet a friend while nobody is watching. The Node.js server advances the simulation in village minutes. It locks the world row before each tick and commits the new world, resident states, events, and active decision traces together. A browser reads a snapshot. Pausing the view freezes only that observer’s snapshot. When the server stops, the clock stops at its last committed tick.

### 2. Keep a current record for each resident and a shared village history

PostgreSQL stores each resident in `dalecrest.actors`, keyed by a stable ID. The `state` JSONB document holds their identity, desires, needs, position, activity, relationships, memories, and current plan. JSONB lets a resident’s record grow without requiring a new table for every trait. The shared clock and supplies live in `dalecrest.world`. Events with a village minute, participants, and description go into `dalecrest.events`. The public chronicle shows the latest 100 events. Earlier events remain queryable in PostgreSQL.

```sql
SELECT id, state->>'name' AS name, state->'desires' AS desires,
       state->'action' AS activity, state->'plan' AS plan
FROM dalecrest.actors
ORDER BY ordinal;
```

### 3. Luna selects an executable action at each activity boundary

With the OpenAI provider enabled, a resident finishes the current activity and waits for a decision. The engine lists actions that resident can start, including specific destinations, jobs and people. The request includes the finished activity, time, needs, traits, goals, desires, supplies and recent memories. Luna selects one menu ID. Under the same database lock as the village clock, Dalecrest checks the offered action is still available, starts it, and records the selection. The simulation resolves movement, encounters, material use and outcomes. An unavailable or invalid choice leaves the actor waiting for a fresh menu.

The backend checks for waiting residents every two seconds, giving earlier turns preference. Failures have a one-minute per-turn cooldown. The village shares a default budget of 7,000 tokens per rolling real hour, close to the previous five-minute cadence at the observed 589 tokens per request. Set `OPENAI_ACTION_TOKENS_PER_HOUR` on the app to change it. The backend reserves an estimate before sending, then replaces it with the reported usage. A response can exceed its estimate. A quarter-hour of spending can be used in a burst and replenishes continuously. When at least half the residents are waiting, the clock advances one village minute per tick. It pauses if everyone is waiting. Other provider modes retain the local activity scoring system.

### 4. Preserve the exchange and observe the outcome separately

An actor’s current plan is overwritten by later plans. A chronicle entry alone cannot recover the exact prompt or the model’s confidence. Each OpenAI attempt therefore gets a durable trace ID before the HTTP call. The trace links the exact request and reply to the simulation’s subsequent activities and chronicle entries. Each direct action records its start and subsequent outcomes under the same trace ID. The trace is available through PostgreSQL and excluded from the public village snapshot. [Trace schema and queries](decision-tracing.md).

### 5. Deploy the application independently of the village data

The VPS runs the application and a dedicated PostgreSQL 17 service in separate containers. The database uses a private network and persistent volume. Caddy serves the observatory over HTTPS. A systemd timer polls GitHub `main` about every two minutes. The deployer builds and tests the candidate, takes a database dump, switches the application container, and checks that it can read the residents. A failed health check can roll back the app image. Restoring village data is a separate operator decision. Administered host files and their installation paths are described in [the deployment scripts](../deploy/).

### 6. Choose the model by what the simulation needs back

Use `gpt-6-luna` for each resident’s next executable activity. For a future task that needs an open-ended response, such as a villager reflecting on several memories, use Claude Haiku 5.5 (`claude-haiku-5-5`) through Anthropic’s Messages API. Haiku is the low-cost default for this work. Read its credential from the backend environment variable `CLAUDE_KEY`. The activity planner is currently the village’s only model-driven task. [Claude models and pricing](https://platform.claude.com/docs/en/models/overview) · [Messages API](https://platform.claude.com/docs/en/api/messages/create).

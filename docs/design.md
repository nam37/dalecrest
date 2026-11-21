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

### 7. The ground is generated once and then owned by the village

The first map was a drawing: coordinates typed into the page, with a second copy of the eight sites in the simulation. Nothing could be built because nothing knew where anything was. The map is now one JSON document in `dalecrest.map`, generated from a seed by `engine/worldgen.mjs`. Roads come first: a through road, lanes out to the mill, fields and coppice, then buildings on lots along those ways, fields and woods. The document holds the road graph, every place with its footprint and door, the trees and the terrain parameters. Elevation and water are pure functions of those parameters, so no height grid is stored.

The seed is used once. After founding, the stored document is the truth and the generator is never run again for that village, so improving the generator cannot reshuffle a village people are watching. `VILLAGE_SEED` chooses the seed for a new database. A database from before the map existed is given one at startup: residents keep their records, each household receives a cottage, and legacy site names are mapped to places.

Residents walk the road graph. A route is stored with the action as a list of waypoints, which keeps the simulation resumable from JSON alone and lets the page animate walking along the lanes between snapshots. Where open ground is clearly shorter, residents cut across it. Twelve crossings between the same two places wear a path into the map.

The map changes rarely and is larger than a resident record, so it has its own table and revision. The world row carries the current revision. The server holds one copy per process and reloads it when the revisions differ. The page fetches `/api/map` only when the revision in the snapshot changes.

### 8. The village grows from what residents ask for

New buildings should have a reason a visitor can read in the chronicle. Each resident derives concerns from their own circumstances: a lodger wants a cottage, a farmer knows how many mouths the fields can feed, the wellkeeper knows how far one well stretches. A concern is voiced in an ordinary conversation, which needs the two residents to be in the same place. The listener agrees or not, depending on shared need, friendship and temperament. A proposal with enough voices calls a moot at the hall that evening. Residents who attend vote, and an agreed work becomes a staked site on a lot chosen for its purpose. Building takes shifts of labour and bundles of wood from the common stores, with a limit on how many can work a site at once.

The loop that drives it: a village with bread on the table, land to feed one more and room at the hall draws a traveller off the road. They take up the trade the village is shortest of and lodge at the hall, which starts the case for a cottage. More residents strain the fields, bins, well and oven in turn. When the lots near the green are taken, the residents stake out a new lane. Arrivals slow as the village grows and stop at 36 residents.

The rules live in `engine/civic.mjs`, `engine/people.mjs` and `engine/sites.mjs`. They use the village's own seeded random state, so a stored village replays identically. Model planning does not take part in these decisions yet. A model arguing a case or casting a vote at the moot is a natural next step, and the proposal and moot records are shaped to allow it.

### 9. Two views draw the same stored map

The plan view in `public/map.js` draws the map in ink on parchment, in the manner of Watabou's village generator. The walking view in `public/view3d.js` raises the same footprints into low-poly buildings with three.js and follows the selected resident at eye level. Neither view holds layout of its own, so anything the village builds appears in both. A site shows as stakes, then a frame, then the finished building.

three.js is an npm dependency served from `/vendor/`, so the page loads nothing from another host. The engine modules are served to the browser unchanged. `/atlas.html` uses them to found a village from any seed in the page and run it forward by days, which is the quickest way to judge the look of a grown village without waiting for one or touching a database.

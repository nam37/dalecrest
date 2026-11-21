# Dalecrest design decisions

These decisions describe the running village. When a change alters a decision, record the reason here and update any affected operator instructions. Planned changes are in the [roadmap](roadmap.md) and are not described here until they are built.

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

### 3. Luna chooses at each real choice, and the clock does not wait

With the OpenAI provider enabled, the Decisions API chooses what a resident does whenever there is something to decide. The request includes feasible activities, the resident's goals and needs, recent memories, and the last flour and firewood count they personally made at an oven. That count includes its age. A resident can choose a reachable oven inspection without knowing what it will reveal. Baking requires a prior check at that oven, physical presence and a remembered supply sufficient for a batch. If those supplies have since run out, the baker discovers the obstacle on starting the shift and counts again. Other activities still use the existing site, capacity and availability rules. Luna selects one menu ID. Under the village clock's database lock, Dalecrest rechecks the offered action and records its start. The simulation resolves movement, encounters and subsequent outcomes. [Trace an oven inspection](decision-tracing.md#trace-an-oven-inspection)

**Routine follows a standing instruction.** Measured under local rules, a resident reaches about 23 activity boundaries a village day, 55% of them repeat the activity before, and one night's sleep is five of them. Asking the model at every boundary spent the budget on moments where nothing had changed. A fresh choice is now kept as a standing instruction for the routine it answered: a night's sleep, a meal, or another stretch of the same activity. At a boundary the engine follows a valid instruction. It asks for a fresh decision when no instruction covers the moment, when the instruction has lapsed or the resident's goals have changed, when the resident has heard something new, when two needs are urgent at once, when the instructed action cannot start, or when following it would run into something the resident has a stake in. Today that last case is a moot falling due. A stale instruction is dropped with its reason and never followed. The engine never picks an activity itself. The rules and their starting values are in `engine/standing.mjs`. They are pilot parameters.

**The clock advances on its own schedule.** Earlier, ticks slowed to fit the token budget and stopped when everyone was waiting, so a visitor saw nobody move and a larger village would have run slower still. Village time now advances at a fixed pace whatever the models are doing: `VILLAGE_SECONDS_PER_MINUTE` real seconds per village minute, 30 by default with the OpenAI provider and 1 under local rules. A resident whose choice has not arrived waits where they are. Their needs keep rising and everyone else carries on. If a valid instruction comes to cover the moment, such as nightfall, they follow it, and a reply that arrives afterwards is kept and marked superseded. Budget and latency now limit how fresh a resident's decisions are, never how fast time passes.

The backend checks for waiting residents every two seconds. A choice that something is about to overtake is served first, then whoever has waited longest. Failures have a one-minute per-turn cooldown. The village shares a default budget of 7,000 tokens per rolling real hour. Set `OPENAI_ACTION_TOKENS_PER_HOUR` on the app to change it. The backend reserves an estimate before sending, then replaces it with the reported usage. A quarter-hour of spending can be used in a burst and replenishes continuously. Other provider modes retain the local activity scoring system.

**Every activity records how it began.** `dalecrest.activity_log` holds one row for each fresh choice, each activity started on a standing instruction, each wait and each instruction that ended, with the exchange behind it. The world row counts ticks and the latest any tick has run. `node --env-file=.env tools/pilot-report.mjs` reports the pilot measurements from those records. [Roadmap Stage 0](roadmap.md) · [Reading the activity log](decision-tracing.md)

### 4. Preserve the exchange and observe the outcome separately

Residents can tell neighbours about an oven reading or a completed shift. A low count can also give them a reason to ask a neighbour to cut wood, grind flour, gather barley or draw water. Counts of flour and wood come from oven inspections. Someone depositing barley or water sees the balance of that reserve. A report keeps the original witness and observation time through retellings. Walking to speak to someone can end in a missed visit. The recipient learns the news when the two meet within speaking distance.

Each request asks for one shift's output within 24 village hours. The model can select an agreement, a refusal, an ordinary activity or, after agreeing, the shift naming the request. Only verified production on that named shift earns credit. Accepting, declining, reporting and fulfilling a request always require fresh choices. The current date and deadlines in model requests use the same calendar as the observatory. [Trace a request and its reply](decision-tracing.md#trace-a-request-and-its-reply)

An actor’s current plan is overwritten by later plans. A chronicle entry alone cannot recover the exact prompt or the model’s confidence. Each OpenAI attempt therefore gets a durable trace ID before the HTTP call. The trace links the exact request and reply to the simulation’s subsequent activities and chronicle entries. Each direct action records its start and subsequent outcomes under the same trace ID. The trace is available through PostgreSQL and excluded from the public village snapshot. [Trace schema and queries](decision-tracing.md).

### 5. Deploy the application independently of the village data

The VPS runs the application and a dedicated PostgreSQL 17 service in separate containers. The database uses a private network and persistent volume. Caddy serves the observatory over HTTPS. A systemd timer polls GitHub `main` about every two minutes. The deployer builds and tests the candidate, takes a database dump, switches the application container, and checks that it can read the residents. A failed health check can roll back the app image. Restoring village data is a separate operator decision. Administered host files and their installation paths are described in [the deployment scripts](../deploy/).

### 6. Choose the model by what the simulation needs back

The accepted design assigns personal goals to a general-purpose model, the choice of the next feasible action to the Decisions API, and the actual outcome to the simulation engine. A goal persists across activities until the resident has reason to reconsider it. The resident knowledge graph describes the evidence each role receives and the links PostgreSQL should preserve. [Resident knowledge graph](knowledge-graph.md)

Today `gpt-6-luna` makes fresh choices in OpenAI mode using predefined goals. A still-valid instruction can repeat a previous choice. General-purpose goal reviews are planned. The initial choice for that work is Claude Haiku 5.5 (`claude-haiku-5-5`) through Anthropic’s Messages API, using the backend environment variable `CLAUDE_KEY`. [Claude models and pricing](https://platform.claude.com/docs/en/models/overview) · [Messages API](https://platform.claude.com/docs/en/api/messages/create)

### 7. The ground is generated once and then owned by the village

The first map was a drawing: coordinates typed into the page, with a second copy of the eight sites in the simulation. Nothing could be built because nothing knew where anything was. The map is now one JSON document in `dalecrest.map`, generated from a seed by `engine/worldgen.mjs`. Roads come first: a through road, lanes out to the mill, fields and coppice, then buildings on lots along those ways, fields and woods. The document holds the road graph, every place with its footprint and door, the trees and the terrain parameters. Elevation and water are pure functions of those parameters, so no height grid is stored.

The seed is used once. After founding, the stored document is the truth and the generator is never run again for that village, so improving the generator cannot reshuffle a village people are watching. `VILLAGE_SEED` chooses the seed for a new database. A database from before the map existed is given one at startup: residents keep their records, each household receives a cottage, and legacy site names are mapped to places.

During that first migration, residents working or waiting move to the corresponding place on the new map. Residents already travelling start from their new home and continue toward their chosen destination. A rollback to a release predating the generated map requires a compatible village database. Restore the matching pre-release dump into a separate database and verify it before switching the app.

Residents walk the road graph. A route is stored with the action as a list of waypoints, which keeps the simulation resumable from JSON alone and lets the page animate walking along the lanes between snapshots. Where open ground is clearly shorter, residents cut across it. Twelve crossings between the same two places wear a path into the map.

The map changes rarely and is larger than a resident record, so it has its own table and revision. The world row carries the current revision. The server holds one copy per process and reloads it when the revisions differ. The page fetches `/api/map` only when the revision in the snapshot changes.

### 8. The village grows from what residents ask for

New buildings should have a reason a visitor can read in the chronicle. Each resident derives concerns from their own circumstances: a lodger wants a cottage, a farmer knows how many mouths the fields can feed, the wellkeeper knows how far one well stretches. A concern is voiced in an ordinary conversation, which needs the two residents to be in the same place. The listener agrees or not, depending on shared need, friendship and temperament. A proposal with enough voices calls a moot at the hall that evening. Residents who attend vote, and an agreed work becomes a staked site on a lot chosen for its purpose. Building takes shifts of labour and bundles of wood from the common stores, with a limit on how many can work a site at once.

The loop that drives it: a village with bread on the table, land to feed one more and room at the hall draws a traveller off the road. They take up the trade the village is shortest of and lodge at the hall, which starts the case for a cottage. More residents strain the fields, bins, well and oven in turn. When the lots near the green are taken, the residents stake out a new lane. Arrivals slow as the village grows and stop at 36 residents.

The rules live in `engine/civic.mjs`, `engine/people.mjs` and `engine/sites.mjs`. They use the village's own seeded random state, so a stored village replays identically. Model planning does not take part in these decisions yet. A model arguing a case or casting a vote at the moot is a natural next step, and the proposal and moot records are shaped to allow it.

### 9. Two views draw the same stored map

The plan view in `public/map.js` draws the map in ink on parchment, in the manner of Watabou's village generator. The walking view in `public/view3d.js` raises the same footprints into low-poly buildings with three.js and follows the selected resident at eye level. Neither view holds layout of its own, so anything the village builds appears in both. A site shows as stakes, then a frame, then the finished building.

three.js is an npm dependency served from `/vendor/`, so the page loads nothing from another host. The typefaces (IM Fell English and Alegreya, from the `@fontsource` packages) are served the same way.

Both views follow the village clock. The map takes a night wash with lit windows, and the walking view has a sky, sun, moon and stars. A hearth with someone at it smokes in both. A resident at home is indoors and not drawn: their window and chimney stand in for them. `public/ambient.js` holds the rules the two views share. The engine modules are served to the browser unchanged. `/atlas.html` uses them to found a village from any seed in the page and run it forward by days, which is the quickest way to judge the look of a grown village without waiting for one or touching a database.

In the live observatory, Map and Walk follow the same selected resident and published clock. A waiting resident shows their finished activity and the village time they entered the decision queue. Movement follows recorded positions and the time until the next tick. Pausing holds both the displayed village and its map revision. The Atlas uses browser-local rules and spends no model tokens.

### 10. The village keeps a calendar

A count of days ("Day 3") told a visitor how long the server had been running, not when the village is. The clock is still a count of village minutes, and `engine/calendar.mjs` turns it into a date. Dalecrest was founded on Tuesday, 1 August 1312, the start of harvest, and each village day is the next day of the Julian calendar that England kept, with its real weekdays and leap years. The founding date is one constant. Nothing is stored, so an existing village simply gains its dates. The page shows the date on the clock, in chronicle headings and wherever a past moment is mentioned. Seasons do not exist yet. When they do, they follow this calendar.

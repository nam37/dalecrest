# Dalecrest

Dalecrest is a medieval village you can watch in a browser. Its residents work, share food, form friendships, and remember encounters. Each has a persistent record in PostgreSQL. In the hosted village, gpt-6-luna chooses among feasible actions. Residents can repeat a routine under a still-valid choice the model made earlier. [Watch the live village](https://dalecrest.trinsicstudios.com/).

## Run a village

On Windows, install Node.js 22.14 or later and run this command from the repository in PowerShell.

```powershell
.\tools\start-village.ps1
```

The launcher installs the dependencies and prepares a dedicated local PostgreSQL cluster on first use. Open the [local observatory](http://127.0.0.1:4173/). Keep the server running for time to advance. Closing the browser or pausing its view leaves the simulation running. Keep the private `.env` and `.local/database` to resume the village after a restart.

To use an existing PostgreSQL server, set `DATABASE_URL` in the environment or a project-local `.env`. The database must exist, and the application role must be able to create and manage the `dalecrest` schema. Then run `npm ci` and `npm start`. A new database starts with eight founders. The hosted village welcomes newcomers into the two hall beds until it reaches ten residents. Existing households and their history carry forward.

## Enable model planning

Local rules work as soon as the village starts. To enable Luna, set `PLANNER_PROVIDER=openai` and `OPENAI_API_KEY` in the server environment and restart the server. Luna is asked whenever a resident has a real choice to make. Routine, such as a night's sleep, follows a choice Luna made earlier. Residents can use up to 48,000 decision tokens per rolling real hour. Robin’s reporting allowance is 60,000, within the same village-wide ceiling of 480,000. Set `OPENAI_ACTION_TOKENS_PER_HOUR` to lower the shared allowance. At $0.10 per million uncached input tokens on the Decisions API, sustained use of the full allowance costs about $35.71 in 31 days. Village time advances at `VILLAGE_SECONDS_PER_MINUTE` real seconds per village minute, 30 by default with Luna enabled, whether or not replies arrive. A resident whose choice has not arrived waits where they are. To use a local Ollama installation, set `PLANNER_PROVIDER=ollama`, `OLLAMA_MODEL`, and `OLLAMA_BASE_URL`.

## Read the Dalecrest Daily

Robin Marsh works as the village journalist. Follow him on the map or choose **Robin’s notebook** in the Chronicle to read his eyewitness notes. At 06:00 each village morning the press prepares an edition covering the preceding calendar day. Open **Dalecrest Daily** in the header to read the lead story, village briefs and **Since yesterday**. The dateline links to that edition, and the numbered references open its source records.

Set `CLAUDE_KEY` in the server environment to enable the editor. It uses Claude Sonnet 5.5 by default. `DALECREST_DAILY_MODEL` can select another Claude model that supports structured output. Publication has its own model call, separate from resident decision allowances. An existing village starts with the latest eligible edition. A delayed edition stays queued across restarts. The hosted app needs these environment values in its installed Compose configuration. On the server, `deploy/dalecrest-set-claude-key` stores the key and restarts the app, as `deploy/dalecrest-set-openai-key` does for Luna. Preview and stand-in villages leave the editor offline.

## Watch it grow

The village map is generated from a seed and then belongs to the village. Residents raise concerns in conversation, settle them at a moot in the hall, and build what was agreed: cottages for newcomers, fields, a granary, wells, a bakehouse, an alehouse, and new lanes when the old ones fill up. The Village page shows the map, the works in progress and the proposals under discussion. Choose **Walk** above the map to follow the selected resident through the village in 3D.

Open the Sandbox at `/atlas.html` on a running server to found a village from any seed in the browser and advance it by days. Set `VILLAGE_SEED` before the first start to choose the seed of a new database.

Open the **Help request archive** from the chronicle, or **Request history** from a resident's panel. Each delivered request has a permanent link with its terms, deadline and recorded events. Follow it in your browser to see what changed on your next visit. [Live request archive](https://dalecrest.trinsicstudios.com/requests.html)

To try a change without touching your village, run a preview against a separate database on port 4174.

```powershell
node --env-file=.env tools/preview-village.mjs
```

`node tools/simulate.mjs 60` runs sixty village days without a database and prints what was decided and built.

To watch the model-driven path without spending tokens, run a village whose decisions are answered by a script. It uses its own database and port 4175, and contacts no model.

```powershell
node --env-file=.env tools/standin-village.mjs
```

The village keeps a calendar and has weather. In cold weather every hearth burns firewood from the common store, so a hard winter can leave houses cold and the oven without fuel. To see winter without waiting for it, run a preview village that wakes on 1 January. It uses its own database and port 4176.

```powershell
node --env-file=.env tools/winter-village.mjs
```

`node --env-file=.env tools/pilot-report.mjs` reports how activities began, how long residents waited and what was spent, for whichever village `DATABASE_URL` names.

## Explore the project

- [Roadmap](docs/roadmap.md) is the canonical plan. It reviews the village as it runs today and sets out the stages ahead, beginning with the Mabel–Oswin promise pilot.
- [Resident knowledge graph](docs/knowledge-graph.md) is the accepted architecture for how residents form goals, choose actions, and learn from the results.
- [Give Dalecrest residents something worth following](docs/proposal-village-life.md) is design background: the proposal that argued for the promise pilot. Where it differs from the roadmap, the roadmap governs.
- [Design decisions](docs/design.md) explains the village clock, resident records, model-selected activities, the generated map, village growth, and deployment.
- [Trace a villager’s decision](docs/decision-tracing.md) shows how to read the exact Luna request, full reply, confidence, and subsequent actions in PostgreSQL.
- [Deployment files](deploy/) describe the private PostgreSQL service, HTTPS routing, backup, health check, and GitHub auto-deploy.

Run `npm test` for the simulation and planner tests. To include the PostgreSQL integration tests, set `DALECREST_TEST_ADMIN_URL` to a development PostgreSQL connection with permission to create databases. The test creates and drops its own uniquely named database and uses a recorded fixture for the model reply.

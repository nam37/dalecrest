# Dalecrest

Dalecrest is a medieval village you can watch in a browser. Its residents work, share food, form friendships, and remember encounters. Each has a persistent record in PostgreSQL. In the hosted village, gpt-6-luna chooses the next activity for each resident from actions they can actually take. [Watch the live village](https://dalecrest.trinsicstudios.com/).

## Run a village

On Windows, install Node.js 22.14 or later and run this command from the repository in PowerShell.

```powershell
.\tools\start-village.ps1
```

The launcher installs the dependencies and prepares a dedicated local PostgreSQL cluster on first use. Open the [local observatory](http://127.0.0.1:4173/). Keep the server running for time to advance. Closing the browser or pausing its view leaves the simulation running. Keep the private `.env` and `.local/database` to resume the village after a restart.

To use an existing PostgreSQL server, set `DATABASE_URL` in the environment or a project-local `.env`. The database must exist, and the application role must be able to create and manage the `dalecrest` schema. Then run `npm ci` and `npm start`. A new database starts with eight residents.

## Enable model planning

Local rules work as soon as the village starts. To enable Luna, set `PLANNER_PROVIDER=openai` and `OPENAI_API_KEY` in the server environment and restart the server. Each completed activity queues a decision. Requests share a rolling budget of 7,000 tokens per real hour by default, configurable with `OPENAI_ACTION_TOKENS_PER_HOUR`. Residents wait for Luna if the budget or provider is unavailable. To use a local Ollama installation, set `PLANNER_PROVIDER=ollama`, `OLLAMA_MODEL`, and `OLLAMA_BASE_URL`.

## Watch it grow

The village map is generated from a seed and then belongs to the village. Residents raise concerns in conversation, settle them at a moot in the hall, and build what was agreed: cottages for newcomers, fields, a granary, wells, a bakehouse, an alehouse, and new lanes when the old ones fill up. The Village page shows the map, the works in progress and the proposals under discussion. Choose **Walk** above the map to follow the selected resident through the village in 3D.

Open `/atlas.html` on a running server to found a village from any seed in the browser and advance it by days. Set `VILLAGE_SEED` before the first start to choose the seed of a new database.

To try a change without touching your village, run a preview against a separate database on port 4174.

```powershell
node --env-file=.env tools/preview-village.mjs
```

`node tools/simulate.mjs 60` runs sixty village days without a database and prints what was decided and built.

## Explore the project

- [Roadmap](docs/roadmap.md) is the canonical plan. It reviews the village as it runs today and sets out the stages ahead, beginning with the Mabel–Oswin promise pilot.
- [Resident knowledge graph](docs/knowledge-graph.md) is the accepted architecture for how residents form goals, choose actions, and learn from the results.
- [Give Dalecrest residents something worth following](docs/proposal-village-life.md) is design background: the proposal that argued for the promise pilot. Where it differs from the roadmap, the roadmap governs.
- [Design decisions](docs/design.md) explains the village clock, resident records, model-selected activities, the generated map, village growth, and deployment.
- [Trace a villager’s decision](docs/decision-tracing.md) shows how to read the exact Luna request, full reply, confidence, and subsequent actions in PostgreSQL.
- [Deployment files](deploy/) describe the private PostgreSQL service, HTTPS routing, backup, health check, and GitHub auto-deploy.

Run `npm test` for the simulation and planner tests. To include the PostgreSQL integration tests, set `DALECREST_TEST_ADMIN_URL` to a development PostgreSQL connection with permission to create databases. The test creates and drops its own uniquely named database and uses a recorded fixture for the model reply.

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

## Explore the project

- [Design decisions](docs/design.md) explains the village clock, resident records, model-selected activities, and deployment.
- [Trace a villager’s decision](docs/decision-tracing.md) shows how to read the exact Luna request, full reply, confidence, and subsequent actions in PostgreSQL.
- [Deployment files](deploy/) describe the private PostgreSQL service, HTTPS routing, backup, health check, and GitHub auto-deploy.

Run `npm test` for the simulation and planner tests. To include the PostgreSQL integration test, set `DALECREST_TEST_ADMIN_URL` to a development PostgreSQL connection with permission to create databases. The test creates and drops its own uniquely named database and uses a recorded fixture for the model reply.

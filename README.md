# Dalecrest

A browser observatory for eight autonomous villagers. Select a resident to see their activity, the reason for their choice, their memories, and their PostgreSQL record. The Chronicle shows the latest 100 events. Pausing the view freezes that browser’s snapshot while the village keeps running on the server.

## Run on Windows

With Node.js 22.14 or later installed, run this in PowerShell from the project directory, then open [the village](http://127.0.0.1:4173/).

```powershell
.\tools\start-village.ps1
```

On first launch the script installs Node dependencies, prepares a dedicated PostgreSQL cluster, and generates local database credentials. A new database starts with eight residents. Later launches resume the same village. The web server runs in that terminal, so you can close the browser while the simulation continues. Keep `.local/database` and the project’s private `.env` across restarts.

## How a villager makes a decision

The engine scores available activities using the resident’s weighted desires, needs, temperament, friendships, memories, and local model intention. A job consumes and produces goods. An encounter requires physical proximity and can change both residents’ memories and their relationship. Model intentions are generated asynchronously from that resident’s record and the village stores. The model selects one of four priorities (work, social contact, rest, or food) and explains why. The simulation checks prerequisites and applies each consequence.

To enable model planning, install a model in Ollama and add `OLLAMA_MODEL` and `OLLAMA_BASE_URL` to the generated `.env`, preserving its database settings. For example, set `OLLAMA_MODEL=gemma4:12b` and `OLLAMA_BASE_URL=http://127.0.0.1:11434` for a standard local Ollama service. The Windows launcher can also start a dedicated Ollama listener when configured for `http://127.0.0.1:11435`. Restart the web server after changing these settings. If the model is unavailable, ordinary decisions continue and the planner retries.

## State and hosting

PostgreSQL stores one JSONB document per resident in `dalecrest.actors.state`, the shared clock and supplies in `dalecrest.world`, and the chronological history in `dalecrest.events`. A tick commits all three together. Initialization seeds a new database once. Subsequent starts load its existing residents.

```sql
SELECT id, state->'desires' AS desires, state->'action' AS activity,
       state->'plan' AS model_intention
FROM dalecrest.actors
ORDER BY ordinal;
```

For an existing PostgreSQL installation or VPS, use Node.js 22.14 or later, run `npm ci`, and set `DATABASE_URL` to the intended PostgreSQL database. Its application role needs permission to create and manage the `dalecrest` schema. Configure a server-accessible Ollama endpoint if desired, then run `npm start`. The HTTP listener defaults to loopback on port 4173. A hosted deployment can put it behind a reverse proxy. Moving an existing village requires restoring a PostgreSQL dump of its database.

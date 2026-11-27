# Engine and system upgrades, November 2026

Five upgrades were proposed on 27 November 2026 after measuring the live village. Upgrades 1, 2, 3 and 5 are built and live. Upgrade 4 is on the [roadmap](roadmap.md) under Stage 7C as a proposal. This page is context for anyone changing the code they touch.

The engine was already fast: one simulated minute takes about 0.2 ms. Almost all the cost was in moving data around it, so each upgrade is about data.

| Upgrade | State | Commit |
| --- | --- | --- |
| 1. Store residents in two parts | Live | `f9c161a` |
| 2. Send visitors less | Live | `f9c161a` |
| 3. Cut wasted planner calls | Live, one part left out | `f9c161a` |
| 4. Trim old history | Proposed, roadmap Stage 7C | — |
| 5. Report tick timing and table sizes | Built 27 November 2026 | the commit that adds this page |

## 1. Residents are stored in two parts

**Why.** Every tick read all 14 residents (about 400 KB) and wrote them all back, although a minute changes only needs, action and position. With a copy of the live village each tick wrote about 185 KB of database log.

**What changed.**
- `dalecrest.actors.state` holds only what changes minute to minute. Seven long lists live in `dalecrest.resident_parts(actor_id, part, value)`, one row per resident and list: `memories`, `goalHistory`, `observations`, `instructions`, `reports`, `goalBook` and `requestMemories` (`RESIDENT_PARTS` in [resident-store.mjs](../resident-store.mjs)).
- A part is written only when its JSON text has changed since it was read. A `WeakMap` remembers what each part held when the resident was read.
- Every read and write of a resident goes through `resident-store.mjs`: `readResidents`, `readResident(db, id, { where })`, `writeResident`, `writeResidentParts`, `hotState` and `residentJson` for SQL.
- `snapshot({ parts })` in `db.mjs` names which lists to include. Without `parts` it includes every one.
- No migration step. `residentJson` merges the parts under `state`, so a record written whole by an older release still reads correctly, and it is split on its next write.

**Measured.** With a copy of the live village each tick now writes about 74 KB of log instead of 185 KB, and the residents' table grows about a fifth as fast.

**Rules for new code.**
- Never `SELECT state FROM dalecrest.actors` and expect the long lists in it. Use `readResident` or `readResidents`.
- Never write a resident with a plain `UPDATE ... SET state=`. Use `writeResident`, or the lists are lost from the stored record.
- A new list that grows over time belongs in `RESIDENT_PARTS`.

**Rollback caveat.** A release from before `f9c161a` reads `actors.state` alone and finds no memories in a split record. To go back that far, restore the database dump the deploy script takes just before each release.

## 2. Visitors are sent less

**Why.** The first page load sent 484 KB. Every visitor got all 60 memories of every resident, the full goal history, and the planner's instructions and observations. One update re-sent a resident's whole memory list for a single new memory.

**What changed.**
- [village-feed.mjs](../village-feed.mjs) makes the public copy. `publicResident` keeps the last 4 memories and the last 2 settled goals, and drops `observations`, `instructions`, `reports` and `requestMemories`. `publicVillage` drops `mootHistory` and `told` from the world. The page reads the moot history from the affairs summary.
- `server.mjs` builds the feed with `snapshot({ withMap: true, parts: FEED_PARTS })`, so the database does not even read the private lists.
- `GET /api/residents/<id>/record` returns one resident's whole record. The Data tab in `public/app.js` fetches it while that tab is open and refreshes it when it is 5 village minutes old.
- The page's own files are served with `Cache-Control: no-cache` and an ETag, so an unchanged script costs a 304 instead of a download. `heldTags` tolerates the `-gzip` and `-zstd` suffixes Caddy adds when it compresses.

**Measured live.** The first load fell from 484 KB to 155 KB, and resident records from 390 KB to 74 KB. `map.js` revalidates with a 304 through Caddy.

**Rules for new code.** A new private resident field belongs in `PRIVATE` in `village-feed.mjs`. A new list the page shows belongs in `FEED_PARTS`.

## 3. Fewer planner calls

**Why.** In one live day 183 fresh decisions were made because a standing instruction would have run into the moot, and 183 because a reply could not start.

**What changed.**
- `engine/standing.mjs` `consider()` no longer sends a routine back to the model because the moot is near. It asks again only when the menu actually offers the meeting and this resident has not yet chosen with this moot on offer. `startChosen` in `sim.mjs` sets `actor.mootWeighed = world.moot.at` when it starts a choice made with the meeting on the menu. The call 35 minutes before the moot still stops whoever is busy.
- `sameOffer` in `action-turns.mjs`: a reply whose activity is still offered, but for a different number of minutes, now starts instead of being sent back.
- The request to the planner states when the moot meets (`mootMeets` in `decisions.mjs`).

**Measured.** In an offline replay of the live village where some residents skip the moot, moot re-asks fell from 62 to 18 and fresh choices by about 9%, with the same ballots cast. How often a reply was refused only for its minutes cannot be measured live yet.

**Left out.** Discouraging repeat socialising (214 of 459 social activities in a day were followed by more socialising). Whom to visit is meant to stay the model's choice, and a prompt change could not be tested offline.

## 4. Trim old history (proposed)

Nothing is deleted today. `decision_traces` keeps the full request and reply text of every planner call. `decision_steps`, `activity_log`, `resident_presence` and `events` gain rows with every tick, and `map_revisions` keeps a whole copy of the map for each revision.

The proposal is a nightly job that:
- drops request and reply text after about two weeks and keeps the parsed decision;
- rolls presence up by day;
- splits events by month;
- keeps map revisions as changes.

Stage 6 wants an archive of every day, so what must be kept whole is decided first. The table sizes from upgrade 5 are the before-and-after measure. The roadmap carries it as an unticked item under Stage 7C and a note on future consideration 3.

## 5. Tick timing and table sizes in the health report

**Why.** The health report showed only how late the clock was. Nothing said which part of a tick was slow or which table was growing.

**What changed.**
- [tick-telemetry.mjs](../tick-telemetry.mjs) adds two tables:
  - `dalecrest.tick_timings(hour, phase, ticks, total_ms, max_ms)` has one row per real hour and phase, so it stays small however fast the clock runs.
  - `dalecrest.table_sizes(measured_at, name, bytes, row_estimate)` holds an hourly sample of every table in the schema, plus `(database)` for the database size and `(log written)` for the write-ahead log position.
- `tick()` in `db.mjs` marks the end of each phase:
  - `read`, `step`, `events`, `knowledge` (goals and observations), `residents`, `map` (only when the map changed), `presence`, `records` (editions, decision steps, activities, song drafts), `clock`, and `total`.
  - `advance()` times the commit and the size sample after they happen, and the next tick records them as `commit` and `sizes`.
  - The size sample runs after the commit because it took about 0.7 s locally, and it must never hold the clock.
  - Timings are kept 30 days and samples 35.
- `admin-health.mjs` adds `ticks` and `storage` to village health:
  - `ticks.lastTwoHours` and `ticks.lastDay` give counts, the mean and worst milliseconds overall, and the same per phase.
  - `storage` gives the latest sample with each table's size, estimated rows and growth per day against the oldest sample in the last week, plus `databaseGrowthPerDay` and `logWrittenPerDay`.
  - Growth reads `null` until two samples are an hour apart.
  - Both fields reach agents through `GET /admin/api/agent` with the next deploy.
- The admin panel gains Tick time and Storage cards (`admin-ui/`). The automatic deploy does not carry the panel's files: copy `admin-ui/` to `/opt/dalecrest-admin/` and restart the admin service to see them.

**Measured locally.** On a copy of the live village, a tick took 55 ms on average and 98 ms at worst. Reading the world and residents took 31 ms of that and writing residents 15 ms. The engine step took 2 ms.

## Tests

- `resident-store.test.mjs` covers the feed projection, `sameOffer`, `hotState`, and in PostgreSQL that parts are written only when changed and that records written whole are split.
- `standing.test.mjs` covers the moot rule.
- `tick-telemetry.test.mjs` covers the timer, the hourly record, size samples, growth, pruning and the health report.
- Run everything against the local PostgreSQL before pushing tick SQL (see the README for `DALECREST_TEST_ADMIN_URL`).

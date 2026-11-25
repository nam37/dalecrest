# Dalecrest roadmap

**Canonical plan · 21 November 2026.** This document is the one plan for moving Dalecrest from a small simulated village to one people want to watch, follow and take part in. It describes work to be done. Nothing here is implemented or deployed by being written down.

- The accepted architecture is the [resident knowledge graph](knowledge-graph.md). Where this plan and that document differ, the knowledge graph governs and this plan is wrong.
- [Design decisions](design.md) describes the village as it runs today.
- [Give Dalecrest residents something worth following](proposal-village-life.md) is design background. It argued for the promise pilot that is now the first milestone, and its reasoning is worth reading. Its stage list is superseded by this one.
- The [illustrated edition](roadmap.html) is a rendering of this plan with the same marks. This document governs.

## State of the plan

**Marked off · 21 November 2026**, against the request archive (`996c2c1`) and resident cards (`836bec3`). Stages 3 and 5 were counted again later that day, after hunting and fishing (`b6dc917`), chronicle notes in the walking view (`563e95d`) and the director. Stages 2 and 3 were counted again on 22 November 2026, when each was built. A ticked box means built, tested and merged. It does not mean measured in the live village: each stage's "Done when" is a separate test, and none has been met. An unticked box is labelled under way or not begun.

| Stage | State | Done | Under way | Not begun |
| --- | --- | ---: | ---: | ---: |
| 0. Liveness and meaningful choices | Built, awaiting the pilot week | 5 | 2 | 0 |
| 1. The promise pilot | In hand | 7 | 1 | 0 |
| 2. Goals and memory | Built, live reviews to be read | 6 | 0 | 0 |
| 3. A village with stakes | Built, awaiting the live measure | 7 | 0 | 0 |
| 3a. The common store | Built, awaiting the live measure | 6 | 1 | 0 |
| 3b. A menu worth choosing from | Built, awaiting the live measure and wording pass | 5 | 0 | 1 |
| 3c. Families and village lessons | Built, awaiting live arrivals | 4 | 1 | 0 |
| 3d. What feeds the village | Built, awaiting live measures | 5 | 0 | 0 |
| 4. Voices: competing interests and the moot | Built, awaiting a live moot | 5 | 0 | 0 |
| 4a. Lead characters | Proposed, Robin first | 0 | 0 | 7 |
| 5. Worth watching | In hand | 8 | 0 | 0 |
| 6. Worth following | In hand | 1 | 1 | 2 |
| 6a. Admin control panel | First release on the live site | 4 | 1 | 4 |
| 7. A living village culture (A–C) | Clock built, live trial pending | 3 | 0 | 7 |
| 8. The world comes to Dalecrest (A–C) | Proposed, not begun | 0 | 0 | 9 |
| 9. Taking part | Groundwork only | 0 | 1 | 4 |
| 10. A wider world | Not begun | 0 | 0 | 1 |
| All stages | | 66 | 8 | 35 |

**Reading the live village.** `readout.mjs` reads every "Done when" measure the database can answer, stage by stage, and marks it met, not met, no data or needing a viewer. On the server: `docker exec dalecrest-app node readout.mjs`, for the last 168 real hours by default. It does not replace `tools/pilot-report.mjs`, which breaks Stage 0 down further.

Stage 3a was added on 22 November 2026 and built the same day. It is numbered to sit after the stage it builds on without renumbering the stages that follow. Stage 3b was added the same day as a proposal, from the first live readout.

The merge passed all 59 tests on 21 November, including eight tests with disposable PostgreSQL databases. With the director the suite has 78 tests. Nine of them need a PostgreSQL database and were not run for that change. The other 69 passed.

## The roles this plan keeps

Three responsibilities are fixed. Every stage below is written to preserve them.

| Role | Responsibility |
| --- | --- |
| A general-purpose model | Sets and revises each resident's persistent goals. |
| The Decisions API | Chooses a meaningful, feasible action in light of those goals, the resident's needs and what the resident knows. |
| The simulation | Executes the chosen action, establishes what actually happened and records it. |

The providers behind the two model roles can change without changing who is responsible for what. The current choices are recorded in [design decision 6](design.md).

## Measurements before Stage 0

Each figure is marked with where it came from. "Local rules" means the scoring in `choose` in `sim.mjs`, which runs in tests, the Sandbox and the preview. It is a stand-in for measurement, not the production decider. The mix of activities the Decisions API chooses in production has not been measured.

| What | Value | Source |
| --- | --- | --- |
| Activities a resident starts per village day | 23.2 to 23.3. About 184 a day for eight residents. | Measured, local rules, 60 days on seeds 26111, 26112 and 26113 |
| What those 23 are | Leisure 11.8, sleep 4.9, visiting 2.2, own trade 1.9, meals 1.4, other work and building 0.7, moot 0.3 | Measured, same runs, founding residents |
| Activities that repeat the one before, in the same place | 55% | Measured, same runs |
| Separate choices that make up one night's sleep | 4.9 | Measured, same runs |
| Tokens per action request | 589 | Historical production observation used in the original cost estimate |
| Action budget | 7,000 tokens per real hour in the original eight-person pilot, about 168,000 a real day | Historical configuration |
| Previous clock | 49 seconds until the next tick, which advanced one village minute. The planner reported "waiting for token budget". | One public snapshot before the fixed-clock release on 21 November 2026 |
| Wood store | Never below 10 of 32. Never below 20 while a building site was open. No minute with flour and no wood. | Measured, local rules, same runs |
| Daytime | 56% idling, 17% at a trade, 10% walking, 8% visiting | Measured, local rules, seed 26111 |
| The chronicle | 49 entries a day. One sentence, "took a loaf from the common oven", is 35% of them. Moots, building and arrivals are 4%. | Measured, local rules, seed 26111 |
| Memory given to the action model | The two latest memory texts. Changing an older promise or a relationship score leaves the request byte-for-byte identical. | Checked against `decisions.mjs` in the background proposal |

Walking to a worksite and doing the job there already count as one activity. The 23 a day cannot be reduced by merging the walk into the work.

Three conclusions shape the plan.

1. [x] **The former clock slowed when money for calls ran short.** Stage 0 moved timekeeping off the decision queue. *Done: the clock runs at a fixed pace whatever the models are doing.*
2. [x] **Many activities repeat.** One night's sleep spanned about five boundaries in the local runs. Stage 0 lets a still-valid model instruction cover routine repeats. *Done: standing instructions, in `engine/standing.mjs`.*
3. [x] **Promises need durable records.** The archive retains the terms, deadline and recorded ending. Each participant remembers the outcome they learned, and their three most recent request memories can inform the next decision.

## Review: how the residents think

Stage numbers refer to the plan below. A box is ticked once the fault it describes has been mended.

1. [x] **Clock and queue.** Stage 0 made the village clock independent of model latency. A resident can wait while others continue.
2. [x] **Routine decisions.** Stage 0 lets a resident continue sleeping under a valid earlier instruction. The activity log records the original model choice.
3. [x] **The action model is shown too little.** `actionBody` in `decisions.mjs` sends needs, stores, two memories and a menu. It leaves out relationships, open obligations and what the resident has learned. (Stages 1 and 2) *Done: the request carries the resident's goals as they now stand, recalled memories with their dates, open requests with the warmth and trust between the two, the household, their own life, cold and the weather.*
4. [x] **Place names.** Stage 0 added readable place names to option descriptions. Choice IDs still identify the exact action.
5. [ ] **Moot attendance.** A scripted test exercises quorum and construction on the model-driven path. How often real residents choose to attend remains a pilot measurement. [Standing-instruction tests](../standing.test.mjs) *Under way: the test is in. The live measurement is not.*
6. [x] **Memory is a short list of sentences.** `remember` in `engine/civic.mjs` keeps 18 strings with no source, importance or recall. (Stages 1 and 2) *Done: memories carry a source, importance and place, a resident keeps sixty, recall is scored, and every memory is stored in PostgreSQL.*
7. [ ] **Everyone knows everything.** The menu and the request use the true stores and every resident's true destination. "Bake" disappears from a menu the moment someone far away uses the last wood. (Stage 1) *Under way: flour and firewood are known only from an oven inspection or from being told. Barley and water are seen on depositing. Other knowledge is still shared by all.*
8. [x] **Residents cannot ask, agree, decline or vote.** The original encounters used templates and the moot assigned votes. Residents now choose social replies, public positions and individual ballots. The grain shortage is measured in days of food. (Stages 1, 3 and 4)
9. [x] **Relationships are one number that only rises.** After 60 days, 19 of 122 are at the maximum. (Stages 2 and 3) *Done: warmth and trust are separate, both fall, and warmth fades and fills more slowly near the top.*
10. [x] **People only arrive, and the economy has no pressure.** Nobody is born, grows old, falls ill or leaves. One harvest shift feeds the founding village for a day. (Stage 3) *Done: the harvest is seasonal and a winter has to be stored for, and residents are born, fall ill, marry and leave.*

What is already right and should be kept: the simulation is deterministic and replays from JSON; every model exchange is recorded before it is applied; the engine checks a chosen action again before starting it; and the map is data the village owns.

## Review: how it looks

The map and the walking view are sound and draw the same data. What is missing is legibility and life.

- [ ] Nothing marks that something is happening. A request, a moot and a building site look like an empty lane. *Under way: a resident who is deciding carries a question mark on the map and rests a hand on the chin in the walking view, and a site shows as stakes, then a frame. A note marks where each recent chronicle entry happened, in both views, and the director takes a watcher there. A request or a moot in progress still has no mark of its own.*
- [x] Every trade is the same arm movement, and a resting resident stands outside their door. *Both views draw the tools and motions of the work. Smoke and lit windows show where a hearth is in use.*
- [ ] A selected resident is not in the URL, a fresh page always starts with Agnes, and only the latest 100 chronicle entries can be reached. *Under way: the selected resident is in the address, so a link or a refresh keeps them. A bare address now opens on the director’s watch. The chronicle still stops at 100.*
- [x] There is no season, weather, sound or change with the hour on the map. *Both views show the weather and the hour. The Sound toggle brings in the river, weather, animals and nearby work.*
- [x] The walking view can only follow. It rebuilds the whole scene whenever the map changes. *A visitor can look around, follow a resident, or hold on a chronicle entry. Map revisions update the affected scenery while the camera and residents stay in place.*
- [x] The page fetches every resident's whole record every 2.5 seconds. *The server streams a snapshot when a viewer connects and sends changed fields and entries after that.*

## Principles

1. **The clock does not wait for a model.** Village time advances on its own schedule. Budget and latency limit how fresh a resident's decisions are, never how fast time passes.
2. **Models decide. The engine establishes what is true.** A goal, a choice and a ballot come from a model. Whether the action could start, what it changed and who saw it come from the engine.
3. **Ask a model when there is a choice to make.** Routine follows an instruction a model already gave. A real tradeoff gets a fresh decision.
4. **Keep three kinds of knowledge apart.** What the world holds, what each resident knows and what the chronicle can verify are different records, and the plan never lets one stand in for another.
5. **Record how each activity came about.** Fresh choice, standing instruction or a wait. A viewer and an operator can both tell which.
6. **Pressure before complexity.** A mind needs something to weigh. Add one real need and prove a story on it before adding systems.
7. **Everything notable has an address.** A resident, a promise, an event and a day can each be linked to and returned to.

## The stages

Stages 0 and 1 together are the first milestone, the promise pilot. Sizes are relative: S is days of work, M is one to two weeks, L is longer.

### Stage 0. Liveness and meaningful choices (M)

**Status · 21 November 2026.** The VPS deployed `19c3f47` from GitHub main at 15:35 EST. The timer was active and the app and PostgreSQL passed their health checks. The full-week live measurements are pending. In a scripted stand-in run, 31% of activity boundaries needed a fresh choice, about seven per resident per village day. [Clock and activity logging](design.md) · [Deployed commit](https://github.com/nam37/dalecrest/commit/19c3f47dea22bb374903dfae83c6c145562b590c)

**Marked off · 21 November 2026.**

- [x] **A clock that advances independently.** Done. Commit `19c3f47`, tested by "village time passes when no decision ever arrives".
- [x] **Standing instructions.** Done. An instruction keeps its routine, action, exchange, goals and lapse. Anything touching a request for help is always a fresh choice, so no commitment is stored on it.
- [ ] **When a fresh decision is needed.** Under way. The engine checks time needed for an accepted work request and an approaching moot. Personal appointments such as the breakfast example remain a design proposal.
- [x] **What happens when things go wrong.** Done. Each row of the table has a test in `standing.test.mjs` or `work-outcomes.test.mjs`.
- [x] **Record the basis of every activity.** Done. `dalecrest.activity_log`, reported by `tools/pilot-report.mjs`.
- [ ] **Pilot parameters.** Under way. Starting values are set. None has been tuned against a pilot week.
- [x] **Covered in Stage 0.** Done.
- **Done when:** not yet met. The pilot week has not been measured.

The clock advances independently. A routine follows a valid standing instruction from an earlier model choice. When no instruction fits, the resident waits for a fresh decision. The thresholds remain pilot parameters.

**A clock that advances independently.** Action requests run alongside the village clock. In OpenAI mode the default pace is 30 real seconds per village minute, or two village days per real day. The pilot will measure how that pace feels to viewers.

**Standing instructions.** A standing instruction is a past model choice that the engine may repeat while the situation it answered still holds. It records:

- the routine it covers, such as sleeping at night, a morning meal or the next shift at the resident's trade
- the action chosen, and the exchange that chose it
- the goal versions and open commitments in force when it was chosen
- when it lapses

**When a fresh decision is needed.** The engine requests one when any of these holds at an activity boundary:

- no standing instruction covers the situation
- the instruction has lapsed, or the goals or commitments it was chosen under have changed
- the resident has learned something consequential since, such as a request, a shortage seen or a promise broken
- following the instruction would cost the resident something they have a stake in, such as missing a commitment that falls due
- two needs are urgent at once
- the instructed action can no longer be started

Breakfast shows the difference. Alice's morning meal is routine and follows her standing instruction. On the morning she has promised to meet Edith at the well, the engine can see that eating first would run past the hour she promised. That is a tradeoff, so the same breakfast is put to the Decisions API as a choice, with the promise in view.

**What happens when things go wrong.**

| Situation | What the resident does | What is recorded |
| --- | --- | --- |
| A fresh decision is needed and the reply arrives in time | Starts the chosen action if the engine finds it still feasible | Fresh choice, with the exchange |
| The reply is late, or the request is queued behind the budget | Waits where they are. Needs keep rising and the wait is visible. If a valid instruction comes to cover the moment, such as nightfall, they follow it and the pending request is withdrawn. | A wait with its cause and length, then whatever ended it |
| The reply arrives after the resident has moved on or the situation has changed | Nothing. The reply is kept and marked superseded. | The exchange, its cost and that it was not applied |
| A standing instruction becomes stale | It is never followed. A fresh decision is requested. | The instruction's end and the reason |
| No instruction applies | A fresh decision is requested, and the resident waits for it | A wait, as above |
| The chosen or instructed action cannot start | The obstacle is recorded and the next choice goes back to the model | The obstacle as an outcome the resident can remember |

A wait never stops the clock or anyone else. When the budget is short, pending requests are served by how soon a commitment falls due and then by how long the resident has waited.

**Record the basis of every activity.** Each activity a resident starts is stored with how it came about: a fresh choice and its exchange, a standing instruction and the exchange that set it, or the wait that preceded it. This is what the pilot measures and what a viewer is later shown.

**Pilot parameters.** These are starting values to be tuned, not decisions: the clock pace; how long each kind of instruction stays valid; how far ahead the engine looks for a commitment that a routine would run into; the need levels that count as urgent; how long a reply may take before the situation is treated as changed; and how long a resident waits before their request is moved up the queue.

**Covered in Stage 0.** The action model sees place names. Scripted tests exercise a moot reaching quorum, superseded replies and standing instructions through the same action-selection code used in production.

Done when: across a full pilot week the clock is never more than one tick late, including through a deliberate provider outage; no resident has followed a stale instruction; every activity has a recorded basis; and the share of boundaries that needed a fresh choice is known.

### Stage 1. The promise pilot (L)

Build one promise that can survive a night's sleep, and let a viewer find out how it ended.

**Implemented so far.** Residents can check the communal oven, share dated observations, ask a neighbour for supplies and choose how to answer. An accepted request offers a specific shift the resident can choose to keep their word. A requester who learns of a later count or delivery can keep the request open, withdraw it in person or decide later. An ordinary shift changes the stores and earns its worker credit for that work alone. [Trace a request and its reply](decision-tracing.md#trace-a-request-and-its-reply) · [Trace a reconsideration](decision-tracing.md#trace-a-reconsideration)

**Marked off · 21 November 2026.**

- [x] **Outcomes.** Done. Commit `b6d7b8d`, with `work-outcomes.test.mjs`.
- [x] **Observations.** Done. Commits `ee1a785` and `2725032`, with `oven-observation.test.mjs`.
- [x] **Requests and commitments.** Done. All seven statuses exist in `engine/exchanges.mjs`. A request asks for one shift's output within 24 village hours.
- [x] **Choices.** Done.
- [x] **Credit.** Done. Commit `45e3e16` added reconsidering and release. Tested in `social-turns.test.mjs`.
- [x] **A thread a viewer can follow.** The request archive is live. Both views show the work at the oven and coppice, and the firewood pile follows the recorded stock.
  - [x] A link to a resident
  - [x] A permanent link to each delivered request
  - [x] The resident panel shows open requests and their status, with a link to the recorded changes
  - [x] History by participant or commitment beyond the latest 100 entries
  - [x] A follow button kept in the browser, and "since your last visit"
  - [x] Mabel with a peel at the oven, Oswin working at the woodpile, in both views
  - [x] A stack that changes with the store
  - [x] An oven that is lit during a bake
- [ ] **First proof in a test village.** Under way. The scripted branches, the changed stock and the restart are covered by automated tests. A run with budgeted model turns is not on record.
- [x] **Second proof: one ordinary pressure.** Done. Winter fuel. Seed 26113 gives 15 mornings with flour and no firewood, held as a test in `seasons.test.mjs`.
- **Done when:** not yet met. Five of the ten acceptance tests have automated cover, two are partly in place and three await the pilot.

Mabel Ash needs wood for the oven. Oswin Holt cuts it. Mabel may ask Oswin for help, and he may accept, decline or leave it unanswered. An accepted promise can be kept, broken or released by Mabel. Each ending has a record a viewer can return to find.

Helpers reconsider standing routines when walking and working would put a promise at risk. At the deadline both parties keep personal memories. Mabel can learn later that Oswin kept his promise. Viewers can follow a permanent request link and read the recorded outcome from PostgreSQL, even after it leaves the chronicle. The four-of-five viewer trial below remains open. [Request archive](https://dalecrest.trinsicstudios.com/requests.html)

**Three kinds of knowledge, kept apart.**

| Record | What it holds | In the pilot |
| --- | --- | --- |
| The world | What is true and what happened, established by the engine | The wood and flour in the store, each shift's actual result, the request and reply as events |
| A resident's knowledge | What that resident observed or was told, with its source and the village minute they learned it | Mabel saw the oven had flour and no wood at a certain hour. Oswin, at the coppice, did not. |
| The chronicle | What a viewer can be shown as verified | That Mabel asked, what Oswin answered, and whether wood arrived from his own shift |

The chronicle states a reason only when a record supports it. An action chosen as "Cut wood for Mabel's request" names the commitment and can be credited to it. A plain "Cut wood" establishes the work and its result and nothing about why.

**What gets built.**

- **Outcomes.** For oven and woodcutting shifts, record the site, the participants, the actual change to the stores and any commitment the choice named, in the same transaction as the change. Record a fruitless or interrupted shift too.
- **Observations.** A resident's knowledge of the stores comes from being there or being told. Away from the oven, Mabel's menu offers "Go and check the oven", and the trip has an outcome even when there is no fuel. Once there, the engine offers the jobs she can actually start.
- **Requests and commitments.** The record identifies both residents, the terms, the due time and the event that began the request. Its statuses are asked, accepted, declined, unanswered, kept, broken and released.
- **Choices.** Asking, accepting and declining are actions on the menu, chosen by the Decisions API on the resident's own turn. The request to the action model includes the open commitment, the relevant observation and the standing with the other party.
- **Credit.** Oswin keeps a promise when his chosen shift names the agreement and adds the wood on time. Someone else's delivery may relieve the shortage. Mabel can release Oswin if she learns enough to change her mind. An accepted agreement still open at its deadline expires as broken.
- **A thread a viewer can follow.** A link to a resident and to a promise. The resident panel shows the open promise, its status and the last verified change. History can be read by participant or commitment beyond the latest 100 entries. A follow button kept in the browser, and "since your last visit". Mabel with a peel at the oven, Oswin working at the woodpile, a stack that changes with the store and an oven that is lit during a bake.

The pilot uses the residents' existing goals. Goal reviews arrive in Stage 2.

**First proof in a test village.** Give Mabel flour and no wood. Exercise agreement, fulfilment, refusal, expiry and a withdrawal after a third party supplies wood. Change the stock between choice and execution and restart the server before an activity completes. Run the same starting position with budgeted model turns to see how residents respond to the information they receive.

**Second proof: one ordinary pressure.** A staged shortage shows that the branches work. It does not show that the story will ever happen. In 60-day runs today the wood store never falls below 10, and never below 20 while a site is open. Choose one ordinary pressure, such as a building project that draws its timber when the footings are set instead of a bundle a shift, and test whether it produces a morning with flour and no wood without scripting. One pressure is enough for the pilot. Personal inventories, deliveries and prices wait until a second story needs them.

**Status · 21 November 2026.** Winter fuel is the chosen pressure. It was merged to `main` in `db81515` and is part of the release that went live at 6:25 p.m. Eastern that day. Hearths draw firewood from the common store on cold mornings, and in seeded runs under local rules a morning with flour and no wood arises unscripted, with a baker learning of it by going to look. Whether it changes what the Decisions API chooses is not yet measured. [Design decision 11](design.md)

Done when: the acceptance tests at the end of this document pass.

### Stage 2. Goals and memory (M)

Give each resident goals that persist and change for reasons, set by the general-purpose model.

**Marked off · 21 November 2026.**

- [x] **Two kinds of goal.** Done. Each goal is a version with an id, kept in `actor.goalBook` by `engine/goals.mjs`. A goal with a condition names one from a fixed vocabulary: a store level, a place reached, a number of finished shifts, each within so many hours, or an open request kept. The engine settles it met, missed or overtaken each minute and records why. A goal on evidence has no condition and may name the resident it concerns. The founding goals became goals on evidence.
- [x] **Goal reviews.** Done. A review is called when a goal is settled, when a resident learns something of importance 8 or more, or at seven in the morning after three days without one. Claude Haiku 5.5 reviews one resident at a time, from `goal-reviews.mjs`, under its own cap of 30,000 tokens a rolling hour. The engine checks each decision before applying it, and a goal about another resident changes only on cited evidence. Between reviews, and without a key, residents keep the goals they have. A changed goal ends the standing instructions chosen under the old one. Reviews do not yet set standing instructions.
- [x] **The chain in PostgreSQL.** Done. `dalecrest.observations` holds every memory, linked to its chronicle entry. `dalecrest.goal_reviews` holds each exchange as sent and received. `dalecrest.goal_versions` holds every version with the observations and evidence it rests on and the review that made it. Each action trace records the goal versions and memories its request was given. The view `dalecrest.goal_chain` reads the chain from an observation to the outcome and its witness in one query.
- [x] **Memory.** Done. Memories carry an id, an importance, a source, the place and the people involved. A resident keeps sixty and forgets the least memorable first. `recall` scores them by recency, importance and relevance to the people and place at hand, and the action request and goal reviews are given what it recalls. Every memory is stored in PostgreSQL. Recall is scored in the engine, not yet in SQL.
- [x] **Relationships with substance.** Done. Warmth and trust are kept apart, in `engine/bonds.mjs`. Warmth rises with company, rises less between people already close, and fades between residents who stop meeting. Trust grows a little with acquaintance and otherwise moves on requests as each resident learns of them: a promise made or kept raises it, and a refusal, an unanswered request or a promise with no word of completion lowers it. Each move is kept as evidence about that person.
- [x] **A resident's own words.** Done. A review may return one sentence in the resident's voice about its most important change. A sentence that is not one plain sentence, or that carries a link or markup, is not published. One that passes is recorded as an "In their words" chronicle entry, worded as what the resident said.
- **Done when:** Met in tests, 22 November 2026. `goals.test.mjs` settles a goal from the record with what settled it, refuses an uncited change to a goal about another resident, gives two residents different counts of the same oven, and keeps a goal through a day and a half of activities and a night. `goal-chain.test.mjs` takes one observation through a review, a choice and its outcome, and reads it back from `dalecrest.goal_chain`. Reviews in the live village start with this release and have not yet been read.

**Two kinds of goal.**

| | A goal the engine can verify | A goal only evidence can inform |
| --- | --- | --- |
| Example | "Four buckets in the barrels by dusk." | "Earn Edith's trust." |
| What it carries | A completion condition from a fixed vocabulary the engine can evaluate: a store level by a time, a commitment kept, a place reached, a work finished | No condition. A statement of what the resident wants and whom it concerns. |
| What the engine does | Marks it met, missed or overtaken, and records the outcome that settled it | Never declares it achieved. Records the evidence that bears on it: promises kept and broken between the two, and Edith's own responses, such as accepting or declining a request, a visit returned, a vote. |
| Who decides it is finished | The engine, from the record | The goal-setting model, which reads the evidence and keeps, revises or retires the goal |

**Goal reviews.** A review is triggered when a resident needs direction, when a goal is met or missed, or when they learn something consequential. Between reviews the last valid goals are reused, including when the goal-setting model is unavailable. Reviews have their own spending cap so they never take turns from action choices. A review may also set or renew standing instructions for the resident's routines.

**The chain in PostgreSQL.** Each link is stored, so an operator can follow a resident from a source event to an outcome without replaying the village.

1. An event in the world becomes an observation for each resident who saw or heard of it, with source and time.
2. A goal review reads observations and returns goal versions. Each version records its owner, its kind, its condition if it has one, the observations it rests on and the exchange that produced it.
3. An action exchange records the goal versions, commitments and observations it was given, the menu and the choice.
4. The outcome is linked to that choice.
5. The outcome becomes an observation for whoever witnessed it, and may trigger the next review.

**Memory.** Replace the 18-sentence list with stored observations that carry source, time, the people and place involved and an importance. For any request, recall by recency, importance and relevance to the people and place at hand. Start with scored SQL.

**Relationships with substance.** Separate warmth from trust. Mabel can stay fond of Oswin and become less willing to rely on him after a missed promise. Both move on recorded events and both can fall.

**A resident's own words.** A review may return one sentence in the resident's voice explaining a revision. It is published as the resident's stated intention. It is not presented as a verified motive.

Done when: a verifiable goal is settled by the engine with the outcome that settled it; a relational goal is kept, revised or retired by a review that cites recorded evidence; two residents hold different beliefs about the same fact; a goal survives several activities and a night's sleep; and the chain from observation to outcome can be read with one query.

### Stage 3. A village with stakes (M, engine rules)

Give residents more to weigh. This stage is engine work and adds no model calls of its own. It adds situations in which a choice is real, which the pilot will have shown how to count.

**Marked off · 21 November 2026.**

- [x] **Seasons and weather.** Done. The year is the real one, as decided on 22 November 2026 under open decision 10. Barley ripens only from April to October, by an amount set for each month, in good and poor years, and heavy rain at harvest lays some of it flat. Nothing grows from November to March. The founding barn holds 160 measures and each granary 120, and barley in store is slowly lost to mice and damp. Cold air sharpens appetites, and nobody comes up the road between November and February. `engine/stores.mjs`.
- [x] **Households.** Done. Each cottage keeps its own woodpile and larder, and its people carry firewood and loaves home from the common stores by choice. A cottage hearth burns only from its own pile, so one household can wake cold while the village woodpile stands, and children eat from the larder. The hall keeps its lodgers’ fire from the common store. A broken bed, sweeping and rotten floorboards are as before. `engine/households.mjs`.
- [x] **Lives.** Done. Residents have ages. Days of hunger, cold or overwork bring illness, which mends when they are fed, warm and rested, and a resident too ill to work is offered no work. Close, trusting pairs with a spark between them walk out together. Asking to marry, and the answer, are the residents’ own choices, and the wedding is on the green on a Sunday. A married couple keep one house, children are born into it, and at fourteen a child becomes a resident. A lodger moves into a cottage that stands empty. A resident ill too long, or unfed or unhoused for long, leaves. Death, by a long illness or old age, happens only where the village allows it: the Sandbox does, and the live village does not, as decided on 22 November 2026 under open decision 8. `engine/lives.mjs`.
- [x] **A working day.** Done. Trades keep hours. Nobody works at a trade on a Sunday or a feast day, and on a feast day the village eats together on the green. The mill and each oven take one worker at a time, and a second waits their turn. The common buildings wear, the carpenter’s repair work goes to the worst first, and a mill, oven or well in poor repair turns out less, or nothing once out of use. `engine/workday.mjs`.
- [x] **Hunting and fishing.** Done. Residents can look for game in the coppice, gather bait and fish from a dry riverbank, and mend a worn fishing pole. They can dress game, tan hides, and cook, smoke or cure the catch. One catch of two fish can be cured and carried to the Storehouse. Raw catches and meat keep for 30 village hours. Processing uses the oldest stock first and a shift claims its ingredients. Cooked and preserved portions supply meals at the hall. Worn shoes make walking more tiring and can be re-soled with Storehouse leather. Oswin prefers hunting, and Hugh and Alice prefer fishing. Their live decisions weigh these preferences against their needs and responsibilities.
- [x] **Outside events.** Done. A peddler trades salt fish for linen on the green. The lord’s reeve takes a tenth of the barley and a length of linen at Michaelmas and Lady Day. Winter storms strip roofs, lay barley flat and bring down deadwood. Stray cattle eat a ripe field until someone who has seen them drives them out. `engine/visitors.mjs`.
- [x] **A chronicle that selects.** Done. Every event carries a salience from 0 to 10. The village snapshot serves the latest 100 notable entries. Meals, shifts and other routine stay in residents’ memories and the full record, which the Chronicle page fetches when asked. The same people doing the same thing within three days is routine the second time. Food and water are judged in days, so a granary no longer reads as a shortage. `engine/chronicle.mjs`.
- **Done when:** Not yet met. The harness half is met: in year runs under local rules no sentence is more than 10% of the public chronicle, and seed 26111 ended its first winter with one measure of barley in store. `tools/year.mjs` reports both, and `stakes.test.mjs` holds them. The live half, the count of real tradeoffs per resident per day, waits for the live village to run under these rules.

- **Seasons and weather.** A year of about 48 village days. Fields produce only in their season. Winter burns wood and eats the stores.
- **Households.** Each cottage has its own larder and woodpile, so one household can run short while the village does not.
- **Lives.** Courtship, marriage, children, old age and death. Illness from hunger, cold or overwork. A resident who is not housed or fed for long leaves.
- **A working day.** Trades have hours, the mill and oven have queues, buildings decay and need the carpenter, and feast days are for the green.
- **Outside events.** A peddler, a tax collector, a storm, a stray herd.
- **A chronicle that selects.** Each event carries a salience. Routine goes to a resident's own log. Measure food in days, not as a fraction of a bin, so that building a granary no longer reads as a shortage.

Local rules can exercise these mechanics cheaply in the Sandbox and in tests. They are a harness for the engine. What residents do about a hard winter is still chosen by the models.

Done when: in harness runs no sentence is more than 10% of the chronicle and a hard winter arrives that the stores can fail to cover; and in the live village the number of real tradeoffs per resident per day, as Stage 0 counts them, has risen without the clock or the budget giving way.

### Stage 3a. The common store (M, engine rules)

Dalecrest holds its goods in common. Nobody is paid, and nothing is bought or sold between residents. In the engine's books the stores are already one pool. They have no building, nobody keeps them, and a resident draws on them at whatever place the goods were made. This stage gives the common store a place, a keeper and a rule for drawing on it. It is engine work. It adds jobs and menu choices and no new kind of model call.

**Why this stage.** The figures below were measured on 22 November 2026, before households and their larders reached the live village.

| What | Value | Source |
| --- | --- | --- |
| Loaves ten residents need in a day | About 11.4. Hunger rises about 60 points a day and a loaf removes 53. | `EATS` in `engine/stores.mjs` and the hunger rules in `sim.mjs` |
| Loaves they took | At least 24 on each of 4 and 5 August 1312. Mabel baked 10 and 15. | The Dalecrest Daily's source records for those two days |
| The most one resident took | Agnes Reed took seven on 4 August, three of them within an hour | The same records |
| How a loaf came about | A fresh choice by the Decisions API in every case checked. The meal routine applies only from hunger 50, and by the times recorded Agnes took two of that evening's loaves at a hunger under 2. | Live plan events on 6 August, and the times of Agnes's loaves on 4 August |
| When the model takes a loaf | Standing at the oven, Agnes was given a visit at hunger 1 and 3 of 100 and a loaf at 5, 10, 25, 45 and 70. Oswin, at the coppice, took a loaf at 10. Thomas did not. | Their live requests replayed against the Decisions API at set hunger levels, 25 requests in all |

The engine offers a loaf at any hunger, and the model often takes it. By 6 August residents were discussing the dwindling bread reserve. A short bread store also feeds the case for a second oven and decides whether a newcomer stays, so the waste distorts both.

**Status · 22 November 2026.** Built, with `storehouse.test.mjs`. The "done when" is a week in the live village and has not been measured. Under local rules on seed 26112 residents drew under a loaf and a half a day each over twenty days, and none went hungry. [Design decision 15](design.md)

**Marked off · 22 November 2026.**

- [x] **A floor under meals.** Done. `MEAL_FLOOR` in `engine/storehouse.mjs`.
- [x] **A storehouse on the map.** Done. Every village gains one between the green and the oven, a stored village by migration on its next step. It wears like the other common buildings.
- [x] **Bringing goods in.** Done. The carry is the last leg of the shift, changed in place, so its decision trace follows it. The shift is recorded when the goods are on the shelf, with the place the work was done.
- [x] **A day's allowance.** Done. 1.25 loaves a grown resident, and a loaf for each child old enough to eat, since children eat a whole loaf from the larder. Drawing it is a meal, so the meal routine covers it.
- [x] **A keeper and a count.** Done. A storekeeper is sent for as soon as there is a storehouse, sleeps there, and counts the shelves about twice a day.
- [x] **Knowing what is short.** Done. A count is a fact that can be passed on. A count under six loaves can become a request to the baker to bake five for the storehouse.
- [ ] **Shown and reported.** Under way. The storehouse is on Robin's rounds and the map and walking view draw it with barrels and sacks at the door. The keeper's counts are in the records the Daily reads. Shelves that change with the stock are not begun.

**Preserved food and leather · 22 November 2026.** The live record on 7 August showed four fish cooked at the hall and Oswin's game still undressed. The Decisions API now sees what each processing shift yields. Residents at the hall can weigh the oldest ingredient's spoilage deadline, and a restocking goal or a dated count of an empty shelf can give processing priority. Processing and delivery are recorded as work.

- **A floor under meals.** A resident whose hunger is under 30 is not offered a meal, at the oven, at the hall or at home. Local rules already behave roughly this way through their scores. Only the model's menu has no floor. This depends on nothing else here and goes first.
- **A storehouse on the map.** One building holds the finished goods residents take for themselves: loaves, linen, salt fish and smoked game, and leather. The peddler's linen and the reeve's length come off its shelves. Barley stays in the barn and granaries, water at the well and cooked meals at the hall. The live village gains its storehouse by migration, as it gained its map.
- **Bringing goods in.** A shift that makes storehouse goods ends with the worker carrying them there. The walk is the last leg of the same activity, so it needs no decision of its own. The stock changes when the goods arrive, and the shift's outcome records it as now. Mabel's five loaves are in the store when she sets them on the shelf.
- **A day's allowance.** Once a day a resident draws bread for their household: a loaf for each grown person and one for each child old enough to eat. It goes to the larder at home, and meals are eaten from there. A lodger draws their own loaf. The allowance is a parameter. It starts at what a resident eats and is tuned against the live village. Drawing it is a routine, so a standing instruction covers it.
- **A keeper and a count.** One resident keeps the storehouse: counts the shelves each day and notices what is running down. The keeper is not a gate. Anyone may draw their allowance when the keeper is away, and the engine holds them to it. A village does not go hungry because one resident is waiting on a decision.
- **Knowing what is short.** A resident learns what the storehouse holds by going there or by being told, with the witness and the hour, as flour and firewood are known from the oven today. The keeper's count is news that can be passed on and asked about.
- **Shown and reported.** The storehouse is a place on Robin's rounds. Its shelves are drawn to change with the stock, as Stage 1 asks of the woodpile. The Daily can report the keeper's count.

Open decisions 12 to 15 belong to this stage. All four were settled on 22 November 2026: the building is the Storehouse, households keep their larders, flour and firewood stay at the oven, and a new resident keeps the store under an allowance the engine sets.

Done when: across a week in the live village residents draw between 1 and 1.5 loaves a day each; nobody has eaten at a hunger under 30; a household can still run short while the storehouse does not; a viewer can tell from the storehouse what the village is short of; and fresh choices per resident per day, as Stage 0 counts them, are known before and after.

### Stage 3b. A menu worth choosing from (M, engine rules)

The original fresh-choice menu offered a visit to nearly every neighbour and many pairings of news and recipients. The engine now builds the feasible choices and prepares a shorter menu for the Decisions API. Standing instructions and late replies use the full feasible list. The model chooses the activity and the simulation carries it out.

**Why this stage.** The figures below were measured on 22 November 2026 from the live village, over 682 applied action requests in the 24 real hours to 12:20 EST. They cover Saturday 5 and Sunday 6 August 1312. Sunday is a day of rest, when nobody works at a trade.

| What | Value | Source |
| --- | --- | --- |
| Options on a menu | 19.5 on average, and up to 36 | The menus in `dalecrest.decision_traces` request bodies |
| Options about people | 7.1 offers to tell someone news and 6.4 visits a menu, together 70% of it | The same menus |
| What was chosen | Visits 42%, telling news 38%, work 7%, meals 7%, rest 5%. Leisure on the green was on every menu and was chosen none of 682 times. | The same requests |
| A working day | By day on Saturday 5 August, menus held 13.6 options about people and 1.3 for work, and 90% of choices went to people. By day on the Sunday they held 16.7 and 2.9, and 74% went to people. | The same requests, by village day |
| Hunting and fishing | On 53% of menus. Chosen 6 times. | The same requests |
| What a request costs | 949 tokens. The menu is 63% of the request. | `token_charge`, and the request bodies' length |
| Fresh choices | 33.1 per resident per village day. 91% were needed because no standing instruction applied, and 60% of back-to-back fresh choices repeated the identical option. | `readout.mjs` and `tools/standing-coverage.sql` |

Saturday held a loop of missed conversations, fixed in `3076912`. Since `fe60da0`, a standing instruction can cover another stretch of the same visit.

**Pre-deploy baseline · 22 November 2026, 12:29–12:45 p.m. Eastern.** Eight fresh requests after the visit routine deployed, all applied, averaged 17.38 options with a maximum of 26. Visits and news made up 67.6% of the menu and six of eight choices. Work averaged two options and was chosen once. The average charge was 1,064 provider tokens, and the menu accounted for 57.9% of the serialized request text. The sample was Sunday evening in the village. Workday comparisons still need a working day.

On the same production snapshot at village minute 8428, the 11 residents averaged 17.36 feasible options and 9.27 curated options. The largest curated menu had 12 options and every protected choice was present. This comparison built menus locally from the snapshot.

- [x] **Company by place.** The green and alehouse offer a place to spend time. Residents can meet whoever is there on arrival. The model is told the names of company the resident can see nearby.
- [x] **People who matter now.** Up to four ordinary named visits give priority to people involved in a goal, request, promise or courtship, then someone nearby, a close bond and neighbours longest unseen.
- [x] **News worth telling.** Up to two ordinary offers go to people the facts concern or people within speaking distance. Relevance comes before recency. Verified receipts for promised work keep their place alongside replies and requests.
- [x] **Work that can start.** The resident's own trade, including a reporting round, and a preferred outing stay visible when feasible. A resident whose trade is unavailable gets a reason they could know, such as the day's hours, a recent shelf count, a check still to make at the oven, or illness. The database records which rule applied.
- [x] **A size, and a record of what was left off.** The menu aims for 12 choices. Protected choices may exceed that target. Protection covers help and promises, courtship and marriage choices, village events, meals from hunger 50, night or urgent rest, the resident's trade, the baker's check when baking is unavailable, and preferred outings. The trace records the omitted IDs and reasons in `menu_audit`, outside the model request.
- [ ] **Words that vary.** Not begun. After the working-week baseline, start with visitor captions for existing activities. A model can draft phrases for review. Choose variants deterministically from the record and preserve the quantities, people, places and who witnessed what. Before varying stored event prose, move repeated-news checks and readout counts that depend on wording to structured facts. Test any changes to the Decisions menu against the same recorded situations with option IDs and order held fixed.

**New activities.** When measurement shows a missing activity, give it a named entry in the stage where the need emerged. Describe when residents can choose it, what it does and how to test it. Review the code and tests before release.

**Measuring in the live village.** `tools/menu-coverage.sql` reports the full and curated menus, charged tokens, recorded omissions and the work and outing counts from feasible to shown, chosen, started and recorded completion. Use `tools/standing-coverage.sql` and `readout.mjs` for standing instructions and fresh choices per resident per village day.

Done when a working week in the live village shows how often menus fit the 12-choice target, whether request size and actual tokens fell, and whether residents work at their trades on days when they can and take their preferred outings when they’re feasible. Every protected choice must remain visible. Compare fresh choices per resident before and after. A category taking over half of a working day’s choices is a reason to inspect the circumstances.

### Stage 3c. Families and village lessons (L)

Bring two families into Dalecrest, each with two parents and four children of different ages. Children already belong to a household, eat from its larder, and become residents at fourteen. Before then, they should have days of their own that visitors can follow.

The live village had eleven residents, two hall lodgers, no vacant finished cottage and two loaves on the Storehouse shelves when this stage was proposed. At the current allowance, four adults and eight children old enough to eat add thirteen loaves to what the village issues each day.

- [x] **Families arrive together.** Each family takes a finished vacant cottage after the village allows for its existing lodgers. One chronicle entry names the parents and children and records the Storehouse's first delivery to the larder. The second family waits for three consecutive fed dawns in the first household.
- [ ] **Prepare for live arrivals.** Under way. The carpenter and Storekeeper can put a family cottage before the moot, and one newcomer takes up baking. The separate village rehearsal brought in both households. Check live housing, baking and the larders at dawn before enabling the live pilot.
- [x] **Children have their own days.** Younger children stay close to home. Older children walk to play on the green and can bring kindling home. A completed trip moves one bundle from the village woodpile to the cottage, at most once per household per day. The clock runs these routines until the child turns fourteen.
- [x] **Lessons in the hall.** A literate parent keeps their trade and can choose to teach letters and reading on Monday, Wednesday and Saturday mornings. The teacher must be present and the hall free of a moot. School-age children walk to the lesson and the record counts the time each actually attends. A dedicated schoolhouse can come later if the village asks for one.
- [x] **See what children do.** Children can be selected and followed in Map and Walk. Household records show their activities and link to them on the map. Their IDs follow them into adult resident records. The first lesson with pupils appears in the chronicle.

**Preview · 24 November 2026.** Open `/atlas.html?families=1&days=7` for a separate Sandbox village with spare cottages and stocked shelves. Seed 26111 brought in the Ashby household on 1 August and the Elmstead household on 4 August, with no missed breakfasts after either arrival. The preview recorded three lessons and six kindling deliveries. Set `VILLAGE_FAMILY_ARRIVALS=1` on a [separate server preview](../tools/preview-village.mjs) to queue the same two households behind the usual housing and bread checks. At the live preflight there were two hall lodgers, no vacant finished cottage and two loaves on the shelves.

Done when both families arrive on separate days and keep their children fed, and a viewer can follow a child from home to a lesson, chore or play. The records show which lessons took place and which chores helped the household.

### Stage 3d. What feeds the village (L)

**Built · 24 November 2026.** The Storehouse allowance measures bread drawn. The meal records show what reached the table, including seasonal produce and mutton. A parent can bring produce or preserved portions home for the children’s breakfast.

- [x] **Count food where it can be eaten.** The dawn count shows how long the ready food in the hall, Storehouse and cottage larders could feed the village, given adult appetites in the weather and the breakfasts of children old enough to eat. Grain, flour, raw fish, game and mutton are shown as potential food with enough labour and fuel. Drawing food changes where it is counted.
- [x] **Record what each household eats.** The meal record includes children’s breakfasts and feast portions, the food eaten and the hunger it relieved. A mixed portion divides the credit among its ingredients. The Stage 3d section of `readout.mjs` reports the last seven completed village days by food source, including hungry adults at dawn and missed child breakfasts. The Stage 3a bread-draw measure remains available.
- [x] **Follow fish and game to the table.** River fish, hunted game and salt fish from trade keep their origins through preparation, delivery, spoilage and serving. Older stock without a recorded origin contributes to the unknown category.
- [x] **Grow vegetables and fruit.** The kitchen garden can be sown from March to June. Peas ripen after 56 days, and a tended plot yields more. Established apple trees bear after spring blossom, pruning improves the yield, and saplings take two years to join the crop. Harvests go to the hall, where residents can eat them or draw them for home. Peas keep three days and apples 45, including time in a larder.
- [x] **Raise sheep for food.** The flock grazes in its pasture, needs tending for spring lambing, and eats stored hay from December through February. Shepherding and haymaking take work time. Taking a grown surplus sheep reduces the flock and yields mutton for the hall, where it can be cooked or smoked. The meal readout credits livestock when someone eats it.

**Seeded verification.** In a breadless village, one family ate the preserved food it drew while a child in a cottage without food missed breakfast. A seasonal test followed peas, apples and mutton to meals, carried four sheep through winter on gathered hay and recorded three lambs in spring. In a separate 370-day run under local choice rules, seed 26111 recorded 20 pea portions, nine apples and four mutton portions eaten, and finished with seven sheep. The PostgreSQL readout reconciles portions and hunger relief across seven village days. Live measurements are pending.

Done when the following checks pass. In a seeded village with no bread for a day, a family with other food can feed its adults and children while a household with no access to a meal still goes hungry. A seven-day report reconciles portions eaten and hunger relieved by source with the meal records. A seasonal run shows a vegetable harvest, a fruit harvest and a flock carried through winter, with food from each reaching a table.

### Stage 4. Voices: competing interests and the moot (L)

Apply the pilot's mechanism to a second problem, and let the village decide things by people taking positions.

**Marked off · 22 November 2026.**

- [x] **A second story.** Lodgers and growers can raise competing motions. Residents who hear one can back it, oppose it or reserve judgment.
- [x] **Ballots.** Each attendee receives a separate Decisions API question for each motion. The engine records returned votes, quorum, abstentions, missing ballots and the outcome.
- [x] **News travels.** A proposal report keeps its original witness and each telling. Estimates can change in conversation and be checked against the motion at the hall.
- [x] **Words.** A settled motion can carry a labelled account reconstructed from two recorded ballots. The account has a separate model budget.
- [x] **A wider agenda.** The catalogue includes six works and a bylaw that raises the daily adult bread allowance to 1.5 loaves.

The PostgreSQL integration test exercises the production queue with scripted provider replies. The live readout counts linked ballots, positions taken on relayed news and moots with complete roll calls. [Follow a ballot](decision-tracing.md#follow-a-ballot)

- **A second story.** A lodger wants a cottage while the growers want another field. Residents who hear a proposal are offered positions on it.
- **Ballots.** When the moot opens, each attending resident receives an explicit ballot from the Decisions API, with their own goals, obligations and what they know. The engine counts recorded ballots, resolves quorum, deducts materials and builds through the existing civic rules. Support, opposition, abstention and a postponed work are all valid endings.
- **News travels.** Facts spread through conversation and witness, using Stage 2's observations. Two test villages with different witnesses give residents different evidence. Rumour can be wrong.
- **Words.** For an exchange that matters, the general-purpose model may write what was said. The positions and their effects are already decided and recorded. The words are labelled as an account.
- **A wider agenda.** A catalogue of works the engine can build and bylaws it can enforce. Residents propose from it. The catalogue grows by code.

Done when: a ballot can be traced to the goals and observations its voter was given; a piece of news can be followed from the person who saw it to the person who acted on it; and a moot runs to a valid outcome on the production path with every ballot recorded.

### Stage 4a. Lead characters (L, proposed)

Give one or two residents more memory and more developed motivations so their lives can be followed across several village days. Start with Robin Marsh. His rounds already take him through the parish, and his life outside the Daily gives him personal decisions to make. A later lead can be the resident who takes on regular teaching at the hall. The two viewpoints should have different concerns, relationships and projects.

**Proposed · 25 November 2026.** This stage builds on the existing [goal reviews](../goal-reviews.mjs), [resident memories](../engine/memory.mjs), [reporting rounds](../engine/reporting.mjs) and [lesson records](../engine/children.mjs). Robin already has a larger allowance for ordinary action requests. The proposed investment is in what he can remember, what he wants to pursue and how he revisits those concerns.

[Pino’s Brain](https://pinos.world/brain) is a reference for showing the projects, commitments and habits a character carries from one day to the next.

- [ ] **Enable depth for a named resident.** Use a per-resident setting keyed to the resident’s lifetime, using the same identity boundary as resident records. Enable Robin first in a preview. Give the setting an operator switch and log when it changes. A successor with the same identifier has their own memories and goals. The teacher becomes a second lead only after completed lessons with pupils establish who is regularly teaching. A dedicated school building is optional.
- [ ] **Give leads more durable personal memory.** Let a lead retain a bounded set of consequential memories beyond the ordinary recent memory window. Start with links to their own recorded observations and relationship evidence, including earlier promises, setbacks, encounters and things that changed their mind. Each selection carries its original source, when the resident learned it and why it matters to a current concern. Keep conflicting accounts and later corrections so a more recent story can revise what the lead believes.
- [ ] **Give motives continuity and consequences.** Keep the versioned goal book as the record of what a resident wants. For the pilot, let a lead develop a lasting personal concern and one concrete plan linked to a goal. A concern can be about a person, their calling, or something they value for its own sake. A plan records what they want to try next and when they would reconsider. A missed visit or a gift can change its course if the resident actually learns about it. Progress, revision and abandonment are all valid outcomes.
- [ ] **Let leads follow through on real plans.** Start with actions the village can already resolve, such as following up on an unfinished story, visiting someone or trying to keep a promise. Add a one-off appointment to the same pilot. One resident proposes a person, place and time window, and the other chooses whether to accept. Use walking time and existing obligations to surface a fresh choice if a routine would make them late. Record who arrived, when, and what each participant learned afterward. Once this works, try a personal project whose time, materials and result the simulation can account for.
- [ ] **Give leads occasional deeper reviews.** Extend the existing goal-review path to consider an older relevant memory, an active plan and what happened since the last review. Start with consequential triggers such as a plan being fulfilled, falling through or receiving credible new evidence. Try a stronger review model only as a measured variant. Keep the existing clock and action contract. The model sets or revises the intention, the action model chooses a feasible move, and the engine resolves what happened.
- [ ] **Show what the resident is carrying forward.** Put a short On their mind section on the resident page, with one active concern or plan and a link to the relevant public record. Show confirmed outcomes separately from a resident’s stated intention or interpretation. Stage 5 can feature a lead when there is something to see. Stage 6 can use the same records to show what they knew, what they chose and what happened. Robin’s private reflections and public reporting serve separate purposes. The Daily continues to report sourced events.
- [ ] **Rehearse before adding the second lead.** Pilot Robin in one preview village with a repeatable fixture for a plan that spans several activities and a night. Compare with an earlier decision trace from the same resident and with a resident on the ordinary profile. Measure reviews, input tokens, waits and the number of decisions where prior experience is relevant. Open the teacher pilot after the Robin trial yields a complete, readable example and the live lesson records support the choice of teacher.

#### Robin’s first pilot

Give Robin a real unfinished matter to return to. For example, his notes might record that a cottage proposal was postponed. He could decide to ask its proposer what has changed, arrange a time to meet, and choose whether to keep that meeting when his reporting takes him elsewhere. These are possible outcomes for a rehearsal. The resident chooses the plan and the simulation establishes the result.

Include a personal concern alongside his reporting. Robin may want to keep an appointment with Agnes on a day when a close moot vote gives him a reason to go to the hall. If they miss each other, Agnes can remember waiting and Robin can remember the choice he made. Any later explanation follows from an encounter or report they actually receive.

The eventual teacher should have a concern drawn from their own lessons and household ties. A pupil can miss a lesson because of another obligation the teacher has yet to hear about. The teacher might ask the household, change what to teach next, or set it aside. Over time the teacher and Robin can reach different judgments about the same village events.

#### Records and decision interfaces

- **Lead settings.** Record the resident’s identity, when depth is enabled, and the applicable recall and review limits. Keep presentation emphasis separate from decision depth so the observatory can follow any resident. Account for a departed resident, an actor identifier reused by a newcomer, and a role that passes to another teacher.
- **Memory selection.** Keep the live snapshot compact and reuse the observation archive. A lead’s retained memory can be a small list of observation or evidence keys. Resolve only the resident’s own keys within their lifetime. Use deterministic, relevance-based retrieval by the current plan, person or place, and record the exact keys in the trace. A starting experiment could retain up to 24 important references and show a few extra relevant memories in a deep review. Tune those values against the current 60-entry memory and the ordinary review context. Repeated routine should carry less weight than a relevant consequence.
- **Motivation and plans.** Extend the existing goal versions before considering a second goal store. A possible plan record holds its owner and version, goal reference, a stated next step, supporting evidence, a review or due time, and the outcome or reason it ended. Distinguish a wish from an accepted appointment. Validate counterparties, location, arrival window and transitions before applying a decision. Give changed plans new versions so a reply about an earlier plan can be recorded as stale.
- **Model calls.** Keep deeper reviews off the tick path. Reserve and measure them under a bounded allowance that leaves room for ordinary reviews and action calls. Coalesce new review triggers while an equivalent review is pending and compare trigger, resident lifetime and plan or goal version when applying a reply. Validate cited keys and use the last valid plan through delays, refusals or provider outages. Closing or reopening a request must be safe to repeat after a restart.
- **Public record.** Reuse the [goal and decision trace](decision-tracing.md#follow-a-goal) to link observations offered, goal or plan versions, the chosen action and its observed outcome. The resident page can show a dated entry or a screened statement the resident chose to share. Keep the model exchange and private review material in the operator record. For the teacher, start with lesson outcomes and pupil participation already appropriate to the public chronicle.

#### Questions for technical review

- Can retained memory use the existing observation keys and queries at decision time, or does a small index by lifetime, person and place need to be added? Which context limits preserve a useful distinction between the action menu and a deeper review?
- Can appointments reuse the request archive’s version and participant rules while keeping arrival and notice as their own outcome? Which transitions need a shared record, and which belong only to each participant’s observations?
- Can the goal-review queue add a bounded lead review without delaying ordinary reviews? Which baseline for token use and decision waits should govern enabling a second resident?
- Which parts of the existing goal chain can be rendered publicly with their sources, and which need a dedicated projection so generated interpretations never appear as established events?

#### Acceptance checks

1. A lead retrieves an important older observation after ordinary entries have faded. The review cites it, the trace identifies it, and another resident with no record of hearing it receives a different context.
2. A plan remains available after a meal, a shift, sleep and a restart. A witnessed setback can revise it. A late or duplicated reply leaves a single consistent plan and outcome.
3. An appointment can be accepted or declined. An accepted appointment changes a choice when travel would make a routine run late. A missed meeting leaves records that reflect what each person witnessed or learned.
4. A viewer can follow one real Robin sequence from intention through action to consequence. The Daily and resident page distinguish observed facts, stated intentions and interpretations.
5. The pilot reports decision waits and token use for Robin and the ordinary residents. Turning off the lead setting stops the extra review path while existing goals and accepted commitments can be handled by the regular systems. A second lead can be enabled independently in a rehearsal.

**Done when** Robin has a traceable concern that changes or progresses over several village days, with a real choice and a recorded consequence. A viewer can tell what mattered to him and what happened next. The operator can compare decision waits and cost against a baseline and can use the same settings for a later teacher pilot.

### Stage 5. Worth watching (M, can start alongside Stage 3)

Presentation. The pilot delivers the first of it: links, the promise thread and readable work at the oven and woodpile.

**Marked off · 21 November 2026.**

- [x] **Show events where they happen.** Done. A note marks the spot on the map, and a staff with a pennant and a note marks it in the walking view. A chronicle entry turns either view to its place and gives its time. Seeing the village as it stood at that minute waits for Stage 6’s archive, and entries for a resident’s own decisions carry no place.
- [x] **A director.** Done. A bare address opens on the watch. It follows whoever is in the middle of something, goes to a place when news arrives there, and shows the whole parish when everyone is indoors. A caption says what is in view and gives the recorded reason. Choosing a resident or moving the map ends it, and Watch brings it back. Scenes are ranked by fixed rules in `public/director.js`, tested in `director.test.mjs`. Visitors’ marks from Stage 9 do not inform it yet, and it has not been tried on first-time viewers.
- [x] **Show the basis.** Done. The resident panel and the map card show the recorded reason for an activity or a wait. A deciding resident carries a question mark on the map and a hand on the chin in the walking view.
- [x] **Dalecrest Daily.** Robin reports from around the village. Each morning’s edition includes his notes, village records and follow-ups.
- [x] **Seasons, weather and the hour.** Both views show seasonal change, weather, daylight and night, residents going indoors, and the tools and movements of their work.
- [x] **A richer parish.** Both views have fenced kitchen gardens, woodpiles that reflect firewood stocks, grazing sheep and stray cattle during herd events. Moving water, shaded relief, canopy woods and drifting cloud shadow are in place. The Sound toggle plays the river, weather, animal calls and nearby work in both views.
- [x] **Time-lapse.** Growth plays or scrubs through dated map revisions on a fixed view of the parish. The archive begins with the earliest saved map. A resident’s Heat map tab shows where their recorded village minutes were spent.
- [x] **Streaming.** One shared stream sends committed changes to Map and Walk, including decisions made between ticks. A reconnect starts with the current village. Walking continues in place as residents and scenery change.

- **Show events where they happen**, on the map and in the walking view. A chronicle entry takes you to its place and time.
- **A director.** A watch mode that follows whoever is in the middle of something and holds on the scene. It is what a first-time visitor sees.
- **Show the basis.** A resident who is waiting on a decision looks like someone making up their mind. A resident following routine looks like routine.
- **Dalecrest Daily.** The general-purpose editor uses Robin’s notebook and the public records to cover the previous village day. Each passage links to supporting events. “Since yesterday” follows earlier stories.
- **Seasons, weather and the hour** in both views. Tools in hand, a movement for each trade, residents who go indoors.
- **A richer parish.** Gardens, fences, woodpiles, animals, moving water, sound.
- **Time-lapse** of the village's growth from stored map revisions.
- **Streaming.** Send changes to the page as they happen. Update the walking view in place.

Done when: someone who opens the site with no explanation stays more than two minutes and can say afterwards what happened while they watched.

### Stage 6. Worth following (M)

**Marked off · 21 November 2026.**

- [x] **Pages with addresses.** Residents, households, promises, moots and village days have copyable links. Resident addresses distinguish people who reuse the same actor ID. Moot pages can read their results from the chronicle after they leave the live panel. The earlier resident and request links still open.
- [ ] **Follow.** Under way. Visitors can follow residents, households, promises and moots in their browser. Following shows updates for each record since it was last opened. The feeds, weekly letter and webhook are still planned.
- [ ] **Why did she do that?** Not begun.
- [ ] **An archive.** Not begun.

- **Pages with addresses** for every resident, household, promise, moot and day.
- **Follow** with no account, plus a feed for the village and for each resident, a weekly letter and a webhook.
- **Why did she do that?** A public, trimmed view of the record: what the resident knew, which goals were in force, whether the activity was a fresh choice or routine, and what happened. Motive is shown only where a record supports it. The full exchange stays private.
- **An archive** of every day of the chronicle with the map as it was.

Done when: in a small pilot, people voluntarily return to check on a resident, and it is known which unresolved matter brought them back.

### Stage 6a. Admin control panel

**First release · 24 November 2026.** The password-protected panel has a health view and audited clock changes. It was exercised in a separate PostgreSQL preview. The live panel is at [/admin](https://dalecrest.trinsicstudios.com/admin). See the [operator guide](admin-control-panel.md) for setup and read-only agent access.

- [x] **Operator access.** Named accounts have password-protected sign-in, expiring sessions and rate limits. Operator permissions are checked on every clock change. Monitors have read-only access. Agents use a separate read-only JSON URL with a bearer key.
- [x] **Live status.** The dashboard shows the village minute and pace, deployed revision, last successful backup, provider health and oldest pending decision. Charts report daily OpenAI and Anthropic tokens, activity starts by resident and decision waits. The dashboard dates its last health check and credentials stay in protected server configuration.
- [x] **Clock controls.** Select 1×, fixed 2× or day/night and see how long a village day takes. The [clock helper](../deploy/dalecrest-set-clock) applies and verifies a preset, with rollback on failure. A restricted host permission covers the helper’s approved operations. The panel shows the effective pace and the recorded request while the village app restarts.
- [ ] **Agent reports.** Under way. Agents read the panel’s charts and four decision reports through `GET /admin/api/agent/metrics` with their read-only key: why fresh choices were needed, how often a fresh choice repeated what had just finished, how often the model’s two likeliest options were close for each resident, and how often each menu position was chosen. The reports cover the last real day and contain totals only, never requests or replies. The village image carries the reports, and the host admin service must be reinstalled to serve the agent address.
- [ ] **Timed trials.** Schedule a start and end in real time and show both in the operator’s time zone. Require the agreed baseline before starting and show the reason if the trial is held. Capture decision waits, discarded replies and token use before and after. Keep the schedule through an app restart, flag conflicts with manual changes and restore the previous pace once at the end.
- [ ] **Separate pause controls.** A simulation pause holds the committed village minute and resumes from it. A planner pause stops new model requests while the clock and valid standing instructions continue. Show which pause is active and what happens to replies already in flight.
- [ ] **Rollout checks and budget limits.** Offer approved feature switches and spending caps with their effective values and restart requirements. Before enabling family arrivals, show spare cottages, hall beds and the bread reserve. State which changes apply only to future arrivals.
- [x] **Change history and recovery.** Requests and outcomes are written to a server journal. The record shows the operator, reason, timestamps, and the previous, requested and effective paces. Restore an earlier verified setting as a new audited change. A stale request is rejected if another operator has already changed the pace.
- [ ] **Rehearsal.** Try the same settings in a clearly labeled preview village with separate state and local decisions. Use it to exercise restart, rollback and family-arrival checks before applying settings to the live village.

The first release is ready when an operator can sign in, set and verify a clock pace, and reverse it from the change record. Tests must enforce operator-only changes through the API. The full stage is done when a preview trial survives a restart, captures its comparison, restores the previous pace once and records each step.

### Stage 7. A living village culture (A–C, proposed)

**Status · 24 November 2026.** The variable-speed clock is built and the live trial is pending. The other parts remain proposals. Models form goals and select consequential choices, and the simulation validates those actions and establishes facts. Culture grows from what residents do and share.

#### 7A. A continuous, variable-speed clock

- [x] **Clock rates.** Run 06:00–22:00 at 15 real seconds per village minute and 22:00–06:00 at 7.5 seconds per minute. Keep 30 seconds as the live comparison rate and support a fixed 15-second trial. A village day takes twelve real hours at the comparison rate, six at fixed 2× and five at the day and night rates.
- [x] **One minute at a time.** The rate changes on the committed minute at 06:00 and 22:00. Schedule from the tick deadline so each half-second survives. If the server misses a whole interval, resume from the current village minute. The clock runs independently of audience presence and the decision queue.
- [x] **One clock in both views.** Commit the upcoming interval and its rate with village time. Show the active multiplier in the observatory and use the same interval for movement in Map and Walk.

**Verification and rollout.** Replay the same choices at both rates and compare event order across 22:00, midnight and dawn. Run fixed 2× for one real day before testing 4× overnight. Compare village minutes spent waiting, replies that arrive too late to apply, and action tokens per real day. Inspect the dawn queue separately from the quiet part of the night.

**Clock settings.** Use `VILLAGE_CLOCK_MODE=fixed` with `VILLAGE_SECONDS_PER_MINUTE=15` for the first trial. Use `VILLAGE_CLOCK_MODE=day-night` for the variable rate. The live comparison remains fixed at 30 seconds. Run `docker exec dalecrest-app node tools/pilot-report.mjs 24` to compare daytime, night and the hour around dawn.

**First live trial.** Stage 3d became healthy at 09:25 EST on 24 November 2026. The VPS is scheduled to check the full real-day and village-minute baseline at 09:28 EST on 25 November. After those checks pass, it will run fixed 2× for 24 real hours, save the comparison and restore 1×.

**On the server.** Use [`deploy/dalecrest-set-clock`](../deploy/dalecrest-set-clock) with `1x`, `2x` or `day-night`. The helper takes the deploy lock, checks the installed Compose settings, and verifies the running pace after restarting the app on its current release. It restores the previous environment if the change fails.

#### 7B. Culture that emerges from shared experience

- [ ] **Proposed.** Record consequential events as verifiable world history, distinct from each resident's sourced memories and interpretations; nobody automatically knows or agrees on an event.
- [ ] **Proposed.** Let accounts travel through encounters and the Dalecrest Daily; readers may react, disagree, forget or pass stories along. Robin's reporting must remain grounded in recorded events, not create facts.
- [ ] **Proposed.** Allow repeated social practices and proposed recurring gatherings to become customs or institutions only through residents' choices, participation and reinforcement; permit customs to fade or be contested.
- [ ] **Proposed.** Carry cultural knowledge through newcomers, children and deaths via observed practices, conversation and records, rather than a single village-wide AI mind.

#### 7C. Cost-bounded growth and evidence

- [ ] **Proposed.** Measure real-time decision waits, meaningful choices per village day, token spending by role, and whether faster days increase the fraction of time residents spend waiting.
- [ ] **Proposed.** Pilot roughly 30–50 residents only after profiling; use standing instructions, household routines and event-triggered reflection to decouple routine activity from model calls, while preserving individual agency for consequential decisions.
- [ ] **Proposed.** Compare seeded villages over 30–60 simulated days: can observers trace a custom or shared belief from an event through transmission to later choices, and do villages develop different practices without scripted outcomes?

**Done when:** Replays with the same choices preserve event order at both rates. A timed live pilot demonstrates continuous progression independent of viewers, shows the active multiplier, and measures waits and token use against the comparison rate. At least one seeded 30–60-day run shows an evidence-linked cultural practice forming, spreading or fading through resident choices. A quiet run is valid evidence.

### Stage 8. The world comes to Dalecrest (A–C, proposed)

**Status · 24 November 2026: not begun.** This stage introduces travelers, courier letters and trade within one village. Preserve the communal economy inside Dalecrest: no wages, individual currency accounts or general price system. External trade exchanges finite physical goods. The river is an optional, plausible source of *placer gold*, not river silver; its yield is intentionally uncertain and scarce, and no new mountain or mine is required.

#### 8A. Travelers, couriers and letters

- [ ] **Proposed.** Travelers arrive by a village road, stay briefly and depart; their presence and actions obey the same physical clock and location rules as residents.
- [ ] **Proposed.** An opt-in visitor can send a bounded letter through a courier to a named resident or the moot; delivery is an event, and the recipient may read, ignore, discuss or reply. Treat submitted text as untrusted claims, never engine instructions.
- [ ] **Proposed.** Record delivery, source, recipient, consent/moderation limits and subsequent choices so an observer can trace outside influence without inventing causality.

#### 8B. Barter and river gold

- [ ] **Proposed.** Keep internal food, tools and household provisions in communal stores, with no wages or personal accounts. A communal trading post can exchange actual surplus goods with visiting merchants.
- [ ] **Proposed.** Pilot small-scale gold panning in the existing river, not a new mine. Model recoverable placer deposits as finite, seed-dependent and rare, with time spent panning competing against food and winter preparation; some river reaches may yield nothing.
- [ ] **Proposed.** Track recovered gold by physical weight in the communal store and as carried merchant inventory, not abstract currency or minted coins. Allow direct barter first, with gold as an optional high-value external trade good.
- [ ] **Proposed.** Merchants bring finite goods and needs; negotiate offers and validate available stock, agreed quantities and actual transfers. A moot can contest trading away essential reserves.

#### 8C. Outside news and cultural effects

- [ ] **Proposed.** Travelers may bring goods, stories and unfamiliar practices; residents learn them through witnessed encounters or reported accounts, not instant omniscience.
- [ ] **Proposed.** Track whether external events change beliefs, customs or policy over time. Robin may report verified village encounters but should not convert a visitor's unsupported claims into facts.

**Done when:** A courier delivers a visitor letter without granting it authority over the simulation; a merchant arrives, negotiates and completes or declines a validated physical exchange; a river-panning trial produces bounded, reproducible yields including empty attempts; communal reserves remain consistent across restarts; and residents can accept, dispute or ignore outside accounts without automatic cultural change.

### Stage 9. Taking part (L)

Let visitors introduce circumstances. Residents keep the final say over their own actions.

**Marked off · 21 November 2026.**

- [ ] **React.** Not begun.
- [ ] **A petition, in a separate village.** Not begun.
- [ ] **The peddler's cart.** Not begun.
- [ ] **Letters.** Not begun.
- [ ] **Your own village.** Under way. The Sandbox already founds a village from `?seed=` in its address. Hosted villages are not begun.

1. **React.** Visitors mark events. This informs the director and changes nothing in the village.
2. **A petition, in a separate village.** A persistent pilot village with its own database and model allowance. A viewer posts a petition for a second well. One open petition per subject. Its origin is recorded, residents who encounter it may ignore, contest or support it, and the petitioner is shown what became of it.
3. **The peddler's cart.** Visitors choose what the peddler brings from a short list.
4. **Letters.** A short, screened, rate-limited letter to a resident, which enters the village only as an observation from far away. Visitor text is data to a model, never instruction.
5. **Your own village.** A shareable link to a Sandbox village first. Hosted villages later.

Done when: a repeat submission creates one petition; a petition can lapse unheard or lose a vote; every resident response links to a real choice; and the original village carried on independently throughout.

### Stage 10. A wider world (later)

**Marked off · 21 November 2026.**

- [ ] **More than one village.** Not begun.

More than one village with a road between them. This multiplies everything above, including the cost, and waits until one village holds an audience.

## Order and dependencies

- Stages 0 and 1 are the first milestone and are built together. The pilot is what tunes Stage 0's parameters.
- Stage 2 needs the observations and commitments the pilot introduces.
- Stage 3 is engine work and can begin once Stage 0 can count real tradeoffs. Its presentation counterpart, Stage 5, can run beside it.
- Stage 3a needs Stage 3's households and working day. Its floor under meals needs nothing and can go first. The allowance is a natural first bylaw for Stage 4's wider agenda.
- Stage 3b needs nothing beyond the stages already built. Measure its menus with `tools/menu-coverage.sql` and its activity starts with `readout.mjs` and `tools/standing-coverage.sql`. It comes before Stage 4, which adds positions and ballots to the menu.
- Stage 3c builds on the households and lives in Stage 3 and the Storehouse allowance in Stage 3a. Begin with family arrivals, then add children's routines and lessons before opening the live rollout.
- Stage 3d builds on the meals and larders from Stages 3 and 3a. Harvests, hay and lambing use Stage 3’s seasonal calendar.
- Stage 4 needs Stage 2's goals and observations.
- Stage 4a builds on Stage 2’s goals and memories and extends the Stage 1 promise pilot to personal plans. Robin can go first. The teacher pilot follows evidence from Stage 3c’s lessons. Stages 5 and 6 can present the same records, and repeated voluntary meetings can later inform Stage 7B.
- Stage 6 needs the records from Stages 1 and 2 and reads best after Stage 5's daily account.
- Stage 6a can start with Stage 0’s activity records and the clock helper from Stage 7A. Rehearse the panel in a preview before connecting it to the live village.
- Stage 7 measures how clock speed affects decision waits and costs in a single village.
- Stage 8 pilots travelers, courier letters and trade within one village before broader visitor participation in Stage 9 and multiple villages in Stage 10.
- Stage 9 needs Stage 4's ballots and positions, which are what make a visitor's petition something residents can answer.

## Cost and pacing

**Since this was written.** The hosted village now keeps at least ten residents, with 48,000 decision tokens per resident per rolling real hour and 60,000 for Robin under a village ceiling of 480,000 ([design decision 3](design.md)). The figures below are the original eight-resident estimate against 168,000 a real day and have not been reworked. One live reading exists: in the first 30 real minutes after the expansion the planner applied 17 decisions on 12,688 input tokens, about 750 a decision. [First village hour after the expansion](decision-tracing.md#first-village-hour-after-the-expansion)

**Pre-Stage 0 baseline.**

- A resident reaches about 23 activity boundaries per village day. Eight residents reach roughly 184.
- The historical production sample used 589 tokens per action request.
- The original pilot budget was about 168,000 tokens a real day, which funds about 285 requests of that size.
- Under the former one-request-per-boundary design, those assumptions imply about 108,000 tokens per village day for eight residents. Spending limited the pace to roughly 1.5 village days per real day.

**What can be avoided.** These follow from the measured mix, which is a local-rule mix and will differ in production.

- One night's sleep is 4.9 boundaries and one decision. That is about 4 avoidable requests per resident per village day.
- 55% of boundaries repeat the activity before, in the same place. If a repeat with nothing changed follows a standing instruction, about 12.8 of the 23 need no request.
- Meals are 1.4 a day and are routine unless they run into something.

**Assumptions.** None of these is measured.

| Quantity | Low | High | Why it is uncertain |
| --- | --- | --- | --- |
| Fresh choices per resident per village day | 5 | 10 | The high case avoids only repeats. The low case also treats most meals and the next shift at a trade as routine. More at stake means more real tradeoffs. |
| Tokens per action request, with goals, commitments, observations and place names added | 900 | 1,200 | Depends on how much recalled context is sent. |
| Goal reviews per resident per village day | 0.5 | 1.5 | Triggered by events, so quiet days need none. |
| Tokens per goal review | 1,500 | 2,500 | A different model with its own price and its own cap. |

**Estimate for eight residents, per village day.**

| | Pre-Stage 0 estimate | Pilot, low | Pilot, high |
| --- | --- | --- | --- |
| Action requests | 184 | 40 | 80 |
| Action tokens | 108,000 | 36,000 | 96,000 |
| Goal reviews (Stage 2 onward) | none | 4 | 12 |
| Goal-review tokens | none | 6,000 | 30,000 |

**What that means for the clock.** Real spending is tokens per village day multiplied by village days per real day. With the clock independent, the pace is a choice.

| Clock pace | Village days per real day | Action tokens per real day, low to high | Against 168,000 |
| --- | --- | --- | --- |
| 49 seconds (illustrative pace from one pre-Stage 0 tick) | 1.2 | 43,000 to 115,000 | Within |
| 30 seconds | 2 | 72,000 to 192,000 | Within, except near the high case |
| 20 seconds | 3 | 108,000 to 288,000 | Within only below the middle case |
| 8 seconds | 7.5 | 270,000 to 720,000 | Over in every case |

Thirty seconds per village minute is the deployed code's default in OpenAI mode. At that pace a village day lasts twelve real hours. Budget pressure increases the wait for a fresh choice while the clock keeps its pace.

**What the pilot measures.** The estimates above are replaced by these.

- Actual tokens charged per applied action and per goal review, as the provider reports them
- Spending per village day and per real day against each cap, including replies that were superseded and never applied
- Real time from an activity boundary to the next activity starting: median, 95th percentile and longest by resident, split into time queued for budget and time waiting on the API
- The share of activities that began as a fresh choice, on a standing instruction, or after a wait
- Fresh choices per resident per village day, and which condition called for each
- How long instructions stayed valid, and how often one went stale before it lapsed
- How late the clock ever ran
- Commitments per village day, how each ended, and the spending per completed commitment
- How long a new visitor waits to see someone act

## Acceptance tests for the first milestone

The central test: **can someone follow Mabel, return the next day, and tell whether Oswin kept his word, and can we trace the answer to choices the residents actually made?**

**How these are marked.** None of the ten is ticked, because the pilot has not run. Each carries a note saying whether an automated test exercises it today.

1. [ ] **Every ending is reachable.** Exercise kept, broken, declined, unanswered and released in a test village. Change the store between choice and execution in one run. Each ending must agree with the work and conversations that actually took place. *Has test cover: all five endings in `social-turns.test.mjs`, the changed store in `oven-observation.test.mjs`.*
2. [ ] **It survives a restart.** Restarting between a choice and its completion yields each outcome exactly once. Earlier history still opens. *Has test cover: the PostgreSQL tests, which need a database to run.*
3. [ ] **The promise reaches the model.** With the menu held fixed, changing an open promise or the standing between two residents changes the serialized action request. *Under way: the request now carries open requests and the standing between the two. No test yet holds the menu fixed and compares the bytes.*
4. [ ] **Knowledge stays local.** A resident who did not see or hear of the shortage receives no trace of it in their request. Mabel's request shows the wood she last observed and when, and a test makes that differ from the true store. *Has test cover: "unseen flour and wood cannot change the request", in `oven-observation.test.mjs`.*
5. [ ] **The chronicle claims only what it can verify.** Every statement about the promise links to a recorded event or outcome. A plain woodcutting shift is not credited to the promise. Wood supplied by someone else relieves the shortage and gives Oswin no credit. *Has test cover: "only a chosen shift for the promise earns credit", in `social-turns.test.mjs`.*
6. [ ] **The answer can be traced.** Starting from the outcome, one query returns the choice that produced it, whether that activity was a fresh choice or routine, the commitment and observations the model was given, and the exact exchange. *Under way: the trace records and worked queries are in [decision tracing](decision-tracing.md). Not yet checked as a single query from an outcome.*
7. [ ] **Time kept moving.** Through the pilot, including a deliberate provider outage, the clock was never more than one tick late and no resident followed a stale instruction. *Awaiting pilot: both rules have unit tests. The claim is about a live week.*
8. [ ] **A viewer can read it.** Four of five first-time viewers, on a mix of phones and desktops, can say who wanted what and what happened within 90 seconds. On a second visit a day later they can find the ending after it has left the latest 100 entries. *Awaiting pilot: the archive is available for the trial with first-time viewers.*
9. [ ] **It can happen unprompted.** With the one chosen pressure in place and no scripting, a morning with flour and no wood arises in seeded runs, and Mabel learns of it by going to look. *Has test cover: "a first winter under local rules brings a morning with flour and no firewood, unscripted", in `seasons.test.mjs`.*
10. [ ] **It was affordable.** Spending stayed inside both caps and every measurement in the list above was captured. *Awaiting pilot: `tools/pilot-report.mjs` and `readout.mjs` are ready to report it.*

## Decisions that remain open

1. **The pace of the clock and the other Stage 0 thresholds.** Thirty seconds per village minute is a starting value. The pilot sets them.
2. **A resident with no instruction and no reply.** This plan has them wait indefinitely. The alternative is a default the engine applies after a long wait, which would be an action no model chose. That changes the agreed roles and needs an explicit decision.
3. **Who issues standing instructions.** The action choice that is reused, the goal review that sets a routine, or both.
4. **How long a promise lasts in real viewing time.** The starting assumption is a visitor who watches for two minutes and checks back tomorrow.
5. **What the audience may see before residents learn it.** The starting assumption is a public record of observable events.
6. **How the action and goal budgets are divided**, and whether the daily account in Stage 5 has a third.
7. **When the pilot reaches the live village.** It is proved in a test village. Moving it to the live one changes what residents know about the stores. *Note, 21 November 2026: oven observations and requests for help are already on `main`, which the live village deploys, so this has in effect been settled by deployment. It should be recorded as decided or reopened.*
8. **Whether residents die**, and whether the live village is migrated or a new one is founded when Stage 3 changes the economy. *Decided, 22 November 2026: the engine knows death, but the live village has it switched off. A resident ill too long leaves to be nursed by kin instead. The Sandbox runs with death on. The live village is migrated in place.*
9. **How far visitors may reach.** Stage 9 can stop at any step. The courier trial in Stage 8 is the first to require moderation.
10. **How long a year is.** Stage 3 proposes a year of about 48 village days. The calendar and the weather now keep the real year of 365, which at two village days to a real day takes six real months. One of the two has to give. *Decided, 22 November 2026: the real year. Stage 3 was built on it.*
11. **Whether the wood store grows with the village.** It holds 32 bundles at any size. With winter fuel that is about a day's burning for thirty hearths in frost, so a large village cannot lay in wood for a cold spell.
12. **What the common store's building is called.** It was proposed as a commissary. "Storehouse" is the working name here, because the word fits 1312 and the plan already speaks of the common store. *Decided, 22 November 2026: the Storehouse.*
13. **Whether households keep a larder and a woodpile.** Stage 3a keeps them as the place a day's allowance is carried to. A stricter commune would have everyone eat at a common table in the hall, and would undo part of Stage 3's households. *Decided, 22 November 2026: households keep both, and the allowance is carried to the larder.*
14. **Whether the oven's flour and firewood move to the storehouse.** The promise pilot rests on Mabel counting them at the oven, and acceptance tests 4 and 9 name that count. Stage 3a leaves both where they are, and leaves household firewood at the woodpile. *Decided, 22 November 2026: they stay at the oven.*
15. **Who keeps the storehouse, and who sets the allowance.** The keeper can be a second duty for a founding resident or the trade of the next arrival. The allowance can be an engine parameter or a bylaw the moot votes, which needs Stage 4. *Decided, 22 November 2026: a new resident arrives to keep the storehouse as a trade, and the allowance is an engine parameter from the start. The moot can now vote to raise the adult allowance to 1.5 loaves.*
16. **Whether the engine may leave a feasible option off the menu.** *Decided for Stage 3b, 22 November 2026.* The fresh-choice menu aims for 12 with overflow for protected choices. The trace records omissions and the engine checks replies and standing instructions against feasibility.
17. **How many people a menu offers, and who.** *Decided for Stage 3b, 22 November 2026.* Up to four named visits. Active relationships and responsibilities, proximity, warmth and time apart guide the shortlist.
18. **Whether company is offered by person or by place.** *Decided for Stage 3b, 22 November 2026.* Casual company at public places and targeted visits to named people both have a place on the menu.
19. **How operators reach the admin panel.** Choose whether to put it behind the existing private operator access or give it its own authenticated entry point. Both options need individually attributable changes and separate read and edit permissions.

## Future considerations

Questions the stages above do not answer. This section was added on 21 November 2026. Nothing here is scheduled or decided. Each is worth a deliberate answer before the point named under it.

1. **Keeping the two editions in step.** This document is the canonical plan and [roadmap.html](roadmap.html) is a hand-made rendering of it. Both now carry the marks, so every change of status has to be made twice. Generating the page from this file would remove that. *Before the next status changes.*
2. **Proving a model change is safe.** Every exchange is stored with the exact request that was sent. Replaying stored requests against a candidate model or a reworded request would show how choices shift before the village feels it. Stages 1 and 2 both change what the request contains, and design decision 6 expects providers to change. *Before the first change of model, or Stage 2's larger request.*
3. **Records that only grow.** Events, the activity log and decision traces gain rows with every tick, and each resident's record grows with what they hold. Stage 6 wants an archive of every day. What is kept whole, what is summarised and what may be dropped needs deciding while the tables are still small. *Before Stage 6, or the first slow query.*
4. **Many viewers at once.** The server reads and prepares each update once for all attached viewers. A connection that falls too far behind reconnects with a fresh snapshot. Measure bandwidth, memory and clock lateness with a hundred concurrent watchers before Stage 5's first public test.
5. **A village that can be read without the map.** Acceptance test 8 puts first-time viewers on phones. Both views are pictures: a visitor using a screen reader, or a small screen in the walking view, gets little of what is happening. A plain account of the current scene would serve them and would also feed Stage 5's director. *Before acceptance test 8 is run.* *Note, 21 November 2026: the director's caption is a first plain account. It is text, it is announced to a screen reader, and it covers the one scene in view, not the village.*
6. **Model-written prose in public.** Stage 2 publishes a resident's own sentence, Stage 4 an account of what was said, and Stage 5 a daily account. Each is text nobody reviewed, shown under the village's name. The plan labels these as accounts. It does not yet say how they are screened, how a wrong one is withdrawn, or how they keep a period voice. *Before Stage 2's first published sentence.*
7. **History beyond the parish.** Dalecrest was founded on 1 August 1312 and keeps the real Julian calendar. The Great Famine of 1315 to 1317 lies under three village years ahead, about a year and a half of real time at the present pace. Whether the outside world reaches the village at all is undecided, and a 48-day year would cut the calendar loose from history altogether. *With open decisions 8 and 10.*
8. **Knowing when the village is in trouble.** The caps bound what can be spent and the activity log records every wait. What tells an operator that the provider has been down for an hour, or that half the village has stood waiting since noon? The pilot's deliberate outage is the natural rehearsal, and open decision 2 depends on how long such waits really last. *Before the pilot week.*
9. **The tests that need a database.** Eight of the 59 tests require PostgreSQL. They include the ones that prove a restart yields each outcome exactly once, which is acceptance test 2. It is worth confirming that the deploy run includes them, so the promise is checked on every release and not only on a machine that happens to have a database. *Before acceptance test 2 is signed off.*

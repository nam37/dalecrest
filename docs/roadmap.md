# Dalecrest roadmap

**Canonical plan · 21 November 2026.** This document is the one plan for moving Dalecrest from a small simulated village to one people want to watch, follow and take part in. It describes work to be done. Nothing here is implemented or deployed by being written down.

- The accepted architecture is the [resident knowledge graph](knowledge-graph.md). Where this plan and that document differ, the knowledge graph governs and this plan is wrong.
- [Design decisions](design.md) describes the village as it runs today.
- [Give Dalecrest residents something worth following](proposal-village-life.md) is design background. It argued for the promise pilot that is now the first milestone, and its reasoning is worth reading. Its stage list is superseded by this one.
- The [illustrated edition](roadmap.html) is a rendering of this plan with the same marks. This document governs.

## State of the plan

**Marked off · 21 November 2026**, against the request archive (`996c2c1`) and resident cards (`836bec3`). A ticked box means built, tested and merged. It does not mean measured in the live village: each stage's "Done when" is a separate test, and none has been met. An unticked box is labelled under way or not begun.

| Stage | State | Done | Under way | Not begun |
| --- | --- | ---: | ---: | ---: |
| 0. Liveness and meaningful choices | Built, awaiting the pilot week | 5 | 2 | 0 |
| 1. The promise pilot | In hand | 6 | 2 | 0 |
| 2. Goals and memory | Not begun | 0 | 0 | 6 |
| 3. A village with stakes | Begun | 0 | 3 | 3 |
| 4. Voices: competing interests and the moot | Groundwork only | 0 | 1 | 4 |
| 5. Worth watching | Begun | 2 | 2 | 4 |
| 6. Worth following | Groundwork only | 0 | 1 | 3 |
| 7. Taking part | Groundwork only | 0 | 1 | 4 |
| 8. A wider world | Not begun | 0 | 0 | 1 |
| All stages | | 13 | 12 | 25 |

The merge passed all 59 tests on 21 November, including eight tests with disposable PostgreSQL databases.

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
3. [ ] **The action model is shown too little.** `actionBody` in `decisions.mjs` sends needs, stores, two memories and a menu. It leaves out relationships, open obligations and what the resident has learned. (Stages 1 and 2) *Under way: the request now carries the resident's own dated oven count, open requests for help with the standing between the two, cold and the weather. Recalled memory and goals that change wait for Stage 2.*
4. [x] **Place names.** Stage 0 added readable place names to option descriptions. Choice IDs still identify the exact action.
5. [ ] **Moot attendance.** A scripted test exercises quorum and construction on the model-driven path. How often real residents choose to attend remains a pilot measurement. [Standing-instruction tests](../standing.test.mjs) *Under way: the test is in. The live measurement is not.*
6. [ ] **Memory is a short list of sentences.** `remember` in `engine/civic.mjs` keeps 18 strings with no source, importance or recall. (Stages 1 and 2) *Not begun: the list of 18 is unchanged. Supply counts are kept beside it as observations with a source and a time.*
7. [ ] **Everyone knows everything.** The menu and the request use the true stores and every resident's true destination. "Bake" disappears from a menu the moment someone far away uses the last wood. (Stage 1) *Under way: flour and firewood are known only from an oven inspection or from being told. Barley and water are seen on depositing. Other knowledge is still shared by all.*
8. [ ] **Residents cannot ask, agree, decline or vote.** Encounters pick one of five templates. Votes in `resolve` are supporter-or-random. One template is wrong in effect: "discussed the dwindling grain reserve" fires when a store is under a quarter of its capacity, so building a granary makes it fire more often. (Stage 1 for asking and agreeing, Stage 3 for the fix, Stage 4 for votes) *Under way: asking, agreeing and declining are model choices. The grain sentence still fires on a quarter of capacity, and votes are unchanged.*
9. [ ] **Relationships are one number that only rises.** After 60 days, 19 of 122 are at the maximum. (Stages 2 and 3) *Not begun.*
10. [ ] **People only arrive, and the economy has no pressure.** Nobody is born, grows old, falls ill or leaves. One harvest shift feeds the founding village for a day. (Stage 3) *Under way: winter fuel is a first real pressure. Lives are not begun.*

What is already right and should be kept: the simulation is deterministic and replays from JSON; every model exchange is recorded before it is applied; the engine checks a chosen action again before starting it; and the map is data the village owns.

## Review: how it looks

The map and the walking view are sound and draw the same data. What is missing is legibility and life.

- [ ] Nothing marks that something is happening. A request, a moot and a building site look like an empty lane. *Under way: a resident who is deciding carries a question mark on the map and rests a hand on the chin in the walking view, and a site shows as stakes, then a frame. Requests and moots are still unmarked.*
- [ ] Every trade is the same arm movement, and a resting resident stands outside their door. *Under way: a resident at home is indoors, with a lit window and smoke standing in for them. The walking view has jointed figures with a tool and a movement for each trade. The map's figures do not.*
- [ ] A selected resident is not in the URL, a fresh page always starts with Agnes, and only the latest 100 chronicle entries can be reached. *Under way: the selected resident is in the address, so a link or a refresh keeps them. A bare address still opens on Agnes, and the chronicle still stops at 100.*
- [ ] There is no season, weather, sound or change with the hour on the map. *Under way: season, weather, night and the hour show in both views. There is no sound.*
- [ ] The walking view can only follow. It rebuilds the whole scene whenever the map changes. *Under way: a visitor can look around, move closer and click a resident to follow. The village is still rebuilt on every map revision.*
- [ ] The page fetches every resident's whole record every 2.5 seconds. *Not begun: only the map is fetched on demand.*

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
- [ ] **A thread a viewer can follow.** Under way. The request archive is live. Work remains on how the oven and woodpile look.
  - [x] A link to a resident
  - [x] A permanent link to each delivered request
  - [x] The resident panel shows open requests and their status, with a link to the recorded changes
  - [x] History by participant or commitment beyond the latest 100 entries
  - [x] A follow button kept in the browser, and "since your last visit"
  - [ ] Mabel with a peel at the oven, Oswin working at the woodpile. Under way: in the walking view only, from commit `c3353a5`.
  - [ ] A stack that changes with the store
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

- [ ] **Two kinds of goal.** Not begun. Residents still hold the goals they were founded with.
- [ ] **Goal reviews.** Not begun. The model for this work is chosen, in design decision 6. No review runs.
- [ ] **The chain in PostgreSQL.** Not begun. Links 3 and 4 exist for action choices, through decision traces. The goal links do not.
- [ ] **Memory.** Not begun.
- [ ] **Relationships with substance.** Not begun.
- [ ] **A resident's own words.** Not begun.

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

- [ ] **Seasons and weather.** Under way. The village has a calendar, daylight, weather and hearths that burn the woodpile. Barley is still gathered in January, and the year is the real 365 days, which is open decision 10.
- [ ] **Households.** Not begun. A household can wake to a cold hearth, but it draws on the common store.
- [ ] **Lives.** Not begun. Cold is now a fourth need, and a chilled resident sleeps badly. Nothing follows from it yet.
- [ ] **A working day.** Under way. Fields and coppice are worked by daylight only. Queues, decay and feast days are not begun.
- [ ] **Outside events.** Not begun.
- [ ] **A chronicle that selects.** Under way. The page opens on highlights that leave routine out. Events carry no salience of their own, and food is still a fraction of a bin.

- **Seasons and weather.** A year of about 48 village days. Fields produce only in their season. Winter burns wood and eats the stores.
- **Households.** Each cottage has its own larder and woodpile, so one household can run short while the village does not.
- **Lives.** Courtship, marriage, children, old age and death. Illness from hunger, cold or overwork. A resident who is not housed or fed for long leaves.
- **A working day.** Trades have hours, the mill and oven have queues, buildings decay and need the carpenter, and feast days are for the green.
- **Outside events.** A peddler, a tax collector, a storm, a stray herd.
- **A chronicle that selects.** Each event carries a salience. Routine goes to a resident's own log. Measure food in days, not as a fraction of a bin, so that building a granary no longer reads as a shortage.

Local rules can exercise these mechanics cheaply in the Sandbox and in tests. They are a harness for the engine. What residents do about a hard winter is still chosen by the models.

Done when: in harness runs no sentence is more than 10% of the chronicle and a hard winter arrives that the stores can fail to cover; and in the live village the number of real tradeoffs per resident per day, as Stage 0 counts them, has risen without the clock or the budget giving way.

### Stage 4. Voices: competing interests and the moot (L)

Apply the pilot's mechanism to a second problem, and let the village decide things by people taking positions.

**Marked off · 21 November 2026.**

- [ ] **A second story.** Not begun.
- [ ] **Ballots.** Not begun. Votes are still supporter-or-random. The moot itself reaches quorum and builds on the model-driven path.
- [ ] **News travels.** Under way. Supply counts and work reports already pass by word of mouth and keep their first witness and time. Other news, and rumour that can be wrong, are not begun.
- [ ] **Words.** Not begun.
- [ ] **A wider agenda.** Not begun.

- **A second story.** A lodger wants a cottage while the growers want another field. Residents who hear a proposal are offered positions on it.
- **Ballots.** When the moot opens, each attending resident receives an explicit ballot from the Decisions API, with their own goals, obligations and what they know. The engine counts recorded ballots, resolves quorum, deducts materials and builds through the existing civic rules. Support, opposition, abstention and a postponed work are all valid endings.
- **News travels.** Facts spread through conversation and witness, using Stage 2's observations. Two test villages with different witnesses give residents different evidence. Rumour can be wrong.
- **Words.** For an exchange that matters, the general-purpose model may write what was said. The positions and their effects are already decided and recorded. The words are labelled as an account.
- **A wider agenda.** A catalogue of works the engine can build and bylaws it can enforce. Residents propose from it. The catalogue grows by code.

Done when: a ballot can be traced to the goals and observations its voter was given; a piece of news can be followed from the person who saw it to the person who acted on it; and a moot runs to a valid outcome on the production path with every ballot recorded.

### Stage 5. Worth watching (M, can start alongside Stage 3)

Presentation. The pilot delivers the first of it: links, the promise thread and readable work at the oven and woodpile.

**Marked off · 21 November 2026.**

- [ ] **Show events where they happen.** Not begun.
- [ ] **A director.** Not begun.
- [x] **Show the basis.** Done. The resident panel and the map card show the recorded reason for an activity or a wait. A deciding resident carries a question mark on the map and a hand on the chin in the walking view.
- [x] **Dalecrest Daily.** Robin reports from around the village. Each morning’s edition includes his notes, village records and follow-ups.
- [ ] **Seasons, weather and the hour.** Under way. Seasons, weather, night and going indoors are in both views. Tools and trade movements arrived in commit `c3353a5`, in the walking view only.
- [ ] **A richer parish.** Under way. Kitchen gardens, shaded relief, canopy woods, light moving on the river and drifting cloud shadow. No fences, woodpiles, animals or sound.
- [ ] **Time-lapse.** Not begun.
- [ ] **Streaming.** Not begun. The page polls every 2.5 seconds. Walking is animated between snapshots, which hides most of the gap.

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

- [ ] **Pages with addresses.** Under way. A resident has an address, such as `#village/agnes`. Nothing else does.
- [ ] **Follow.** Not begun.
- [ ] **Why did she do that?** Not begun.
- [ ] **An archive.** Not begun.

- **Pages with addresses** for every resident, household, promise, moot and day.
- **Follow** with no account, plus a feed for the village and for each resident, a weekly letter and a webhook.
- **Why did she do that?** A public, trimmed view of the record: what the resident knew, which goals were in force, whether the activity was a fresh choice or routine, and what happened. Motive is shown only where a record supports it. The full exchange stays private.
- **An archive** of every day of the chronicle with the map as it was.

Done when: in a small pilot, people voluntarily return to check on a resident, and it is known which unresolved matter brought them back.

### Stage 7. Taking part (L)

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

### Stage 8. A wider world (later)

**Marked off · 21 November 2026.**

- [ ] **More than one village.** Not begun.

More than one village with a road between them. This multiplies everything above, including the cost, and waits until one village holds an audience.

## Order and dependencies

- Stages 0 and 1 are the first milestone and are built together. The pilot is what tunes Stage 0's parameters.
- Stage 2 needs the observations and commitments the pilot introduces.
- Stage 3 is engine work and can begin once Stage 0 can count real tradeoffs. Its presentation counterpart, Stage 5, can run beside it.
- Stage 4 needs Stage 2's goals and observations.
- Stage 6 needs the records from Stages 1 and 2 and reads best after Stage 5's daily account.
- Stage 7 needs Stage 4's ballots and positions, which are what make a visitor's petition something residents can answer.

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
10. [ ] **It was affordable.** Spending stayed inside both caps and every measurement in the list above was captured. *Awaiting pilot: `tools/pilot-report.mjs` is ready to report it.*

## Decisions that remain open

1. **The pace of the clock and the other Stage 0 thresholds.** Thirty seconds per village minute is a starting value. The pilot sets them.
2. **A resident with no instruction and no reply.** This plan has them wait indefinitely. The alternative is a default the engine applies after a long wait, which would be an action no model chose. That changes the agreed roles and needs an explicit decision.
3. **Who issues standing instructions.** The action choice that is reused, the goal review that sets a routine, or both.
4. **How long a promise lasts in real viewing time.** The starting assumption is a visitor who watches for two minutes and checks back tomorrow.
5. **What the audience may see before residents learn it.** The starting assumption is a public record of observable events.
6. **How the action and goal budgets are divided**, and whether the daily account in Stage 5 has a third.
7. **When the pilot reaches the live village.** It is proved in a test village. Moving it to the live one changes what residents know about the stores. *Note, 21 November 2026: oven observations and requests for help are already on `main`, which the live village deploys, so this has in effect been settled by deployment. It should be recorded as decided or reopened.*
8. **Whether residents die**, and whether the live village is migrated or a new one is founded when Stage 3 changes the economy.
9. **How far visitors may reach.** Stage 7 can stop at any step. Letters are the first with real moderation work.
10. **How long a year is.** Stage 3 proposes a year of about 48 village days. The calendar and the weather now keep the real year of 365, which at two village days to a real day takes six real months. One of the two has to give.
11. **Whether the wood store grows with the village.** It holds 32 bundles at any size. With winter fuel that is about a day's burning for thirty hearths in frost, so a large village cannot lay in wood for a cold spell.

## Future considerations

Questions the stages above do not answer. This section was added on 21 November 2026. Nothing here is scheduled or decided. Each is worth a deliberate answer before the point named under it.

1. **Keeping the two editions in step.** This document is the canonical plan and [roadmap.html](roadmap.html) is a hand-made rendering of it. Both now carry the marks, so every change of status has to be made twice. Generating the page from this file would remove that. *Before the next status changes.*
2. **Proving a model change is safe.** Every exchange is stored with the exact request that was sent. Replaying stored requests against a candidate model or a reworded request would show how choices shift before the village feels it. Stages 1 and 2 both change what the request contains, and design decision 6 expects providers to change. *Before the first change of model, or Stage 2's larger request.*
3. **Records that only grow.** Events, the activity log and decision traces gain rows with every tick, and each resident's record grows with what they hold. Stage 6 wants an archive of every day. What is kept whole, what is summarised and what may be dropped needs deciding while the tables are still small. *Before Stage 6, or the first slow query.*
4. **Many viewers at once.** Each open page asks for the whole village every 2.5 seconds and the server builds the answer afresh each time. Stage 5's streaming improves freshness. It does not by itself settle what a hundred watchers cost. One snapshot built per tick and shared by everyone may be enough. *Before Stage 5's first public test.*
5. **A village that can be read without the map.** Acceptance test 8 puts first-time viewers on phones. Both views are pictures: a visitor using a screen reader, or a small screen in the walking view, gets little of what is happening. A plain account of the current scene would serve them and would also feed Stage 5's director. *Before acceptance test 8 is run.*
6. **Model-written prose in public.** Stage 2 publishes a resident's own sentence, Stage 4 an account of what was said, and Stage 5 a daily account. Each is text nobody reviewed, shown under the village's name. The plan labels these as accounts. It does not yet say how they are screened, how a wrong one is withdrawn, or how they keep a period voice. *Before Stage 2's first published sentence.*
7. **History beyond the parish.** Dalecrest was founded on 1 August 1312 and keeps the real Julian calendar. The Great Famine of 1315 to 1317 lies under three village years ahead, about a year and a half of real time at the present pace. Whether the outside world reaches the village at all is undecided, and a 48-day year would cut the calendar loose from history altogether. *With open decisions 8 and 10.*
8. **Knowing when the village is in trouble.** The caps bound what can be spent and the activity log records every wait. What tells an operator that the provider has been down for an hour, or that half the village has stood waiting since noon? The pilot's deliberate outage is the natural rehearsal, and open decision 2 depends on how long such waits really last. *Before the pilot week.*
9. **The tests that need a database.** Eight of the 59 tests require PostgreSQL. They include the ones that prove a restart yields each outcome exactly once, which is acceptance test 2. It is worth confirming that the deploy run includes them, so the promise is checked on every release and not only on a machine that happens to have a database. *Before acceptance test 2 is signed off.*

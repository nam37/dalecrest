# Dalecrest roadmap

**Canonical plan · 21 November 2026.** This document is the one plan for moving Dalecrest from a small simulated village to one people want to watch, follow and take part in. It describes work to be done. Nothing here is implemented or deployed by being written down.

- The accepted architecture is the [resident knowledge graph](knowledge-graph.md). Where this plan and that document differ, the knowledge graph governs and this plan is wrong.
- [Design decisions](design.md) describes the village as it runs today.
- [Give Dalecrest residents something worth following](proposal-village-life.md) is design background. It argued for the promise pilot that is now the first milestone, and its reasoning is worth reading. Its stage list is superseded by this one.

## The roles this plan keeps

Three responsibilities are fixed. Every stage below is written to preserve them.

| Role | Responsibility |
| --- | --- |
| A general-purpose model | Sets and revises each resident's persistent goals. |
| The Decisions API | Chooses a meaningful, feasible action in light of those goals, the resident's needs and what the resident knows. |
| The simulation | Executes the chosen action, establishes what actually happened and records it. |

The providers behind the two model roles can change without changing who is responsible for what. The current choices are recorded in [design decision 6](design.md).

## Measurements before Stage 0

Each figure is marked with where it came from. "Local rules" means the scoring in `choose` in `sim.mjs`, which runs in tests, the Atlas and the preview. It is a stand-in for measurement, not the production decider. The mix of activities the Decisions API chooses in production has not been measured.

| What | Value | Source |
| --- | --- | --- |
| Activities a resident starts per village day | 23.2 to 23.3. About 184 a day for eight residents. | Measured, local rules, 60 days on seeds 26111, 26112 and 26113 |
| What those 23 are | Leisure 11.8, sleep 4.9, visiting 2.2, own trade 1.9, meals 1.4, other work and building 0.7, moot 0.3 | Measured, same runs, founding residents |
| Activities that repeat the one before, in the same place | 55% | Measured, same runs |
| Separate choices that make up one night's sleep | 4.9 | Measured, same runs |
| Tokens per action request | 589 | Historical production observation used in the original cost estimate |
| Action budget | 7,000 tokens per real hour by default, about 168,000 a real day | Configuration |
| Previous clock | 49 seconds until the next tick, which advanced one village minute. The planner reported "waiting for token budget". | One public snapshot before the fixed-clock release on 21 November 2026 |
| Wood store | Never below 10 of 32. Never below 20 while a building site was open. No minute with flour and no wood. | Measured, local rules, same runs |
| Daytime | 56% idling, 17% at a trade, 10% walking, 8% visiting | Measured, local rules, seed 26111 |
| The chronicle | 49 entries a day. One sentence, "took a loaf from the common oven", is 35% of them. Moots, building and arrivals are 4%. | Measured, local rules, seed 26111 |
| Memory given to the action model | The two latest memory texts. Changing an older promise or a relationship score leaves the request byte-for-byte identical. | Checked against `decisions.mjs` in the background proposal |

Walking to a worksite and doing the job there already count as one activity. The 23 a day cannot be reduced by merging the walk into the work.

Three conclusions shape the plan.

1. **The former clock slowed when money for calls ran short.** Stage 0 moved timekeeping off the decision queue.
2. **Many activities repeat.** One night's sleep spanned about five boundaries in the local runs. Stage 0 lets a still-valid model instruction cover routine repeats.
3. **Promises need durable records.** Residents remember encounters, but the model sees only the latest two memory texts. A promise needs to survive later meals and shifts.

## Review: how the residents think

Stage numbers refer to the plan below.

1. **Clock and queue.** Stage 0 made the village clock independent of model latency. A resident can wait while others continue.
2. **Routine decisions.** Stage 0 lets a resident continue sleeping under a valid earlier instruction. The activity log records the original model choice.
3. **The action model is shown too little.** `actionBody` in `decisions.mjs` sends needs, stores, two memories and a menu. It leaves out relationships, open obligations and what the resident has learned. (Stages 1 and 2)
4. **Place names.** Stage 0 added readable place names to option descriptions. Choice IDs still identify the exact action.
5. **Moot attendance.** A scripted test exercises quorum and construction on the model-driven path. How often real residents choose to attend remains a pilot measurement. [Standing-instruction tests](../standing.test.mjs)
6. **Memory is a short list of sentences.** `remember` in `engine/civic.mjs` keeps 18 strings with no source, importance or recall. (Stages 1 and 2)
7. **Everyone knows everything.** The menu and the request use the true stores and every resident's true destination. "Bake" disappears from a menu the moment someone far away uses the last wood. (Stage 1)
8. **Residents cannot ask, agree, decline or vote.** Encounters pick one of five templates. Votes in `resolve` are supporter-or-random. One template is wrong in effect: "discussed the dwindling grain reserve" fires when a store is under a quarter of its capacity, so building a granary makes it fire more often. (Stage 1 for asking and agreeing, Stage 3 for the fix, Stage 4 for votes)
9. **Relationships are one number that only rises.** After 60 days, 19 of 122 are at the maximum. (Stages 2 and 3)
10. **People only arrive, and the economy has no pressure.** Nobody is born, grows old, falls ill or leaves. One harvest shift feeds the founding village for a day. (Stage 3)

What is already right and should be kept: the simulation is deterministic and replays from JSON; every model exchange is recorded before it is applied; the engine checks a chosen action again before starting it; and the map is data the village owns.

## Review: how it looks

The map and the walking view are sound and draw the same data. What is missing is legibility and life.

- Nothing marks that something is happening. A request, a moot and a building site look like an empty lane.
- Every trade is the same arm movement, and a resting resident stands outside their door.
- A selected resident is not in the URL, a fresh page always starts with Agnes, and only the latest 100 chronicle entries can be reached.
- There is no season, weather, sound or change with the hour on the map.
- The walking view can only follow. It rebuilds the whole scene whenever the map changes.
- The page fetches every resident's whole record every 2.5 seconds.

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

**Implemented so far.** Shifts record their actual stock changes. Any resident can check the communal oven and carry a personal, dated count of flour and firewood into a later decision. A baker can go back to resolve uncertainty. A depleted store can also surprise someone acting on an older count. The next test is whether someone who learns the oven needs wood can choose to share that fact or ask a neighbour for help. [Inspect a shift outcome](decision-tracing.md#inspect-an-oven-or-woodcutting-shift) · [Trace an oven inspection](decision-tracing.md#trace-an-oven-inspection)

Mabel Ash needs wood for the oven. Oswin Holt cuts it. Mabel may ask Oswin for help, and he may accept, decline or leave it unanswered. If he accepts, the promise can be kept, broken or overtaken by events. Each of those is an ending the village records and a viewer can return to find.

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
- **Requests and commitments.** One durable record for a two-party promise: both residents, the terms, the village minute it falls due, its status and the event that began it. Its statuses are asked, accepted, declined, unanswered, kept, broken, overtaken and released.
- **Choices.** Asking, accepting and declining are actions on the menu, chosen by the Decisions API on the resident's own turn. The request to the action model includes the open commitment, the relevant observation and the standing with the other party.
- **Credit.** The promise is kept when Oswin's own shift adds the wood before it falls due. If someone else fills the store first, the shortage is relieved, the promise is marked overtaken and Oswin earns no credit. If the hour passes with it open, it is broken, and Oswin knows.
- **A thread a viewer can follow.** A link to a resident and to a promise. The resident panel shows the open promise, its status and the last verified change. History can be read by participant or commitment beyond the latest 100 entries. A follow button kept in the browser, and "since your last visit". Mabel with a peel at the oven, Oswin working at the woodpile, a stack that changes with the store and an oven that is lit during a bake.

The pilot uses the residents' existing goals. Goal reviews arrive in Stage 2.

**First proof: a staged shortage in a test village.** In a disposable PostgreSQL village, set the store to flour and no wood and place Mabel at the oven. Use recorded or scripted choices to drive every branch: accepted and kept; accepted and broken; declined; left unanswered until it lapses; overtaken by another resident's wood; and a store that changes between choice and execution. Restart the server between a choice and its completion. Then run the same starting position with budgeted real turns to learn whether an open promise changes what the Decisions API chooses.

**Second proof: one ordinary pressure.** A staged shortage shows that the branches work. It does not show that the story will ever happen. In 60-day runs today the wood store never falls below 10, and never below 20 while a site is open. Choose one ordinary pressure, such as a building project that draws its timber when the footings are set instead of a bundle a shift, and test whether it produces a morning with flour and no wood without scripting. One pressure is enough for the pilot. Personal inventories, deliveries and prices wait until a second story needs them.

**Status · 21 November 2026.** Winter fuel is the chosen pressure. It is built on the `winter-fuel` branch and is not deployed. Hearths draw firewood from the common store on cold mornings, and in seeded runs under local rules a morning with flour and no wood arises unscripted, with a baker learning of it by going to look. Whether it changes what the Decisions API chooses is not yet measured. [Design decision 11](design.md)

Done when: the acceptance tests at the end of this document pass.

### Stage 2. Goals and memory (M)

Give each resident goals that persist and change for reasons, set by the general-purpose model.

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

- **Seasons and weather.** A year of about 48 village days. Fields produce only in their season. Winter burns wood and eats the stores.
- **Households.** Each cottage has its own larder and woodpile, so one household can run short while the village does not.
- **Lives.** Courtship, marriage, children, old age and death. Illness from hunger, cold or overwork. A resident who is not housed or fed for long leaves.
- **A working day.** Trades have hours, the mill and oven have queues, buildings decay and need the carpenter, and feast days are for the green.
- **Outside events.** A peddler, a tax collector, a storm, a stray herd.
- **A chronicle that selects.** Each event carries a salience. Routine goes to a resident's own log. Measure food in days, not as a fraction of a bin, so that building a granary no longer reads as a shortage.

Local rules can exercise these mechanics cheaply in the Atlas and in tests. They are a harness for the engine. What residents do about a hard winter is still chosen by the models.

Done when: in harness runs no sentence is more than 10% of the chronicle and a hard winter arrives that the stores can fail to cover; and in the live village the number of real tradeoffs per resident per day, as Stage 0 counts them, has risen without the clock or the budget giving way.

### Stage 4. Voices: competing interests and the moot (L)

Apply the pilot's mechanism to a second problem, and let the village decide things by people taking positions.

- **A second story.** A lodger wants a cottage while the growers want another field. Residents who hear a proposal are offered positions on it.
- **Ballots.** When the moot opens, each attending resident receives an explicit ballot from the Decisions API, with their own goals, obligations and what they know. The engine counts recorded ballots, resolves quorum, deducts materials and builds through the existing civic rules. Support, opposition, abstention and a postponed work are all valid endings.
- **News travels.** Facts spread through conversation and witness, using Stage 2's observations. Two test villages with different witnesses give residents different evidence. Rumour can be wrong.
- **Words.** For an exchange that matters, the general-purpose model may write what was said. The positions and their effects are already decided and recorded. The words are labelled as an account.
- **A wider agenda.** A catalogue of works the engine can build and bylaws it can enforce. Residents propose from it. The catalogue grows by code.

Done when: a ballot can be traced to the goals and observations its voter was given; a piece of news can be followed from the person who saw it to the person who acted on it; and a moot runs to a valid outcome on the production path with every ballot recorded.

### Stage 5. Worth watching (M, can start alongside Stage 3)

Presentation. The pilot delivers the first of it: links, the promise thread and readable work at the oven and woodpile.

- **Show events where they happen**, on the map and in the walking view. A chronicle entry takes you to its place and time.
- **A director.** A watch mode that follows whoever is in the middle of something and holds on the scene. It is what a first-time visitor sees.
- **Show the basis.** A resident who is waiting on a decision looks like someone making up their mind. A resident following routine looks like routine.
- **Yesterday in Dalecrest.** A short account of each village day written by the general-purpose model on its own budget. Every claim in it must cite an event.
- **Seasons, weather and the hour** in both views. Tools in hand, a movement for each trade, residents who go indoors.
- **A richer parish.** Gardens, fences, woodpiles, animals, moving water, sound.
- **Time-lapse** of the village's growth from stored map revisions.
- **Streaming.** Send changes to the page as they happen. Update the walking view in place.

Done when: someone who opens the site with no explanation stays more than two minutes and can say afterwards what happened while they watched.

### Stage 6. Worth following (M)

- **Pages with addresses** for every resident, household, promise, moot and day.
- **Follow** with no account, plus a feed for the village and for each resident, a weekly letter and a webhook.
- **Why did she do that?** A public, trimmed view of the record: what the resident knew, which goals were in force, whether the activity was a fresh choice or routine, and what happened. Motive is shown only where a record supports it. The full exchange stays private.
- **An archive** of every day of the chronicle with the map as it was.

Done when: in a small pilot, people voluntarily return to check on a resident, and it is known which unresolved matter brought them back.

### Stage 7. Taking part (L)

Let visitors introduce circumstances. Residents keep the final say over their own actions.

1. **React.** Visitors mark events. This informs the director and changes nothing in the village.
2. **A petition, in a separate village.** A persistent pilot village with its own database and model allowance. A viewer posts a petition for a second well. One open petition per subject. Its origin is recorded, residents who encounter it may ignore, contest or support it, and the petitioner is shown what became of it.
3. **The peddler's cart.** Visitors choose what the peddler brings from a short list.
4. **Letters.** A short, screened, rate-limited letter to a resident, which enters the village only as an observation from far away. Visitor text is data to a model, never instruction.
5. **Your own village.** A shareable link to an Atlas village first. Hosted villages later.

Done when: a repeat submission creates one petition; a petition can lapse unheard or lose a vote; every resident response links to a real choice; and the original village carried on independently throughout.

### Stage 8. A wider world (later)

More than one village with a road between them. This multiplies everything above, including the cost, and waits until one village holds an audience.

## Order and dependencies

- Stages 0 and 1 are the first milestone and are built together. The pilot is what tunes Stage 0's parameters.
- Stage 2 needs the observations and commitments the pilot introduces.
- Stage 3 is engine work and can begin once Stage 0 can count real tradeoffs. Its presentation counterpart, Stage 5, can run beside it.
- Stage 4 needs Stage 2's goals and observations.
- Stage 6 needs the records from Stages 1 and 2 and reads best after Stage 5's daily account.
- Stage 7 needs Stage 4's ballots and positions, which are what make a visitor's petition something residents can answer.

## Cost and pacing

**Pre-Stage 0 baseline.**

- A resident reaches about 23 activity boundaries per village day. Eight residents reach roughly 184.
- The historical production sample used 589 tokens per action request.
- The default budget is about 168,000 tokens a real day, which funds about 285 requests of that size.
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

1. **Every ending is reachable.** In a test village with scripted choices, the promise ends kept, broken, declined, unanswered and overtaken, and one run has the store change between choice and execution. Each ending agrees with the stores.
2. **It survives a restart.** Restarting between a choice and its completion yields each outcome exactly once. Earlier history still opens.
3. **The promise reaches the model.** With the menu held fixed, changing an open promise or the standing between two residents changes the serialized action request.
4. **Knowledge stays local.** A resident who did not see or hear of the shortage receives no trace of it in their request. Mabel's request shows the wood she last observed and when, and a test makes that differ from the true store.
5. **The chronicle claims only what it can verify.** Every statement about the promise links to a recorded event or outcome. A plain woodcutting shift is not credited to the promise. Wood supplied by someone else relieves the shortage and gives Oswin no credit.
6. **The answer can be traced.** Starting from the outcome, one query returns the choice that produced it, whether that activity was a fresh choice or routine, the commitment and observations the model was given, and the exact exchange.
7. **Time kept moving.** Through the pilot, including a deliberate provider outage, the clock was never more than one tick late and no resident followed a stale instruction.
8. **A viewer can read it.** Four of five first-time viewers, on a mix of phones and desktops, can say who wanted what and what happened within 90 seconds. On a second visit a day later they can find the ending after it has left the latest 100 entries.
9. **It can happen unprompted.** With the one chosen pressure in place and no scripting, a morning with flour and no wood arises in seeded runs, and Mabel learns of it by going to look.
10. **It was affordable.** Spending stayed inside both caps and every measurement in the list above was captured.

## Decisions that remain open

1. **The pace of the clock and the other Stage 0 thresholds.** Thirty seconds per village minute is a starting value. The pilot sets them.
2. **A resident with no instruction and no reply.** This plan has them wait indefinitely. The alternative is a default the engine applies after a long wait, which would be an action no model chose. That changes the agreed roles and needs an explicit decision.
3. **Who issues standing instructions.** The action choice that is reused, the goal review that sets a routine, or both.
4. **How long a promise lasts in real viewing time.** The starting assumption is a visitor who watches for two minutes and checks back tomorrow.
5. **What the audience may see before residents learn it.** The starting assumption is a public record of observable events.
6. **How the action and goal budgets are divided**, and whether the daily account in Stage 5 has a third.
7. **When the pilot reaches the live village.** It is proved in a test village. Moving it to the live one changes what residents know about the stores.
8. **Whether residents die**, and whether the live village is migrated or a new one is founded when Stage 3 changes the economy.
9. **How far visitors may reach.** Stage 7 can stop at any step. Letters are the first with real moderation work.
10. **How long a year is.** Stage 3 proposes a year of about 48 village days. The calendar and the weather now keep the real year of 365, which at two village days to a real day takes six real months. One of the two has to give.
11. **Whether the wood store grows with the village.** It holds 32 bundles at any size. With winter fuel that is about a day's burning for thirty hearths in frost, so a large village cannot lay in wood for a cold spell.

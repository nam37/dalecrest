// What residents know and want, kept in PostgreSQL so an operator can follow a resident from what they
// saw to what they chose and what came of it, without replaying the village. See Stage 2 of
// docs/roadmap.md and "Follow a goal" in docs/decision-tracing.md.
//
//   observations   every memory a resident forms, keyed by resident and number, linked to the
//                  chronicle entry it records when there is one
//   goal_reviews   each exchange with the goal-setting model, exactly as sent and received
//   goal_versions  every version of every goal, with the observations and evidence it rests on
//   goal_chain     a view: observation -> goal version -> action choice -> outcome -> who witnessed it

export const knowledgeSchema = `
  CREATE TABLE IF NOT EXISTS dalecrest.observations (
    actor_id text NOT NULL, seq integer NOT NULL, minute bigint NOT NULL, kind text NOT NULL, text text NOT NULL,
    actor_ids text[] NOT NULL DEFAULT '{}', place text, importance smallint NOT NULL, source text NOT NULL,
    details jsonb NOT NULL DEFAULT '{}', event_id bigint REFERENCES dalecrest.events(id),
    PRIMARY KEY (actor_id, seq)
  );
  CREATE INDEX IF NOT EXISTS observations_event ON dalecrest.observations (event_id) WHERE event_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS dalecrest.goal_reviews (
    id bigserial PRIMARY KEY, actor_id text NOT NULL, observed_minute bigint NOT NULL, why text NOT NULL,
    model text NOT NULL, request_body text NOT NULL, offered text[] NOT NULL DEFAULT '{}',
    requested_at timestamptz NOT NULL DEFAULT clock_timestamp(), status text NOT NULL DEFAULT 'requested',
    response_at timestamptz, http_status integer, response_body text, token_charge integer, error text,
    applied_minute bigint, result jsonb, statement text, statement_event_id bigint REFERENCES dalecrest.events(id)
  );
  CREATE INDEX IF NOT EXISTS goal_reviews_actor ON dalecrest.goal_reviews (actor_id, id DESC);
  CREATE INDEX IF NOT EXISTS goal_reviews_spend ON dalecrest.goal_reviews (requested_at) WHERE token_charge IS NOT NULL;
  CREATE TABLE IF NOT EXISTS dalecrest.goal_versions (
    actor_id text NOT NULL, goal_id text NOT NULL, version integer NOT NULL, kind text NOT NULL, text text NOT NULL,
    focus text, about text, condition jsonb, status text NOT NULL, since_minute bigint NOT NULL, settled_minute bigint,
    outcome jsonb, basis text[] NOT NULL DEFAULT '{}', source text NOT NULL,
    review_id bigint REFERENCES dalecrest.goal_reviews(id),
    PRIMARY KEY (actor_id, goal_id, version)
  );
  CREATE OR REPLACE VIEW dalecrest.goal_chain AS
    SELECT src.actor_id, src.seq AS observation_seq, src.minute AS observed_minute, src.text AS observation,
      gv.goal_id, gv.version AS goal_version, gv.text AS goal, gv.review_id,
      t.id AS trace_id, t.choice, e.id AS outcome_event_id, e.description AS outcome,
      w.actor_id AS witnessed_by, w.seq AS witness_seq
    FROM dalecrest.observations src
    JOIN dalecrest.goal_versions gv ON gv.actor_id = src.actor_id AND (src.actor_id || ':' || src.seq) = ANY (gv.basis)
    JOIN dalecrest.decision_traces t ON t.actor_id = gv.actor_id AND (gv.actor_id || ':' || gv.goal_id || ':' || gv.version) = ANY (t.goal_keys)
    LEFT JOIN dalecrest.events e ON e.outcome->>'traceId' = t.id::text
    LEFT JOIN dalecrest.observations w ON w.event_id = e.id;
`;

const row = (actor, m) => {
  const { id, minute, text, actorIds, kind, importance, source, place, ...details } = m;
  return { actor_id: actor.id, seq: id, minute, kind, text, actor_ids: actorIds || [], place: place ?? null,
    importance: importance ?? 2, source: source || 'witnessed', details };
};

// Stores each resident's memories not yet stored, linking each to the chronicle entry with the same
// minute and words. chronicle is what recordEvents returned for this tick. actor.observedTo marks how far
// a resident's memories have been stored, so call this before the residents are saved.
export async function writeObservations(db, actors, chronicle = []) {
  const rows = [];
  for (const actor of actors) {
    for (const m of actor.memories || []) if (m.id != null && m.id > (actor.observedTo || 0)) rows.push(row(actor, m));
    actor.observedTo = Math.max(actor.observedTo || 0, ...(actor.memories || []).map(m => m.id || 0));
  }
  if (!rows.length) return;
  const said = new Map(chronicle.map(e => [Number(e.minute) + '|' + e.description, e.id]));
  for (const r of rows) r.event_id = said.get(r.minute + '|' + r.text) ?? null;
  await db.query(`INSERT INTO dalecrest.observations(actor_id,seq,minute,kind,text,actor_ids,place,importance,source,details,event_id)
    SELECT actor_id,seq,minute,kind,text,actor_ids,place,importance,source,details,event_id FROM jsonb_to_recordset($1)
    AS o(actor_id text, seq integer, minute bigint, kind text, text text, actor_ids text[], place text, importance smallint,
      source text, details jsonb, event_id bigint)
    ON CONFLICT (actor_id, seq) DO NOTHING`, [JSON.stringify(rows)]);
}

// Stores every goal version the engine has changed since it was last stored, and marks it stored.
// Call before the residents are saved, so the marks are saved with them.
export async function writeGoals(db, actors) {
  const rows = [];
  for (const actor of actors) {
    for (const g of [...(actor.goalBook || []), ...(actor.goalHistory || [])]) {
      if (g.stored) continue;
      rows.push({ actor_id: actor.id, goal_id: g.id, version: g.version, kind: g.kind, text: g.text, focus: g.focus ?? null,
        about: g.about ?? null, condition: g.condition ?? null, status: g.status, since_minute: g.since, settled_minute: g.settled ?? null,
        outcome: g.outcome ?? null, basis: g.basis || [], source: g.source, review_id: g.reviewId ?? null });
      g.stored = true;
    }
  }
  if (!rows.length) return;
  await db.query(`INSERT INTO dalecrest.goal_versions(actor_id,goal_id,version,kind,text,focus,about,condition,status,since_minute,
      settled_minute,outcome,basis,source,review_id)
    SELECT actor_id,goal_id,version,kind,text,focus,about,condition,status,since_minute,settled_minute,outcome,basis,source,review_id
    FROM jsonb_to_recordset($1) AS g(actor_id text, goal_id text, version integer, kind text, text text, focus text, about text,
      condition jsonb, status text, since_minute bigint, settled_minute bigint, outcome jsonb, basis text[], source text, review_id bigint)
    ON CONFLICT (actor_id, goal_id, version) DO UPDATE SET status = excluded.status, settled_minute = excluded.settled_minute,
      outcome = excluded.outcome, basis = excluded.basis, condition = excluded.condition`, [JSON.stringify(rows)]);
}

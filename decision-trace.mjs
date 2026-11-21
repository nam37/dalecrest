import { stepVillage } from './sim.mjs';

export async function initializeTraces(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS dalecrest.decision_traces (
      id bigserial PRIMARY KEY, actor_id text NOT NULL, model text NOT NULL,
      endpoint text NOT NULL, request_body text NOT NULL, observed_minute bigint NOT NULL,
      requested_at timestamptz NOT NULL DEFAULT clock_timestamp(), status text NOT NULL DEFAULT 'requested',
      response_at timestamptz, http_status integer, provider_request_id text, response_body text,
      credential_redacted boolean NOT NULL DEFAULT false, error text, choice text, confidence double precision,
      applied_minute bigint, until_minute bigint, state_at_application jsonb,
      ended_minute bigint, end_reason text
    );
    CREATE INDEX IF NOT EXISTS decision_traces_actor ON dalecrest.decision_traces (actor_id,id DESC);
    ALTER TABLE dalecrest.decision_traces ADD COLUMN IF NOT EXISTS decision_since bigint,
      ADD COLUMN IF NOT EXISTS token_charge integer;
    CREATE UNIQUE INDEX IF NOT EXISTS decision_action_pending ON dalecrest.decision_traces(actor_id)
      WHERE decision_since IS NOT NULL AND status IN ('requested','received');
    CREATE INDEX IF NOT EXISTS decision_tokens_by_time ON dalecrest.decision_traces(requested_at) WHERE token_charge IS NOT NULL;
    CREATE INDEX IF NOT EXISTS decision_traces_pending ON dalecrest.decision_traces (status,id)
      WHERE status IN ('requested','received');
    CREATE UNIQUE INDEX IF NOT EXISTS decision_traces_active ON dalecrest.decision_traces (actor_id)
      WHERE status='applied' AND ended_minute IS NULL;
    CREATE TABLE IF NOT EXISTS dalecrest.decision_steps (
      id bigserial PRIMARY KEY, trace_id bigint NOT NULL REFERENCES dalecrest.decision_traces(id),
      minute bigint NOT NULL, kind text NOT NULL, details jsonb NOT NULL DEFAULT '{}',
      event_id bigint REFERENCES dalecrest.events(id)
    );
    CREATE INDEX IF NOT EXISTS decision_steps_trace ON dalecrest.decision_steps (trace_id,minute,id);
  `);
}

export function residentState(actor) {
  return structuredClone({ action: actor.action, position: actor.position, needs: actor.needs });
}

// Observe each real minute. Choosing the same activity again creates a new action object.
export function advanceWithTraces(village, minutes, traces, externalActions = false) {
  if (!traces.length) return { events: stepVillage(village, { minutes, externalActions }), steps: [] };
  const events = [], steps = [];
  const byActor = new Map(traces.map(t => [t.actor_id, t]));
  for (let i = 0; i < minutes; i++) {
    const next = village.world.minute + 1;
    const observed = [];
    for (const actor of village.actors) {
      const trace = byActor.get(actor.id);
      if (trace && (trace.decision_since != null || next < Number(trace.until_minute))) {
        observed.push({ actor, trace, action: actor.action, phase: actor.action.phase, remaining: actor.action.remaining });
      }
    }
    const tickEvents = stepVillage(village, { minutes: 1, externalActions });
    events.push(...tickEvents);
    for (const { actor, trace, action, phase, remaining } of observed) {
      const add = kind => steps.push({ trace_id: trace.id, minute: next, kind, details: residentState(actor) });
      if (actor.action !== action && actor.action.kind === 'waiting') {
        steps.push({ trace_id: trace.id, minute: next, kind: 'activity_ended', details: { ...residentState(actor), action: structuredClone(action) } });
        if (trace.decision_since != null) byActor.delete(actor.id);
      } else if (actor.action !== action) add('selected');
      else {
        if (phase === 'travelling' && actor.action.phase === 'working') add('arrived');
        if (remaining > 0 && actor.action.remaining <= 0) add('activity_ended');
      }
    }
  }
  return { events, steps };
}

export async function writeSteps(db, steps, chronicle, traces, minute) {
  if (!traces.length) return;
  const byActor = new Map(traces.map(t => [t.actor_id, t]));
  const finished = steps.filter(s => s.kind === 'activity_ended' && traces.some(t => t.id === s.trace_id && t.decision_since != null));
  const ends = new Map(finished.map(s => [s.trace_id, s.minute]));
  for (const event of chronicle) {
    for (const id of event.actor_ids) {
      const trace = byActor.get(id);
      if (trace && (trace.decision_since != null ? Number(event.minute) <= (ends.get(trace.id) ?? Infinity) : Number(event.minute) < Number(trace.until_minute))) {
        steps.push({ trace_id: trace.id, minute: event.minute, kind: 'chronicle', details: {}, event_id: event.id });
      }
    }
  }
  if (steps.length) {
    await db.query(`INSERT INTO dalecrest.decision_steps(trace_id,minute,kind,details,event_id)
      SELECT trace_id,minute,kind,details,event_id FROM jsonb_to_recordset($1)
      AS s(trace_id bigint, minute bigint, kind text, details jsonb, event_id bigint)`, [JSON.stringify(steps)]);
  }
  if (finished.length) {
    await db.query(`UPDATE dalecrest.decision_traces t SET ended_minute=s.minute,end_reason='activity_ended'
      FROM jsonb_to_recordset($1) AS s(trace_id bigint, minute bigint) WHERE t.id=s.trace_id AND t.ended_minute IS NULL`, [JSON.stringify(finished)]);
  }
  if (traces.some(t => t.until_minute != null && Number(t.until_minute) <= minute)) {
    await db.query(`UPDATE dalecrest.decision_traces SET ended_minute=until_minute, end_reason='expired'
      WHERE status='applied' AND ended_minute IS NULL AND until_minute <= $1`, [minute]);
  }
}

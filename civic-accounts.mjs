import { screenStatement } from './engine/goals.mjs';

const modelName = process.env.DALECREST_CIVIC_MODEL?.trim() || 'claude-haiku-5-5';
const hourlyBudget = Number(process.env.CIVIC_ACCOUNT_TOKENS_PER_HOUR ?? 6000);
const eligible = `kind='civic' AND outcome->>'civic'='resolution'
  AND outcome->'ballots'->1 IS NOT NULL`;

export const civicAccountSchema = `
  CREATE TABLE IF NOT EXISTS dalecrest.civic_accounts (
    event_id bigint NOT NULL REFERENCES dalecrest.events(id), attempt smallint NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now(), model text NOT NULL, token_charge integer NOT NULL,
    account text, PRIMARY KEY (event_id, attempt)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS published_civic_account ON dalecrest.civic_accounts (event_id) WHERE account IS NOT NULL;
  CREATE INDEX IF NOT EXISTS civic_account_sources ON dalecrest.events (id) WHERE ${eligible};
`;

// The chronicle attaches a reconstruction to its source. The Daily and residents read the original event.
export const eventAccount = `(SELECT account FROM dalecrest.civic_accounts
  WHERE event_id=dalecrest.events.id AND account IS NOT NULL)`;

const instructions = `Reconstruct two lines for a labelled account of a medieval village debate.
Give each of the two supplied speakers one short sentence in their own voice, in the given order.
Express only how each voted on this proposal at the same moot, including abstention if recorded.
Invent no motives, evidence, promises or effects. The settled outcome is context only.
Use plain English without modern jargon. Return only the two lines without names or quotation marks.`;
const format = { type: 'object', additionalProperties: false, required: ['first', 'second'],
  properties: { first: { type: 'string' }, second: { type: 'string' } } };

// Hold a separate advisory lock only while reserving the cost of a call. Concurrent editors and
// restarts share the same rolling budget. An abandoned reservation still counts as an attempt.
export async function claimCivicAccount(db, { budget = hourlyBudget, model = modelName } = {}) {
  if (!Number.isSafeInteger(budget) || budget <= 0) return;
  await db.query('SELECT pg_advisory_xact_lock(39495128)');
  const { rows: [source] } = await db.query(`SELECT e.id, e.description, e.outcome, coalesce(last.attempt,0)+1 AS attempt,
      (SELECT jsonb_object_agg(id,state->>'name') FROM dalecrest.actors WHERE id=ANY(e.actor_ids)) AS names
    FROM dalecrest.events e LEFT JOIN LATERAL (
      SELECT attempt, requested_at FROM dalecrest.civic_accounts WHERE event_id=e.id ORDER BY attempt DESC LIMIT 1
    ) last ON true
    WHERE ${eligible} AND NOT EXISTS (
      SELECT 1 FROM dalecrest.civic_accounts WHERE event_id=e.id AND account IS NOT NULL)
      AND (last.attempt IS NULL OR (last.attempt<3 AND last.requested_at < now()-interval '10 minutes'))
    ORDER BY e.id LIMIT 1`);
  if (!source) return;
  const { ballots, title, proposalKey } = source.outcome;
  const first = ballots[0];
  const second = ballots.find(b => b.choice !== first.choice) || ballots[1];
  const speakers = [first, second].map(({ actorId, choice }) => ({ name: source.names?.[actorId] || actorId, vote: choice }));
  const body = JSON.stringify({ model, max_tokens: 200, system: instructions,
    messages: [{ role: 'user', content: JSON.stringify({ proposal: title || proposalKey, speakers, outcome: source.description }) }],
    output_config: { format: { type: 'json_schema', schema: format } } });
  const reserve = Buffer.byteLength(body) + 400;
  const { rows } = await db.query(`INSERT INTO dalecrest.civic_accounts(event_id,attempt,model,token_charge)
    SELECT $1,$2,$3,$4::integer WHERE $4::integer + (SELECT coalesce(sum(token_charge),0) FROM dalecrest.civic_accounts
      WHERE requested_at > now()-interval '1 hour') <= $5 RETURNING event_id`, [source.id, source.attempt, model, reserve, budget]);
  return rows.length ? { id: source.id, attempt: source.attempt, speakers, body } : null;
}

export async function writeCivicAccount(db, claim, key, request = fetch) {
  const response = await request('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(90000),
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': key }, body: claim.body
  });
  if (!response.ok) throw new Error('Civic account HTTP ' + response.status);
  const result = await response.json();
  if (result.stop_reason !== 'end_turn') throw new Error('Civic account incomplete');
  const lines = JSON.parse(result.content.find(b => b.type === 'text')?.text);
  const words = [screenStatement(lines?.first), screenStatement(lines?.second)];
  if (words.some(line => !line || line.includes(key))) throw new Error('Invalid civic account');
  const account = claim.speakers.map((speaker, i) => speaker.name + ' said, “' + words[i] + '”').join(' ');
  const usage = result.usage || {};
  const tokens = (usage.input_tokens || 0) + (usage.output_tokens || 0)
    + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  await db.query(`UPDATE dalecrest.civic_accounts SET account=$3,token_charge=coalesce($4,token_charge)
    WHERE event_id=$1 AND attempt=$2 AND attempt=(SELECT max(attempt) FROM dalecrest.civic_accounts WHERE event_id=$1)`,
    [claim.id, claim.attempt, account, Number.isSafeInteger(tokens) && tokens > 0 ? tokens : null]);
}

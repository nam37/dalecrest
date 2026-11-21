// Runs this checkout against its own database in the configured PostgreSQL server, so trying a change
// never touches the village in DATABASE_URL. From the project directory:
//   node --env-file=.env tools/preview-village.mjs
// It listens on port 4174 unless PORT is set. PREVIEW_DATABASE names the database (default dalecrest_preview).
import pg from 'pg';

const name = process.env.PREVIEW_DATABASE || 'dalecrest_preview';
if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('PREVIEW_DATABASE must be a plain lowercase database name.');
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the PostgreSQL server that should hold the preview database.');
const url = new URL(process.env.DATABASE_URL);
if (url.pathname === '/' + name) throw new Error('The preview database must differ from the one in DATABASE_URL.');
const admin = new URL(url);
admin.pathname = '/postgres';
const client = new pg.Client({ connectionString: admin.href });
await client.connect();
if (!(await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount) await client.query('CREATE DATABASE ' + name);
await client.end();
url.pathname = '/' + name;
process.env.DATABASE_URL = url.href;
process.env.PORT ||= '4174';
// A preview runs on local decision rules and never spends model calls.
delete process.env.PLANNER_PROVIDER;
delete process.env.OLLAMA_MODEL;
await import('../server.mjs');

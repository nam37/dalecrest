import { appendFile, readFile } from 'node:fs/promises';

// One admin process owns this journal. Each request is durable before it can call the host helper.
export async function openClockAudit(path) {
  const records = new Map();
  function record(entry) {
    const previous = records.get(entry.id);
    records.set(entry.id, { ...previous, ...entry });
  }
  const saved = await readFile(path, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return '';
  });
  for (const line of saved.split('\n').filter(Boolean)) record(JSON.parse(line));
  async function write(entry) {
    await appendFile(path, JSON.stringify(entry) + '\n', { mode: 0o600, flush: true });
    record(entry);
  }
  for (const entry of records.values()) {
    if (entry.status === 'applying') {
      await write({ id: entry.id, status: 'interrupted', finishedAt: new Date().toISOString() });
    }
  }
  return {
    write,
    find: id => records.get(id),
    recent: () => Array.from(records.values()).slice(-30).reverse(),
  };
}

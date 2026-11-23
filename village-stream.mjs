import { villageChanges } from './public/village-update.js';

// The browser reconnects with a fresh baseline. The clients that stay connected share one patch.
export function createVillageStream(read) {
  const clients = new Set();
  let latest, pending = false, reading = false, closed = false;

  function send(client, message) {
    if (client.blocked) client.response.destroy();
    else client.blocked = !client.response.write(message);
  }

  function frame(name, payload) {
    const remaining = Math.max(0, Math.round(latest.due - performance.now()));
    return 'event: ' + name + '\ndata: {"nextTickInMs":' + remaining + ',"state":' + payload + '}\n\n';
  }

  function baseline(client) {
    latest.json ??= JSON.stringify(latest.state);
    client.ready = true;
    send(client, frame('snapshot', latest.json));
  }

  async function publish() {
    try {
      while (pending && clients.size && !closed) {
        pending = false;
        const { nextTickInMs, ...state } = await read();
        if (!clients.size || closed) break;
        const patch = latest && villageChanges(latest.state, state);
        latest = { state, due: performance.now() + nextTickInMs, json: null };
        const update = patch && Object.keys(patch).length ? frame('update', JSON.stringify(patch)) : null;
        for (const client of clients) {
          if (!client.ready) baseline(client);
          else if (update) send(client, update);
        }
      }
    } catch {
      // A failed read leaves no patch to apply. A fresh stream will recover from a full snapshot.
      latest = null;
      pending = false;
      for (const { response, blocked } of clients) {
        if (blocked) response.destroy();
        else response.end();
      }
      clients.clear();
    } finally {
      reading = false;
    }
  }

  function changed() {
    if (!clients.size || closed) return;
    pending = true;
    if (reading) return;
    reading = true;
    queueMicrotask(publish);
  }

  const heartbeat = setInterval(() => {
    for (const client of clients) send(client, ': keep-alive\n\n');
    // Also catch up after a lost database notification.
    changed();
  }, 15000);
  heartbeat.unref();

  return {
    changed,
    subscribe(response, head = false) {
      if (closed) { response.writeHead(503).end(); return; }
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      });
      if (head) { response.end(); return; }
      const client = { response, blocked: false, ready: false };
      clients.add(client);
      response.on('drain', () => { client.blocked = false; });
      response.on('error', () => response.destroy());
      response.once('close', () => {
        clients.delete(client);
        if (!clients.size) latest = null;
      });
      // A held-open response disables the socket's idle request timeout. Comments survive proxies.
      response.flushHeaders();
      response.write('retry: 1800\n\n');
      if (latest) baseline(client);
      else changed();
    },
    close() {
      closed = true;
      clearInterval(heartbeat);
      for (const { response, blocked } of clients) {
        if (blocked) response.destroy();
        else response.end();
      }
      clients.clear();
      latest = null;
    },
  };
}

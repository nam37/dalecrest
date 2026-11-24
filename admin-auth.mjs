import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const username = /^[a-z][a-z0-9-]{0,39}$/;
const passwordFormat = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{64})$/;
const sessionLife = 4 * 60 * 60 * 1000;
const loginWindow = 15 * 60 * 1000;
export const keyDigest = value => createHash('sha256').update(value).digest('hex');

export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 256) {
    throw new Error('Use at least 12 characters and at most 256 bytes for the password.');
  }
  const salt = randomBytes(16);
  return 'scrypt$' + salt.toString('hex') + '$' + (await derive(password, salt, 32)).toString('hex');
}

export function loadCredentials({ accounts, agentKeys = [] } = {}) {
  const people = new Map(), keys = new Map();
  if (!Array.isArray(accounts) || !Array.isArray(agentKeys)) throw new Error('Invalid admin credentials document.');
  for (const { name, role, password } of accounts) {
    const hash = passwordFormat.exec(password);
    if (!username.test(name) || !['operator', 'monitor'].includes(role) || !hash || people.has(name)) {
      throw new Error('Invalid or duplicate admin account.');
    }
    people.set(name, { name, role, salt: Buffer.from(hash[1], 'hex'), digest: Buffer.from(hash[2], 'hex') });
  }
  for (const { name, digest } of agentKeys) {
    if (!username.test(name) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest) || keys.has(name)) {
      throw new Error('Invalid or duplicate agent key.');
    }
    keys.set(name, Buffer.from(digest, 'hex'));
  }
  if (![...people.values()].some(person => person.role === 'operator')) throw new Error('Set up at least one operator account.');
  return { people, keys };
}

export function adminAuth({ people, keys }, { secure, path = '/' }) {
  const sessions = new Map(), attempts = new Map();
  const dummy = { salt: randomBytes(16), digest: randomBytes(32) };
  const cookieName = secure ? (path === '/' ? '__Host-' : '__Secure-') + 'dalecrest-admin' : 'dalecrest-admin-preview';
  const cookie = (token, maxAge) => cookieName + '=' + token + '; Path=' + path + '; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (secure ? '; Secure' : '');
  const tokenOf = req => req.headers.cookie?.split(';').map(value => value.trim())
    .find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  let hashing = 0;
  return {
    async login(req, input) {
      const { name, password } = input || {};
      const now = Date.now();
      for (const [ip, entry] of attempts) if (entry.until <= now) attempts.delete(ip);
      // Use the peer address. Forwarded headers are outside the authentication boundary.
      const ip = req.socket.remoteAddress;
      const entry = attempts.get(ip) ?? { count: 0, until: now + loginWindow };
      if (entry.count >= 8 || hashing >= 4 || (!attempts.has(ip) && attempts.size >= 1024)) return { status: 429 };
      entry.count++;
      attempts.set(ip, entry);
      if (typeof name !== 'string' || typeof password !== 'string' || Buffer.byteLength(password) > 256) return { status: 401 };
      const person = people.get(name);
      const { salt, digest } = person ?? dummy;
      hashing++;
      try {
        if (!timingSafeEqual(await derive(password, salt, 32), digest) || !person) return { status: 401 };
      } finally {
        hashing--;
      }
      attempts.delete(ip);
      for (const [id, session] of sessions) if (session.expires <= now) sessions.delete(id);
      if (sessions.size >= 128) sessions.delete(sessions.keys().next().value);
      const token = randomBytes(32).toString('base64url');
      const viewer = { name: person.name, role: person.role };
      sessions.delete(tokenOf(req));
      sessions.set(token, { viewer, expires: now + sessionLife });
      return { status: 200, viewer, cookie: cookie(token, sessionLife / 1000) };
    },
    viewer(req) {
      const token = tokenOf(req), session = sessions.get(token);
      if (session?.expires > Date.now()) return session.viewer;
      sessions.delete(token);
    },
    logout(req) {
      sessions.delete(tokenOf(req));
      return cookie('', 0);
    },
    agent(req) {
      const match = /^Bearer ([a-z][a-z0-9-]{0,39})\.([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
      const digest = match && keys.get(match[1]);
      return Boolean(digest && timingSafeEqual(Buffer.from(keyDigest(match[2]), 'hex'), digest));
    },
  };
}

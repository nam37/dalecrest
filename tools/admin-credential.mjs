import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { keyDigest, passwordHash } from '../admin-auth.mjs';

const [kind, name, role] = process.argv.slice(2);
if (!/^[a-z][a-z0-9-]{0,39}$/.test(name ?? '')) throw new Error('Choose an account or key name with lowercase letters, digits and hyphens.');
if (kind === 'account' && ['operator', 'monitor'].includes(role)) {
  const password = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  console.log(JSON.stringify({ name, role, password: await passwordHash(password) }));
} else if (kind === 'agent' && !role) {
  const key = randomBytes(32).toString('base64url');
  console.error('Agent bearer key (shown once): ' + name + '.' + key);
  console.log(JSON.stringify({ name, digest: keyDigest(key) }));
} else {
  throw new Error('Use account <name> <operator|monitor> with a password on standard input, or agent <name>.');
}

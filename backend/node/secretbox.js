import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

// Secrets the app keeps in its database (the Claude key) are sealed with AES-256-GCM. The key comes
// from SECRET_KEY in the environment, or else from a key file next to the database, made once. A
// copy of the database alone (a backup, a shared file) then holds no usable secret.
const PREFIX = 'enc:v1:';
let key = null;

function getKey() {
  if (key) return key;
  if (process.env.SECRET_KEY) {
    key = crypto.createHash('sha256').update(process.env.SECRET_KEY).digest();
    return key;
  }
  const file = path.join(DATA_DIR, 'secret.key');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  }
  key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  return key;
}

export const isSealed = (value) => typeof value === 'string' && value.startsWith(PREFIX);

export function seal(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

/** The plain text, or '' when it cannot be opened (another key): the app then acts as if none is set. */
export function open(value) {
  if (!isSealed(value)) return value || '';
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    console.error('Een opgeslagen geheim kon niet worden geopend (andere SECRET_KEY?). Sla de API key opnieuw op.');
    return '';
  }
}

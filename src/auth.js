import crypto from 'node:crypto';
import { db } from './db.js';
import { COOKIE_SECURE } from './config.js';

const SESSION_DAYS = 30;
const COOKIE = 'dyc_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function validateCredentials(username, password) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    return 'Gebruikersnaam: 3–32 tekens (letters, cijfers, _ . -).';
  }
  if (typeof password !== 'string' || password.length < 8) {
    return 'Wachtwoord moet minstens 8 tekens zijn.';
  }
  return null;
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 86400_000;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: SESSION_DAYS * 86400_000,
    path: '/',
  });
}

export function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(COOKIE, { path: '/' });
}

/** Attaches req.user when a valid session cookie is present. */
export function sessionMiddleware(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = db
      .prepare(
        `SELECT u.id, u.username, u.role, s.expires_at FROM sessions s
         JOIN users u ON u.id = s.user_id WHERE s.token = ?`
      )
      .get(token);
    if (row && row.expires_at > Date.now()) {
      req.user = { id: row.id, username: row.username, role: row.role };
    } else if (row) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
  }
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Niet ingelogd' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Niet ingelogd' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Alleen voor admin' });
  next();
}

/**
 * State-changing API calls must carry this header. Browsers can't add custom
 * headers to cross-site form posts, so this blocks CSRF on top of SameSite=Lax.
 */
export function requireAjaxHeader(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'dyc') return res.status(403).json({ error: 'Ongeldig verzoek' });
  next();
}

// Very small in-memory brute-force guard for the login endpoint: only failed attempts count.
const attempts = new Map();
export function loginRateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, reset: now + 15 * 60_000 };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + 15 * 60_000;
  }
  attempts.set(key, entry);
  if (entry.count >= 20) return res.status(429).json({ error: 'Te veel pogingen, probeer het later opnieuw.' });
  res.on('finish', () => {
    if (res.statusCode >= 400) entry.count += 1;
  });
  next();
}

export function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { ROOT_DIR, MAX_UPLOAD_MB } from './config.js';
import { db, getSettings, saveSettings, tx, DEFAULT_SETTINGS } from './db.js';
import {
  hashPassword, verifyPassword, validateCredentials, createSession, destroySession, sessionMiddleware,
  requireUser, requireAdmin, requireAjaxHeader, loginRateLimit, purgeExpiredSessions,
} from './auth.js';
import { upload, sniff, storeUpload, storedPath, removeStored, cleanupUploads, releaseDir, KIND_LABEL, KIND_COLUMN } from './files.js';
import {
  serializeRelease, getRelease, listReleases, processRelease, touchRelease, folderSummary,
  canSeePlaylist, canEditPlaylist, playlistReleases, serializePlaylist,
} from './model.js';
import { generateYoutubeKit, extractBpm, LIMITS, claudeConfigured } from './youtube.js';
import { suggestNames } from './albumnames.js';
import { computeStats, PERIODS } from './stats.js';
import { ClaudeError } from './claude.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (what = 'Niet gevonden') => new HttpError(404, what);

// ---------- input helpers ----------

function text(v, max, name) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw bad(`${name} is ongeldig.`);
  const s = v.replace(/\r\n/g, '\n').trim();
  if (s.length > max) throw bad(`${name} is te lang (max ${max} tekens).`);
  return s;
}
function intOrNull(v, min, max, name) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} moet een heel getal tussen ${min} en ${max} zijn.`);
  return n;
}
function dateOrNull(v) {
  if (!v) return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad('Datum is ongeldig.');
  return v;
}
function urlOrEmpty(v, name) {
  const s = text(v, 500, name);
  if (!s) return '';
  let u;
  try {
    u = new URL(s);
  } catch {
    throw bad(`${name} is geen geldige link.`);
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw bad(`${name} moet met https:// beginnen.`);
  return u.toString();
}
const bool = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
const idParam = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw notFound();
  return n;
};
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'release';

// ---------- the app ----------

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; " +
        "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    // HSTS only over HTTPS: browsers ignore it on http, and a local http preview must keep working.
    if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  // Static: the app itself, the fonts from their packages, nothing else.
  const pub = path.join(ROOT_DIR, 'public');
  // maxAge 0 with an ETag: the browser asks again on every load and gets a 304 when nothing changed,
  // so an update shows at once.
  app.use(express.static(pub, { index: 'index.html', maxAge: 0, etag: true }));
  for (const name of ['inter', 'montserrat']) {
    app.use(`/fonts/${name}`, express.static(path.join(ROOT_DIR, 'node_modules', '@fontsource-variable', name), { index: false, maxAge: '30d' }));
  }

  app.use(sessionMiddleware);
  app.use('/api', requireAjaxHeader);
  app.use('/api', express.json({ limit: '1mb' }));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // ---------- auth ----------

  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

  app.get('/api/session', (req, res) => {
    res.json({ user: req.user || null, needsSetup: userCount() === 0 });
  });

  app.post('/api/setup', loginRateLimit, (req, res) => {
    if (userCount() > 0) throw new HttpError(403, 'De admin bestaat al.');
    const { username, password } = req.body || {};
    const err = validateCredentials(username, password);
    if (err) throw bad(err);
    const r = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(username, hashPassword(password));
    createSession(res, Number(r.lastInsertRowid));
    res.status(201).json({ user: { id: Number(r.lastInsertRowid), username, role: 'admin' } });
  });

  app.post('/api/login', loginRateLimit, (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') throw bad('Vul je gebruikersnaam en wachtwoord in.');
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!u || !verifyPassword(password, u.password_hash)) throw new HttpError(401, 'Gebruikersnaam of wachtwoord klopt niet.');
    purgeExpiredSessions();
    createSession(res, u.id);
    res.json({ user: { id: u.id, username: u.username, role: u.role } });
  });

  app.post('/api/logout', (req, res) => {
    destroySession(req, res);
    res.json({ ok: true });
  });

  app.post('/api/me/password', requireUser, (req, res) => {
    const { current, password } = req.body || {};
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (typeof current !== 'string' || !verifyPassword(current, u.password_hash)) throw bad('Je huidige wachtwoord klopt niet.');
    const err = validateCredentials(u.username, password);
    if (err) throw bad(err);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), u.id);
    res.json({ ok: true });
  });

  // ---------- accounts (admin) ----------

  app.get('/api/users', requireAdmin, (_req, res) => {
    res.json({ users: db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all() });
  });

  app.post('/api/users', requireAdmin, (req, res) => {
    const { username, password, role } = req.body || {};
    const err = validateCredentials(username, password);
    if (err) throw bad(err);
    if (!['admin', 'listener'].includes(role)) throw bad('Kies een rol.');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw bad('Die gebruikersnaam bestaat al.');
    const r = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hashPassword(password), role);
    res.status(201).json({ user: { id: Number(r.lastInsertRowid), username, role } });
  });

  app.post('/api/users/:id/password', requireAdmin, (req, res) => {
    const id = idParam(req.params.id);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) throw notFound('Account niet gevonden.');
    const err = validateCredentials(u.username, req.body?.password);
    if (err) throw bad(err);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.password), id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    res.json({ ok: true });
  });

  app.delete('/api/users/:id', requireAdmin, (req, res) => {
    const id = idParam(req.params.id);
    if (id === req.user.id) throw bad('Je kunt je eigen account niet verwijderen.');
    const r = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (!r.changes) throw notFound('Account niet gevonden.');
    res.json({ ok: true });
  });

  // ---------- settings (admin) ----------

  app.get('/api/settings', requireAdmin, (_req, res) => {
    const s = getSettings();
    const { anthropic_api_key, ...rest } = s;
    res.json({
      settings: rest,
      claude: { configured: claudeConfigured(s), key_saved: Boolean(anthropic_api_key), from_env: !anthropic_api_key && claudeConfigured(s) },
    });
  });

  app.put('/api/settings', requireAdmin, (req, res) => {
    const b = req.body || {};
    const values = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key === 'anthropic_api_key' || !(key in b)) continue;
      values[key] = key.endsWith('_url') ? urlOrEmpty(b[key], key) : text(b[key], 2000, key);
    }
    if (typeof b.anthropic_api_key === 'string' && b.anthropic_api_key.trim()) {
      values.anthropic_api_key = text(b.anthropic_api_key, 300, 'API key');
    }
    if (b.clear_api_key === true) values.anthropic_api_key = '';
    saveSettings(values);
    res.json({ ok: true });
  });

  // ---------- releases ----------

  app.get('/api/releases', requireUser, (req, res) => {
    res.json({ releases: listReleases(req.user).map((r) => serializeRelease(r, req.user)) });
  });

  app.get('/api/releases/:id', requireUser, (req, res) => {
    const r = getRelease(idParam(req.params.id), req.user);
    if (!r) throw notFound('Release niet gevonden.');
    res.json({ release: serializeRelease(r, req.user), limits: LIMITS });
  });

  function readReleaseFields(b, existing) {
    const title = text(b.title, 200, 'Titel');
    if (!title) throw bad('Geef de release een titel.');
    const style = text(b.style, 4000, 'Style-omschrijving');
    let bpm = intOrNull(b.bpm, 40, 300, 'BPM');
    if (bpm === null) bpm = extractBpm(style);
    let folderId = intOrNull(b.folder_id, 1, Number.MAX_SAFE_INTEGER, 'Map');
    if (folderId !== null && !db.prepare('SELECT 1 FROM folders WHERE id = ?').get(folderId)) throw bad('Die collectie bestaat niet.');
    return {
      title,
      style,
      lyrics: text(b.lyrics, 20000, 'Lyrics'),
      bpm,
      release_date: dateOrNull(b.release_date),
      video_type: text(b.video_type, 60, 'Video-type') || getSettings().default_video_type,
      folder_id: folderId,
      hidden: bool(b.hidden) ? 1 : 0,
      notes: text(b.notes, 4000, 'Notities'),
      youtube_url: b.youtube_url === undefined ? existing?.youtube_url ?? '' : urlOrEmpty(b.youtube_url, 'YouTube-link'),
      spotify_url: b.spotify_url === undefined ? existing?.spotify_url ?? '' : urlOrEmpty(b.spotify_url, 'Spotify-link'),
      on_youtube: b.on_youtube === undefined ? existing?.on_youtube ?? 0 : bool(b.on_youtube) ? 1 : 0,
      on_spotify: b.on_spotify === undefined ? existing?.on_spotify ?? 0 : bool(b.on_spotify) ? 1 : 0,
    };
  }

  /** Checks every uploaded file before anything is stored. */
  function checkFiles(req) {
    const found = {};
    for (const kind of Object.keys(KIND_COLUMN)) {
      const f = req.files?.[kind]?.[0];
      if (!f) continue;
      const ext = sniff(kind, f.path);
      if (!ext) throw bad(`${f.originalname} is geen geldig ${KIND_LABEL[kind]}-bestand.`);
      found[kind] = { path: f.path, ext };
    }
    return found;
  }

  const runUpload = (req, res) =>
    new Promise((resolve, reject) => upload(req, res, (err) => (err ? reject(err) : resolve())));

  app.post('/api/releases', requireAdmin, async (req, res) => {
    await runUpload(req, res);
    try {
      const fields = readReleaseFields(req.body || {});
      const files = checkFiles(req);
      if (!files.wav) throw bad('Een WAV-bestand is verplicht.');
      const id = tx(() => {
        const cols = Object.keys(fields);
        const r = db
          .prepare(`INSERT INTO releases (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
          .run(...cols.map((c) => fields[c]));
        const newId = Number(r.lastInsertRowid);
        for (const [kind, f] of Object.entries(files)) {
          db.prepare(`UPDATE releases SET ${KIND_COLUMN[kind]} = ? WHERE id = ?`).run(storeUpload(newId, kind, f.path, f.ext), newId);
        }
        return newId;
      });
      processRelease(id);
      res.status(201).json({ release: serializeRelease(getRelease(id, req.user), req.user) });
    } finally {
      cleanupUploads(req);
    }
  });

  app.put('/api/releases/:id', requireAdmin, async (req, res) => {
    await runUpload(req, res);
    try {
      const id = idParam(req.params.id);
      const existing = db.prepare('SELECT * FROM releases WHERE id = ?').get(id);
      if (!existing) throw notFound('Release niet gevonden.');
      const b = req.body || {};
      const fields = readReleaseFields(b, existing);
      const files = checkFiles(req);
      tx(() => {
        const cols = Object.keys(fields);
        db.prepare(`UPDATE releases SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
          .run(...cols.map((c) => fields[c]), id);
        for (const kind of ['mp3', 'video', 'cover']) {
          if (bool(b[`remove_${kind}`]) && !files[kind]) {
            removeStored(id, existing[KIND_COLUMN[kind]]);
            db.prepare(`UPDATE releases SET ${KIND_COLUMN[kind]} = NULL WHERE id = ?`).run(id);
          }
        }
        for (const [kind, f] of Object.entries(files)) {
          db.prepare(`UPDATE releases SET ${KIND_COLUMN[kind]} = ? WHERE id = ?`).run(storeUpload(id, kind, f.path, f.ext), id);
          if (kind === 'mp3') db.prepare('UPDATE releases SET mp3_generated = 0 WHERE id = ?').run(id);
          if (kind === 'cover') db.prepare('UPDATE releases SET cover_generated = 0 WHERE id = ?').run(id);
          if (kind === 'wav') {
            db.prepare('UPDATE releases SET duration = NULL WHERE id = ?').run(id);
            if (existing.mp3_generated) {
              removeStored(id, existing.mp3_file);
              db.prepare('UPDATE releases SET mp3_file = NULL, mp3_generated = 0 WHERE id = ?').run(id);
            }
          }
          if (kind === 'video' && existing.cover_generated) {
            removeStored(id, existing.cover_file);
            db.prepare('UPDATE releases SET cover_file = NULL, cover_generated = 0 WHERE id = ?').run(id);
          }
        }
      });
      processRelease(id);
      res.json({ release: serializeRelease(getRelease(id, req.user), req.user) });
    } finally {
      cleanupUploads(req);
    }
  });

  app.delete('/api/releases/:id', requireAdmin, (req, res) => {
    const id = idParam(req.params.id);
    const r = db.prepare('DELETE FROM releases WHERE id = ?').run(id);
    if (!r.changes) throw notFound('Release niet gevonden.');
    fs.rmSync(releaseDir(id), { recursive: true, force: true });
    res.json({ ok: true });
  });

  app.post('/api/releases/:id/youtube', requireAdmin, async (req, res) => {
    const id = idParam(req.params.id);
    const r = db.prepare('SELECT * FROM releases WHERE id = ?').get(id);
    if (!r) throw notFound('Release niet gevonden.');
    const useClaude = req.body?.mode !== 'template';
    const extra = text(req.body?.extra, 1000, 'Extra wensen');
    const kit = await generateYoutubeKit(r, getSettings(), { useClaude, extra });
    db.prepare(
      "UPDATE releases SET yt_title = ?, yt_description = ?, yt_tags = ?, yt_generated_with = ?, bpm = COALESCE(bpm, ?), updated_at = datetime('now') WHERE id = ?"
    ).run(kit.title, kit.description, kit.tags, kit.generatedWith, kit.bpm, id);
    res.json({ release: serializeRelease(getRelease(id, req.user), req.user), generated_with: kit.generatedWith });
  });

  app.put('/api/releases/:id/youtube', requireAdmin, (req, res) => {
    const id = idParam(req.params.id);
    if (!db.prepare('SELECT 1 FROM releases WHERE id = ?').get(id)) throw notFound('Release niet gevonden.');
    const b = req.body || {};
    db.prepare("UPDATE releases SET yt_title = ?, yt_description = ?, yt_tags = ?, updated_at = datetime('now') WHERE id = ?").run(
      text(b.yt_title, 300, 'Titel'), text(b.yt_description, 10000, 'Beschrijving'), text(b.yt_tags, 2000, 'Tags'), id
    );
    res.json({ release: serializeRelease(getRelease(id, req.user), req.user) });
  });

  app.post('/api/releases/:id/status', requireAdmin, (req, res) => {
    const id = idParam(req.params.id);
    const r = db.prepare('SELECT * FROM releases WHERE id = ?').get(id);
    if (!r) throw notFound('Release niet gevonden.');
    const b = req.body || {};
    const youtube_url = b.youtube_url === undefined ? r.youtube_url : urlOrEmpty(b.youtube_url, 'YouTube-link');
    const spotify_url = b.spotify_url === undefined ? r.spotify_url : urlOrEmpty(b.spotify_url, 'Spotify-link');
    const on_youtube = b.on_youtube === undefined ? r.on_youtube : bool(b.on_youtube) ? 1 : 0;
    const on_spotify = b.on_spotify === undefined ? r.on_spotify : bool(b.on_spotify) ? 1 : 0;
    db.prepare("UPDATE releases SET youtube_url = ?, spotify_url = ?, on_youtube = ?, on_spotify = ?, updated_at = datetime('now') WHERE id = ?")
      .run(youtube_url, spotify_url, on_youtube, on_spotify, id);
    res.json({ release: serializeRelease(getRelease(id, req.user), req.user) });
  });

  // ---------- media ----------

  app.get('/media/:id/:kind', requireUser, (req, res) => {
    const r = getRelease(idParam(req.params.id), req.user);
    if (!r) throw notFound();
    const kind = req.params.kind;
    const column = { audio: r.mp3_file ? 'mp3_file' : 'wav_file', wav: 'wav_file', mp3: 'mp3_file', video: 'video_file', cover: 'cover_file' }[kind];
    if (!column) throw notFound();
    const file = storedPath(r.id, r[column]);
    if (!file) throw notFound();
    res.set('Cache-Control', 'private, max-age=3600');
    if (req.query.download === '1') {
      return res.download(file, `${slug(r.title)}-${kind}${path.extname(file)}`);
    }
    res.sendFile(file, { acceptRanges: true, dotfiles: 'deny' });
  });

  // ---------- collections (folders, admin manages) ----------

  app.get('/api/folders', requireUser, (req, res) => {
    const hiddenFilter = req.user.role === 'admin' ? '' : 'AND r.hidden = 0';
    const rows = db
      .prepare(
        `SELECT f.*, (SELECT COUNT(*) FROM releases r WHERE r.folder_id = f.id ${hiddenFilter}) AS count
         FROM folders f ORDER BY f.id`
      )
      .all();
    res.json({ folders: rows.map(folderSummary) });
  });

  app.get('/api/folders/:id', requireUser, (req, res) => {
    const f = db.prepare('SELECT * FROM folders WHERE id = ?').get(idParam(req.params.id));
    if (!f) throw notFound('Collectie niet gevonden.');
    const releases = listReleases(req.user, { folderId: f.id });
    res.json({ folder: { ...folderSummary({ ...f, count: releases.length }), releases: releases.map((r) => serializeRelease(r, req.user)) } });
  });

  app.post('/api/folders', requireAdmin, (req, res) => {
    const name = text(req.body?.name, 120, 'Naam');
    if (!name) throw bad('Geef de collectie een naam.');
    const r = db.prepare('INSERT INTO folders (name, description) VALUES (?, ?)').run(name, text(req.body?.description, 1000, 'Omschrijving'));
    res.status(201).json({ folder: folderSummary(db.prepare('SELECT * FROM folders WHERE id = ?').get(r.lastInsertRowid)) });
  });

  app.put('/api/folders/:id', requireAdmin, (req, res) => {
    const id = idParam(req.params.id);
    const name = text(req.body?.name, 120, 'Naam');
    if (!name) throw bad('Geef de collectie een naam.');
    const r = db.prepare('UPDATE folders SET name = ?, description = ? WHERE id = ?').run(name, text(req.body?.description, 1000, 'Omschrijving'), id);
    if (!r.changes) throw notFound('Collectie niet gevonden.');
    res.json({ ok: true });
  });

  app.delete('/api/folders/:id', requireAdmin, (req, res) => {
    const r = db.prepare('DELETE FROM folders WHERE id = ?').run(idParam(req.params.id));
    if (!r.changes) throw notFound('Collectie niet gevonden.');
    res.json({ ok: true });
  });

  app.post('/api/folders/:id/suggest-names', requireAdmin, async (req, res) => {
    const f = db.prepare('SELECT * FROM folders WHERE id = ?').get(idParam(req.params.id));
    if (!f) throw notFound('Collectie niet gevonden.');
    const releases = listReleases(req.user, { folderId: f.id });
    if (!releases.length) throw bad('Deze collectie heeft nog geen nummers.');
    res.json(await suggestNames(getSettings(), f.name, releases, text(req.body?.direction, 300, 'Richting')));
  });

  // ---------- playlists (everyone; owners edit their own) ----------

  function loadPlaylist(id, user) {
    const p = db.prepare('SELECT p.*, u.username AS owner_name FROM playlists p JOIN users u ON u.id = p.owner_id WHERE p.id = ?').get(id);
    if (!canSeePlaylist(p, user)) throw notFound('Playlist niet gevonden.');
    return p;
  }
  function editablePlaylist(id, user) {
    const p = loadPlaylist(id, user);
    if (!canEditPlaylist(p, user)) throw new HttpError(403, 'Alleen de maker kan deze playlist aanpassen.');
    return p;
  }

  app.get('/api/playlists', requireUser, (req, res) => {
    const rows = db
      .prepare(
        `SELECT p.*, u.username AS owner_name, (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS count
         FROM playlists p JOIN users u ON u.id = p.owner_id
         WHERE p.owner_id = ? OR p.is_public = 1 ORDER BY p.id`
      )
      .all(req.user.id);
    res.json({ playlists: rows.map((p) => serializePlaylist(p, req.user)) });
  });

  app.get('/api/playlists/:id', requireUser, (req, res) => {
    const p = loadPlaylist(idParam(req.params.id), req.user);
    res.json({ playlist: serializePlaylist(p, req.user, playlistReleases(p.id, req.user)) });
  });

  app.post('/api/playlists', requireUser, (req, res) => {
    const name = text(req.body?.name, 120, 'Naam');
    if (!name) throw bad('Geef de playlist een naam.');
    const r = db
      .prepare('INSERT INTO playlists (owner_id, name, description, is_public) VALUES (?, ?, ?, ?)')
      .run(req.user.id, name, text(req.body?.description, 1000, 'Omschrijving'), bool(req.body?.is_public) ? 1 : 0);
    res.status(201).json({ playlist: { id: Number(r.lastInsertRowid), name } });
  });

  app.put('/api/playlists/:id', requireUser, (req, res) => {
    const p = editablePlaylist(idParam(req.params.id), req.user);
    const name = text(req.body?.name, 120, 'Naam');
    if (!name) throw bad('Geef de playlist een naam.');
    db.prepare('UPDATE playlists SET name = ?, description = ?, is_public = ? WHERE id = ?').run(
      name, text(req.body?.description, 1000, 'Omschrijving'), bool(req.body?.is_public) ? 1 : 0, p.id
    );
    res.json({ ok: true });
  });

  app.delete('/api/playlists/:id', requireUser, (req, res) => {
    const p = editablePlaylist(idParam(req.params.id), req.user);
    db.prepare('DELETE FROM playlists WHERE id = ?').run(p.id);
    res.json({ ok: true });
  });

  app.post('/api/playlists/:id/items', requireUser, (req, res) => {
    const p = editablePlaylist(idParam(req.params.id), req.user);
    const r = getRelease(idParam(req.body?.release_id), req.user);
    if (!r) throw notFound('Release niet gevonden.');
    const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM playlist_items WHERE playlist_id = ?').get(p.id).n;
    db.prepare('INSERT OR IGNORE INTO playlist_items (playlist_id, release_id, position) VALUES (?, ?, ?)').run(p.id, r.id, pos);
    res.status(201).json({ ok: true });
  });

  app.delete('/api/playlists/:id/items/:releaseId', requireUser, (req, res) => {
    const p = editablePlaylist(idParam(req.params.id), req.user);
    db.prepare('DELETE FROM playlist_items WHERE playlist_id = ? AND release_id = ?').run(p.id, idParam(req.params.releaseId));
    res.json({ ok: true });
  });

  app.put('/api/playlists/:id/order', requireUser, (req, res) => {
    const p = editablePlaylist(idParam(req.params.id), req.user);
    const ids = req.body?.release_ids;
    if (!Array.isArray(ids) || ids.length > 1000) throw bad('Ongeldige volgorde.');
    tx(() => ids.forEach((rid, i) => db.prepare('UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND release_id = ?').run(i + 1, p.id, Number(rid))));
    res.json({ ok: true });
  });

  app.post('/api/playlists/:id/suggest-names', requireUser, async (req, res) => {
    const p = editablePlaylist(idParam(req.params.id), req.user);
    const releases = playlistReleases(p.id, req.user);
    if (!releases.length) throw bad('Deze playlist heeft nog geen nummers.');
    res.json(await suggestNames(getSettings(), p.name, releases, text(req.body?.direction, 300, 'Richting')));
  });

  // ---------- stats ----------

  app.get('/api/stats', requireUser, (req, res) => {
    const months = req.query.months === undefined ? 12 : Number(req.query.months);
    if (!PERIODS.includes(months)) throw bad(`Kies een periode van ${PERIODS.join(', ')} maanden.`);
    res.json(computeStats(listReleases(req.user), { months, admin: req.user.role === 'admin' }));
  });

  // ---------- errors ----------

  app.use('/api', (_req, _res, next) => next(notFound('Onbekende API-route.')));

  app.use((err, req, res, _next) => {
    cleanupUploads(req);
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `Bestand is te groot (max ${MAX_UPLOAD_MB} MB).` : 'Upload mislukt: ' + err.code;
      return res.status(400).json({ error: msg });
    }
    if (err instanceof ClaudeError) return res.status(err.status).json({ error: err.message });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ongeldige gegevens.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Te veel gegevens in één keer.' });
    console.error(err);
    res.status(500).json({ error: 'Er ging iets mis op de server.' });
  });

  return app;
}

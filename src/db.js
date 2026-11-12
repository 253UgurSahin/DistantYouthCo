import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'distantyouth.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'listener')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  style TEXT NOT NULL DEFAULT '',
  lyrics TEXT NOT NULL DEFAULT '',
  bpm INTEGER,
  release_date TEXT,
  video_type TEXT NOT NULL DEFAULT 'Official Visualizer',
  hidden INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  wav_file TEXT,
  mp3_file TEXT,
  mp3_generated INTEGER NOT NULL DEFAULT 0,
  video_file TEXT,
  cover_file TEXT,
  cover_generated INTEGER NOT NULL DEFAULT 0,
  duration REAL,
  yt_title TEXT NOT NULL DEFAULT '',
  yt_description TEXT NOT NULL DEFAULT '',
  yt_tags TEXT NOT NULL DEFAULT '',
  yt_generated_with TEXT NOT NULL DEFAULT '',
  youtube_url TEXT NOT NULL DEFAULT '',
  spotify_url TEXT NOT NULL DEFAULT '',
  on_youtube INTEGER NOT NULL DEFAULT 0,
  on_spotify INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, release_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// ---------- migrations ----------

/**
 * Release columns added after the first version. CREATE TABLE IF NOT EXISTS does not add columns to a
 * database that already exists, so each one is added here when it is missing. Safe to run on every start.
 */
const ADDED_RELEASE_COLUMNS = {
    // The id of the video the app uploaded itself (empty when the release was put on YouTube by hand).
    youtube_video_id: "TEXT NOT NULL DEFAULT ''",
    // What YouTube last said about that video: private, unlisted or public.
    yt_privacy: "TEXT NOT NULL DEFAULT ''",
    // ISO time a scheduled video goes public; empty when it is not scheduled.
    yt_publish_at: "TEXT NOT NULL DEFAULT ''",
    // When the app finished uploading it (SQLite datetime, UTC).
    yt_uploaded_at: "TEXT NOT NULL DEFAULT ''",
};
{
    const have = new Set(db.prepare('PRAGMA table_info(releases)').all().map((c) => c.name));
    for (const [name, type] of Object.entries(ADDED_RELEASE_COLUMNS)) {
        // The names and types are our own constants above, never user input, so building the SQL is safe.
        if (!have.has(name)) db.exec(`ALTER TABLE releases ADD COLUMN ${name} ${type}`);
    }
}

export const DEFAULT_SETTINGS = {
  artist_name: 'Distant Youth Co.',
  spotify_artist_url: 'https://open.spotify.com/artist/7hbil2HXkg0OniGTxMUHeo',
  youtube_channel_url: 'https://www.youtube.com/@DistantYouthCo',
  ai_disclosure: '🧪 Made with AI — Suno AI (AI-assisted, human-directed).',
  default_hashtags: '#aimusic #sunoai #bassmusic #electronicmusic #distantyouthco',
  default_video_type: 'Official Visualizer',
  anthropic_api_key: '',
    // ---- Direct upload to YouTube (Google OAuth, see src/youtube-api.js) ----
    // The OAuth client of the artist's own Google Cloud project. The ID is not secret; the secret
    // and the refresh token are, and the settings API never sends those two back to the browser.
    youtube_client_id: '',
    youtube_client_secret: '',
    // Written by the OAuth callback only, never by the settings form.
    youtube_refresh_token: '',
    youtube_channel_id: '',
    youtube_channel_title: '',
    // What the upload button picks by default: private, unlisted or public.
    youtube_default_privacy: 'private',
    // '1': tell YouTube the video contains realistic AI-made material (its "altered or synthetic content" label).
    youtube_synthetic_media: '1',
};

/**
 * Settings that only the server may read or write through dedicated code paths: secrets, and what the
 * OAuth callback stores. The generic settings form skips these, and GET /api/settings leaves them out.
 */
export const SERVER_ONLY_SETTINGS = new Set([
    'anthropic_api_key',
    'youtube_client_secret',
    'youtube_refresh_token',
    'youtube_channel_id',
    'youtube_channel_title',
]);

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function saveSettings(values) {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const [k, v] of Object.entries(values)) {
    if (k in DEFAULT_SETTINGS && typeof v === 'string') stmt.run(k, v);
  }
}

/** Run fn inside a transaction. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

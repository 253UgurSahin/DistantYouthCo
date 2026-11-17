import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { seal, open, isSealed } from './secretbox.js';

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

export const DEFAULT_SETTINGS = {
  artist_name: 'Distant Youth Co.',
  spotify_artist_url: 'https://open.spotify.com/artist/7hbil2HXkg0OniGTxMUHeo',
  youtube_channel_url: 'https://www.youtube.com/@DistantYouthCo',
  ai_disclosure: '🧪 Made with AI — Suno AI (AI-assisted, human-directed).',
  default_hashtags: '#aimusic #sunoai #bassmusic #electronicmusic #distantyouthco',
  default_video_type: 'Official Visualizer',
  anthropic_api_key: '',
};

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = SECRET_KEYS.has(r.key) ? open(r.value) : r.value;
  return out;
}

export function saveSettings(values) {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const [k, v] of Object.entries(values)) {
    if (k in DEFAULT_SETTINGS && typeof v === 'string') stmt.run(k, SECRET_KEYS.has(k) ? seal(v) : v);
  }
}

// Settings that are secrets: sealed in the database (secretbox.js).
const SECRET_KEYS = new Set(['anthropic_api_key']);

// A key saved before sealing existed is sealed once, at start.
for (const k of SECRET_KEYS) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
  if (row?.value && !isSealed(row.value)) saveSettings({ [k]: row.value });
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

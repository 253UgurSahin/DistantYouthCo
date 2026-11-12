import { db } from './db.js';
import { storedPath, releaseDir } from './files.js';
import { hasFfmpeg, probeDuration, wavToMp3, videoThumbnail } from './media.js';
import path from 'node:path';

// ---------- releases ----------

export function youtubeState(r) {
  if (r.on_youtube) return 'live';
  if (r.video_file && r.yt_description) return 'ready';
  return 'none';
}

/** The moon: concept (new), ready for YouTube (waxing), live (full). */
export function releaseStatus(r) {
  const yt = youtubeState(r);
  if (yt === 'ready') return 'ready';
  if (r.on_youtube || r.on_spotify) return 'live';
  return 'concept';
}

const processing = new Set();

export function serializeRelease(r, user) {
  const v = encodeURIComponent(r.updated_at || '');
  const out = {
    id: r.id,
    title: r.title,
    style: r.style,
    lyrics: r.lyrics,
    bpm: r.bpm,
    release_date: r.release_date,
    video_type: r.video_type,
    duration: r.duration,
    folder_id: r.folder_id,
    folder_name: r.folder_name ?? null,
    youtube_url: r.youtube_url,
    spotify_url: r.spotify_url,
    on_youtube: Boolean(r.on_youtube),
    on_spotify: Boolean(r.on_spotify),
    status: releaseStatus(r),
    youtube_state: youtubeState(r),
    has: { wav: Boolean(r.wav_file), mp3: Boolean(r.mp3_file), video: Boolean(r.video_file), cover: Boolean(r.cover_file) },
    mp3_generated: Boolean(r.mp3_generated),
    cover_generated: Boolean(r.cover_generated),
    processing: processing.has(r.id),
    audio_url: r.mp3_file || r.wav_file ? `/media/${r.id}/audio?v=${v}` : null,
    video_url: r.video_file ? `/media/${r.id}/video?v=${v}` : null,
    cover_url: r.cover_file ? `/media/${r.id}/cover?v=${v}` : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
  if (user?.role === 'admin') {
    Object.assign(out, {
      hidden: Boolean(r.hidden),
      notes: r.notes,
      yt_title: r.yt_title,
      yt_description: r.yt_description,
      yt_tags: r.yt_tags,
      yt_generated_with: r.yt_generated_with,
            // The video the app uploaded itself, and what YouTube last said about it.
            youtube_video_id: r.youtube_video_id || '',
            yt_privacy: r.yt_privacy || '',
            yt_publish_at: r.yt_publish_at || '',
            yt_uploaded_at: r.yt_uploaded_at || '',
    });
  }
  return out;
}

const SELECT_RELEASE = `SELECT r.*, f.name AS folder_name FROM releases r LEFT JOIN folders f ON f.id = r.folder_id`;
const ORDER = `ORDER BY COALESCE(r.release_date, substr(r.created_at, 1, 10)) DESC, r.id DESC`;

export function getRelease(id, user) {
  const r = db.prepare(`${SELECT_RELEASE} WHERE r.id = ?`).get(id);
  if (!r) return null;
  if (r.hidden && user?.role !== 'admin') return null;
  return r;
}

export function listReleases(user, { folderId } = {}) {
  const where = [];
  const args = [];
  if (user?.role !== 'admin') where.push('r.hidden = 0');
  if (folderId !== undefined) {
    where.push('r.folder_id = ?');
    args.push(folderId);
  }
  const sql = `${SELECT_RELEASE} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ${ORDER}`;
  return db.prepare(sql).all(...args);
}

export function touchRelease(id) {
  db.prepare("UPDATE releases SET updated_at = datetime('now') WHERE id = ?").run(id);
}

/** After an upload: duration, an MP3 from the WAV, and a cover from the video, when ffmpeg is there. */
export async function processRelease(id) {
  if (processing.has(id) || !(await hasFfmpeg())) return;
  processing.add(id);
  try {
    let r = db.prepare('SELECT * FROM releases WHERE id = ?').get(id);
    if (!r) return;
    const wav = storedPath(id, r.wav_file);
    if (wav && !r.duration) {
      const d = await probeDuration(wav);
      if (d) db.prepare('UPDATE releases SET duration = ? WHERE id = ?').run(d, id);
    }
    if (wav && !r.mp3_file) {
      try {
        await wavToMp3(wav, path.join(releaseDir(id), 'audio.mp3'));
        db.prepare('UPDATE releases SET mp3_file = ?, mp3_generated = 1 WHERE id = ?').run('audio.mp3', id);
      } catch (e) {
        console.error(`MP3 voor release ${id} mislukt:`, e.message);
      }
    }
    r = db.prepare('SELECT * FROM releases WHERE id = ?').get(id);
    const video = storedPath(id, r.video_file);
    if (video && !r.cover_file) {
      try {
        await videoThumbnail(video, path.join(releaseDir(id), 'cover.jpg'));
        db.prepare('UPDATE releases SET cover_file = ?, cover_generated = 1 WHERE id = ?').run('cover.jpg', id);
      } catch (e) {
        console.error(`Cover voor release ${id} mislukt:`, e.message);
      }
    }
    touchRelease(id);
  } finally {
    processing.delete(id);
  }
}

// ---------- folders and playlists ----------

export function folderSummary(f) {
  const rows = db
    .prepare('SELECT id, cover_file, updated_at, duration FROM releases WHERE folder_id = ? AND hidden = 0 ORDER BY id DESC')
    .all(f.id);
  return {
    id: f.id,
    name: f.name,
    description: f.description,
    count: f.count ?? rows.length,
    duration: rows.reduce((s, r) => s + (r.duration || 0), 0),
    covers: rows.filter((r) => r.cover_file).slice(0, 3).map((r) => `/media/${r.id}/cover?v=${encodeURIComponent(r.updated_at)}`),
  };
}

export function canSeePlaylist(p, user) {
  return p && (p.is_public || p.owner_id === user.id || user.role === 'admin');
}

export function canEditPlaylist(p, user) {
  return p && (p.owner_id === user.id || user.role === 'admin');
}

export function playlistReleases(playlistId, user) {
  return db
    .prepare(
      `SELECT r.*, f.name AS folder_name FROM playlist_items i
       JOIN releases r ON r.id = i.release_id LEFT JOIN folders f ON f.id = r.folder_id
       WHERE i.playlist_id = ? ${user.role === 'admin' ? '' : 'AND r.hidden = 0'}
       ORDER BY i.position, i.rowid`
    )
    .all(playlistId);
}

export function serializePlaylist(p, user, releases) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    is_public: Boolean(p.is_public),
    owner: p.owner_name,
    mine: p.owner_id === user.id,
    can_edit: canEditPlaylist(p, user),
    count: releases ? releases.length : p.count,
    duration: releases ? releases.reduce((s, r) => s + (r.duration || 0), 0) : undefined,
    releases: releases ? releases.map((r) => serializeRelease(r, user)) : undefined,
  };
}

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { UPLOAD_DIR, MAX_UPLOAD_MB } from './config.js';

const TMP_DIR = path.join(UPLOAD_DIR, 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

export const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_DIR,
    filename: (_req, _file, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 4, fields: 40, fieldSize: 256 * 1024 },
}).fields([
  { name: 'wav', maxCount: 1 },
  { name: 'mp3', maxCount: 1 },
  { name: 'video', maxCount: 1 },
  { name: 'cover', maxCount: 1 },
]);

function head(file, n = 16) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(n);
    const read = fs.readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

const ascii = (buf, start, end) => buf.subarray(start, end).toString('latin1');

/** Checks the real content of an uploaded file (not its name). Returns the extension to store it under, or null. */
export function sniff(kind, file) {
  const b = head(file);
  if (b.length < 12) return null;
  switch (kind) {
    case 'wav':
      return ['RIFF', 'RF64', 'BW64'].includes(ascii(b, 0, 4)) && ascii(b, 8, 12) === 'WAVE' ? 'wav' : null;
    case 'mp3':
      return ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) ? 'mp3' : null;
    case 'video':
      return ascii(b, 4, 8) === 'ftyp' ? 'mp4' : null;
    case 'cover':
      if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
      if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return 'png';
      if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
      return null;
    default:
      return null;
  }
}

export const KIND_LABEL = { wav: 'WAV', mp3: 'MP3', video: 'MP4', cover: 'cover' };
export const KIND_COLUMN = { wav: 'wav_file', mp3: 'mp3_file', video: 'video_file', cover: 'cover_file' };
const BASENAME = { wav: 'master', mp3: 'audio', video: 'video', cover: 'cover' };

export function releaseDir(id) {
  return path.join(UPLOAD_DIR, 'releases', String(id));
}

/** Absolute path of a stored file, or null when the stored name is missing or would leave the folder. */
export function storedPath(id, name) {
  if (!name) return null;
  const dir = releaseDir(id);
  const full = path.resolve(dir, name);
  return full.startsWith(dir + path.sep) && fs.existsSync(full) ? full : null;
}

/** Moves an uploaded temp file into the release's folder; returns the stored file name. */
export function storeUpload(id, kind, tmpPath, ext) {
  const dir = releaseDir(id);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.startsWith(BASENAME[kind] + '.')) fs.rmSync(path.join(dir, f), { force: true });
  const name = `${BASENAME[kind]}.${ext}`;
  fs.renameSync(tmpPath, path.join(dir, name));
  return name;
}

export function removeStored(id, name) {
  const p = storedPath(id, name);
  if (p) fs.rmSync(p, { force: true });
}

/** Removes temp files of a request that did not end up stored. */
export function cleanupUploads(req) {
  for (const list of Object.values(req.files || {})) {
    for (const f of list) if (f.path && fs.existsSync(f.path)) fs.rmSync(f.path, { force: true });
  }
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, '..');
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT_DIR, 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const PORT = Number(process.env.PORT || 3000);
// Set COOKIE_SECURE=1 when the app runs behind HTTPS.
export const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 4096);
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

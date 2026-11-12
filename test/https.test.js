import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// Behind an HTTPS proxy (TRUST_PROXY=1 and X-Forwarded-Proto: https), without COOKIE_SECURE.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dyc-https-'));
process.env.DATA_DIR = dataDir;
process.env.DYC_NO_FFMPEG = '1';
process.env.TRUST_PROXY = '1';
delete process.env.COOKIE_SECURE;
const { createApp } = await import('../src/app.js');

let server;
let base;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const setup = (proto) => fetch(base + '/api/setup', {
  method: 'POST',
  headers: { 'X-Requested-With': 'dyc', 'Content-Type': 'application/json', 'X-Forwarded-Proto': proto },
  body: JSON.stringify({ username: 'admin', password: crypto.randomBytes(12).toString('base64url') }),
});

test('X001: over HTTPS the sign-in cookie is Secure by itself', async () => {
  const res = await setup('https');
  assert.equal(res.status, 201);
  assert.match(res.headers.get('set-cookie'), /;\s*Secure/i);
});

test('X003: over HTTPS the app sends HSTS; over plain http it does not', async () => {
  const s = await fetch(base + '/', { headers: { 'X-Forwarded-Proto': 'https' } });
  assert.match(s.headers.get('strict-transport-security') || '', /max-age=\d{7,}/);
  const p = await fetch(base + '/');
  assert.equal(p.headers.get('strict-transport-security'), null);
});

test('F001: the app\'s own scripts and styles are checked again on every load', async () => {
  for (const f of ['/js/main.js', '/css/app.css', '/']) {
    const r = await fetch(base + f);
    assert.match(r.headers.get('cache-control') || '', /max-age=0|no-cache/, f);
    assert.ok(r.headers.get('etag'), `${f} has an ETag, so a reload costs a 304`);
  }
});

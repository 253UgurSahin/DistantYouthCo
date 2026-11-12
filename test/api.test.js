import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A database and upload folder of its own: never the one the app uses.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dyc-test-'));
process.env.DATA_DIR = dataDir;
process.env.DYC_NO_FFMPEG = '1';
delete process.env.ANTHROPIC_API_KEY;
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

function wav() {
  const data = Buffer.alloc(800);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(16000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

class Client {
  cookie = '';
  async req(method, p, body, { ajax = true, raw = false } = {}) {
    const headers = {};
    if (ajax) headers['X-Requested-With'] = 'dyc';
    if (this.cookie) headers.Cookie = this.cookie;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + p, { method, headers, body: payload, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    if (raw) return res;
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  }
}

const admin = new Client();
const listener = new Client();
const other = new Client();
let releaseId;
let hiddenId;

test('first visit asks for the admin; setup works once', async () => {
  const s = await admin.req('GET', '/api/session');
  assert.equal(s.body.needsSetup, true);
  assert.equal((await admin.req('POST', '/api/setup', { username: 'ad', password: 'x' })).status, 400, 'weak input is refused');
  assert.equal((await admin.req('POST', '/api/setup', { username: 'admin', password: 'geheim1234' })).status, 201);
  assert.equal((await new Client().req('POST', '/api/setup', { username: 'evil', password: 'geheim1234' })).status, 403, 'no second setup');
});

test('state-changing calls need the app header (CSRF guard)', async () => {
  const r = await admin.req('POST', '/api/folders', { name: 'X' }, { ajax: false });
  assert.equal(r.status, 403);
});

test('a release needs a real WAV', async () => {
  const fd = new FormData();
  fd.append('title', 'Fake');
  fd.append('wav', new Blob([Buffer.from('this is not a wav')]), 'fake.wav');
  const r = await admin.req('POST', '/api/releases', fd);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /geen geldig WAV/);
  const none = new FormData();
  none.append('title', 'No audio');
  assert.equal((await admin.req('POST', '/api/releases', none)).status, 400);
});

test('admin uploads releases; BPM comes from the style', async () => {
  const fd = new FormData();
  fd.append('title', 'Lanterns in the Rain');
  fd.append('style', 'heavy melodic dubstep, 140 bpm, koto');
  fd.append('lyrics', '[Chorus]\nLight it up, light it up, like lanterns in the rain.');
  fd.append('wav', new Blob([wav()]), 'lanterns.wav');
  const r = await admin.req('POST', '/api/releases', fd);
  assert.equal(r.status, 201);
  assert.equal(r.body.release.bpm, 140);
  assert.equal(r.body.release.has.wav, true);
  releaseId = r.body.release.id;
  const h = new FormData();
  h.append('title', 'Secret demo');
  h.append('hidden', '1');
  h.append('wav', new Blob([wav()]), 'demo.wav');
  hiddenId = (await admin.req('POST', '/api/releases', h)).body.release.id;
});

test('the YouTube-kit falls back to the template without a Claude key', async () => {
  const r = await admin.req('POST', `/api/releases/${releaseId}/youtube`, { mode: 'claude' });
  assert.equal(r.status, 200);
  assert.equal(r.body.generated_with, 'template');
  assert.match(r.body.release.yt_description, /^# 🎵 Lanterns in the Rain — Distant Youth Co\. \(Official Visualizer\)/);
  const s = await admin.req('POST', `/api/folders`, { name: 'Japanese-Inspired' });
  const names = await admin.req('POST', `/api/folders/${s.body.folder.id}/suggest-names`, {});
  assert.equal(names.status, 400, 'an empty collection has nothing to name');
});

test('admin makes a listener and a second listener', async () => {
  assert.equal((await admin.req('POST', '/api/users', { username: 'luisteraar', password: 'luister1234', role: 'listener' })).status, 201);
  assert.equal((await admin.req('POST', '/api/users', { username: 'ander', password: 'ander12345', role: 'listener' })).status, 201);
  assert.equal((await listener.req('POST', '/api/login', { username: 'luisteraar', password: 'fout' })).status, 401);
  assert.equal((await listener.req('POST', '/api/login', { username: 'luisteraar', password: 'luister1234' })).status, 200);
  assert.equal((await other.req('POST', '/api/login', { username: 'ander', password: 'ander12345' })).status, 200);
});

test('a listener cannot upload, manage or see hidden releases', async () => {
  const fd = new FormData();
  fd.append('title', 'x');
  fd.append('wav', new Blob([wav()]), 'x.wav');
  assert.equal((await listener.req('POST', '/api/releases', fd)).status, 403);
  assert.equal((await listener.req('GET', '/api/users')).status, 403);
  assert.equal((await listener.req('GET', '/api/settings')).status, 403);
  assert.equal((await listener.req('POST', `/api/releases/${releaseId}/youtube`, {})).status, 403);
  const list = await listener.req('GET', '/api/releases');
  assert.deepEqual(list.body.releases.map((r) => r.id), [releaseId]);
  assert.equal(list.body.releases[0].yt_description, undefined, 'admin-only fields are not sent');
  assert.equal((await listener.req('GET', `/api/releases/${hiddenId}`)).status, 404);
  assert.equal((await listener.req('GET', `/media/${hiddenId}/audio`, undefined, { raw: true })).status, 404);
  assert.equal((await listener.req('GET', `/media/${releaseId}/audio`, undefined, { raw: true })).status, 200);
});

test('media needs a session and supports ranges', async () => {
  assert.equal((await new Client().req('GET', `/media/${releaseId}/audio`, undefined, { raw: true })).status, 401);
  const res = await fetch(`${base}/media/${releaseId}/wav`, { headers: { Cookie: admin.cookie, Range: 'bytes=0-9' } });
  assert.equal(res.status, 206);
  assert.equal((await res.arrayBuffer()).byteLength, 10);
});

test('playlists belong to their owner', async () => {
  const p = await listener.req('POST', '/api/playlists', { name: 'Night Drive' });
  assert.equal(p.status, 201);
  const id = p.body.playlist.id;
  assert.equal((await listener.req('POST', `/api/playlists/${id}/items`, { release_id: releaseId })).status, 201);
  assert.equal((await listener.req('POST', `/api/playlists/${id}/items`, { release_id: hiddenId })).status, 404, 'no hidden release in a playlist');
  assert.equal((await other.req('GET', `/api/playlists/${id}`)).status, 404, 'a private playlist is invisible to others');
  await listener.req('PUT', `/api/playlists/${id}`, { name: 'Night Drive', is_public: true });
  assert.equal((await other.req('GET', `/api/playlists/${id}`)).status, 200, 'a shared one can be seen');
  assert.equal((await other.req('DELETE', `/api/playlists/${id}`)).status, 403, 'but not changed');
  assert.equal((await other.req('POST', `/api/playlists/${id}/items`, { release_id: releaseId })).status, 403);
  assert.equal((await admin.req('GET', `/api/playlists/${id}`)).body.playlist.releases.length, 1);
});

test('settings never send the API key back', async () => {
  await admin.req('PUT', '/api/settings', { anthropic_api_key: 'sk-ant-example-key', artist_name: 'Distant Youth Co.' });
  const s = await admin.req('GET', '/api/settings');
  assert.equal(s.body.claude.key_saved, true);
  assert.ok(!JSON.stringify(s.body).includes('sk-ant-example-key'), 'not from the server');
  assert.equal((await admin.req('PUT', '/api/settings', { spotify_artist_url: 'javascript:alert(1)' })).status, 400);
});

test('security headers are set', async () => {
  const res = await fetch(base + '/');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
});

test('deleting a release removes its files', async () => {
  assert.equal((await admin.req('DELETE', `/api/releases/${hiddenId}`)).status, 200);
  assert.equal(fs.existsSync(path.join(dataDir, 'uploads', 'releases', String(hiddenId))), false);
});

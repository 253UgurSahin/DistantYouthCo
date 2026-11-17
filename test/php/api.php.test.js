// The PHP server (php/, for shared hosting): the same API as the Node.js server, under the limits of a
// shared host (2 MB per upload, 8 MB per request). Starts PHP's built-in server on a free port.
//   node --test test/php/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const hasPhp = spawnSync('php', ['-v']).status === 0;
const skip = hasPhp ? false : 'PHP is not installed here';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dyc-php-'));
const pw = () => crypto.randomBytes(12).toString('base64url');
const PW = { admin: pw(), listener: pw() };
let base;
let proc;
let fake;
const seen = [];

function wav(seconds = 1) {
  const data = Buffer.alloc(16000 * seconds, 1);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(16000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(3000, 2)]);

class Client {
  cookie = '';
  async req(method, p, body, { ajax = true, raw = false, headers = {} } = {}) {
    const h = { ...headers };
    if (ajax) h['X-Requested-With'] = 'dyc';
    if (this.cookie) h.Cookie = this.cookie;
    let payload;
    if (body instanceof FormData || Buffer.isBuffer(body)) payload = body;
    else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + p, { method, headers: h, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    if (raw) return res;
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  /** A file in pieces, as the app sends it to a shared host. */
  async piecewise(buf, name, chunk) {
    const { body } = await this.req('POST', '/api/uploads', { name, size: buf.length });
    for (let o = 0; o < buf.length; o += chunk) {
      const r = await this.req('POST', `/api/uploads/${body.token}?offset=${o}`, buf.subarray(o, o + chunk), { headers: { 'Content-Type': 'application/octet-stream' } });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    return body.token;
  }
}
const admin = new Client();
const listener = new Client();

before(async () => {
  if (skip) return;
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body: JSON.parse(b || '{}') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ suggestions: [{ name: 'Paper Lanterns', why: 'Licht in de nacht.' }] }) }] }));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  execBuild();
  const port = 20000 + Math.floor(Math.random() * 20000);
  base = `http://127.0.0.1:${port}`;
  const dist = path.join(ROOT, 'dist', 'shared-host');
  proc = spawn('php', ['-d', 'upload_max_filesize=2M', '-d', 'post_max_size=8M', '-S', `127.0.0.1:${port}`, '-t', path.join(dist, 'public_html'), path.join(ROOT, 'php', 'dev-router.php')], {
    env: { ...process.env, DATA_DIR: dataDir, DYC_APP_DIR: path.join(dist, 'distantyouth'), DYC_NO_FFMPEG: '1', ANTHROPIC_BASE_URL: `http://127.0.0.1:${fake.address().port}`, ANTHROPIC_API_KEY: '' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + '/api/session')).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
});
function execBuild() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-shared-host.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}
after(() => {
  proc?.kill();
  fake?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

let releaseId;
let hiddenId;

test('session: version and the size of upload pieces this host needs', { skip }, async () => {
  const s = await admin.req('GET', '/api/session');
  assert.equal(s.status, 200);
  assert.match(s.body.version, /^\d+\.\d+\.\d+$/);
  assert.ok(s.body.upload_chunk > 0 && s.body.upload_chunk < 2 * 1024 * 1024, 'pieces under the 2 MB limit');
  assert.equal(s.body.needsSetup, true);
});

test('setup once, the CSRF header, accounts and roles', { skip }, async () => {
  assert.equal((await admin.req('POST', '/api/setup', { username: 'admin', password: PW.admin }, { ajax: false })).status, 403, 'no app header: refused');
  assert.equal((await admin.req('POST', '/api/setup', { username: 'admin', password: PW.admin })).status, 201);
  assert.equal((await new Client().req('POST', '/api/setup', { username: 'evil', password: PW.admin })).status, 403);
  assert.equal((await admin.req('POST', '/api/users', { username: 'luisteraar', password: PW.listener, role: 'listener' })).status, 201);
  assert.equal((await listener.req('POST', '/api/login', { username: 'luisteraar', password: PW.listener })).status, 200);
  assert.equal((await listener.req('GET', '/api/users')).status, 403);
  assert.equal((await listener.req('GET', '/api/settings')).status, 403);
  assert.equal((await new Client().req('GET', '/api/releases')).status, 401);
});

test('a release from pieces: wrong order refused, a piece sent twice is not written twice, duration read from the WAV', { skip }, async () => {
  const big = wav(200); // 3.2 MB: over the 2 MB limit of one upload
  const { body } = await admin.req('POST', '/api/uploads', { name: 'master.wav', size: big.length });
  const t = body.token;
  const half = 1_600_000;
  assert.equal((await admin.req('POST', `/api/uploads/${t}?offset=${half}`, big.subarray(half), { headers: { 'Content-Type': 'application/octet-stream' } })).status, 409);
  assert.equal((await admin.req('POST', `/api/uploads/${t}?offset=0`, big.subarray(0, half), { headers: { 'Content-Type': 'application/octet-stream' } })).body.received, half);
  assert.equal((await admin.req('POST', `/api/uploads/${t}?offset=0`, big.subarray(0, half), { headers: { 'Content-Type': 'application/octet-stream' } })).body.received, half, 'a retry adds nothing');
  const early = new FormData();
  early.append('title', 'Te vroeg');
  early.append('wav_upload', t);
  assert.match((await admin.req('POST', '/api/releases', early)).body.error, /nog niet helemaal/);
  await admin.req('POST', `/api/uploads/${t}?offset=${half}`, big.subarray(half), { headers: { 'Content-Type': 'application/octet-stream' } });
  const fd = new FormData();
  fd.append('title', 'Lanterns in the Rain');
  fd.append('style', 'heavy melodic dubstep, 140 bpm, koto');
  fd.append('lyrics', '[Chorus]\nLight it up, like lanterns in the rain');
  fd.append('wav_upload', t);
  fd.append('video_upload', await admin.piecewise(mp4, 'v.mp4', 1000));
  const made = await admin.req('POST', '/api/releases', fd);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  releaseId = made.body.release.id;
  assert.equal(made.body.release.bpm, 140);
  assert.equal(made.body.release.duration, 200);
  assert.equal(made.body.release.has.video, true);
  const stored = fs.readFileSync(path.join(dataDir, 'uploads', 'releases', String(releaseId), 'master.wav'));
  assert.ok(stored.equals(big), 'stored exactly as sent');
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'uploads', 'tmp')), [], 'no pieces left behind');
});

test('a file over this host\'s limit in one go gets a clear 413; a fake WAV is refused', { skip }, async () => {
  const fd = new FormData();
  fd.append('title', 'Te groot');
  fd.append('wav', new Blob([wav(200)]), 'big.wav');
  const r = await admin.req('POST', '/api/releases', fd);
  assert.equal(r.status, 413);
  assert.match(r.body.error, /te groot/i);
  const t = await admin.piecewise(Buffer.from('this is not a wav file at all'), 'nep.wav', 1000);
  const f2 = new FormData();
  f2.append('title', 'Nep');
  f2.append('wav_upload', t);
  assert.match((await admin.req('POST', '/api/releases', f2)).body.error, /geen geldig WAV/);
});

test('hidden releases stay hidden from listeners, also their files', { skip }, async () => {
  const fd = new FormData();
  fd.append('title', 'Geheim');
  fd.append('hidden', '1');
  fd.append('wav', new Blob([wav(1)]), 'g.wav');
  hiddenId = (await admin.req('POST', '/api/releases', fd)).body.release.id;
  assert.equal((await listener.req('GET', `/api/releases/${hiddenId}`)).status, 404);
  assert.equal((await listener.req('GET', `/media/${hiddenId}/audio`, undefined, { raw: true })).status, 404);
  assert.ok(!(await listener.req('GET', '/api/releases')).body.releases.some((r) => r.id === hiddenId));
  const st = await listener.req('GET', '/api/stats?months=12');
  assert.equal(st.status, 200);
  assert.equal(st.body.total, 1);
});

test('media: ranges for seeking, a download name, nothing outside the release', { skip }, async () => {
  const r = await listener.req('GET', `/media/${releaseId}/audio`, undefined, { raw: true, headers: { Range: 'bytes=0-99' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), `bytes 0-99/${wav(200).length}`);
  assert.equal((await r.arrayBuffer()).byteLength, 100);
  const d = await admin.req('GET', `/media/${releaseId}/video?download=1`, undefined, { raw: true });
  assert.match(d.headers.get('content-disposition'), /lanterns-in-the-rain-video\.mp4/);
  assert.equal((await admin.req('GET', `/media/${releaseId}/..%2f..%2fdistantyouth.db`, undefined, { raw: true })).status, 404);
});

test('downloads: a ZIP the unzip tools accept; a listener gets none', { skip }, async () => {
  const z = await admin.req('GET', `/downloads/videos.zip?ids=${releaseId}`, undefined, { raw: true });
  assert.equal(z.status, 200);
  const buf = Buffer.from(await z.arrayBuffer());
  const p = path.join(dataDir, 'test.zip');
  fs.writeFileSync(p, buf);
  const py = spawnSync('python3', ['-I', '-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(z.namelist()[0]); print(len(z.read(z.namelist()[0])))', p], { encoding: 'utf8' });
  if (!py.error) {
    assert.equal(py.status, 0, py.stderr);
    assert.deepEqual(py.stdout.trim().split('\n'), ['Lanterns in the Rain (Official Visualizer).mp4', String(mp4.length)]);
  }
  assert.equal((await listener.req('GET', '/downloads/videos.zip', undefined, { raw: true })).status, 403);
  assert.equal((await listener.req('GET', '/api/downloads')).status, 403);
});

test('the Claude key is sealed in the database and never sent back; album names go to Claude as the Node server sends them', { skip }, async () => {
  assert.equal((await admin.req('PUT', '/api/settings', { anthropic_api_key: 'sk-ant-example-key' })).status, 200);
  const s = await admin.req('GET', '/api/settings');
  assert.equal(s.body.claude.key_saved, true);
  assert.ok(!JSON.stringify(s.body).includes('sk-ant-example-key'));
  const db = new DatabaseSync(path.join(dataDir, 'distantyouth.db'), { readOnly: true });
  const raw = db.prepare("SELECT value FROM settings WHERE key = 'anthropic_api_key'").get().value;
  db.close();
  assert.match(raw, /^enc:v1:/);
  const folder = (await admin.req('POST', '/api/folders', { name: 'EP' })).body.folder;
  // A form goes as a POST that names PUT, as the app sends it: PHP reads form fields of a POST only.
  const moved = await admin.req('POST', `/api/releases/${releaseId}`, (() => { const f = new FormData(); f.append('title', 'Lanterns in the Rain'); f.append('style', 'heavy melodic dubstep, 140 bpm, koto'); f.append('lyrics', '[Chorus]\nLight it up, like lanterns in the rain'); f.append('folder_id', String(folder.id)); return f; })(), { headers: { 'X-HTTP-Method-Override': 'PUT' } });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.release.folder_id, folder.id);
  const names = await admin.req('POST', `/api/folders/${folder.id}/suggest-names`, { direction: 'kort' });
  assert.equal(names.status, 200, JSON.stringify(names.body));
  assert.deepEqual(names.body.suggestions.map((x) => x.name), ['Paper Lanterns']);
  const sent = seen.at(-1);
  assert.equal(sent.headers['x-api-key'], 'sk-ant-example-key');
  assert.match(sent.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(sent.body.model, 'claude-opus-5-5');
  assert.equal(sent.body.fallbacks, 'default');
  assert.equal(sent.body.output_config.format.type, 'json_schema');
  assert.match(sent.body.messages[0].content, /<direction_from_artist>kort<\/direction_from_artist>/);
});

test('YouTube kit from the template, in the artist\'s layout', { skip }, async () => {
  const r = await admin.req('POST', `/api/releases/${releaseId}/youtube`, { mode: 'template' });
  assert.equal(r.status, 200);
  const d = r.body.release.yt_description;
  assert.match(d, /^# 🎵 Lanterns in the Rain — Distant Youth Co\. \(Official Visualizer\)\n\n\*"Light it up, like lanterns in the rain"\*/);
  assert.match(d, /140 BPM · Heavy Melodic Dubstep · Koto/);
  assert.match(d, /🎧 More from Distant Youth Co\. on Spotify: {2}\nhttps:\/\/open\.spotify\.com/);
  assert.match(d, /#heavymelodicdubstep #koto #aimusic/);
});

test('playlists: private ones are another listener\'s secret; a POST can stand in for PUT and DELETE', { skip }, async () => {
  const p = (await listener.req('POST', '/api/playlists', { name: 'Mijn nacht' })).body.playlist;
  assert.equal((await listener.req('POST', `/api/playlists/${p.id}/items`, { release_id: releaseId })).status, 201);
  assert.equal((await listener.req('POST', `/api/playlists/${p.id}/items`, { release_id: hiddenId })).status, 404);
  const other = new Client();
  await admin.req('POST', '/api/users', { username: 'ander', password: PW.listener, role: 'listener' });
  await other.req('POST', '/api/login', { username: 'ander', password: PW.listener });
  assert.equal((await other.req('GET', `/api/playlists/${p.id}`)).status, 404);
  assert.equal((await other.req('DELETE', `/api/playlists/${p.id}`)).status, 404);
  assert.equal((await listener.req('POST', `/api/playlists/${p.id}`, undefined, { headers: { 'X-HTTP-Method-Override': 'DELETE' } })).status, 200);
});

test('the data folder refuses to serve anything; twenty wrong passwords block the login', { skip }, async () => {
  assert.match(fs.readFileSync(path.join(dataDir, '.htaccess'), 'utf8'), /Require all denied/);
  const c = new Client();
  let last;
  for (let i = 0; i < 22; i++) last = await c.req('POST', '/api/login', { username: 'luisteraar', password: 'wrong' + i });
  assert.equal(last.status, 429);
});

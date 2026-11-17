import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// A stand-in for the Anthropic API: it records each request and answers with what the test set.
const seen = [];
let reply = null;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ path: req.url, headers: req.headers, body: JSON.parse(body || '{}') });
    const { status = 200, json } = reply(seen.at(-1));
    res.writeHead(status, { 'content-type': 'application/json', 'request-id': 'req_test' });
    res.end(JSON.stringify(json));
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dyc-claude-'));
process.env.DATA_DIR = dataDir;
process.env.DYC_NO_FFMPEG = '1';
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
process.env.ANTHROPIC_API_KEY = 'example-key';
const { createApp } = await import('../../backend/node/app.js');

const message = (text, stop_reason = 'end_turn') => ({
  json: {
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason, stop_sequence: null,
    content: text === null ? [] : [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 10 },
  },
});

let base;
let server;
let cookie = '';
const pass = crypto.randomBytes(12).toString('base64url');
async function call(method, p, body) {
  const headers = { 'X-Requested-With': 'dyc', Cookie: cookie };
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + p, { method, headers, body: payload });
  const c = res.headers.get('set-cookie');
  if (c) cookie = c.split(';')[0];
  return { status: res.status, body: await res.json() };
}
function wav() {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36, 4); h.write('WAVE', 8);
  return h;
}

let releaseId;
let folderId;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await call('POST', '/api/setup', { username: 'admin', password: pass });
  folderId = (await call('POST', '/api/folders', { name: 'Werktitel' })).body.folder.id;
  const fd = new FormData();
  fd.append('title', 'Lanterns in the Rain');
  fd.append('style', 'heavy melodic dubstep, 140 bpm, koto');
  fd.append('lyrics', '[Chorus]\nLight it up, light it up, like lanterns in the rain.');
  fd.append('folder_id', String(folderId));
  fd.append('wav', new Blob([wav()]), 'l.wav');
  releaseId = (await call('POST', '/api/releases', fd)).body.release.id;
});
after(() => {
  server.close();
  fake.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('the key is read from the environment', () => {
  assert.ok(process.env.ANTHROPIC_API_KEY === 'example-key', 'not from env');
});

test('YouTube-kit: Claude writes the story, the app keeps the fixed layout', async () => {
  reply = () => message(JSON.stringify({
    hook_line: 'Light it up, light it up, like lanterns in the rain.',
    story_paragraphs: ['Lanterns in the Rain is a heavy melodic dubstep track about letting go of fear.', 'Then the energy takes over.'],
    style_tags: ['Heavy Melodic Dubstep', 'Koto'],
    bpm: 140,
    dedication: 'For everyone who still finds a reason to shine.',
    closing_line: 'Light it up.',
    hashtags: ['dubstep', 'koto'],
    youtube_tags: ['Lanterns in the Rain', 'melodic dubstep'],
  }));
  const r = await call('POST', `/api/releases/${releaseId}/youtube`, { mode: 'claude', extra: 'deel 2 van de reeks' });
  assert.equal(r.status, 200);
  assert.equal(r.body.generated_with, 'claude-opus-5-5');
  const d = r.body.release.yt_description;
  assert.match(d, /^# 🎵 Lanterns in the Rain — Distant Youth Co\. \(Official Visualizer\)\n\n\*"Light it up/);
  assert.match(d, /Then the energy takes over\./);
  assert.match(d, /140 BPM · Heavy Melodic Dubstep · Koto/);
  assert.match(d, /🧪 Made with AI — Suno AI/);
  assert.match(d, /#dubstep #koto #aimusic/);

  const sent = seen.at(-1);
  assert.match(sent.path, /^\/v1\/messages/);
  assert.equal(sent.body.model, 'claude-opus-5-5');
  assert.equal(sent.body.fallbacks, 'default');
  assert.equal(sent.body.output_config.format.type, 'json_schema');
  assert.match(sent.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.match(sent.body.messages[0].content, /<lyrics>[\s\S]*lanterns in the rain/);
  assert.match(sent.body.messages[0].content, /deel 2 van de reeks/);
});

test('a refusal or a cut-off answer becomes a clear message, not a half description', async () => {
  reply = () => message(null, 'refusal');
  let r = await call('POST', `/api/releases/${releaseId}/youtube`, { mode: 'claude' });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /wilde dit niet schrijven/);
  reply = () => message('{"hook_line": "Light', 'max_tokens');
  r = await call('POST', `/api/releases/${releaseId}/youtube`, { mode: 'claude' });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /te lang/);
});

test('a wrong key says so', async () => {
  reply = () => ({ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
  const r = await call('POST', `/api/releases/${releaseId}/youtube`, { mode: 'claude' });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /API key is ongeldig/);
});

test('album names: Claude reads the tracks of the collection', async () => {
  reply = () => message(JSON.stringify({ suggestions: [
    { name: 'Paper Lanterns', why: 'Licht in het donker komt steeds terug.' },
    { name: '  ', why: 'leeg, wordt weggelaten' },
    { name: 'Midnight Rain', why: 'Regen en nacht als rode draad.' },
  ] }));
  const r = await call('POST', `/api/folders/${folderId}/suggest-names`, { direction: 'kort' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.suggestions.map((s) => s.name), ['Paper Lanterns', 'Midnight Rain']);
  const sent = seen.at(-1).body.messages[0].content;
  assert.match(sent, /<title>Lanterns in the Rain<\/title>/);
  assert.match(sent, /<direction_from_artist>kort<\/direction_from_artist>/);
});

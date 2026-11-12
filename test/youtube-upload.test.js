// Tests for the direct YouTube upload (src/youtube-api.js and its routes in src/app.js).
//
// Nothing here talks to the real Google: a small fake Google runs on localhost and the module's
// `endpoints` point at it. The fake keeps the parts of Google's protocol the app relies on: the OAuth
// token swap and refresh, the channel lookup, YouTube's resumable upload (308 "resume incomplete" with a
// Range header, and the "bytes */<size>" status query), thumbnails.set and videos.list.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

// A database and upload folder of its own: never the one the app uses.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dyc-yt-test-'));
process.env.DATA_DIR = dataDir;
process.env.DYC_NO_FFMPEG = '1';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.YOUTUBE_CLIENT_ID;
delete process.env.YOUTUBE_CLIENT_SECRET;
delete process.env.PUBLIC_URL;
const { createApp } = await import('../src/app.js');
const yt = await import('../src/youtube-api.js');
const { db } = await import('../src/db.js');

// Small chunks, so a test video of under a megabyte still goes up in several of them,
// and short waits, so the retry test does not take seconds.
yt.uploadConfig.chunkSize = 256 * 1024;
yt.uploadConfig.retryDelayMs = 5;

const pw = () => crypto.randomBytes(12).toString('base64url');
const PW = { admin: pw(), listener: pw() };
// Not real credentials: the fake Google only checks that they come back unchanged.
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const CLIENT_SECRET = crypto.randomBytes(9).toString('hex');

// ---------- the fake Google ----------

const fake = {
    refreshOk: true,
    // 'store-then-503': keep the next middle chunk but answer 503, as if the answer got lost on the way.
    failNextChunk: '',
    sessions: new Map(), // session id -> { total, received: Buffer[], size }
    metadata: null,
    uploadHeaders: null,
    statusQueries: 0,
    thumbnail: null,
    videoStatus: { privacyStatus: 'private', uploadStatus: 'uploaded' },
    revoked: [],
    tokenCalls: [],
    nextVideo: 1,
};

function readBody(req) {
    return new Promise((resolve) => {
        const parts = [];
        req.on('data', (c) => parts.push(c));
        req.on('end', () => resolve(Buffer.concat(parts)));
    });
}

function json(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
}

let googleBase;
const google = http.createServer(async (req, res) => {
    const url = new URL(req.url, googleBase);
    const body = await readBody(req);
    const authed = req.headers.authorization?.startsWith('Bearer at-');

    if (url.pathname === '/token' && req.method === 'POST') {
        const p = new URLSearchParams(body.toString());
        fake.tokenCalls.push(p.get('grant_type'));
        if (p.get('client_id') !== CLIENT_ID || p.get('client_secret') !== CLIENT_SECRET) return json(res, 401, { error: 'invalid_client' });
        if (p.get('grant_type') === 'authorization_code' && p.get('code') === 'good-code') {
            return json(res, 200, { access_token: 'at-1', expires_in: 3600, refresh_token: 'rt-1', token_type: 'Bearer' });
        }
        if (p.get('grant_type') === 'refresh_token' && p.get('refresh_token') === 'rt-1' && fake.refreshOk) {
            return json(res, 200, { access_token: `at-${fake.tokenCalls.length}`, expires_in: 3600, token_type: 'Bearer' });
        }
        return json(res, 400, { error: 'invalid_grant' });
    }
    if (url.pathname === '/revoke' && req.method === 'POST') {
        fake.revoked.push(new URLSearchParams(body.toString()).get('token'));
        return json(res, 200, {});
    }
    if (url.pathname === '/youtube/v3/channels') {
        if (!authed) return json(res, 401, { error: { errors: [{ reason: 'authorizationRequired' }] } });
        return json(res, 200, { items: [{ id: 'UC-test', snippet: { title: 'Distant Youth Co.' } }] });
    }
    if (url.pathname === '/upload/youtube/v3/videos' && req.method === 'POST') {
        if (!authed) return json(res, 401, {});
        fake.metadata = JSON.parse(body.toString());
        fake.uploadHeaders = req.headers;
        const id = crypto.randomBytes(6).toString('hex');
        fake.sessions.set(id, { total: Number(req.headers['x-upload-content-length']), received: [], size: 0 });
        res.writeHead(200, { Location: `${googleBase}/upload-session/${id}` });
        return res.end();
    }
    if (url.pathname.startsWith('/upload-session/') && req.method === 'PUT') {
        const s = fake.sessions.get(url.pathname.split('/').pop());
        if (!s) return json(res, 404, {});
        const range = req.headers['content-range'] || '';
        const finished = () => {
            const video = { id: `vid-${fake.nextVideo++}`, status: { ...fake.metadata.status } };
            s.video = video;
            json(res, 201, video);
        };
        const incomplete = () => {
            res.writeHead(308, s.size ? { Range: `bytes=0-${s.size - 1}` } : {});
            res.end();
        };
        if (/^bytes \*\/\d+$/.test(range)) {
            // The status query after a failure.
            fake.statusQueries++;
            return s.size === s.total ? finished() : incomplete();
        }
        const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
        if (!m) return json(res, 400, {});
        // Like YouTube: only the bytes that follow on from what it has count.
        if (Number(m[1]) !== s.size) return incomplete();
        s.received.push(body);
        s.size += body.length;
        if (fake.failNextChunk === 'store-then-503' && s.size < s.total) {
            fake.failNextChunk = '';
            return json(res, 503, { error: { errors: [{ reason: 'backendError' }] } });
        }
        return s.size === s.total ? finished() : incomplete();
    }
    if (url.pathname === '/upload/youtube/v3/thumbnails/set' && req.method === 'POST') {
        fake.thumbnail = { videoId: url.searchParams.get('videoId'), type: req.headers['content-type'], bytes: body.length };
        return json(res, 200, { items: [] });
    }
    if (url.pathname === '/youtube/v3/videos' && req.method === 'GET') {
        if (!authed) return json(res, 401, {});
        const items = fake.videoStatus ? [{ id: url.searchParams.get('id'), status: fake.videoStatus }] : [];
        return json(res, 200, { items });
    }
    json(res, 404, { error: 'unknown fake route' });
});

// ---------- the app and its clients ----------

let server;
let base;
before(async () => {
    google.listen(0);
    await new Promise((r) => google.once('listening', r));
    googleBase = `http://127.0.0.1:${google.address().port}`;
    Object.assign(yt.endpoints, {
        auth: `${googleBase}/auth`,
        token: `${googleBase}/token`,
        revoke: `${googleBase}/revoke`,
        api: `${googleBase}/youtube/v3`,
        upload: `${googleBase}/upload/youtube/v3`,
    });
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
    server.close();
    google.close();
    // Close the database first: Windows does not let us delete a file that is still open.
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

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
        const data = await res.json().catch(() => null);
        return { status: res.status, body: data };
    }
}

const admin = new Client();
const listener = new Client();

// ---------- test files ----------

function wav() {
    const data = Buffer.alloc(800);
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(8000, 24);
    h.writeUInt32LE(16000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
    return Buffer.concat([h, data]);
}

// A file the app accepts as MP4 (it checks for "ftyp" at byte 4), about 700 KB: three chunks of 256 KiB.
const VIDEO = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), crypto.randomBytes(700 * 1024)]);
// A file the app accepts as JPEG (FF D8 FF at the start).
const COVER = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(4000)]);

async function newRelease(title, { video = false, cover = false } = {}) {
    const fd = new FormData();
    fd.append('title', title);
    fd.append('style', 'heavy melodic dubstep, 140 bpm, koto');
    fd.append('lyrics', '[Chorus]\nLight it up, light it up, like lanterns in the rain.');
    fd.append('wav', new Blob([wav()]), 'master.wav');
    if (video) fd.append('video', new Blob([VIDEO]), 'video.mp4');
    if (cover) fd.append('cover', new Blob([COVER]), 'cover.jpg');
    const r = await admin.req('POST', '/api/releases', fd);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.release.id;
}

/** Follows an upload job until it ends, like the browser does. */
async function waitForJob(id) {
    for (let i = 0; i < 400; i++) {
        const { body } = await admin.req('GET', `/api/releases/${id}/youtube/upload`);
        if (body.job && ['done', 'error'].includes(body.job.state)) return body.job;
        await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('the upload did not finish');
}

let withVideo;
let withoutVideo;
let oauthState;

// ---------- unit: the video resource ----------

test('tags: a list for the API, counted the way YouTube counts them', () => {
    assert.deepEqual(yt.tagsForApi('dubstep, Distant Youth Co., dubstep, <bad>, '), ['dubstep', 'Distant Youth Co.', 'bad']);
    // "a b" counts as "\"a b\"" (5), plus a comma, plus "c" (1).
    assert.equal(yt.tagsLength(['a b', 'c']), 7);
});

test('the video resource: music, not for kids, AI label, and YouTube\'s rules checked up front', () => {
    const release = { yt_title: 'Lanterns in the Rain — Distant Youth Co.', yt_description: '# 🎵 Lanterns', yt_tags: 'dubstep, koto' };
    const { resource } = yt.buildVideoResource(release, { privacy: 'public', syntheticMedia: true });
    assert.equal(resource.snippet.categoryId, '10');
    assert.deepEqual(resource.snippet.tags, ['dubstep', 'koto']);
    assert.equal(resource.status.selfDeclaredMadeForKids, false);
    assert.equal(resource.status.containsSyntheticMedia, true);
    assert.equal(resource.status.publishAt, undefined);
    assert.throws(() => yt.buildVideoResource({ ...release, yt_title: '' }, { privacy: 'public' }), /titel/);
    assert.throws(() => yt.buildVideoResource({ ...release, yt_description: 'a < b' }, { privacy: 'public' }), /< en >/);
    // 1,300 emoji are 1,300 characters but 5,200 bytes: over YouTube's byte limit.
    assert.throws(() => yt.buildVideoResource({ ...release, yt_description: '🎵'.repeat(1300) }, { privacy: 'public' }), /5\.000 bytes/);
    assert.throws(() => yt.buildVideoResource(release, { privacy: 'public', publishAt: '2030-01-01T00:00:00.000Z' }), /privé/);
    // Too many tags: dropped from the end with a warning, not a refused upload.
    const many = Array.from({ length: 80 }, (_, i) => `long tag number ${i}`).join(', ');
    const { resource: r2, warnings } = yt.buildVideoResource({ ...release, yt_tags: many }, { privacy: 'private' });
    assert.ok(yt.tagsLength(r2.snippet.tags) <= 500);
    assert.match(warnings[0], /weggelaten/);
});

// ---------- settings ----------

test('settings: a YouTube block, and the client secret never comes back', async () => {
    assert.equal((await admin.req('POST', '/api/setup', { username: 'admin', password: PW.admin })).status, 201);
    assert.equal((await admin.req('POST', '/api/users', { username: 'luisteraar', password: PW.listener, role: 'listener' })).status, 201);
    assert.equal((await listener.req('POST', '/api/login', { username: 'luisteraar', password: PW.listener })).status, 200);

    let s = await admin.req('GET', '/api/settings');
    assert.equal(s.body.youtube.configured, false);
    assert.equal(s.body.youtube.connected, false);
    assert.equal(s.body.youtube.redirect_uri, `${base}/oauth/youtube/callback`);
    assert.equal(s.body.settings.youtube_default_privacy, 'private');

    assert.equal((await admin.req('PUT', '/api/settings', {
        youtube_client_id: CLIENT_ID, youtube_client_secret: CLIENT_SECRET, youtube_default_privacy: 'unlisted', youtube_synthetic_media: true,
    })).status, 200);
    s = await admin.req('GET', '/api/settings');
    assert.equal(s.body.youtube.configured, true);
    assert.equal(s.body.youtube.secret_saved, true);
    assert.equal(s.body.youtube.client_id, CLIENT_ID);
    assert.equal(s.body.settings.youtube_default_privacy, 'unlisted');
    assert.equal(s.body.settings.youtube_synthetic_media, '1');
    assert.ok(!JSON.stringify(s.body).includes(CLIENT_SECRET), 'the secret is not sent back');

    assert.equal((await admin.req('PUT', '/api/settings', { youtube_default_privacy: 'everyone' })).status, 400);
    // The form cannot plant a token or a channel: those come from Google only.
    await admin.req('PUT', '/api/settings', { youtube_refresh_token: 'planted', youtube_channel_title: 'Not mine' });
    s = await admin.req('GET', '/api/settings');
    assert.equal(s.body.youtube.connected, false);
    assert.equal((await listener.req('GET', '/api/settings')).status, 403);
});

// ---------- connecting ----------

test('connecting: off to Google with a state; a wrong state is refused; the right one connects once', async () => {
    const start = await admin.req('GET', '/oauth/youtube/start', undefined, { raw: true });
    assert.equal(start.status, 303);
    const to = new URL(start.headers.get('location'));
    assert.equal(`${to.origin}${to.pathname}`, `${googleBase}/auth`);
    assert.equal(to.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(to.searchParams.get('redirect_uri'), `${base}/oauth/youtube/callback`);
    assert.equal(to.searchParams.get('access_type'), 'offline');
    assert.match(to.searchParams.get('scope'), /youtube\.upload/);
    assert.doesNotMatch(to.searchParams.get('scope'), /auth\/youtube(\s|$)/, 'no full-control scope');
    oauthState = to.searchParams.get('state');
    assert.ok(oauthState.length >= 20);

    // Someone else's code with a made-up state: refused, nothing connected.
    const wrong = await admin.req('GET', '/oauth/youtube/callback?state=made-up&code=good-code', undefined, { raw: true });
    assert.equal(wrong.status, 303);
    assert.equal(wrong.headers.get('location'), '/#/instellingen?youtube=klaar');
    let s = await admin.req('GET', '/api/settings');
    assert.equal(s.body.youtube.connected, false);
    assert.equal(s.body.youtube.last_auth.ok, false);

    // The listener's session cannot use the admin's state.
    await listener.req('GET', `/oauth/youtube/callback?state=${oauthState}&code=good-code`, undefined, { raw: true });
    assert.equal((await admin.req('GET', '/api/settings')).body.youtube.connected, false);
    // ...and a listener is never sent to Google.
    const lStart = await listener.req('GET', '/oauth/youtube/start', undefined, { raw: true });
    assert.equal(lStart.headers.get('location'), '/#/instellingen');
});

test('connecting: the right state and code store the channel', async () => {
    // A fresh "Koppel" click, so this test does not depend on what the previous one left behind.
    const start = await admin.req('GET', '/oauth/youtube/start', undefined, { raw: true });
    oauthState = new URL(start.headers.get('location')).searchParams.get('state');
    const ok = await admin.req('GET', `/oauth/youtube/callback?state=${oauthState}&code=good-code`, undefined, { raw: true });
    assert.equal(ok.status, 303);
    const s = await admin.req('GET', '/api/settings');
    assert.equal(s.body.youtube.connected, true);
    assert.deepEqual(s.body.youtube.channel, { id: 'UC-test', title: 'Distant Youth Co.' });
    assert.equal(s.body.youtube.last_auth.ok, true);
    assert.equal(s.body.youtube.last_auth.message, 'Gekoppeld met Distant Youth Co.', 'one full stop, not two');
    assert.ok(!JSON.stringify(s.body).includes('rt-1'), 'the refresh token is not sent back');
    // A state works once.
    await admin.req('GET', `/oauth/youtube/callback?state=${oauthState}&code=good-code`, undefined, { raw: true });
    assert.equal((await admin.req('GET', '/api/settings')).body.youtube.last_auth.ok, false);
});

// ---------- uploading ----------

test('an upload needs an MP4, YouTube-proof texts, a future time, an admin and the app header', async () => {
    withoutVideo = await newRelease('Zonder video');
    await admin.req('POST', `/api/releases/${withoutVideo}/youtube`, { mode: 'template' });
    const noVideo = await admin.req('POST', `/api/releases/${withoutVideo}/youtube/upload`, { privacy: 'private' });
    assert.equal(noVideo.status, 400);
    assert.match(noVideo.body.error, /MP4/);

    withVideo = await newRelease('Lanterns in the Rain', { video: true, cover: true });
    await admin.req('POST', `/api/releases/${withVideo}/youtube`, { mode: 'template' });
    const kit = (await admin.req('GET', `/api/releases/${withVideo}`)).body.release;

    await admin.req('PUT', `/api/releases/${withVideo}/youtube`, { yt_title: kit.yt_title, yt_description: 'Love <3', yt_tags: kit.yt_tags });
    const angle = await admin.req('POST', `/api/releases/${withVideo}/youtube/upload`, { privacy: 'private' });
    assert.equal(angle.status, 400);
    assert.match(angle.body.error, /< en >/);
    await admin.req('PUT', `/api/releases/${withVideo}/youtube`, { yt_title: kit.yt_title, yt_description: kit.yt_description, yt_tags: kit.yt_tags });

    const past = await admin.req('POST', `/api/releases/${withVideo}/youtube/upload`, { privacy: 'scheduled', publish_at: '2020-01-01T10:00:00.000Z' });
    assert.equal(past.status, 400);
    assert.equal((await admin.req('POST', `/api/releases/${withVideo}/youtube/upload`, { privacy: 'everyone' })).status, 400);
    assert.equal((await listener.req('POST', `/api/releases/${withVideo}/youtube/upload`, { privacy: 'private' })).status, 403);
    assert.equal((await admin.req('POST', `/api/releases/${withVideo}/youtube/upload`, { privacy: 'private' }, { ajax: false })).status, 403);
    assert.equal(fake.metadata, null, 'nothing reached YouTube');
});

test('the upload goes up in chunks, survives a lost answer, sets the thumbnail and links the video', async () => {
    fake.failNextChunk = 'store-then-503';
    const when = new Date(Date.now() + 3 * 86400_000).toISOString();
    const start = await admin.req('POST', `/api/releases/${withVideo}/youtube/upload`, { privacy: 'scheduled', publish_at: when });
    assert.equal(start.status, 202, JSON.stringify(start.body));
    assert.equal(start.body.job.total, VIDEO.length);

    const job = await waitForJob(withVideo);
    assert.equal(job.state, 'done', job.error);
    assert.deepEqual(job.warnings, []);
    assert.match(job.result.url, /^https:\/\/youtu\.be\/vid-\d+$/);
    assert.equal(job.result.privacy, 'private');
    assert.equal(job.result.publish_at, when);

    // Every byte arrived, once, in order, although one answer was lost on the way.
    const session = [...fake.sessions.values()].at(-1);
    assert.equal(Buffer.compare(Buffer.concat(session.received), VIDEO), 0);
    assert.ok(fake.statusQueries >= 1, 'it asked YouTube how far it got');

    // What YouTube was told.
    assert.equal(fake.uploadHeaders['x-upload-content-length'], String(VIDEO.length));
    const { snippet, status } = fake.metadata;
    assert.match(snippet.title, /^Lanterns in the Rain — Distant Youth Co\./);
    assert.match(snippet.description, /^# 🎵 Lanterns in the Rain/);
    assert.ok(Array.isArray(snippet.tags) && snippet.tags.includes('Lanterns in the Rain'));
    assert.equal(snippet.categoryId, '10');
    assert.deepEqual(status, {
        privacyStatus: 'private', publishAt: when, selfDeclaredMadeForKids: false, containsSyntheticMedia: true, embeddable: true,
    });
    assert.deepEqual(fake.thumbnail, { videoId: job.result.video_id, type: 'image/jpeg', bytes: COVER.length });

    // The release now points at the video; it is not "live" while it is private.
    const r = (await admin.req('GET', `/api/releases/${withVideo}`)).body.release;
    assert.equal(r.youtube_video_id, job.result.video_id);
    assert.equal(r.youtube_url, job.result.url);
    assert.equal(r.yt_privacy, 'private');
    assert.equal(r.yt_publish_at, when);
    assert.equal(r.on_youtube, false);
    assert.equal((await listener.req('GET', `/api/releases/${withVideo}`)).body.release.youtube_video_id, undefined, 'admin-only');
});

test('a second upload needs a yes; the status check sees it go public; a deleted video unlinks', async () => {
    const again = await admin.req('POST', `/api/releases/${withVideo}/youtube/upload`, { privacy: 'private' });
    assert.equal(again.status, 409);
    assert.match(again.body.error, /al op YouTube/);

    fake.videoStatus = { privacyStatus: 'public', uploadStatus: 'processed' };
    let sync = await admin.req('POST', `/api/releases/${withVideo}/youtube/sync`, {});
    assert.equal(sync.status, 200);
    assert.equal(sync.body.release.on_youtube, true);
    assert.equal(sync.body.release.status, 'live');
    assert.equal(sync.body.release.yt_publish_at, '');

    fake.videoStatus = { privacyStatus: 'public', uploadStatus: 'rejected', rejectionReason: 'copyright' };
    sync = await admin.req('POST', `/api/releases/${withVideo}/youtube/sync`, {});
    assert.match(sync.body.sync.problem, /afgewezen \(copyright\)/);
    assert.equal(sync.body.release.on_youtube, false, 'a rejected video is not live');

    fake.videoStatus = null;
    sync = await admin.req('POST', `/api/releases/${withVideo}/youtube/sync`, {});
    assert.equal(sync.body.sync.removed, true);
    assert.equal(sync.body.release.youtube_video_id, '');
    assert.equal(sync.body.release.youtube_url, '');
    assert.equal((await admin.req('POST', `/api/releases/${withoutVideo}/youtube/sync`, {})).status, 400);
});

test('a link set by hand to another video forgets the uploaded one', async () => {
    db.prepare("UPDATE releases SET youtube_video_id = 'vid-x', youtube_url = 'https://youtu.be/vid-x' WHERE id = ?").run(withVideo);
    await admin.req('POST', `/api/releases/${withVideo}/status`, { youtube_url: 'https://youtu.be/other', on_youtube: true });
    const r = (await admin.req('GET', `/api/releases/${withVideo}`)).body.release;
    assert.equal(r.youtube_video_id, '');
    assert.equal(r.on_youtube, true);
});

test('disconnecting revokes the token at Google and forgets the channel', async () => {
    assert.equal((await listener.req('POST', '/api/youtube/disconnect', {})).status, 403);
    assert.equal((await admin.req('POST', '/api/youtube/disconnect', {})).status, 200);
    assert.deepEqual(fake.revoked, ['rt-1']);
    const s = await admin.req('GET', '/api/settings');
    assert.equal(s.body.youtube.connected, false);
    assert.equal(s.body.youtube.configured, true, 'the client ID and secret stay');
    const up = await admin.req('POST', `/api/releases/${withoutVideo}/youtube/upload`, { privacy: 'private' });
    assert.equal(up.status, 409);
    assert.match(up.body.error, /niet gekoppeld/);
});

test('a refresh token Google no longer accepts disconnects, instead of failing on every try', async () => {
    // Connect again, then let Google refuse the refresh (revoked by the artist, or 7 days in "Testing" mode).
    const start = await admin.req('GET', '/oauth/youtube/start', undefined, { raw: true });
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    await admin.req('GET', `/oauth/youtube/callback?state=${state}&code=good-code`, undefined, { raw: true });
    assert.equal((await admin.req('GET', '/api/settings')).body.youtube.connected, true);
    yt.resetForTests(); // drop the cached access token, so the next call has to refresh
    fake.refreshOk = false;
    db.prepare("UPDATE releases SET youtube_video_id = 'vid-y' WHERE id = ?").run(withVideo);
    const sync = await admin.req('POST', `/api/releases/${withVideo}/youtube/sync`, {});
    assert.equal(sync.status, 409);
    assert.match(sync.body.error, /verlopen of ingetrokken/);
    assert.equal((await admin.req('GET', '/api/settings')).body.youtube.connected, false);
});

test('a new client ID means connecting again', async () => {
    fake.refreshOk = true;
    const start = await admin.req('GET', '/oauth/youtube/start', undefined, { raw: true });
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    await admin.req('GET', `/oauth/youtube/callback?state=${state}&code=good-code`, undefined, { raw: true });
    assert.equal((await admin.req('GET', '/api/settings')).body.youtube.connected, true);
    await admin.req('PUT', '/api/settings', { youtube_client_id: CLIENT_ID }); // the same one: stays connected
    assert.equal((await admin.req('GET', '/api/settings')).body.youtube.connected, true);
    await admin.req('PUT', '/api/settings', { youtube_client_id: 'another.apps.googleusercontent.com' });
    assert.equal((await admin.req('GET', '/api/settings')).body.youtube.connected, false);
});

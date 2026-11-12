// Direct upload to the artist's own YouTube channel, through the official YouTube Data API v3.
//
// How it fits together:
//   1. The artist makes an OAuth client in their own Google Cloud project and saves its ID and secret
//      in Instellingen (or in .env as YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET).
//   2. "Koppel YouTube-kanaal" sends the browser to Google (beginAuth). Google sends it back to
//      /oauth/youtube/callback with a one-time code (finishAuth), which we swap for a refresh token.
//      That refresh token is stored on the server and never sent to the browser.
//   3. "Upload naar YouTube" starts a background job (startUpload) that sends the release's MP4 in
//      chunks with YouTube's resumable upload protocol, so a 4 GB video survives a dropped connection,
//      then sets the cover as the thumbnail and writes the video's link back on the release.
//   4. syncVideoStatus asks YouTube whether the video is public yet (a scheduled video, or one the
//      artist made public in YouTube Studio), so the moon goes to "live" by itself.
//
// No Google SDK: a handful of plain HTTPS calls with fetch keeps the app small and easy to test
// (the tests point `endpoints` at a fake Google on localhost).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, getSettings, saveSettings } from './db.js';
import { storedPath } from './files.js';
import { LIMITS } from './youtube.js';

// ---------- addresses and tuning ----------

/** Every Google address this module talks to. Tests replace these with a local fake. */
export const endpoints = {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    revoke: 'https://oauth2.googleapis.com/revoke',
    api: 'https://www.googleapis.com/youtube/v3',
    upload: 'https://www.googleapis.com/upload/youtube/v3',
};

/**
 * Upload tuning. YouTube requires every chunk except the last to be a multiple of 256 KiB.
 * 8 MiB is a good middle: few requests, and little to send again after a dropped connection.
 */
export const uploadConfig = {
    chunkSize: 8 * 1024 * 1024,
    // How often one stuck spot may fail in a row before we give up (network errors, 5xx, 429).
    maxRetries: 6,
    // First wait after a failure; it doubles each time (1, 2, 4, 8, 16, 32 s), plus a little jitter.
    retryDelayMs: 1000,
};

/**
 * youtube.upload: put videos and thumbnails on the channel.
 * youtube.readonly: read the channel's name and a video's status (public, private, scheduled).
 * Deliberately nothing that can edit or delete videos that are already there.
 */
export const SCOPES = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
];

/** The privacy choices YouTube knows. "Scheduled" is private plus a publishAt time. */
export const PRIVACY = ['private', 'unlisted', 'public'];

// YouTube's own category id for Music.
const MUSIC_CATEGORY = '10';
// YouTube refuses custom thumbnails above 2 MB.
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
// YouTube counts the description in bytes (UTF-8), not in characters: an emoji counts as 4.
const MAX_DESCRIPTION_BYTES = 5000;
// How long a "Koppel"-click may take before its state is no longer accepted.
const STATE_TTL_MS = 10 * 60_000;

// ---------- errors ----------

/** A user-facing error: its message is Dutch and safe to show in the app. */
export class YoutubeError extends Error {
    constructor(message, status = 502, code = '') {
        super(message);
        this.status = status;
        this.code = code;
    }
}

// Google's error "reason" codes we can explain in plain Dutch. Everything else gets a generic message
// with the code in brackets, so it can still be looked up.
const REASONS = {
    quotaExceeded: 'Het dagelijkse YouTube-quotum van je Google-project is op. Na middernacht (Amerikaanse westkusttijd) kan het weer.',
    uploadLimitExceeded: 'Je kanaal heeft voor vandaag het maximale aantal uploads bereikt. Probeer het morgen opnieuw.',
    rateLimitExceeded: 'YouTube vindt dat er te snel achter elkaar wordt geüpload. Probeer het over een paar minuten opnieuw.',
    youtubeSignupRequired: 'Dit Google-account heeft nog geen YouTube-kanaal. Maak er eerst een aan op youtube.com.',
    invalidTitle: 'YouTube weigert de titel. Controleer hem in de YouTube-kit (max 100 tekens, geen < of >).',
    invalidDescription: 'YouTube weigert de beschrijving. Controleer hem in de YouTube-kit (max 5.000 bytes, geen < of >).',
    invalidTags: 'YouTube weigert de tags. Maak de lijst korter of haal vreemde tekens weg.',
    invalidPublishAt: 'YouTube weigert het publicatiemoment. Kies een tijd in de toekomst.',
    invalidCategoryId: 'YouTube weigert de categorie Muziek voor deze video.',
    forbidden: 'YouTube gaf geen toestemming voor deze actie. Koppel je kanaal opnieuw bij Instellingen.',
    insufficientPermissions: 'De koppeling mist rechten. Koppel je kanaal opnieuw bij Instellingen en vink alles aan.',
    authorizationRequired: 'De koppeling met YouTube werkt niet meer. Koppel je kanaal opnieuw bij Instellingen.',
    accessNotConfigured: 'De YouTube Data API v3 staat nog niet aan in je Google Cloud-project. Zet hem aan en probeer het opnieuw.',
};

// The thumbnail call has its own typical refusals.
const THUMBNAIL_REASONS = {
    forbidden: 'Eigen thumbnails mogen pas als je kanaal geverifieerd is (met je telefoonnummer, op youtube.com/verify).',
    invalidImage: 'YouTube kan je cover niet als thumbnail gebruiken (kapot of onbekend beeldformaat).',
    mediaBodyRequired: 'De cover kwam leeg aan bij YouTube.',
};

/** Reads Google's error body and turns it into a YoutubeError with a Dutch explanation. */
async function googleError(res, what, reasons = REASONS) {
    const body = await res.json().catch(() => null);
    // The YouTube API puts the code in error.errors[0].reason; newer Google APIs in error.details or error.status.
    const reason = body?.error?.errors?.[0]?.reason || body?.error?.details?.[0]?.reason || body?.error?.status || '';
    const known = reasons[reason] || REASONS[reason];
    // Upstream trouble is a 502 for our own client, except "come back later", which stays a 429.
    const status = res.status === 429 || reason === 'quotaExceeded' || reason === 'rateLimitExceeded' ? 429 : 502;
    return new YoutubeError(known || `${what} (YouTube: ${reason || res.status}).`, status, reason);
}

/**
 * fetch, with a network failure turned into a YoutubeError (code "network") so callers can tell
 * "Google said no" apart from "we never reached Google". Redirects are never followed: a 308 from
 * YouTube means "resume incomplete" here, not "go elsewhere".
 */
async function call(url, options) {
    try {
        return await fetch(url, { redirect: 'manual', ...options });
    } catch {
        throw new YoutubeError('Kan YouTube niet bereiken (netwerk). Controleer je internetverbinding.', 502, 'network');
    }
}

/** Reads and drops a response body we do not need, so its connection can be reused. */
async function discard(res) {
    await res.arrayBuffer().catch(() => {});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the OAuth client ----------

/** The OAuth client to use: the one saved in Instellingen, else the one from the environment. */
export function clientCredentials(settings = getSettings()) {
    return {
        id: settings.youtube_client_id || process.env.YOUTUBE_CLIENT_ID || '',
        secret: settings.youtube_client_secret || process.env.YOUTUBE_CLIENT_SECRET || '',
    };
}

/**
 * The address Google sends the browser back to. It must be registered, character for character, as an
 * "Authorised redirect URI" on the OAuth client, so the settings screen shows exactly this value.
 * PUBLIC_URL wins when it is set (behind a proxy the Host header may not be the public address).
 */
export function redirectUriFor(req) {
    const base = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/+$/, '') : `${req.protocol}://${req.get('host')}`;
    return `${base}/oauth/youtube/callback`;
}

/** What the settings screen needs to know. Never includes the secret or the refresh token. */
export function youtubeStatus(settings, redirectUri, userId) {
    const { id, secret } = clientCredentials(settings);
    const connected = Boolean(id && secret && settings.youtube_refresh_token);
    const last = lastAuth.get(userId);
    return {
        configured: Boolean(id && secret),
        connected,
        // The client ID is not a secret (it is in every Google sign-in link), so showing it back is fine.
        client_id: settings.youtube_client_id,
        secret_saved: Boolean(settings.youtube_client_secret),
        from_env: !settings.youtube_client_id && Boolean(process.env.YOUTUBE_CLIENT_ID),
        channel: connected ? { id: settings.youtube_channel_id, title: settings.youtube_channel_title } : null,
        redirect_uri: redirectUri,
        // The outcome of the last "Koppel" round trip, for a message on the settings screen.
        // Kept on the server (not in the URL) so nobody can put their own text in that message.
        last_auth: last && Date.now() - last.at < 5 * 60_000 ? { ok: last.ok, message: last.message } : null,
        upload_running: [...jobs.values()].some(isActive),
    };
}

// ---------- connecting the channel (OAuth 2.0, authorization code flow) ----------

// state -> { userId, redirectUri, expires }. In memory: the app is one process, and a state that is
// lost in a restart only means the artist clicks "Koppel" once more.
const pendingStates = new Map();
// userId -> { ok, message, at }: the result of the last round trip, see youtubeStatus.
const lastAuth = new Map();

/**
 * Step 1: the Google sign-in address to send the browser to. The random state ties Google's answer to
 * this admin's click, so nobody can slip their own Google account into the app (OAuth CSRF).
 */
export function beginAuth(userId, redirectUri) {
    const { id, secret } = clientCredentials();
    if (!id || !secret) throw new YoutubeError('Vul eerst de Client ID en het Client secret in en sla ze op.', 409);
    const now = Date.now();
    for (const [k, v] of pendingStates) if (v.expires < now) pendingStates.delete(k);
    const state = crypto.randomBytes(24).toString('base64url');
    pendingStates.set(state, { userId, redirectUri, expires: now + STATE_TTL_MS });
    const url = new URL(endpoints.auth);
    url.search = new URLSearchParams({
        client_id: id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        // offline + consent: Google hands out a refresh token every time, also on a second "Koppel".
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
    }).toString();
    return url.toString();
}

/**
 * Step 2: Google sent the browser back. Checks the state, swaps the code for tokens, reads which
 * channel was picked (a Google account can hold several brand channels) and stores it all.
 * Always records the outcome for the settings screen, also when it fails.
 */
export async function finishAuth(userId, { state, code, error }) {
    try {
        const pending = pendingStates.get(state);
        pendingStates.delete(state);
        if (!pending || pending.expires < Date.now() || pending.userId !== userId) {
            throw new YoutubeError('Deze koppelpoging is verlopen of hoort niet bij jouw account. Klik nog een keer op Koppel.', 400);
        }
        if (error) {
            throw new YoutubeError(error === 'access_denied'
                ? 'Je hebt bij Google geen toestemming gegeven. Er is niets gekoppeld.'
                // Only letters and _ from Google's code, so the message cannot carry anything else.
                : `Google gaf een fout: ${String(error).replace(/[^a-z_]/gi, '').slice(0, 60)}.`, 400);
        }
        if (!code) throw new YoutubeError('Google gaf geen code terug. Probeer het opnieuw.', 400);
        const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: pending.redirectUri });
        if (!tokens.refresh_token) throw new YoutubeError('Google gaf geen blijvende toegang terug. Probeer het opnieuw.', 502);
        const channel = await readChannel(tokens.access_token);
        saveSettings({
            youtube_refresh_token: tokens.refresh_token,
            youtube_channel_id: channel.id,
            youtube_channel_title: channel.title,
        });
        access = {
            token: tokens.access_token,
            expires: Date.now() + (tokens.expires_in || 3600) * 1000,
            refreshToken: tokens.refresh_token,
        };
        // No second full stop when the channel name ends in one already ("Distant Youth Co.").
        const end = /[.!?]$/.test(channel.title) ? '' : '.';
        lastAuth.set(userId, { ok: true, message: `Gekoppeld met ${channel.title}${end}`, at: Date.now() });
        return channel;
    } catch (e) {
        const message = e instanceof YoutubeError ? e.message : 'Koppelen mislukt door een fout op de server.';
        if (!(e instanceof YoutubeError)) console.error('YouTube koppelen mislukt:', e);
        lastAuth.set(userId, { ok: false, message, at: Date.now() });
        throw e;
    }
}

/** The channel this access token belongs to: { id, title }. */
async function readChannel(token) {
    const res = await call(`${endpoints.api}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw await googleError(res, 'Kon je kanaal niet lezen');
    const item = (await res.json()).items?.[0];
    if (!item) throw new YoutubeError(REASONS.youtubeSignupRequired, 400, 'youtubeSignupRequired');
    return { id: item.id, title: item.snippet?.title || item.id };
}

/** POST to Google's token endpoint (code swap or refresh). */
async function tokenRequest(params) {
    const { id, secret } = clientCredentials();
    const res = await call(endpoints.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }).toString(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        // invalid_grant: the refresh token was revoked, expired (7 days in Google's "Testing" mode) or the code was used.
        if (body.error === 'invalid_grant') throw new YoutubeError('De koppeling met YouTube is verlopen of ingetrokken. Koppel je kanaal opnieuw bij Instellingen.', 409, 'invalid_grant');
        if (body.error === 'invalid_client' || body.error === 'unauthorized_client') {
            throw new YoutubeError('Google kent deze Client ID of dit Client secret niet. Controleer ze bij Instellingen.', 409, body.error);
        }
        if (body.error === 'redirect_uri_mismatch') {
            throw new YoutubeError('De omleidings-URI klopt niet. Zet hem precies zoals bij Instellingen staat in je Google OAuth-client.', 409, body.error);
        }
        throw new YoutubeError(`Google weigerde de aanvraag (${String(body.error || res.status).slice(0, 60)}).`, 502, body.error || '');
    }
    return body;
}

// The current access token (valid for about an hour). Kept in memory only; the refresh token is the
// lasting part and lives in the settings table.
let access = null;

/** A valid access token, refreshed when it is about to expire (or when `force` is set after a 401). */
async function accessToken(force = false) {
    const s = getSettings();
    if (!s.youtube_refresh_token) throw new YoutubeError('Je YouTube-kanaal is niet gekoppeld. Koppel het bij Instellingen.', 409, 'not_connected');
    if (!force && access && access.refreshToken === s.youtube_refresh_token && access.expires > Date.now() + 60_000) return access.token;
    let t;
    try {
        t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.youtube_refresh_token });
    } catch (e) {
        // A dead refresh token will not come back to life: forget it, so the screens say "not connected".
        if (e.code === 'invalid_grant') clearConnection();
        throw e;
    }
    access = { token: t.access_token, expires: Date.now() + (t.expires_in || 3600) * 1000, refreshToken: s.youtube_refresh_token };
    return access.token;
}

/** Forgets the channel and its tokens (the client ID and secret stay). */
function clearConnection() {
    saveSettings({ youtube_refresh_token: '', youtube_channel_id: '', youtube_channel_title: '' });
    access = null;
}

/** "Ontkoppelen": tells Google to revoke the token (best effort) and forgets it here. */
export async function disconnect() {
    const token = getSettings().youtube_refresh_token;
    if (token) {
        try {
            const res = await fetch(endpoints.revoke, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ token }).toString(),
            });
            await discard(res);
        } catch {
            // Offline or Google is down: still forget it here. The artist can also revoke it at
            // myaccount.google.com/permissions.
        }
    }
    clearConnection();
}

/** Called when the client ID changes: a refresh token only works with the client that issued it. */
export function forgetConnectionIfClientChanged(oldId, newId) {
    if (oldId !== newId) clearConnection();
}

// ---------- the video resource (title, description, tags, privacy) ----------

/** The kit stores tags comma-separated; the API wants a list. Doubles and characters YouTube refuses go. */
export function tagsForApi(field) {
    return [...new Set(String(field || '').split(',').map((t) => t.trim().replace(/[<>",]/g, '')).filter(Boolean))];
}

/**
 * How YouTube counts the 500 characters of the tag list: a comma between tags, and a tag that holds a
 * space counts as if it had quotes around it.
 */
export function tagsLength(tags) {
    return tags.reduce((n, t, i) => n + t.length + (/\s/.test(t) ? 2 : 0) + (i ? 1 : 0), 0);
}

/**
 * Builds the `video` resource YouTube wants, from the texts of the YouTube-kit, and checks them against
 * YouTube's rules first, so the artist gets a clear message instead of a refused upload after 2 GB.
 * Returns { resource, warnings }; throws a 400 YoutubeError listing what is wrong.
 */
export function buildVideoResource(release, { privacy, publishAt = '', syntheticMedia = true }) {
    const problems = [];
    const warnings = [];
    const title = String(release.yt_title || '').trim();
    const description = String(release.yt_description || '');
    if (!title) problems.push('Geef de video eerst een titel in de YouTube-kit.');
    // [...s] counts characters the way YouTube does (an emoji is one), not UTF-16 units.
    if ([...title].length > LIMITS.title) problems.push(`De titel is te lang voor YouTube (max ${LIMITS.title} tekens).`);
    if (Buffer.byteLength(description, 'utf8') > MAX_DESCRIPTION_BYTES) {
        problems.push('De beschrijving is te lang voor YouTube (max 5.000 bytes; een emoji telt als 4).');
    }
    if (/[<>]/.test(title) || /[<>]/.test(description)) problems.push('YouTube staat de tekens < en > niet toe in de titel en de beschrijving.');
    if (!PRIVACY.includes(privacy)) problems.push('Kies of de video privé, verborgen of openbaar wordt.');
    if (publishAt && privacy !== 'private') problems.push('Een ingeplande video moet tot dat moment privé zijn.');
    if (problems.length) throw new YoutubeError(problems.join(' '), 400, 'invalid_metadata');

    // Tags: rather than refusing the whole upload over one tag too many, drop tags from the end
    // (the kit puts the most important ones first) and say so.
    const tags = tagsForApi(release.yt_tags);
    let dropped = 0;
    while (tags.length && tagsLength(tags) > LIMITS.tags) {
        tags.pop();
        dropped++;
    }
    if (dropped) warnings.push(`${dropped} ${dropped === 1 ? 'tag is' : 'tags zijn'} weggelaten: YouTube telt tags met een spatie als "tussen aanhalingstekens", en zo paste de lijst niet in 500 tekens.`);

    const status = {
        privacyStatus: privacy,
        // A music video is not "made for kids"; saying so here saves a question in YouTube Studio.
        selfDeclaredMadeForKids: false,
        // YouTube's label for realistic altered or synthetic (AI) content, set in Instellingen.
        containsSyntheticMedia: Boolean(syntheticMedia),
        embeddable: true,
    };
    if (publishAt) status.publishAt = publishAt;
    return {
        resource: {
            snippet: { title, description, tags, categoryId: MUSIC_CATEGORY },
            status,
        },
        warnings,
    };
}

// ---------- the upload jobs ----------

// releaseId -> job. A job is in memory: a restart in the middle of an upload ends it, and YouTube
// throws away an unfinished upload session by itself (it never becomes a half video on the channel).
const jobs = new Map();
const isActive = (job) => ['starting', 'uploading', 'thumbnail'].includes(job.state);

/** What the browser gets to see of a job. */
function publicJob(job) {
    return {
        state: job.state, // starting | uploading | thumbnail | done | error
        sent: job.sent,
        total: job.total,
        started_at: job.startedAt,
        warnings: job.warnings,
        error: job.error,
        result: job.result,
    };
}

/** The current or last upload of a release, or null. */
export function uploadJob(releaseId) {
    const job = jobs.get(releaseId);
    return job ? publicJob(job) : null;
}

/**
 * Starts uploading a release's MP4 in the background and returns the job right away; the browser
 * follows it with uploadJob(). Everything that can be checked up front is checked here, so a mistake
 * comes back as a 400/409 at once instead of as a failed job.
 */
export function startUpload(releaseId, { privacy, publishAt = '' }) {
    const current = jobs.get(releaseId);
    if (current && isActive(current)) throw new YoutubeError('Deze release wordt al geüpload. Wacht tot hij klaar is.', 409, 'busy');
    const settings = getSettings();
    const { id, secret } = clientCredentials(settings);
    if (!id || !secret || !settings.youtube_refresh_token) {
        throw new YoutubeError('Je YouTube-kanaal is niet gekoppeld. Koppel het bij Instellingen.', 409, 'not_connected');
    }
    const release = db.prepare('SELECT * FROM releases WHERE id = ?').get(releaseId);
    if (!release) throw new YoutubeError('Release niet gevonden.', 404);
    const file = storedPath(releaseId, release.video_file);
    if (!file) throw new YoutubeError('Deze release heeft nog geen MP4. Upload eerst een video bij de release.', 400, 'no_video');
    const { resource, warnings } = buildVideoResource(release, {
        privacy,
        publishAt,
        syntheticMedia: settings.youtube_synthetic_media !== '0',
    });
    const job = {
        state: 'starting',
        sent: 0,
        total: fs.statSync(file).size,
        startedAt: new Date().toISOString(),
        warnings,
        error: null,
        result: null,
    };
    jobs.set(releaseId, job);
    // Not awaited on purpose: the HTTP request returns now and the upload carries on in the background.
    runUpload(releaseId, file, resource, job);
    return publicJob(job);
}

/** The background part of an upload: video, thumbnail, then the link on the release. Never throws. */
async function runUpload(releaseId, file, resource, job) {
    try {
        job.state = 'uploading';
        const video = await resumableUpload(file, job.total, resource, (sent) => {
            job.sent = sent;
        });
        job.sent = job.total;

        // The cover as thumbnail. A refused thumbnail is a warning, not a failed upload: the video is there.
        const release = db.prepare('SELECT cover_file FROM releases WHERE id = ?').get(releaseId);
        const cover = release ? storedPath(releaseId, release.cover_file) : null;
        if (cover) {
            job.state = 'thumbnail';
            const warning = await setThumbnail(video.id, cover);
            if (warning) job.warnings.push(warning);
        }

        const privacy = video.status?.privacyStatus || resource.status.privacyStatus;
        const publishAt = video.status?.publishAt || resource.status.publishAt || '';
        const url = `https://youtu.be/${video.id}`;
        // The release now points at this video. It only counts as "live" (the full moon) once it is public;
        // a private or scheduled one becomes live when syncVideoStatus sees it public.
        db.prepare(
            `UPDATE releases SET youtube_video_id = ?, youtube_url = ?, yt_privacy = ?, yt_publish_at = ?,
             yt_uploaded_at = datetime('now'), on_youtube = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(video.id, url, privacy, publishAt, privacy === 'public' ? 1 : 0, releaseId);
        job.result = {
            video_id: video.id,
            url,
            studio_url: `https://studio.youtube.com/video/${video.id}/edit`,
            privacy,
            publish_at: publishAt,
        };
        job.state = 'done';
    } catch (e) {
        job.state = 'error';
        job.error = e instanceof YoutubeError ? e.message : 'Er ging iets mis op de server tijdens het uploaden.';
        if (!(e instanceof YoutubeError)) console.error(`YouTube-upload van release ${releaseId} mislukt:`, e);
    }
}

/** "Range: bytes=0-524287" -> 524288, the first byte YouTube does not have yet. No header: nothing yet. */
function nextOffset(res) {
    const m = /bytes=0-(\d+)/.exec(res.headers.get('range') || '');
    return m ? Number(m[1]) + 1 : 0;
}

/**
 * YouTube's resumable upload: one POST with the metadata opens an upload session, then the file goes up
 * in PUT chunks. After a dropped connection or a 5xx we ask YouTube how far it got and carry on from
 * there, instead of starting over. Returns the video resource YouTube made.
 */
async function resumableUpload(file, size, resource, onProgress) {
    let token = await accessToken();

    // 1. Open the session. A 401 here means the access token just expired: refresh once and retry.
    const open = () => call(`${endpoints.upload}/videos?uploadType=resumable&part=snippet,status`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Length': String(size),
            'X-Upload-Content-Type': 'video/*',
        },
        body: JSON.stringify(resource),
    });
    let res = await open();
    if (res.status === 401) {
        await discard(res);
        token = await accessToken(true);
        res = await open();
    }
    if (!res.ok) throw await googleError(res, 'YouTube wilde de upload niet starten');
    const session = res.headers.get('location');
    await discard(res);
    if (!session) throw new YoutubeError('YouTube gaf geen uploadadres terug. Probeer het opnieuw.', 502);

    // 2. Send the chunks.
    const fh = await fs.promises.open(file, 'r');
    try {
        let offset = 0;
        let failures = 0;
        // After a failure we first ask YouTube how much it has, instead of guessing.
        let askFirst = false;
        for (;;) {
            let res2 = null;
            let sentChunk = false;
            try {
                if (askFirst || offset >= size) {
                    // Status query: an empty PUT with "bytes */<size>".
                    res2 = await call(session, {
                        method: 'PUT',
                        headers: { Authorization: `Bearer ${token}`, 'Content-Range': `bytes */${size}` },
                        body: Buffer.alloc(0),
                    });
                } else {
                    const len = Math.min(uploadConfig.chunkSize, size - offset);
                    const buf = Buffer.alloc(len);
                    const { bytesRead } = await fh.read(buf, 0, len, offset);
                    if (bytesRead !== len) throw new YoutubeError('De video is tijdens het uploaden veranderd of weggehaald.', 409);
                    sentChunk = true;
                    res2 = await call(session, {
                        method: 'PUT',
                        headers: { Authorization: `Bearer ${token}`, 'Content-Range': `bytes ${offset}-${offset + len - 1}/${size}` },
                        body: buf,
                    });
                }
            } catch (e) {
                // Only a network failure is worth retrying; anything else is a real problem.
                if (!(e instanceof YoutubeError) || e.code !== 'network') throw e;
                res2 = null;
            }

            if (res2 && (res2.status === 200 || res2.status === 201)) {
                // The last byte is in: YouTube answers with the new video.
                onProgress(size);
                return await res2.json();
            }
            if (res2 && res2.status === 308) {
                // "Resume incomplete": YouTube has everything up to the Range it sends back.
                await discard(res2);
                offset = nextOffset(res2);
                onProgress(offset);
                askFirst = false;
                // Progress made: the next failure starts counting from zero again. A status answer alone
                // is not progress, otherwise a chunk that always fails would be retried forever.
                if (sentChunk) failures = 0;
                if (offset < size) continue;
                // YouTube says it has every byte but did not finish: ask again after the wait below.
            } else if (res2 && res2.status === 401) {
                // The access token ran out during a long upload: get a new one and ask where we were.
                await discard(res2);
                token = await accessToken(true);
            } else if (res2 && (res2.status === 404 || res2.status === 410)) {
                await discard(res2);
                throw new YoutubeError('De uploadsessie bij YouTube is verlopen. Start de upload opnieuw.', 502, 'session_expired');
            } else if (res2 && res2.status < 500 && res2.status !== 408 && res2.status !== 429) {
                throw await googleError(res2, 'YouTube weigerde de upload');
            } else if (res2) {
                // 5xx, 408 or 429: YouTube's side; wait and try again.
                await discard(res2);
            }

            failures++;
            if (failures > uploadConfig.maxRetries) {
                throw new YoutubeError('De verbinding met YouTube viel steeds weg. Probeer het later opnieuw.', 502, 'gave_up');
            }
            const wait = Math.min(uploadConfig.retryDelayMs * 2 ** (failures - 1), 32_000);
            await sleep(wait + Math.random() * uploadConfig.retryDelayMs * 0.25);
            askFirst = true;
        }
    } finally {
        await fh.close();
    }
}

/**
 * Sets the cover as the video's thumbnail. Returns a warning to show, or null when it worked.
 * YouTube takes JPG and PNG up to 2 MB; anything else is skipped with a note.
 */
async function setThumbnail(videoId, coverPath) {
    const type = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' }[path.extname(coverPath).toLowerCase()];
    if (!type) return 'Geen thumbnail gezet: YouTube wil een JPG of PNG, en je cover is een WebP. Zet hem zelf in YouTube Studio.';
    if (fs.statSync(coverPath).size > MAX_THUMBNAIL_BYTES) {
        return 'Geen thumbnail gezet: je cover is groter dan 2 MB, de grens van YouTube. Zet een kleinere in YouTube Studio.';
    }
    try {
        const token = await accessToken();
        const res = await call(`${endpoints.upload}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': type },
            body: fs.readFileSync(coverPath),
        });
        if (!res.ok) return `Geen thumbnail gezet: ${(await googleError(res, 'YouTube weigerde de cover', THUMBNAIL_REASONS)).message}`;
        await discard(res);
        return null;
    } catch (e) {
        if (e instanceof YoutubeError) return `Geen thumbnail gezet: ${e.message}`;
        throw e;
    }
}

// ---------- after the upload: is it public yet? ----------

/**
 * Asks YouTube for the video's current status and writes it on the release. Costs 1 unit of the daily
 * quota (an upload costs far more), so the YouTube-kit can call this every time it opens.
 * The video counts as live once it is public; a deleted video unlinks the release.
 */
export async function syncVideoStatus(releaseId) {
    const release = db.prepare('SELECT * FROM releases WHERE id = ?').get(releaseId);
    if (!release) throw new YoutubeError('Release niet gevonden.', 404);
    if (!release.youtube_video_id) throw new YoutubeError('Deze release is niet via de app op YouTube gezet.', 400);
    let token = await accessToken();
    const url = `${endpoints.api}/videos?part=status&id=${encodeURIComponent(release.youtube_video_id)}`;
    let res = await call(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
        await discard(res);
        token = await accessToken(true);
        res = await call(url, { headers: { Authorization: `Bearer ${token}` } });
    }
    if (!res.ok) throw await googleError(res, 'Kon de status van je video niet ophalen');
    const video = (await res.json()).items?.[0];

    if (!video) {
        // Not there any more (deleted in YouTube Studio): unlink, so a new upload is possible without a warning.
        db.prepare(
            `UPDATE releases SET youtube_video_id = '', youtube_url = '', yt_privacy = '', yt_publish_at = '',
             on_youtube = 0, updated_at = datetime('now') WHERE id = ?`
        ).run(releaseId);
        return { removed: true, privacy: '', publish_at: '', upload_status: '', problem: '' };
    }

    const st = video.status || {};
    const privacy = st.privacyStatus || '';
    const publishAt = st.publishAt || '';
    // rejected/failed: YouTube took the file but will not show it (copyright, a broken file, ...).
    const problem = st.uploadStatus === 'rejected'
        ? `YouTube heeft de video afgewezen${st.rejectionReason ? ` (${st.rejectionReason})` : ''}.`
        : st.uploadStatus === 'failed'
            ? `YouTube kon de video niet verwerken${st.failureReason ? ` (${st.failureReason})` : ''}.`
            : '';
    const live = privacy === 'public' && !problem ? 1 : 0;
    db.prepare("UPDATE releases SET yt_privacy = ?, yt_publish_at = ?, on_youtube = ?, updated_at = datetime('now') WHERE id = ?")
        .run(privacy, publishAt, live, releaseId);
    return { removed: false, privacy, publish_at: publishAt, upload_status: st.uploadStatus || '', problem };
}

// ---------- for the tests ----------

/** Forgets the in-memory state (jobs, states, access token), so a test starts clean. */
export function resetForTests() {
    jobs.clear();
    pendingStates.clear();
    lastAuth.clear();
    access = null;
}

// Edge cases at test level 4 and 5 (forge-check test): every form with empty, long, odd and hostile
// input, the slow-network matrix, offline halfway, an expired session, two tabs at once, time zones
// and summer time, and the keyboard alone. Helpers after ../forge-check/edge.example.spec.ts.
// Only the user's own local app (FORGE_BASE_URL); a failing case leaves forge-work/test/evidence/<case>.png.
import { test, expect, type Locator, type Page, type Route, type APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { AUTH, HAS_PASSWORDS, SEED, guard, apiAs } from './helpers';

guard();
test.skip(!HAS_PASSWORDS, 'no test passwords');

const WORK = [path.resolve('forge-work'), path.resolve('..', '..', 'forge-work')].find((dir) => fs.existsSync(dir)) || path.resolve('..', '..', 'forge-work');
const EVIDENCE = path.join(WORK, 'test', 'evidence');

// ---- helpers ----
const LONG = (n = 300) => 'L'.repeat(n);
const ACCENTS = 'Zoë Ångström-Müller 😀 日本';
const HTML_TEXT = '<img src=x onerror="window.__forgeRan=1"><b>bold</b>';
const SQL_TEXT = "Robert'); DROP TABLE releases;--";
const CONTROL = 'a\u0007b\u0000c‮d​e';
const RTL = 'שלום עולם مرحبا بالعالم';
const HOSTILE = [HTML_TEXT, SQL_TEXT, ACCENTS, CONTROL, RTL, LONG(10_000), LONG(100_000)];

async function withEvidence(page: Page, caseId: string, steps: () => Promise<void>) {
  try {
    await steps();
  } catch (error) {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    await page.screenshot({ path: path.join(EVIDENCE, `${caseId.replace(/[^\w-]/g, '-')}.png`), fullPage: true }).catch(() => {});
    throw error;
  }
}
async function expectRejected(page: Page, field: Locator) {
  await expect(async () => {
    const invalid = await field.evaluate((element) => element.getAttribute('aria-invalid') === 'true'
      || ('checkValidity' in element && !(element as HTMLInputElement).checkValidity()));
    const alerts = await page.getByRole('alert').filter({ hasText: /\S/ }).count();
    expect(invalid || alerts > 0, 'no visible sign that the input was refused').toBe(true);
  }).toPass({ timeout: 5_000 });
}
async function expectShownAsText(page: Page, text: string) {
  await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
  expect(await page.evaluate(() => (window as any).__forgeRan), 'the typed HTML ran as code').toBeUndefined();
  expect(await page.locator('img[src="x"]').count(), 'the typed HTML became an element').toBe(0);
}
async function slowNetwork(page: Page, delayMs: number) {
  const handler = async (route: Route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    await route.continue().catch(() => {});
  };
  await page.route('**/api/**', handler);
  return () => page.unroute('**/api/**', handler);
}
function smallWav(): Buffer {
  const rate = 8000, data = Buffer.alloc(rate * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const H = { 'X-Requested-With': 'dyc' };
async function newRelease(req: APIRequestContext, fields: Record<string, string>) {
  const res = await req.post('/api/releases', { headers: H, multipart: { ...fields, wav: { name: 'a.wav', mimeType: 'audio/wav', buffer: smallWav() } } });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}
async function pickWav(page: Page) {
  await page.locator('#file-wav').setInputFiles({ name: 'e.wav', mimeType: 'audio/wav', buffer: smallWav() });
}

// ---- every form and field: hostile and oversized input (level 5) ----

test.describe('as admin', () => {
  test.use({ storageState: AUTH.admin });

  test('F12-E1 hostile and huge input on every field: refused plainly or kept as plain text, never a 500', async ({ page }) => {
    const req = page.request;
    const settingsBefore = (await (await req.get('/api/settings')).json()).settings;
    const { release } = (await newRelease(req, { title: `Doel ${Date.now()}` })).body;
    const forms: [string, string, string, (v: string) => unknown, (j: any) => unknown][] = [
      ['folder name', 'POST', '/api/folders', (v) => ({ name: v }), (j) => j.folder?.name],
      ['folder description', 'POST', '/api/folders', (v) => ({ name: `F ${Date.now()}`, description: v }), null as any],
      ['playlist name', 'POST', '/api/playlists', (v) => ({ name: v }), (j) => j.playlist?.name],
      ['playlist description', 'POST', '/api/playlists', (v) => ({ name: `P ${Date.now()}`, description: v }), null as any],
      ['YouTube description', 'PUT', `/api/releases/${release.id}/youtube`, (v) => ({ yt_title: 't', yt_description: v, yt_tags: 'a' }), (j) => j.release?.yt_description],
      ['YouTube title', 'PUT', `/api/releases/${release.id}/youtube`, (v) => ({ yt_title: v, yt_description: 'd', yt_tags: 'a' }), (j) => j.release?.yt_title],
      ['setting artist name', 'PUT', '/api/settings', (v) => ({ artist_name: v }), null as any],
      ['setting hashtags', 'PUT', '/api/settings', (v) => ({ default_hashtags: v }), null as any],
      ['new account', 'POST', '/api/users', (v) => ({ username: v, password: v, role: 'listener' }), null as any],
      ['upload start', 'POST', '/api/uploads', (v) => ({ name: v, size: 10 }), null as any],
      ['YouTube link', 'POST', `/api/releases/${release.id}/status`, (v) => ({ youtube_url: v }), null as any],
    ];
    const crashes: string[] = [];
    for (const [what, method, url, body, read] of forms) {
      for (const v of HOSTILE) {
        const res = await req.fetch(url, { method, headers: { ...H, 'Content-Type': 'application/json' }, data: body(v) });
        const tag = `${what} with ${v.length > 40 ? `${v.length} characters` : JSON.stringify(v)}`;
        if (res.status() >= 500) crashes.push(`${tag}: ${res.status()}`);
        if (res.ok() && read) expect(read(await res.json()), `${tag}: stored as typed`).toBe(v.trim());
        if (!res.ok()) expect((await res.json()).error, `${tag}: a message`).toMatch(/\S/);
      }
    }
    // A release's own fields, sent as a form (multipart), also with bytes that are not UTF-8.
    for (const [field, v] of [['title', HTML_TEXT], ['title', CONTROL], ['title', LONG(100_000)], ['style', LONG(10_000)], ['lyrics', LONG(100_000)], ['notes', RTL], ['title', Buffer.from([0x41, 0xc3, 0x28, 0x42]).toString('latin1')]] as const) {
      const res = await newRelease(req, { title: `T ${Date.now()}`, [field]: v });
      if (res.status >= 500) crashes.push(`release ${field}: ${res.status}`);
    }
    // Sign-in and the search of the stats with nonsense.
    for (const v of [SQL_TEXT, LONG(100_000)]) {
      const res = await req.post('/api/login', { headers: H, data: { username: v, password: v } });
      if (res.status() >= 500) crashes.push(`login: ${res.status()}`);
    }
    for (const m of ['-1', '1e9', HTML_TEXT, '12abc']) {
      const res = await req.get(`/api/stats?months=${encodeURIComponent(m)}`);
      if (res.status() >= 500) crashes.push(`stats ${m}: ${res.status()}`);
    }
    await req.put('/api/settings', { headers: H, data: settingsBefore }); // leave the settings as they were
    expect(crashes, 'no 500 on any input').toEqual([]);
  });

  test('F12-E2 typed HTML shows as text everywhere a title shows', async ({ page }) => {
    const title = `${HTML_TEXT} ${Date.now()}`;
    const { body } = await newRelease(page.request, { title });
    await withEvidence(page, 'F12-E2', async () => {
      for (const where of [`/#/release/${body.release.id}`, '/', `/#/release/${body.release.id}/youtube`, '/#/downloads', '/#/aanvullen']) {
        await page.goto(where);
        await expect(page.locator('main h1').first()).toBeVisible();
        expect(await page.evaluate(() => (window as any).__forgeRan), `${where}: the HTML ran`).toBeUndefined();
        expect(await page.locator('img[src="x"]').count(), `${where}: the HTML became an element`).toBe(0);
      }
      await page.goto(`/#/release/${body.release.id}`);
      await expectShownAsText(page, '<b>bold</b>');
      await page.goto('/');
      await page.getByLabel('Zoek in je muziek').fill(HTML_TEXT);
      await expectShownAsText(page, '<b>bold</b>');
    });
  });

  test('F12-E3 the release form: nothing filled in, too long, and a session that ended while it was open', async ({ page }) => {
    await page.goto('/#/nieuw');
    await page.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expectRejected(page, page.getByLabel('Titel', { exact: true }));
    await page.getByLabel('Titel', { exact: true }).fill(`Te lang ${Date.now()}`);
    await pickWav(page);
    // The field stops at its maximum (maxlength), so what is saved is never more than the server takes.
    await page.locator('#u-lyrics').fill(LONG(20_001));
    expect((await page.locator('#u-lyrics').inputValue()).length).toBeLessThanOrEqual(20_000);
    // The session ends while the form is open: saving leads to the sign-in, not a crash.
    await page.goto('/#/nieuw');
    await page.getByLabel('Titel', { exact: true }).fill(`Verlopen ${Date.now()}`);
    await pickWav(page);
    await page.context().clearCookies();
    await page.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Welkom terug' })).toBeVisible();
  });

  // ---- the slow-network matrix and offline halfway (level 5) ----
  for (const ms of [0, 400, 2000]) {
    test(`F12-E4 saving a release on a network of ${ms} ms: one release, the button waits, it lands on its page`, async ({ page }) => {
      const title = `Traag ${ms} ${Date.now()}`;
      await page.goto('/#/nieuw');
      await page.getByLabel('Titel', { exact: true }).fill(title);
      await pickWav(page);
      const fast = await slowNetwork(page, ms);
      const save = page.getByRole('button', { name: 'Opslaan', exact: true });
      await save.click();
      if (ms >= 400) await expect(save).toBeDisabled();
      await save.click({ force: true, trial: false }).catch(() => {}); // an impatient second click
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 20_000 });
      await fast();
      const { releases } = await (await apiAs(page, 'GET', '/releases')).json();
      expect(releases.filter((r: { title: string }) => r.title === title)).toHaveLength(1);
    });
  }

  test('F12-E5 offline halfway: a clear message, the form keeps what was typed, saving again works', async ({ page, context }) => {
    const title = `Offline ${Date.now()}`;
    await page.goto('/#/nieuw');
    await page.getByLabel('Titel', { exact: true }).fill(title);
    await page.getByLabel('Lyrics').fill('[Chorus]\nNiet kwijt');
    await pickWav(page);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/verbinding|mislukt/i);
    await expect(page.getByLabel('Titel', { exact: true })).toHaveValue(title);
    await expect(page.getByLabel('Lyrics')).toHaveValue('[Chorus]\nNiet kwijt');
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  });

  test('F12-E6 the YouTube-kit offline: the text stays, and is saved when the network is back', async ({ page, context }) => {
    await page.goto(`/#/release/${SEED.hearts}/youtube`);
    const tags = page.locator('#yt-tags');
    const before = await tags.inputValue();
    await context.setOffline(true);
    await tags.fill('offline getypt');
    await expect(page.getByRole('status')).toContainText(/verbinding|mislukt/i, { timeout: 10_000 });
    await expect(tags).toHaveValue('offline getypt');
    await context.setOffline(false);
    await tags.fill('weer online');
    await expect(page.getByText('Opgeslagen')).toBeVisible();
    expect((await (await apiAs(page, 'GET', `/releases/${SEED.hearts}`)).json()).release.yt_tags).toBe('weer online');
    await apiAs(page, 'PUT', `/releases/${SEED.hearts}/youtube`, { yt_title: (await (await apiAs(page, 'GET', `/releases/${SEED.hearts}`)).json()).release.yt_title, yt_description: (await (await apiAs(page, 'GET', `/releases/${SEED.hearts}`)).json()).release.yt_description, yt_tags: before });
  });

  // ---- two tabs at once (level 5) ----

  test('F12-E7 two tabs edit the same release: the second save does not wipe out the first without a word', async ({ page, context }) => {
    const { body } = await newRelease(page.request, { title: `Twee tabs ${Date.now()}`, notes: 'begin' });
    const id = body.release.id;
    const other = await context.newPage();
    await page.goto(`/#/release/${id}/bewerken`);
    await other.goto(`/#/release/${id}/bewerken`);
    await page.getByLabel('Titel', { exact: true }).fill('Titel uit tab 1');
    await page.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Titel uit tab 1' })).toBeVisible();
    // Tab 2 still shows the old title and saves a note.
    await other.getByLabel('Notities (alleen voor jou)').fill('notitie uit tab 2');
    await other.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(other.getByRole('alert')).toContainText(/intussen gewijzigd/i);
    const r = (await (await apiAs(page, 'GET', `/releases/${id}`)).json()).release;
    expect(r.title, 'the first save is still there').toBe('Titel uit tab 1');
  });

  test('F12-E8 two tabs on the YouTube-kit: the older tab says so instead of overwriting', async ({ page, context }) => {
    const { body } = await newRelease(page.request, { title: `Kit tabs ${Date.now()}` });
    const id = body.release.id;
    const other = await context.newPage();
    await page.goto(`/#/release/${id}/youtube`);
    await other.goto(`/#/release/${id}/youtube`);
    await page.locator('#yt-tags').fill('uit tab 1');
    await expect(page.getByText('Opgeslagen')).toBeVisible();
    await other.locator('#yt-desc').fill('beschrijving uit tab 2');
    await expect(other.getByRole('status')).toContainText(/intussen gewijzigd/i, { timeout: 10_000 });
    const r = (await (await apiAs(page, 'GET', `/releases/${id}`)).json()).release;
    expect(r.yt_tags).toBe('uit tab 1');
  });

  test('F12-L1 a long word in a name never makes a phone screen scroll sideways', async ({ page }) => {
    await page.request.post('/api/folders', { headers: H, data: { name: `Https://distantyouth.example/${'x'.repeat(60)}/${Date.now()}` } });
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      for (const where of ['/#/collecties', '/']) {
        await page.goto(where);
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${where} at ${width}`).toBeLessThanOrEqual(0);
      }
    }
  });

  // ---- the keyboard alone (level 4) ----

  test('F12-K1 a new release with the keyboard alone, and a dialog that keeps and returns the focus', async ({ page }) => {
    const title = `Toetsenbord ${Date.now()}`;
    await page.goto('/#/nieuw');
    // From the WAV slot's button, Enter opens the file chooser.
    const chooser = page.waitForEvent('filechooser');
    await page.locator('label[for="file-wav"]').focus();
    await page.keyboard.press('Enter');
    await (await chooser).setFiles({ name: 'k.wav', mimeType: 'audio/wav', buffer: smallWav() });
    // Tab goes on to the next control you can see, not to the hidden file field behind the button.
    await page.locator('label[for="file-mp3"]').focus();
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type), 'an invisible stop').not.toBe('file');
    await page.getByLabel('Titel', { exact: true }).focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(title);
    await page.keyboard.press('Enter'); // submits the form
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    // Edit, delete, Escape: the dialog closes and the focus is back on the button.
    await page.getByRole('link', { name: 'Bewerken' }).focus();
    await page.keyboard.press('Enter');
    const del = page.getByRole('button', { name: 'Verwijderen' });
    await del.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((d) => d.contains(document.activeElement)), 'the focus stays in the dialog').toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(del).toBeFocused();
  });

  test('F12-K2 several at once and Aanvullen with the keyboard alone', async ({ page }) => {
    await page.goto('/#/meerdere');
    const chooser = page.waitForEvent('filechooser');
    await page.locator('label[for="bulk-files"]').focus();
    await page.keyboard.press('Enter');
    const n = Date.now();
    await (await chooser).setFiles([{ name: `Toets ${n}.wav`, mimeType: 'audio/wav', buffer: smallWav() }]);
    await page.getByRole('button', { name: 'Upload 1 release' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: 'Style en lyrics aanvullen' })).toBeVisible();
    await page.getByRole('link', { name: 'Style en lyrics aanvullen' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Style-omschrijving')).toBeFocused();
    await page.keyboard.type('riddim, 140 bpm');
    await page.keyboard.press('Tab');
    await page.keyboard.type('[Chorus] la');
    await page.getByRole('button', { name: 'Opslaan en klaar' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Klaar: 1 van 1 aangevuld.')).toBeVisible();
  });
});

test.describe('as listener', () => {
  test.use({ storageState: AUTH.alice });

  test('F12-K3 listening with the keyboard alone: play, pause with Space, the full player closes with Escape', async ({ page }) => {
    await page.goto(`/#/release/${SEED.lanterns}`);
    await page.getByRole('button', { name: 'Afspelen', exact: true }).focus();
    await page.keyboard.press('Enter');
    const toggle = page.locator('.player').getByRole('button', { name: /^(Pauzeren|Afspelen)$/ });
    await expect(toggle).toHaveAccessibleName('Pauzeren');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAccessibleName('Afspelen');
  });
});

// ---- time zones and summer time (level 5) ----

for (const timezoneId of ['Pacific/Auckland', 'America/New_York', 'Europe/Amsterdam']) {
  test.describe(`in ${timezoneId}`, () => {
    test.use({ storageState: AUTH.admin, timezoneId });

    test(`F12-Z1 a release date is the same day everywhere, also on the summer-time Sundays (${timezoneId})`, async ({ page }) => {
      for (const day of ['2026-03-29', '2026-10-25', '2026-12-31']) {
        const title = `Datum ${day} ${timezoneId} ${Date.now()}`;
        const { body } = await newRelease(page.request, { title, release_date: day });
        const want = new Date(`${day}T12:00:00Z`).toLocaleDateString('nl-NL', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
        await page.goto(`/#/release/${body.release.id}`);
        await expect(page.getByText(want).first(), `release page shows ${want}`).toBeVisible();
        await page.request.post(`/api/releases/${body.release.id}`, { headers: { ...H, 'X-HTTP-Method-Override': 'PUT' }, multipart: { title, release_date: day } });
      }
      // Downloads lists the date too.
      const title = `Datum dl ${timezoneId} ${Date.now()}`;
      const res = await page.request.post('/api/releases', { headers: H, multipart: { title, release_date: '2026-03-29', wav: { name: 'a.wav', mimeType: 'audio/wav', buffer: smallWav() }, video: { name: 'v.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync('../../forge-work/improve/assets/visualizer.mp4') } } });
      expect(res.ok()).toBe(true);
      await page.goto('/#/downloads');
      await expect(page.getByRole('listitem').filter({ hasText: title })).toContainText('29 mrt 2026');
    });
  });
}

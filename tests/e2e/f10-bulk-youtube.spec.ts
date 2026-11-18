import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { AUTH, HAS_PASSWORDS, ASSETS, guard, expectAccessible, apiAs } from './helpers';

guard();
test.skip(!HAS_PASSWORDS, 'no test passwords');

const file = (name: string, from: string) => ({ name, mimeType: 'application/octet-stream', buffer: fs.readFileSync(`${ASSETS}/${from}`) });

test.describe('as admin', () => {
  test.use({ storageState: AUTH.admin });

  test('F10-H1 several releases at once: files go with the WAV of the same name', async ({ page }) => {
    const n = Date.now();
    await page.goto('/#/meerdere');
    await expectAccessible(page);
    await page.locator('#bulk-files').setInputFiles([
      file(`Moon Bulk ${n} A.wav`, 'demo.wav'),
      file(`Moon_Bulk_${n}_B.wav`, 'demo.wav'),
      file(`Moon Bulk ${n} A.mp4`, 'visualizer.mp4'),
      file(`Moon Bulk ${n} B - cover.jpg`, 'cover-lanterns.jpg'),
      file(`Lost ${n}.mp4`, 'visualizer.mp4'),
    ]);
    const rows = page.locator('.bulk-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).getByRole('textbox').first()).toHaveValue(`Moon Bulk ${n} A`);
    await expect(rows.nth(0)).toContainText('MP4');
    await expect(rows.nth(1).getByRole('textbox').first()).toHaveValue(`Moon Bulk ${n} B`);
    await expect(rows.nth(1)).toContainText('Cover');
    await expect(page.getByText(`Geen WAV gevonden voor: Lost ${n}.mp4`)).toBeVisible();
    // B has no MP4: its video is on YouTube.
    await rows.nth(1).getByLabel('Geen MP4? YouTube-link (optioneel)').fill('https://youtu.be/dQw4w9WgXcQ');
    await page.getByRole('button', { name: 'Upload 2 releases' }).click();
    await expect(page.getByRole('link', { name: 'Klaar: naar de release' })).toHaveCount(2, { timeout: 60_000 });
    const { releases } = await (await apiAs(page, 'GET', '/releases')).json();
    const a = releases.find((r: { title: string }) => r.title === `Moon Bulk ${n} A`);
    const b = releases.find((r: { title: string }) => r.title === `Moon Bulk ${n} B`);
    expect(a.has).toMatchObject({ wav: true, video: true });
    expect(b.has).toMatchObject({ wav: true, video: false, cover: true });
    expect(b.youtube_id).toBe('dQw4w9WgXcQ');
  });

  test('F10-H3 the form fills itself: title from the WAV, every file to its slot, a warning for a double, the YouTube text made', async ({ page }) => {
    const n = Date.now();
    await page.goto('/#/nieuw');
    await page.locator('#file-wav').setInputFiles([file(`Self_Filled_${n}.wav`, 'demo.wav'), file(`Self Filled ${n}.mp4`, 'visualizer.mp4'), file('art.jpg', 'cover-lanterns.jpg')]);
    await expect(page.getByLabel('Titel', { exact: true })).toHaveValue(`Self Filled ${n}`);
    await expect(page.locator('#file-video-text')).toContainText(`Self Filled ${n}.mp4`);
    await expect(page.locator('#file-cover-text')).toContainText('art.jpg');
    await page.getByLabel('Titel', { exact: true }).fill('Lanterns in the Rain');
    await expect(page.locator('#u-title-dup')).toContainText('Er is al een release met deze titel');
    await page.getByLabel('Titel', { exact: true }).fill(`Self Filled ${n}`);
    await expect(page.locator('#u-title-dup')).toBeEmpty();
    await expect(page.getByRole('button', { name: /YouTube-kit maken/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: `Self Filled ${n}` })).toBeVisible();
    const id = page.url().match(/release\/(\d+)/)![1];
    const r = (await (await apiAs(page, 'GET', `/releases/${id}`)).json()).release;
    expect(r.yt_title).toBe(`Self Filled ${n} — Distant Youth Co. (Official Visualizer)`);
    expect(r.has).toMatchObject({ wav: true, video: true, cover: true });

    // The kit keeps what you change by itself.
    await page.goto(`/#/release/${id}/youtube`);
    await expect(page.getByRole('button', { name: 'Tekst opslaan' })).toHaveCount(0);
    await page.locator('#yt-tags').fill('zelf, getypt');
    await expect(page.getByText('Opgeslagen')).toBeVisible();
    expect((await (await apiAs(page, 'GET', `/releases/${id}`)).json()).release.yt_tags).toBe('zelf, getypt');
  });

  test('F10-E1 several at once: a release that is already there is skipped unless you say so', async ({ page }) => {
    await page.goto('/#/meerdere');
    await page.locator('#bulk-files').setInputFiles([file('Lanterns in the Rain.wav', 'demo.wav'), file(`Fresh ${Date.now()}.wav`, 'demo.wav')]);
    await expect(page.getByText('Bestaat al: wordt overgeslagen.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload 1 release' })).toBeVisible();
    await page.getByRole('button', { name: 'Toch uploaden' }).click();
    await expect(page.getByRole('button', { name: 'Upload 2 releases' })).toBeVisible();
    await page.getByRole('button', { name: 'Overslaan' }).click();
    await expect(page.getByRole('button', { name: 'Upload 1 release' })).toBeVisible();
  });

  test('F10-N1 a link that is not a YouTube video is refused on the release form', async ({ page }) => {
    await page.goto('/#/nieuw');
    await page.getByLabel('Titel', { exact: true }).fill(`YT ${Date.now()}`);
    await page.locator('#file-wav').setInputFiles(`${ASSETS}/demo.wav`);
    await page.getByLabel('Of een YouTube-link in plaats van de MP4').fill('https://example.com/mijn-video');
    await page.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('geen link naar een YouTube-video');
  });
});

test.describe('as listener', () => {
  test.use({ storageState: AUTH.alice });

  test('F10-H2 a release with only a YouTube link plays its video from YouTube, after you press play', async ({ page, browser }) => {
    const admin = await browser.newContext({ storageState: AUTH.admin });
    const ap = await admin.newPage();
    await ap.goto('/#/nieuw');
    const title = `Op YouTube ${Date.now()}`;
    await ap.getByLabel('Titel', { exact: true }).fill(title);
    await ap.locator('#file-wav').setInputFiles(`${ASSETS}/demo.wav`);
    await ap.getByLabel('Of een YouTube-link in plaats van de MP4').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await ap.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(ap.getByRole('heading', { level: 1, name: title })).toBeVisible();
    const id = ap.url().match(/release\/(\d+)/)![1];
    await admin.close();

    // YouTube itself is not contacted until play; the test stops it at the door.
    const asked: string[] = [];
    await page.route('https://www.youtube-nocookie.com/**', (route) => { asked.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>yt</title>' }); });
    await page.goto(`/#/release/${id}`);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expectAccessible(page);
    const play = page.getByRole('button', { name: `Speelt af via YouTube: ${title}` });
    await expect(play).toBeVisible();
    await expect(page.getByText('Pas als je op afspelen drukt, ziet YouTube je IP-adres.')).toBeVisible(); // X004
    expect(asked).toEqual([]);
    await play.click();
    const frame = page.locator('iframe.yt-frame');
    await expect(frame).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
    await expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    await expect.poll(() => asked.length).toBeGreaterThan(0);
  });
});

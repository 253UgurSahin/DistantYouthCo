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
    expect(asked).toEqual([]);
    await play.click();
    const frame = page.locator('iframe.yt-frame');
    await expect(frame).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
    await expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    await expect.poll(() => asked.length).toBeGreaterThan(0);
  });
});

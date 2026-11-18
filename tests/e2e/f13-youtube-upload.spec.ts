import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { AUTH, HAS_PASSWORDS, SEED, ASSETS, guard, expectAccessible, apiAs } from './helpers';

// Direct upload to YouTube, against tests/e2e/fake-google.php (the test instance's .env points the
// Google addresses there; see forge-work/test-plan.md). Without it these tests are skipped.
const FAKE = process.env.FAKE_GOOGLE === '1';

guard();
test.skip(!HAS_PASSWORDS || !FAKE, 'needs FAKE_GOOGLE=1 and the stand-in Google');
test.describe.configure({ mode: 'serial' });
test.use({ storageState: AUTH.admin });

test('F13-H1 connect the channel in Instellingen, upload a release from the kit, refresh its status, disconnect', async ({ page }) => {
  await page.goto('/');
  await apiAs(page, 'DELETE', '/youtube/connection'); // a run cut short may have left it connected
  await page.goto('/#/instellingen');
  const panel = page.getByRole('region', { name: 'YouTube-kanaal' });
  await expect(panel).toContainText('Nog niet gekoppeld');
  await expect(panel.locator('.redirect-uri')).toHaveText(/\/oauth\/youtube\/callback$/);
  await expectAccessible(page);
  await page.getByLabel('Client ID').fill('fake-client.apps.googleusercontent.com');
  const clientSecret = `stand-in-${Date.now().toString(36)}`; // made up per run
  await page.getByLabel('Client secret').fill(clientSecret);
  await page.getByRole('button', { name: 'Koppel YouTube-kanaal' }).click();
  // Google's consent (the stand-in says yes at once) sends us back.
  await expect(page.locator('#toasts')).toContainText('YouTube-kanaal gekoppeld: Fake Channel');
  await expect(panel).toContainText('Gekoppeld: Fake Channel');
  const settings = await (await apiAs(page, 'GET', '/settings')).text();
  expect(settings).not.toContain(clientSecret);
  expect(settings).not.toContain('stand-in-'); // the tokens of the stand-in Google stay on the server

  // The kit of a new release with an MP4 (its first upload).
  const made = await page.request.post('/api/releases', { headers: { 'X-Requested-With': 'dyc' }, multipart: {
    title: `Naar YouTube ${Date.now()}`, style: 'melodic dubstep, 140 bpm',
    wav: { name: 'a.wav', mimeType: 'audio/wav', buffer: fs.readFileSync(`${ASSETS}/lanterns.wav`).subarray(0, 200_000) },
    video: { name: 'v.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(`${ASSETS}/visualizer.mp4`) },
  } });
  const rid = (await made.json()).release.id;
  await page.goto(`/#/release/${rid}/youtube`);
  const direct = page.getByRole('region', { name: 'Direct naar YouTube' });
  await expect(direct).toContainText('Naar Fake Channel');
  await expectAccessible(page);
  await direct.getByLabel('Zichtbaarheid').selectOption('public');
  await direct.getByRole('button', { name: 'Upload naar YouTube' }).click();
  await expect(direct.getByRole('status')).toContainText('Geüpload naar YouTube.', { timeout: 60_000 });
  await expect(direct.getByRole('link', { name: 'Bekijk op YouTube' })).toHaveAttribute('href', /^https:\/\/youtu\.be\/FAKE/);
  const r = (await (await apiAs(page, 'GET', `/releases/${rid}`)).json()).release;
  expect([r.on_youtube, r.youtube_privacy, r.status]).toEqual([true, 'public', 'live']);
  expect(r.youtube_url).toMatch(/^https:\/\/youtu\.be\/FAKE/);
  await direct.getByRole('button', { name: 'Status vernieuwen' }).click();
  await expect(page.locator('#toasts')).toContainText('Status bijgewerkt: Openbaar');

  // Once more: it asks first.
  await direct.getByRole('button', { name: 'Nog een keer uploaden' }).click();
  await expect(page.getByRole('dialog')).toContainText('tweede video');
  await page.getByRole('dialog').getByRole('button', { name: 'Annuleren' }).click();

  // Leave the instance as it was: disconnected.
  await page.goto('/#/instellingen');
  await panel.getByRole('button', { name: 'Ontkoppelen' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ontkoppelen' }).click();
  await expect(panel).toContainText('Nog niet gekoppeld');
});

test('F13-N1 without a channel the kit says where to connect; a scheduled upload needs a moment', async ({ page }) => {
  await page.goto(`/#/release/${SEED.lanterns}/youtube`);
  const direct = page.getByRole('region', { name: 'Direct naar YouTube' });
  await expect(direct.getByRole('link', { name: 'Kanaal koppelen' })).toHaveAttribute('href', '#/instellingen');
  expect((await apiAs(page, 'POST', `/releases/${SEED.lanterns}/youtube-upload`, { privacy: 'public' })).status()).toBe(409);
  // A release without an MP4 says so.
  await page.goto(`/#/release/${SEED.hearts}/youtube`);
  await expect(page.getByRole('region', { name: 'Direct naar YouTube' })).toContainText(/Kanaal koppelen|nog geen MP4/);
});

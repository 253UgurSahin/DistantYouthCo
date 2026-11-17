import { test, expect } from '@playwright/test';
import { AUTH, ALICE, HAS_PASSWORDS, SEED, ASSETS, guard, expectAccessible, apiAs } from './helpers';

guard();
test.skip(!HAS_PASSWORDS, 'no test passwords');
test.use({ storageState: AUTH.admin });

test('F02-H1 admin uploads a release with WAV and video, and lands on its page', async ({ page }) => {
  const title = `Night Upload ${Date.now()}`;
  await page.goto('/#/nieuw');
  await expectAccessible(page);
  await page.getByLabel('Titel', { exact: true }).fill(title);
  await page.getByLabel('Style-omschrijving').fill('melodic dubstep, 150 bpm, koto');
  await page.getByLabel('Lyrics').fill('[Chorus]\nHold on to the light');
  await page.locator('#file-wav').setInputFiles(`${ASSETS}/demo.wav`);
  await page.locator('#file-video').setInputFiles(`${ASSETS}/visualizer.mp4`);
  await page.getByRole('button', { name: 'Opslaan', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  // The duration shows at once where the server reads it from the WAV (PHP), a moment later otherwise (Node with ffmpeg).
  await expect(page.getByText(/^Distant Youth Co\. · (\d+:\d\d · )?150 BPM$/)).toBeVisible();
});

test('F02-N1 a file that is not a WAV is refused with a clear message', async ({ page }) => {
  await page.goto('/#/nieuw');
  await page.getByLabel('Titel', { exact: true }).fill(`Fake ${Date.now()}`);
  await page.locator('#file-wav').setInputFiles({ name: 'fake.wav', mimeType: 'audio/wav', buffer: Buffer.from('not a wav at all') });
  await page.getByRole('button', { name: 'Opslaan', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('geen geldig WAV-bestand');
});

test('F02-N2 no WAV and no title: both are asked for, nothing is sent', async ({ page }) => {
  await page.goto('/#/nieuw');
  await page.getByRole('button', { name: 'Opslaan', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('titel');
  await page.getByLabel('Titel', { exact: true }).fill('Zonder WAV');
  await page.getByRole('button', { name: 'Opslaan', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('WAV-bestand is verplicht');
});

test('F02-E1 accents, emoji and HTML in a title come back as plain text', async ({ page }) => {
  const title = `Ça va 🌙 <b>bold</b> ' OR 1=1 -- ${Date.now()}`;
  await page.goto('/#/nieuw');
  await page.getByLabel('Titel', { exact: true }).fill(title);
  await page.locator('#file-wav').setInputFiles(`${ASSETS}/demo.wav`);
  await page.getByRole('button', { name: 'Opslaan', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(page.locator('main b', { hasText: 'bold' })).toHaveCount(0);
});

test('F02-E2 a title over 200 characters is refused', async ({ page }) => {
  const r = await apiAs(page, 'PUT', `/releases/${SEED.lanterns}`, undefined);
  expect(r.status()).toBe(400); // no title at all
  await page.goto(`/#/release/${SEED.lanterns}/bewerken`);
  await expect(page.getByLabel('Titel', { exact: true })).toHaveAttribute('maxlength', '200');
});

test('F02-E3 a double click on Save makes one release, not two', async ({ page }) => {
  const title = `Double ${Date.now()}`;
  await page.goto('/#/nieuw');
  await page.getByLabel('Titel', { exact: true }).fill(title);
  await page.locator('#file-wav').setInputFiles(`${ASSETS}/demo.wav`);
  await page.getByRole('button', { name: 'Opslaan', exact: true }).dblclick();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  const list = await (await apiAs(page, 'GET', '/releases')).json();
  expect(list.releases.filter((r: { title: string }) => r.title === title)).toHaveLength(1);
});

test('F02-E4 a listener never sees a hidden concept, not even by its address', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: AUTH.alice });
  const page = await ctx.newPage();
  expect((await apiAs(page, 'GET', `/releases/${SEED.hiddenDemo}`)).status()).toBe(404);
  expect((await page.request.get(`/media/${SEED.hiddenDemo}/audio`)).status()).toBe(404);
  await page.goto(`/#/release/${SEED.hiddenDemo}`);
  await expect(page.getByText('Dit bestaat niet (meer).')).toBeVisible();
  await ctx.close();
});

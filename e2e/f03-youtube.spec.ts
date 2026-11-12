import { test, expect } from '@playwright/test';
import { AUTH, HAS_PASSWORDS, SEED, guard, expectAccessible, apiAs } from './helpers';

guard();
test.skip(!HAS_PASSWORDS, 'no test passwords');
test.use({ storageState: AUTH.admin });

test('F03-H1 the YouTube-kit fills title, description and tags, and copies the description', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/#/release/${SEED.lanterns}/youtube`);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Template' }).click();
  await page.getByRole('button', { name: /genereren/i }).click();
  await expect(page.getByText(/Gemaakt met het template/)).toBeVisible();
  await expect(page.getByLabel('YouTube-beschrijving')).toHaveValue(/^# 🎵 Lanterns in the Rain — Distant Youth Co\. \(Official Visualizer\)/);
  await expect(page.locator('#yt-title-count')).toContainText('/ 100 tekens');
  await page.getByRole('button', { name: 'Kopieer beschrijving' }).click();
  await expect(page.getByRole('button', { name: 'Gekopieerd' })).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('More from Distant Youth Co. on Spotify');
});

test('F03-H2 changing the video type changes the title and the first line', async ({ page }) => {
  await page.goto(`/#/release/${SEED.lanterns}/youtube`);
  await page.getByLabel('Type').selectOption('Official Lyric Video');
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveValue(/\(Official Lyric Video\)$/);
});

test('F03-H3 marking it as on YouTube with its link', async ({ page }) => {
  await page.goto(`/#/release/${SEED.lanterns}/youtube`);
  await page.getByLabel('Plak de link van je video').fill('https://youtu.be/abc123');
  await page.getByRole('button', { name: 'Markeer als op YouTube' }).click();
  await expect(page.getByRole('status')).toContainText('Op YouTube gezet');
  const r = await (await apiAs(page, 'GET', `/releases/${SEED.lanterns}`)).json();
  expect(r.release.on_youtube).toBe(true);
  await apiAs(page, 'POST', `/releases/${SEED.lanterns}/status`, { on_youtube: false, youtube_url: '' }); // leave the seed as it was
});

test('F03-N1 a link that is not a web address is refused', async ({ page }) => {
  await page.goto(`/#/release/${SEED.lanterns}/youtube`);
  await page.getByLabel('Plak de link van je video').fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Markeer als op YouTube' }).click();
  await expect(page.getByRole('status')).toContainText(/link/i);
  const r = await (await apiAs(page, 'GET', `/releases/${SEED.lanterns}`)).json();
  expect(r.release.on_youtube).toBe(false);
});

test('F03-N2 Claude without a key: the button is off and says why', async ({ page }) => {
  await page.goto(`/#/release/${SEED.lanterns}/youtube`);
  const claude = page.getByRole('button', { name: 'Claude' });
  await expect(claude).toBeDisabled();
  await expect(claude).toHaveAttribute('title', /Instellingen/);
});

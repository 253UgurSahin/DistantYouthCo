import { test, expect } from '@playwright/test';
import { AUTH, HAS_PASSWORDS, SEED, guard, expectAccessible } from './helpers';

guard();
test.skip(!HAS_PASSWORDS, 'no test passwords');

test.describe('as admin', () => {
  test.use({ storageState: AUTH.admin });

  test('F09-H1 Downloads lists every video; one MP4 or several as a ZIP', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Hoofdmenu' }).getByRole('link', { name: 'Downloads' }).click();
    await expect(page.getByRole('heading', { name: 'Downloads' })).toBeVisible();
    await expectAccessible(page);
    const mp4 = page.getByRole('link', { name: /MP4 van Lanterns in the Rain downloaden/ });
    await expect(mp4).toHaveAttribute('href', `/media/${SEED.lanterns}/video?download=1`);
    const one = page.waitForEvent('download');
    await mp4.click();
    expect((await one).suggestedFilename()).toMatch(/\.mp4$/);

    // Nothing chosen: the ZIP button is off; all chosen: it downloads them together.
    await page.getByLabel('Alles kiezen').uncheck();
    await expect(page.getByText('Niets gekozen')).toBeVisible();
    await page.getByLabel('Alles kiezen').check();
    await expect(page.getByText(/gekozen ·/)).toBeVisible();
    const zipLink = page.getByRole('link', { name: /Download .*(video|ZIP)/ }).first();
    await expect(zipLink).toHaveAttribute('href', /download|videos\.zip/);
  });

  test('F09-H2 home shows what to do next, each a link to where it is done', async ({ page }) => {
    await page.goto('/');
    const todo = page.getByRole('region', { name: 'Te doen' });
    await expect(todo).toBeVisible();
    const all = todo.getByRole('button', { name: /^Toon alle/ });
    if (await all.count()) await all.click(); // more than five on their way: the rest is one click away
    await expect(todo.getByRole('link', { name: /Lanterns in the Rain.*Op YouTube zetten/ })).toHaveAttribute('href', `#/release/${SEED.lanterns}/youtube`);
  });
});

test.describe('as listener', () => {
  test.use({ storageState: AUTH.alice });

  test('F09-N1 a listener gets no Downloads and no to-do list', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Hoofdmenu' }).getByRole('link', { name: 'Downloads' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Te doen' })).toHaveCount(0);
    expect((await page.request.get('/downloads/videos.zip')).status()).toBe(403);
  });
});

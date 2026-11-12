import { test, expect } from '@playwright/test';
import { AUTH, HAS_PASSWORDS, SEED, guard, expectAccessible } from './helpers';

guard();
test.skip(!HAS_PASSWORDS, 'no test passwords');
test.use({ storageState: AUTH.alice });

test('F04-H1 a listener plays the latest release from the home screen', async ({ page }) => {
  await page.goto('/');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Afspelen' }).first().click();
  const player = page.getByRole('region', { name: 'Speler' });
  await expect(player).toBeVisible();
  await expect(player.getByRole('button', { name: 'Pauzeren' })).toBeVisible();
  await expect(player.getByRole('slider', { name: 'Positie in het nummer' })).toBeVisible();
});

test('F04-H2 the release page shows the lyrics with the chorus and plays', async ({ page }) => {
  await page.goto(`/#/release/${SEED.lanterns}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Lanterns in the Rain' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Chorus' })).toBeVisible();
  await expect(page.getByText('Light it up, light it up, like lanterns in the rain')).toBeVisible();
  await expectAccessible(page);
  // Listeners get no admin tools on a release.
  await expect(page.getByRole('link', { name: 'YouTube-kit' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Bewerken/ })).toHaveCount(0);
});

test('F04-H3 search and the status filter narrow the releases', async ({ page }) => {
  await page.goto('/');
  const releases = page.getByRole('region', { name: /^Releases/ });
  await page.getByRole('searchbox', { name: 'Zoek in je muziek' }).fill('hold on');
  await expect(releases.getByRole('link', { name: 'Paper Hearts', exact: true }).first()).toBeVisible();
  await expect(releases.getByRole('link', { name: 'Lanterns in the Rain', exact: true })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Zoek in je muziek' }).fill('');
  await page.getByRole('group', { name: 'Filter op status' }).getByRole('button', { name: 'Klaar voor YouTube' }).click();
  await expect(releases.getByRole('link', { name: 'Paper Hearts', exact: true })).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('F04-H4 the player opens full screen and closes with Escape', async ({ page }) => {
    await page.goto(`/#/release/${SEED.lanterns}`);
    await page.getByRole('button', { name: 'Afspelen' }).first().click();
    await page.getByRole('button', { name: /speler groot openen/ }).first().click();
    const full = page.getByRole('dialog', { name: /^Speler:/ });
    await expect(full).toBeVisible();
    await expect(full.getByText('Chorus')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(full).toHaveCount(0);
  });
});

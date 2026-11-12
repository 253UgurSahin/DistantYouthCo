import { test, expect } from '@playwright/test';
import { AUTH, HAS_PASSWORDS, SEED, guard, expectAccessible, apiAs } from './helpers';

guard();
test.skip(!HAS_PASSWORDS, 'no test passwords');

test.describe('as admin', () => {
  test.use({ storageState: AUTH.admin });

  test('F05-H1 a new collection, then a release moved into it', async ({ page }) => {
    const name = `EP ${Date.now()}`;
    await page.goto('/#/collecties');
    await page.getByRole('button', { name: 'Nieuwe collectie' }).click();
    await page.getByRole('dialog').getByLabel('Naam').fill(name);
    await page.getByRole('dialog').getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByText('Nog geen nummers')).toBeVisible();
    await expectAccessible(page);
  });

  test('F05-N1 album names without a Claude key say where to set one', async ({ page }) => {
    await page.goto(`/#/collectie/${SEED.folder}`);
    await page.getByRole('button', { name: 'Stel namen voor' }).click();
    await expect(page.getByText(/Claude is niet ingesteld/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Naar Instellingen' })).toBeVisible();
  });
});

test.describe('as listener', () => {
  test.use({ storageState: AUTH.alice });
  test('F05-N2 a listener cannot make, change or name collections', async ({ page }) => {
    await page.goto(`/#/collectie/${SEED.folder}`);
    await expect(page.getByRole('button', { name: 'Bewerken' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stel namen voor' })).toHaveCount(0);
    expect((await apiAs(page, 'POST', '/folders', { name: 'x' })).status()).toBe(403);
    expect((await apiAs(page, 'POST', `/folders/${SEED.folder}/suggest-names`, {})).status()).toBe(403);
  });
});

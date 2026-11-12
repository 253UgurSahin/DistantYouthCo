import { test, expect } from '@playwright/test';
import { AUTH, HAS_PASSWORDS, SEED, guard, expectAccessible, apiAs } from './helpers';

guard();
test.skip(!HAS_PASSWORDS, 'no test passwords');
test.use({ storageState: AUTH.alice });

test('F06-H1 a listener makes a playlist from a release page, then reorders it', async ({ page }) => {
  const name = `Late ${Date.now()}`;
  await page.goto(`/#/release/${SEED.lanterns}`);
  await page.getByRole('button', { name: 'Aan playlist toevoegen' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Nieuwe playlist' }).click();
  await page.getByRole('dialog').getByLabel('Naam').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Opslaan' }).click();
  await expect(page.getByRole('status')).toContainText(`Toegevoegd aan ${name}`);
  await page.goto(`/#/release/${SEED.hearts}`);
  await page.getByRole('button', { name: 'Aan playlist toevoegen' }).click();
  await page.getByRole('dialog').getByRole('button', { name }).click();
  await page.goto('/#/playlists');
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expectAccessible(page);
  const rows = page.getByRole('listitem');
  await expect(rows.first()).toContainText('Lanterns in the Rain');
  await page.getByRole('button', { name: 'Paper Hearts omhoog' }).click();
  await expect(page.getByRole('listitem').first()).toContainText('Paper Hearts');
});

test('F06-E1 a second listener cannot open, change or delete someone\'s private playlist', async ({ page, browser }) => {
  const { playlist } = await (await apiAs(page, 'POST', '/playlists', { name: `Privé ${Date.now()}` })).json();
  expect((await apiAs(page, 'GET', `/playlists/${playlist.id}`)).status()).toBe(200); // the owner sees it
  const bob = await browser.newContext({ storageState: AUTH.bob });
  const other = await bob.newPage();
  const seen = await apiAs(other, 'GET', `/playlists/${playlist.id}`);
  expect(await seen.text()).not.toContain('Privé');
  expect(seen.status()).toBe(404);
  expect((await apiAs(other, 'DELETE', `/playlists/${playlist.id}`)).status()).toBe(404);
  expect((await apiAs(other, 'POST', `/playlists/${playlist.id}/items`, { release_id: SEED.lanterns })).status()).toBe(404);
  await bob.close();
});

test('F06-E2 a shared playlist can be seen but not changed by another listener', async ({ page, browser }) => {
  const { playlist } = await (await apiAs(page, 'POST', '/playlists', { name: `Gedeeld ${Date.now()}`, is_public: true })).json();
  const bob = await browser.newContext({ storageState: AUTH.bob });
  const other = await bob.newPage();
  expect((await apiAs(other, 'GET', `/playlists/${playlist.id}`)).status()).toBe(200);
  expect((await apiAs(other, 'PUT', `/playlists/${playlist.id}`, { name: 'Overgenomen' })).status()).toBe(403);
  expect((await apiAs(other, 'DELETE', `/playlists/${playlist.id}`)).status()).toBe(403);
  await bob.close();
});

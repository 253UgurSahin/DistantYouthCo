import { test, expect } from '@playwright/test';
import { AUTH, HAS_PASSWORDS, guard, expectAccessible, apiAs } from './helpers';

guard();
test.skip(!HAS_PASSWORDS, 'no test passwords');

test.describe('as admin', () => {
  test.use({ storageState: AUTH.admin });

  test('F07-H1 the admin makes a listener account and removes it again', async ({ page }) => {
    const user = `gast${Date.now() % 100000}`;
    await page.goto('/#/accounts');
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Nieuw account' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Gebruikersnaam').fill(user);
    await dlg.getByLabel('Wachtwoord').fill(`pw-${Date.now()}-x`);
    await dlg.getByRole('button', { name: 'Aanmaken' }).click();
    await expect(page.getByRole('cell', { name: user, exact: true })).toBeVisible();
    await page.getByRole('button', { name: `${user} verwijderen` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Verwijderen' }).click();
    await expect(page.getByRole('cell', { name: user, exact: true })).toHaveCount(0);
  });

  test('F07-N1 a weak password or a taken name is refused', async ({ page }) => {
    expect((await apiAs(page, 'POST', '/users', { username: 'kort', password: '123', role: 'listener' })).status()).toBe(400);
    expect((await apiAs(page, 'POST', '/users', { username: 'luisteraar', password: 'lang genoeg 123', role: 'listener' })).status()).toBe(400);
  });

  test('F07-H2 settings save and the API key is never shown again', async ({ page }) => {
    await page.goto('/#/instellingen');
    await expectAccessible(page);
    await expect(page.getByLabel('Artiestennaam')).toHaveValue('Distant Youth Co.');
    await page.getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.getByRole('status')).toContainText('Instellingen opgeslagen');
    const s = await (await apiAs(page, 'GET', '/settings')).json();
    expect(JSON.stringify(s)).not.toContain('anthropic_api_key');
  });
});

test.describe('as listener', () => {
  test.use({ storageState: AUTH.alice });
  test('F07-N2 a listener gets no admin screens and no admin API', async ({ page }) => {
    await page.goto('/#/accounts');
    await expect(page.getByText(/Dit bestaat niet|Alleen voor admin/)).toBeVisible();
    for (const p of ['/users', '/settings']) expect((await apiAs(page, 'GET', p)).status()).toBe(403);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Nieuwe release' })).toHaveCount(0);
  });
});

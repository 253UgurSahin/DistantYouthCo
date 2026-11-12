import { test, expect } from '@playwright/test';
import { ALICE, HAS_PASSWORDS, guard, signIn, expectAccessible } from './helpers';

guard();

test('F01-H2 the sign-in page loads and passes the accessibility scan', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Distant Youth Studio' })).toBeVisible();
  await expectAccessible(page);
});

test.describe('F01 sign in', () => {
  test.skip(!HAS_PASSWORDS, 'no test passwords');

  test('F01-N1 a wrong password shows an error and does not sign in', async ({ page }) => {
    await signIn(page, ALICE, `wrong-${Date.now()}`);
    await expect(page.getByRole('alert').filter({ hasText: /klopt niet/ })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Hoofdmenu' })).toHaveCount(0);
  });

  test('F01-N2 empty fields are not sent', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Inloggen' }).click();
    await expect(page.getByLabel('Gebruikersnaam')).toHaveJSProperty('validity.valueMissing', true);
  });

  // A session of its own: signing out must not end the saved session the other specs use.
  test('F01-H3 sign out ends the session; the old cookie no longer works', async ({ page, context }) => {
    await signIn(page, ALICE);
    await expect(page.getByRole('navigation', { name: 'Hoofdmenu' })).toBeVisible();
    await page.getByRole('button', { name: /^Account/ }).click();
    await page.getByRole('button', { name: 'Uitloggen' }).click();
    await expect(page.getByLabel('Gebruikersnaam')).toBeVisible();
    expect((await context.request.get('/api/releases', { headers: { 'X-Requested-With': 'dyc' } })).status()).toBe(401);
  });
});

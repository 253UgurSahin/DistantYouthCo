import { test, expect } from '@playwright/test';
import { ALICE, HAS_PASSWORDS, guard, signIn, expectAccessible } from './helpers';

guard();

test('F01-H2 the sign-in page loads and passes the accessibility scan', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welkom terug' })).toBeVisible();
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

test('F01-H4 the sign-in remembers who you are and shows the password on request', async ({ page }) => {
  test.skip(!HAS_PASSWORDS, 'no test passwords');
  await signIn(page, ALICE);
  await expect(page.getByRole('navigation', { name: 'Hoofdmenu' })).toBeVisible();
  await page.context().clearCookies();
  await page.goto('/');
  await expect(page.getByLabel('Gebruikersnaam')).toHaveValue(ALICE);
  await expect(page.getByLabel('Wachtwoord')).toBeFocused();
  await page.getByLabel('Wachtwoord').fill('zichtbaar');
  await page.getByRole('button', { name: 'Laat zien wat je typt' }).click();
  await expect(page.getByLabel('Wachtwoord')).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: `Niet ${ALICE}?` }).click();
  await expect(page.getByLabel('Gebruikersnaam')).toHaveValue('');
});

test('F01-E1 the sign-in page fits the window: no scrolling, on a phone or a laptop', async ({ page }) => {
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 664 }]) {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Inloggen|Account aanmaken/ })).toBeVisible();
    const extra = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    expect(extra, `at ${size.width}x${size.height} the page scrolls ${extra}px`).toBeLessThanOrEqual(0);
  }
});


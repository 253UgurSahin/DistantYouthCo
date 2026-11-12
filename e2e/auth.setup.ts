import { test as setup, expect } from '@playwright/test';
import { ADMIN, ALICE, BOB, AUTH, HAS_PASSWORDS, signIn } from './helpers';

for (const [user, file] of [[ADMIN, AUTH.admin], [ALICE, AUTH.alice], [BOB, AUTH.bob]]) {
  setup(`F01-H1 ${user} signs in and sees the releases`, async ({ page }) => {
    setup.skip(!HAS_PASSWORDS, 'set the E2E_ passwords in forge-work/test/e2e.env');
    await signIn(page, user);
    await expect(page.getByRole('navigation', { name: 'Hoofdmenu' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.context().storageState({ path: file });
  });
}

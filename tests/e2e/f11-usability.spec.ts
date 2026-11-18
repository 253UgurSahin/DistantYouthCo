import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { AUTH, HAS_PASSWORDS, ASSETS, SEED, guard, expectAccessible, apiAs } from './helpers';

guard();
test.skip(!HAS_PASSWORDS, 'no test passwords');

test.describe('as admin', () => {
  test.use({ storageState: AUTH.admin });

  test('U001 home shows the progress once: Te doen, not a second table of the same', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Te doen' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'De stand van de nacht' })).toBeVisible();
    await expect(page.getByText('Wat elke release al heeft')).toHaveCount(0);
  });

  test('U002 Te doen shows every release on its way, the rest behind one button', async ({ page }) => {
    // Enough releases on their way for more than five.
    for (let i = 0; i < 6; i++) {
      await page.request.post('/api/releases', { headers: { 'X-Requested-With': 'dyc' }, multipart: { title: `Onderweg ${Date.now()}-${i}`, wav: { name: 'a.wav', mimeType: 'audio/wav', buffer: fs.readFileSync(`${ASSETS}/demo.wav`) } } });
    }
    await page.goto('/');
    const todo = page.getByRole('region', { name: 'Te doen' });
    const total = Number((await todo.getByText(/releases onderweg/).textContent())!.match(/\d+/)![0]);
    expect(total).toBeGreaterThan(5);
    await expect(todo.getByRole('listitem')).toHaveCount(5);
    await todo.getByRole('button', { name: `Toon alle ${total}` }).click();
    await expect(todo.getByRole('listitem')).toHaveCount(total);
    await expect(todo.getByRole('button', { name: /Toon minder/ })).toBeFocused();
    await expectAccessible(page);
  });
});

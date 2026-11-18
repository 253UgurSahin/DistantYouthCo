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

test.describe('as listener', () => {
  test.use({ storageState: AUTH.alice });

  test('U004 a release page leads to the release before and after it', async ({ page }) => {
    const { releases } = await (await apiAs(page, 'GET', '/releases')).json();
    expect(releases.length).toBeGreaterThan(2);
    await page.goto(`/#/release/${releases[1].id}`);
    const pager = page.getByRole('navigation', { name: 'Andere releases' });
    await expect(pager.getByRole('link', { name: `Vorige ${releases[0].title}` })).toBeVisible();
    await pager.getByRole('link', { name: `Volgende ${releases[2].title}` }).click();
    await expect(page.getByRole('heading', { level: 1, name: releases[2].title })).toBeVisible();
    await page.goto(`/#/release/${releases[0].id}`);
    await expect(pager.getByRole('link', { name: /^Vorige/ })).toHaveCount(0);
    await expectAccessible(page);
  });

  test('U005 the releases as a compact list, in the order you choose, remembered', async ({ page }) => {
    await page.goto('/');
    const rel = page.getByRole('region', { name: 'Releases' });
    await rel.getByRole('button', { name: 'Lijst' }).click();
    const rows = page.getByRole('list', { name: 'Releases als lijst' }).getByRole('listitem');
    await expect(rows.first()).toBeVisible();
    await page.getByLabel('Volgorde').selectOption('az');
    const titles = await rows.locator('.title').allTextContents();
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, 'nl', { sensitivity: 'base' })));
    await page.reload();
    await expect(page.getByRole('list', { name: 'Releases als lijst' })).toBeVisible();
    await expect(page.getByLabel('Volgorde')).toHaveValue('az');
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Covers' }).click();
    await page.getByLabel('Volgorde').selectOption('new');
  });
});


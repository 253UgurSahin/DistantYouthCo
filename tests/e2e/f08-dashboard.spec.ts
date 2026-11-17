import { test, expect } from '@playwright/test';
import { AUTH, HAS_PASSWORDS, guard, apiAs } from './helpers';

guard();
test.skip(!HAS_PASSWORDS, 'no test passwords');

test.describe('as admin', () => {
  test.use({ storageState: AUTH.admin });
  test('F08-H1 the period switch reshapes the bars and the table shows the same months', async ({ page }) => {
    await page.goto('/');
    const stand = page.getByRole('region', { name: 'De stand van de nacht' });
    await stand.getByRole('button', { name: '6 mnd' }).click();
    await stand.getByRole('button', { name: 'Toon als tabel' }).click();
    await expect(stand.getByRole('table').first().getByRole('row')).toHaveCount(7); // header + 6 months
    await stand.getByRole('button', { name: '24 mnd' }).click();
    await expect(stand.getByRole('table').first().getByRole('row')).toHaveCount(25);
    await expect(stand.getByText(/t\.o\.v\. de 24 maanden ervoor/)).toBeVisible();
  });

  test('F08-H2 a number drills down to the releases behind it', async ({ page }) => {
    await page.goto('/');
    const stand = page.getByRole('region', { name: 'De stand van de nacht' });
    await stand.getByRole('button', { name: /Klaar voor YouTube\s*: toon deze releases/ }).click();
    await expect(page.getByRole('group', { name: 'Filter op status' }).getByRole('button', { name: 'Klaar voor YouTube' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('F08-H3 live refresh can be paused', async ({ page }) => {
    await page.goto('/');
    const stand = page.getByRole('region', { name: 'De stand van de nacht' });
    await expect(stand.getByText(/live · bijgewerkt/)).toBeVisible();
    await stand.getByRole('button', { name: 'Live verversen pauzeren' }).click();
    await expect(stand.getByText(/gepauzeerd/)).toBeVisible();
  });
});

test.describe('as listener', () => {
  test.use({ storageState: AUTH.alice });
  test('F08-E1 a listener\'s numbers leave out the hidden concept', async ({ page }) => {
    const s = await (await apiAs(page, 'GET', '/stats?months=24')).json();
    expect(s.matrix.rows.map((r: { title: string }) => r.title)).not.toContain('Untitled Night Demo');
    expect(s.matrix.columns.map((c: { key: string }) => c.key)).not.toContain('yt_text');
  });
});

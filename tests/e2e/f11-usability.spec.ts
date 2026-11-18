import { test, expect } from '@playwright/test';
import { AUTH, HAS_PASSWORDS, guard, expectAccessible, apiAs } from './helpers';

guard();
test.skip(!HAS_PASSWORDS, 'no test passwords');

/** A one-second silent WAV, small enough for any host's upload limit (the app's own form sends big files in pieces). */
function smallWav(): Buffer {
  const rate = 8000, data = Buffer.alloc(rate * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

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
      await page.request.post('/api/releases', { headers: { 'X-Requested-With': 'dyc' }, multipart: { title: `Onderweg ${Date.now()}-${i}`, wav: { name: 'a.wav', mimeType: 'audio/wav', buffer: smallWav() } } });
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

test.describe('as admin, filling in', () => {
  test.use({ storageState: AUTH.admin });

  test('U003 Aanvullen walks through releases without style or lyrics, and keeps everything else', async ({ page }) => {
    const n = Date.now();
    const ids: number[] = [];
    for (const t of [`Kaal ${n} A`, `Kaal ${n} B`]) {
      const res = await page.request.post('/api/releases', { headers: { 'X-Requested-With': 'dyc' }, multipart: { title: t, hidden: '1', notes: 'privé', wav: { name: 'a.wav', mimeType: 'audio/wav', buffer: smallWav() } } });
      ids.push((await res.json()).release.id);
    }
    await page.goto(`/#/aanvullen?ids=${ids.join(',')}`);
    await expectAccessible(page);
    await expect(page.getByText('1 van 2')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: `Kaal ${n} B` })).toBeVisible(); // newest first
    await expect(page.getByLabel('Style-omschrijving')).toBeFocused();
    await page.getByLabel('Style-omschrijving').fill('melodic dubstep, 150 bpm, koto');
    await expect(page.getByText(/Herkend: .*150 BPM/i)).toBeVisible();
    await page.getByLabel('Lyrics').fill('[Chorus]\nLicht in de nacht');
    await page.getByRole('button', { name: 'Opslaan en volgende' }).click();
    await expect(page.getByText('2 van 2')).toBeVisible();
    await page.getByRole('button', { name: 'Overslaan' }).click();
    await expect(page.getByText('Klaar: 1 van 2 aangevuld.')).toBeVisible();
    const b = (await (await apiAs(page, 'GET', `/releases/${ids[1]}`)).json()).release;
    expect([b.style, b.lyrics, b.bpm, b.hidden, b.notes]).toEqual(['melodic dubstep, 150 bpm, koto', '[Chorus]\nLicht in de nacht', 150, true, 'privé']);
    expect(b.yt_description).toContain('150 BPM');
    // Home points there while some are bare.
    await page.goto('/');
    await expect(page.getByRole('link', { name: /zonder style of lyrics: aanvullen/ })).toHaveAttribute('href', '#/aanvullen');
  });
});

test.describe('as admin, deleting', () => {
  test.use({ storageState: AUTH.admin });

  test('U006 a deleted release comes back with "Ongedaan maken"', async ({ page }) => {
    const title = `Per ongeluk ${Date.now()}`;
    const res = await page.request.post('/api/releases', { headers: { 'X-Requested-With': 'dyc' }, multipart: { title, wav: { name: 'a.wav', mimeType: 'audio/wav', buffer: smallWav() } } });
    const id = (await res.json()).release.id;
    await page.goto(`/#/release/${id}/bewerken`);
    await page.getByRole('button', { name: 'Verwijderen' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Verwijderen/ }).click();
    const status = page.getByRole('status');
    await expect(status).toContainText(`"${title}" verwijderd`);
    expect((await apiAs(page, 'GET', `/releases/${id}`)).status()).toBe(404);
    // It waits while you read it: hover keeps it.
    await status.getByRole('button', { name: 'Ongedaan maken' }).hover();
    await page.waitForTimeout(11000);
    await status.getByRole('button', { name: 'Ongedaan maken' }).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(status).toContainText(`"${title}" is terug`);
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


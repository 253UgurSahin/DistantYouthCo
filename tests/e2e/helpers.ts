import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export const BASE_URL = process.env.FORGE_BASE_URL || 'http://localhost:3100';
// The demo accounts: one admin, two listeners. Their passwords live in forge-work/test/e2e.env.
export const ADMIN = 'admin';
export const ALICE = 'luisteraar';
export const BOB = 'ander';
export const PASSWORDS: Record<string, string> = {
  [ADMIN]: process.env.E2E_PASSWORD_ADMIN || '',
  [ALICE]: process.env.E2E_PASSWORD || '',
  [BOB]: process.env.E2E_PASSWORD_2 || '',
};
export const AUTH = { admin: '.auth/admin.json', alice: '.auth/alice.json', bob: '.auth/bob.json' };
export const HAS_PASSWORDS = Object.values(PASSWORDS).every(Boolean);
// Seed records of the demo instance (forge-work/improve/seed.mjs).
export const SEED = { lanterns: 3, hearts: 1, hiddenDemo: 2, folder: 1 };
export const ASSETS = '../../forge-work/improve/assets';

export async function signIn(page: Page, user: string, password = PASSWORDS[user]) {
  await page.goto('/');
  await page.getByLabel('Gebruikersnaam').fill(user);
  await page.getByLabel('Wachtwoord').fill(password);
  await page.getByRole('button', { name: 'Inloggen' }).click();
}

// Every test fails on a console error, an uncaught page error, a 5xx, or a 4xx on one of the app's own assets.
export function guard() {
  let problems: string[] = [];
  test.beforeEach(async ({ page }) => {
    problems = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`console error: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    page.on('response', (r) => {
      const own = ['script', 'stylesheet', 'image', 'font'].includes(r.request().resourceType()) && new URL(r.url()).origin === new URL(BASE_URL).origin;
      if (r.status() >= 500 || (r.status() >= 400 && own)) problems.push(`${r.status()} on ${r.url()}`);
    });
  });
  test.afterEach(() => expect(problems).toEqual([]));
}

export async function expectAccessible(page: Page) {
  // Entrances fade in: scan once they are done, so half-faded text is not counted as low contrast.
  // First let the view load its data: before it renders there are no animations yet, the wait below
  // passes on an empty page, and the scan then lands mid-fade (a contrast failure about 1 run in 8).
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity || !(a.timeline instanceof DocumentTimeline)));
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

/** The API, as the browser's signed-in user (with the app's CSRF header). */
export async function apiAs(page: Page, method: string, path: string, data?: unknown) {
  return page.request.fetch('/api' + path, { method, headers: { 'X-Requested-With': 'dyc' }, data });
}

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

test('pair from a mobile window, browse originals, filter, cache shell and revoke sharing', async () => {
  const root = path.resolve('.test-data/remote-library');
  await fs.mkdir(path.join(root, 'Nested'), { recursive: true });
  await sharp({ create: { width: 600, height: 400, channels: 3, background: '#986bcc' } }).png().toFile(path.join(root, 'Purple.png'));
  await sharp({ create: { width: 600, height: 400, channels: 3, background: '#55aa99' } }).png().toFile(path.join(root, 'Nested', 'Green.png'));
  const app = await electron.launch({ args: ['.', `--folder=${root}`], env: { ...process.env, LUMEN_TEST_DATA: path.resolve('.test-data/remote-profile') } });
  try {
    const desktop = await app.firstWindow();
    await expect(desktop.getByText('2 images indexed', { exact: false })).toBeVisible();
    await desktop.getByRole('button', { name: 'Share on network' }).click();
    await desktop.getByRole('button', { name: 'Start sharing', exact: true }).click();
    const token = await desktop.getByRole('textbox', { name: 'Pairing key', exact: true }).inputValue();
    expect(token).toHaveLength(48);
    await app.evaluate(async ({ BrowserWindow }) => {
      const mobile = new BrowserWindow({ width: 390, height: 844, webPreferences: { nodeIntegration: false, contextIsolation: true } });
      await mobile.loadURL('http://127.0.0.1:47831');
    });
    const mobile = app.windows().at(-1)!;
    const errors: string[] = []; mobile.on('pageerror', error => errors.push(error.message));
    await mobile.getByLabel('Pairing key', { exact: true }).fill('wrong');
    await mobile.getByRole('button', { name: 'Connect to Lumen' }).click();
    await expect(mobile.getByRole('status')).toContainText('Pairing key rejected');
    await mobile.getByLabel('Pairing key', { exact: true }).fill(token);
    await mobile.getByRole('button', { name: 'Connect to Lumen' }).click();
    await expect(mobile.locator('.card')).toHaveCount(2);
    await expect.poll(() => mobile.locator('.card img').first().evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(600);
    await mobile.screenshot({ path: 'test-results/remote-mobile.png' });
    await mobile.locator('.card').first().click();
    await expect.poll(() => mobile.locator('#full').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(600);
    await mobile.getByRole('button', { name: 'Close image', exact: true }).click();
    await mobile.getByRole('searchbox', { name: 'Search images' }).fill('Purple');
    await expect(mobile.locator('.card')).toHaveCount(1);
    await mobile.getByRole('searchbox', { name: 'Search images' }).fill('');
    await mobile.getByRole('combobox', { name: 'Browse folder' }).selectOption('Nested');
    await expect(mobile.locator('.card')).toHaveCount(1);
    await expect(mobile.locator('.card')).toContainText('Green');
    await mobile.evaluate(async () => { await navigator.serviceWorker.ready; });
    expect(await mobile.evaluate(async () => (await caches.open('lumen-shell-v1')).keys().then(keys => keys.every(key => !key.url.includes('/api/'))))).toBe(true);
    await desktop.getByRole('button', { name: 'Stop sharing', exact: true }).click();
    await expect(desktop.getByRole('button', { name: 'Start sharing', exact: true })).toBeVisible();
    await mobile.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(mobile.getByRole('status')).toContainText('Cannot reach your PC');
    await mobile.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(mobile.getByRole('heading', { name: 'A window into your PC.' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

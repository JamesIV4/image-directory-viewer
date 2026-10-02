import { test, expect, chromium, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

test('fresh HTTPS PWA discovers the advertised hostname without an address or key', async () => {
  const profile = await fs.mkdtemp(path.resolve('.test-data/remote-discovery-'));
  const root = path.join(profile, 'Photos'); await fs.mkdir(root);
  await sharp({ create: { width: 20, height: 20, channels: 3, background: '#55aa99' } }).png().toFile(path.join(root, 'Found.png'));
  // Exercise browser discovery and cross-origin HTTP; mDNS advertisement is checked separately on the LAN.
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP lumen.local 127.0.0.1'] });
  const app = await electron.launch({ args: ['.', `--folder=${root}`], env: { ...process.env, LUMEN_TEST_DATA: profile } });
  try {
    const desktop = await app.firstWindow();
    await expect(desktop.getByText('1 images indexed', { exact: false })).toBeVisible();
    const context = await browser.newContext({ permissions: ['local-network-access'], serviceWorkers: 'block' });
    const mobile = await context.newPage();
    const site = 'https://jamesiv4.github.io/image-directory-viewer/';
    await mobile.route(site + '**', async route => {
      const name = new URL(route.request().url()).pathname.slice('/image-directory-viewer/'.length) || 'index.html';
      if (name === 'sw.js') return route.fulfill({ status: 404 });
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
      await route.fulfill({ body: await fs.readFile(path.resolve('dist-pwa', name)), contentType: types[path.extname(name)] });
    });
    await mobile.goto(site);
    await expect(mobile.locator('.card')).toHaveCount(1, { timeout: 15000 });
    await expect(mobile.locator('.card')).toContainText('Found.png');
    expect(await mobile.evaluate(() => JSON.parse(localStorage.getItem('lumen.remote')!).base)).toBe('http://lumen.local:47831');
  } finally { await browser.close(); await app.close(); }
});

test('automatically connect, browse originals, reconnect, cache shell and revoke sharing', async () => {
  const root = path.resolve('.test-data/remote-library');
  await fs.mkdir(path.join(root, 'Nested'), { recursive: true });
  await sharp({ create: { width: 600, height: 400, channels: 3, background: '#986bcc' } }).png().toFile(path.join(root, 'Purple.png'));
  await sharp({ create: { width: 600, height: 400, channels: 3, background: '#55aa99' } }).png().toFile(path.join(root, 'Nested', 'Green.png'));
  await fs.mkdir(path.resolve('.test-data/remote-profile'), { recursive: true });
  await fs.writeFile(path.resolve('.test-data/remote-profile/settings.json'), JSON.stringify({ recent: [] }));
  const app = await electron.launch({ args: ['.', `--folder=${root}`], env: { ...process.env, LUMEN_TEST_DATA: path.resolve('.test-data/remote-profile') } });
  try {
    const desktop = await app.firstWindow();
    await expect(desktop.getByText('2 images indexed', { exact: false })).toBeVisible();
    await desktop.getByRole('button', { name: 'Share on network' }).click();
    await expect(desktop.getByRole('button', { name: 'Stop sharing', exact: true })).toBeVisible();
    const token = await desktop.getByRole('textbox', { name: 'Pairing key', exact: true }).inputValue();
    expect(token).toMatch(/^[A-Z0-9]{5}$/);
    await app.evaluate(async ({ BrowserWindow }) => {
      const mobile = new BrowserWindow({ width: 390, height: 844, webPreferences: { nodeIntegration: false, contextIsolation: true } });
      await mobile.loadURL('http://127.0.0.1:47831');
    });
    const mobile = app.windows().at(-1)!;
    const errors: string[] = []; mobile.on('pageerror', error => errors.push(error.message));
    await expect(mobile.locator('.card')).toHaveCount(2);
    await mobile.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await mobile.getByText('Connect using a PC address', { exact: true }).click();
    await mobile.getByLabel('Pairing key', { exact: true }).fill('wrong');
    await mobile.getByRole('button', { name: 'Connect to Lumen' }).click();
    await expect(mobile.getByRole('status')).toContainText('Pairing key rejected');
    await mobile.getByLabel('Pairing key', { exact: true }).fill(token);
    await mobile.getByRole('button', { name: 'Connect to Lumen' }).click();
    await expect(mobile.locator('.card')).toHaveCount(2);
    await mobile.reload();
    await expect(mobile.locator('.card')).toHaveCount(2);
    expect(await mobile.evaluate(() => JSON.parse(localStorage.getItem('lumen.remote')!).token)).toBe(token);
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
    await desktop.getByRole('button', { name: 'Start sharing', exact: true }).click();
    await expect(mobile.getByRole('status')).toHaveText('', { timeout: 20000 });
    await expect(mobile.locator('.card')).toHaveCount(1);
    await mobile.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(mobile.getByRole('heading', { name: 'A window into your PC.' })).toBeVisible();
    expect(await mobile.evaluate(() => localStorage.getItem('lumen.remote'))).toBeNull();
    await mobile.waitForTimeout(5500);
    await expect(mobile.getByRole('heading', { name: 'A window into your PC.' })).toBeVisible();
    await mobile.getByRole('button', { name: 'Find Lumen automatically' }).click();
    await expect(mobile.locator('.card')).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

test('desktop restarts keep the pairing key and sharing preference', async () => {
  const profile = await fs.mkdtemp(path.resolve('.test-data/remote-restart-'));
  const launch = () => electron.launch({ args: ['.'], env: { ...process.env, LUMEN_TEST_DATA: profile } });
  let app = await launch();
  try {
    let desktop = await app.firstWindow();
    await desktop.getByRole('button', { name: 'Share on network' }).click();
    await expect(desktop.getByRole('button', { name: 'Stop sharing', exact: true })).toBeVisible();
    const token = await desktop.getByRole('textbox', { name: 'Pairing key', exact: true }).inputValue();
    await app.close();
    app = await launch(); desktop = await app.firstWindow();
    await desktop.getByRole('button', { name: 'Share on network' }).click();
    await expect(desktop.getByRole('button', { name: 'Stop sharing', exact: true })).toBeVisible();
    await expect(desktop.getByRole('textbox', { name: 'Pairing key', exact: true })).toHaveValue(token);
    await desktop.getByRole('button', { name: 'Stop sharing', exact: true }).click();
    await expect(desktop.getByRole('button', { name: 'Start sharing', exact: true })).toBeVisible();
    await app.close();
    app = await launch(); desktop = await app.firstWindow();
    await desktop.getByRole('button', { name: 'Share on network' }).click();
    await expect(desktop.getByRole('button', { name: 'Start sharing', exact: true })).toBeVisible();
    await desktop.getByRole('button', { name: 'Start sharing', exact: true }).click();
    await expect(desktop.getByRole('textbox', { name: 'Pairing key', exact: true })).toHaveValue(token);
  } finally { await app.close(); }
});

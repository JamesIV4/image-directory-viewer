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
    await expect(mobile.locator('.image-card')).toHaveCount(1, { timeout: 15000 });
    await expect(mobile.locator('.image-card')).toContainText('Found.png');
    expect(await mobile.evaluate(() => JSON.parse(localStorage.getItem('lumen.remote')!).base)).toBe('http://lumen.local:47831');
  } finally { await browser.close(); await app.close(); }
});

test('automatically connect, browse originals, reconnect, cache shell and revoke sharing', async () => {
  const root = await fs.mkdtemp(path.resolve('.test-data/remote-library-'));
  await fs.mkdir(path.join(root, 'Nested'), { recursive: true });
  await sharp({ create: { width: 600, height: 400, channels: 3, background: '#986bcc' } }).png().toFile(path.join(root, 'Purple.png'));
  await sharp({ create: { width: 600, height: 400, channels: 3, background: '#55aa99' } }).png().toFile(path.join(root, 'Nested', 'Green.png'));
  const profile = await fs.mkdtemp(path.resolve('.test-data/remote-profile-'));
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ recent: [] }));
  const app = await electron.launch({ args: ['.', `--folder=${root}`], env: { ...process.env, LUMEN_TEST_DATA: profile } });
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
    await expect(mobile.locator('.image-card')).toHaveCount(2);
    await mobile.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await mobile.getByText('Connect using a PC address', { exact: true }).click();
    await mobile.getByLabel('Pairing key', { exact: true }).fill('wrong');
    await mobile.getByRole('button', { name: 'Connect to Lumen' }).click();
    await expect(mobile.getByRole('status')).toContainText('Pairing key rejected');
    await mobile.getByLabel('Pairing key', { exact: true }).fill(token);
    await mobile.getByRole('button', { name: 'Connect to Lumen' }).click();
    await expect(mobile.locator('.image-card')).toHaveCount(2);
    await mobile.reload();
    await expect(mobile.locator('.image-card')).toHaveCount(2);
    expect(await mobile.evaluate(() => JSON.parse(localStorage.getItem('lumen.remote')!).token)).toBe(token);
    await expect.poll(() => mobile.locator('.image-card img').first().evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(600);
    await mobile.screenshot({ path: 'test-results/remote-mobile.png' });
    await mobile.locator('.image-card').first().click();
    await expect.poll(() => mobile.locator('.original-image').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(600);
    await mobile.getByRole('button', { name: '1:1', exact: true }).click();
    await expect(mobile.locator('.zoom-value')).toHaveText('100%');
    await mobile.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(mobile.locator('.zoom-value')).not.toHaveText('100%');
    await mobile.getByRole('button', { name: 'Nearest neighbor', exact: true }).click();
    await expect(mobile.getByRole('button', { name: 'Nearest neighbor', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await mobile.getByRole('button', { name: 'Image details', exact: true }).click();
    await expect(mobile.locator('.image-info')).toContainText('600');
    await expect(mobile.locator('.image-info')).toContainText('srgb');
    await mobile.getByRole('button', { name: 'Close viewer', exact: true }).click();
    await mobile.getByRole('button', { name: 'Details view', exact: true }).click();
    await expect(mobile.locator('.library')).toHaveClass(/list/);
    await mobile.getByRole('button', { name: 'Gallery view', exact: true }).click();
    await mobile.getByRole('textbox', { name: 'Exclude folders', exact: true }).fill('Nested');
    await expect(mobile.locator('.image-card')).toHaveCount(1);
    await mobile.getByRole('textbox', { name: 'Exclude folders', exact: true }).fill('');
    await expect(mobile.locator('.image-card')).toHaveCount(2);
    await mobile.getByRole('button', { name: 'Filter by date and time', exact: true }).click();
    await mobile.getByLabel('Newer than', { exact: true }).fill('2099-01-01T00:00');
    await expect(mobile.locator('.image-card')).toHaveCount(0);
    await mobile.getByRole('button', { name: 'Clear dates', exact: true }).click();
    await expect(mobile.locator('.image-card')).toHaveCount(2);
    await mobile.getByRole('button', { name: 'Filter by date and time', exact: true }).click();
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mobile.getByRole('textbox', { name: 'Search images' }).fill('Purple');
    await expect(mobile.locator('.image-card')).toHaveCount(1);
    await mobile.getByRole('textbox', { name: 'Search images' }).fill('');
    await mobile.getByRole('button', { name: 'Show sidebar', exact: true }).click();
    await mobile.locator('.tree-label').filter({ hasText: 'Nested' }).click();
    await mobile.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
    await expect(mobile.locator('.image-card')).toHaveCount(1);
    await expect(mobile.locator('.image-card')).toContainText('Green');
    await mobile.evaluate(async () => { await navigator.serviceWorker.ready; });
    expect(await mobile.evaluate(async () => { const keys = await caches.keys(); const name = keys.find(key => key.startsWith('lumen-shell-'))!; const entries = await (await caches.open(name)).keys(); return entries.length > 0 && entries.every(key => !key.url.includes('/api/')); })).toBe(true);
    await desktop.getByRole('button', { name: 'Stop sharing', exact: true }).click();
    await expect(desktop.getByRole('button', { name: 'Start sharing', exact: true })).toBeVisible();
    await mobile.getByRole('button', { name: 'Refresh library', exact: true }).click();
    await expect(mobile.getByRole('status')).toContainText('Cannot reach your PC');
    await desktop.getByRole('button', { name: 'Start sharing', exact: true }).click();
    await expect(mobile.locator('.remote-status')).toHaveCount(0, { timeout: 20000 });
    await expect(mobile.locator('.image-card')).toHaveCount(1);
    await mobile.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(mobile.getByRole('heading', { name: 'A window into your PC.' })).toBeVisible();
    expect(await mobile.evaluate(() => localStorage.getItem('lumen.remote'))).toBeNull();
    await mobile.waitForTimeout(5500);
    await expect(mobile.getByRole('heading', { name: 'A window into your PC.' })).toBeVisible();
    await mobile.getByRole('button', { name: 'Find Lumen automatically' }).click();
    await expect(mobile.locator('.image-card')).toHaveCount(2);
    await sharp({ create: { width: 40, height: 30, channels: 3, background: '#aa7755' } }).png().toFile(path.join(root, 'Added.png'));
    await mobile.getByRole('button', { name: 'Refresh library', exact: true }).click();
    await expect(desktop.getByText('3 images indexed', { exact: false })).toBeVisible();
    await expect(mobile.locator('.image-card')).toHaveCount(3);
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

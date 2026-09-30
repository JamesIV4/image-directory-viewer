// Run from the repository root after `npm.cmd run build`.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';
import sharp from 'sharp';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(workspace, 'docs', 'screenshots');
const data = path.join(workspace, '.test-data', 'readme');
const library = path.join(data, 'Field Notes');
const photos = JSON.parse(await fs.readFile(path.join(output, 'photos.json'), 'utf8'));

for (const [index, photo] of photos.entries()) {
  const folder = path.join(library, photo.folder);
  await fs.mkdir(folder, { recursive: true });
  const target = path.join(folder, `${photo.name}.jpg`);
  try { await fs.access(target); }
  catch {
    const url = `https://images.unsplash.com/${photo.image}?auto=format&fit=max&w=2200&q=90`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Photo download failed: ${response.status} ${url}`);
    await sharp(Buffer.from(await response.arrayBuffer())).rotate().jpeg({ quality: 92 }).toFile(target);
  }
  // A stable modification-date range makes the date controls useful in the demo.
  const modified = new Date(Date.UTC(2026, 5, 1 + index * 7, 12));
  await fs.utimes(target, modified, modified);
}

// Use a new disposable profile each time; never change the user's preferences.
const profile = await fs.mkdtemp(path.join(data, 'profile-'));
const app = await electron.launch({
  args: ['.', `--folder=${library}`], cwd: workspace,
  env: { ...process.env, LUMEN_TEST_DATA: profile },
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1080));
  await expect(page.getByText('15 images indexed', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Expand Alpine', exact: true }).click();

  async function capture(name) {
    await expect(page.locator('.failed-thumb')).toHaveCount(0);
    await expect.poll(() => page.locator('.thumb img').evaluateAll(images =>
      images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0)),
    ).toBe(true);
    await page.mouse.move(1580, 1060);
    await page.evaluate(() => document.fonts.ready);
    // Wait for layout and viewer zoom animations to settle before capturing.
    await page.waitForTimeout(500);
    const screenshot = await page.screenshot({ animations: 'disabled' });
    await sharp(screenshot).webp({ quality: 94, effort: 6 }).toFile(path.join(output, `${name}.webp`));
    console.log(`Captured ${name}.webp`);
  }

  await page.getByRole('button', { name: 'Gallery view', exact: true }).click();
  await capture('gallery');

  await page.getByRole('button', { name: 'Collapse controls', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 900));
  await capture('condensed');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1080));
  await page.getByRole('button', { name: 'Expand controls', exact: true }).click();

  await page.getByRole('checkbox', { name: 'Include Alpine', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Grouped by folder', exact: true }).click();
  await page.getByRole('button', { name: 'Filter by date and time', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Date and time filters' })).toBeVisible();
  await capture('folders-and-dates');
  await page.getByRole('button', { name: 'Filter by date and time', exact: true }).click();
  await page.locator('.folder-filter-banner').getByRole('button', { name: 'Include all folders' }).click();

  await page.getByRole('button', { name: 'Gallery view', exact: true }).click();
  await page.getByRole('button', { name: 'View Alpine/Lakes/Emerald lake.jpg', exact: true }).click();
  await expect(page.locator('.original-image')).toHaveJSProperty('complete', true);
  await expect.poll(() => page.locator('.original-image').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.viewer-loading')).toHaveCount(0);
  await page.getByRole('button', { name: 'Image details', exact: true }).click();
  await expect(page.locator('.image-info')).toContainText('srgb');
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await capture('viewer');
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await app.close();
}

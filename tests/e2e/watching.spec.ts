import { test, expect, chromium, _electron as electron, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

test('watched images wait for the top of each gallery', async () => {
  const profile = await fs.mkdtemp(path.resolve('.test-data/watching-'));
  const root = path.join(profile, 'Photos');
  await fs.mkdir(path.join(root, 'Nested'), { recursive: true });
  const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#88aacc' } }).png().toBuffer();
  await Promise.all(Array.from({ length: 70 }, (_, i) => fs.writeFile(path.join(root, `Photo-${i}.png`), png)));
  const app = await electron.launch({ args: ['.', `--folder=${root}`], env: { ...process.env, LUMEN_TEST_DATA: profile, LUMEN_TEST_SHARE_PORT: '47832' } });
  const browser = await chromium.launch();
  try {
    const desktop = await app.firstWindow();
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mobile.goto('http://127.0.0.1:47832');
    const gallery = (page: Page) => page.getByRole('region', { name: 'Image collection' });
    const firstImage = (page: Page) => gallery(page).locator('.image-card').first();
    const indexed = (page: Page, count: number) => expect(page.getByText(`${count} images indexed`, { exact: false })).toBeVisible();
    await indexed(desktop, 70);
    await indexed(mobile, 70);

    const scrollTo = (page: Page, top: number) => gallery(page).evaluate((element, value) => { element.scrollTop = value; }, top);
    const offset = (page: Page) => gallery(page).evaluate(element => element.scrollTop);
    await scrollTo(desktop, 1000);
    await scrollTo(mobile, 800);
    await expect.poll(() => offset(desktop)).toBe(1000);
    await expect.poll(() => offset(mobile)).toBe(800);
    const desktopCards = await gallery(desktop).locator('.image-card').allTextContents();

    const importFolder = path.join(profile, 'Import');
    await fs.mkdir(importFolder);
    await fs.writeFile(path.join(importFolder, 'Imported.png'), png);
    await fs.rename(importFolder, path.join(root, 'Nested', 'Import'));
    await fs.writeFile(path.join(root, 'Added.png'), png);
    await fs.writeFile(path.join(root, 'Ignored.txt'), 'Plain text');

    const desktopUpdates = desktop.getByRole('button', { name: '2 New Images', exact: true });
    const mobileUpdates = mobile.getByRole('button', { name: '2 New Images', exact: true });
    await expect(desktopUpdates).toBeVisible();
    await expect(mobileUpdates).toBeVisible();
    expect(await offset(desktop)).toBe(1000);
    expect(await offset(mobile)).toBe(800);
    expect(await gallery(desktop).locator('.image-card').allTextContents()).toEqual(desktopCards);

    await scrollTo(mobile, 0);
    await indexed(mobile, 72);
    await expect(mobileUpdates).toBeHidden();
    await expect(desktopUpdates).toBeVisible();
    await desktopUpdates.click();
    await indexed(desktop, 72);
    expect(await offset(desktop)).toBe(0);
    await expect(desktopUpdates).toBeHidden();

    await fs.writeFile(path.join(root, 'Nested', 'At top.png'), png);
    for (const page of [desktop, mobile]) {
      await indexed(page, 73);
      await expect(firstImage(page)).toHaveAttribute('aria-label', 'View Nested/At top.png');
      await expect(page.getByRole('button', { name: '1 New Image', exact: true })).toBeHidden();
    }

    const detailArrival = 'Nested/While viewing.png';
    const detections = await Promise.all([desktop, mobile].map(async page => {
      expect(await offset(page)).toBe(0);
      await firstImage(page).click();
      await expect(page.getByRole('dialog', { name: 'Viewing At top.png' })).toBeVisible();
      return page.evaluateHandle(relativePath => ({
        detected: new Promise<void>(resolve => {
          const unsubscribe = window.lumen.onIndex(event => {
            if (event.type !== 'update' || !event.items.some(item => item.relativePath === relativePath)) return;
            unsubscribe();
            resolve();
          });
        }),
      }), detailArrival);
    }));
    await fs.writeFile(path.join(root, detailArrival), png);
    await Promise.all(detections.map(detection => detection.evaluate(({ detected }) => detected)));
    for (const page of [desktop, mobile]) {
      await expect(page.locator('.viewer-counter')).toHaveText('1 / 73');
      const prompt = page.getByRole('button', { name: '1 New Image', exact: true });
      await page.getByRole('button', { name: 'Close viewer', exact: true }).click();
      await expect(prompt).toBeVisible();
      expect(await offset(page)).toBe(0);
      await indexed(page, 73);
      await prompt.click();
      await indexed(page, 74);
      await expect(firstImage(page)).toHaveAttribute('aria-label', `View ${detailArrival}`);
    }

    await desktop.getByRole('checkbox', { name: 'Include subfolders', exact: true }).uncheck();
    await scrollTo(desktop, 1000);
    await expect.poll(() => offset(desktop)).toBe(1000);
    await fs.writeFile(path.join(root, 'Nested', 'Out of scope.png'), png);
    await indexed(desktop, 75);
    expect(await offset(desktop)).toBe(1000);
    await expect(desktop.getByRole('button', { name: '1 New Image', exact: true })).toBeHidden();

    await fs.writeFile(path.join(root, 'Temporary.png'), png);
    const temporary = desktop.getByRole('button', { name: '1 New Image', exact: true });
    await expect(temporary).toBeVisible();
    await fs.unlink(path.join(root, 'Temporary.png'));
    await expect(temporary).toBeHidden();
    await indexed(desktop, 75);
  } finally { await browser.close(); await app.close(); }
});

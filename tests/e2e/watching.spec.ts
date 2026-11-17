import { test, expect, chromium, _electron as electron, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

test('watched images wait for the prompt and only the latest batch glows', async () => {
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
    const newCards = (page: Page) => gallery(page).locator('.image-card.recently-added');
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
    await expect.poll(() => offset(mobile)).toBe(0);
    await expect(mobileUpdates).toBeVisible();
    await indexed(mobile, 70);
    await mobileUpdates.click();
    await indexed(mobile, 72);
    await expect(mobileUpdates).toBeHidden();
    await expect(desktopUpdates).toBeVisible();
    await desktopUpdates.click();
    await indexed(desktop, 72);
    expect(await offset(desktop)).toBe(0);
    await expect(desktopUpdates).toBeHidden();
    for (const page of [desktop, mobile]) {
      await expect(newCards(page)).toHaveCount(2);
      await expect(newCards(page).first()).toHaveCSS('box-shadow', /rgba?\(88, 175, 255/);
    }

    const topArrival = 'Nested/At top.png';
    await fs.writeFile(path.join(root, topArrival), png);
    for (const page of [desktop, mobile]) {
      const prompt = page.getByRole('button', { name: '1 New Image', exact: true });
      await expect(prompt).toBeVisible();
      await indexed(page, 72);
      await expect(newCards(page)).toHaveCount(2);
      await expect(gallery(page).getByRole('button', { name: `View ${topArrival}`, exact: true })).toHaveCount(0);
      await prompt.click();
      await indexed(page, 73);
      await expect(firstImage(page)).toHaveAttribute('aria-label', `View ${topArrival}`);
      await expect(newCards(page)).toHaveCount(1);
      await expect(newCards(page)).toHaveAttribute('aria-label', `View ${topArrival}`);
      await expect(prompt).toBeHidden();
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
      await expect(newCards(page)).toHaveAttribute('aria-label', `View ${detailArrival}`);
    }

    const subfolders = desktop.getByRole('checkbox', { name: 'Include subfolders', exact: true });
    await subfolders.uncheck();
    await scrollTo(desktop, 1000);
    await expect.poll(() => offset(desktop)).toBe(1000);
    await fs.writeFile(path.join(root, 'Nested', 'Out of scope.png'), png);
    const prompt = desktop.getByRole('button', { name: '1 New Image', exact: true });
    await expect(mobile.getByRole('button', { name: '1 New Image', exact: true })).toBeVisible();
    await indexed(desktop, 74);
    expect(await offset(desktop)).toBe(1000);
    await expect(prompt).toBeHidden();
    await subfolders.check();
    await expect(prompt).toBeVisible();
    await indexed(desktop, 74);
    await prompt.click();
    await indexed(desktop, 75);

    await fs.writeFile(path.join(root, 'Temporary.png'), png);
    await expect(prompt).toBeVisible();
    await fs.unlink(path.join(root, 'Temporary.png'));
    await expect(prompt).toBeHidden();
    await indexed(desktop, 75);
  } finally { await browser.close(); await app.close(); }
});

test('recent folders remember their glow and queue images added while away', async () => {
  const profile = await fs.mkdtemp(path.resolve('.test-data/recent-watching-'));
  const root = path.join(profile, 'Photos'), other = path.join(profile, 'Other');
  await fs.mkdir(path.join(root, 'Nested'), { recursive: true });
  await fs.mkdir(other);
  const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#88aacc' } }).png().toBuffer();
  await fs.writeFile(path.join(root, 'Existing.png'), png);
  await fs.writeFile(path.join(other, 'Other.png'), png);
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ lastRoot: root, recent: [root, other] }));
  const app = await electron.launch({ args: ['.'], env: { ...process.env, LUMEN_TEST_DATA: profile, LUMEN_TEST_SHARE_PORT: '47832' } });
  const browser = await chromium.launch();
  try {
    const desktop = await app.firstWindow();
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mobile.goto('http://127.0.0.1:47832');
    const clients = [desktop, mobile];
    const recent = (page: Page, folder: string) => page.locator('.recent-folders').getByRole('button', { name: folder, exact: true });
    const card = (page: Page, relative: string) => page.getByRole('button', { name: `View ${relative}`, exact: true });
    const glow = (page: Page) => page.locator('.image-card.recently-added');
    const prompt = (page: Page, count: number) => page.getByRole('button', { name: `${count} New ${count === 1 ? 'Image' : 'Images'}`, exact: true });
    for (const page of clients) await expect(card(page, 'Existing.png')).toBeVisible();

    await fs.writeFile(path.join(root, 'First batch.png'), png);
    for (const page of clients) {
      await prompt(page, 1).click();
      await expect(glow(page)).toHaveAttribute('aria-label', 'View First batch.png');
    }
    await fs.writeFile(path.join(root, 'Queued.png'), png);
    for (const page of clients) await expect(prompt(page, 1)).toBeVisible();
    await recent(desktop, 'Other').click();
    for (const page of clients) await expect(card(page, 'Other.png')).toBeVisible();

    await fs.writeFile(path.join(other, 'Other batch.png'), png);
    for (const page of clients) {
      await prompt(page, 1).click();
      await expect(glow(page)).toHaveAttribute('aria-label', 'View Other batch.png');
    }
    await fs.writeFile(path.join(root, 'Nested', 'While away.png'), png);
    await fs.utimes(path.join(root, 'Existing.png'), new Date(), new Date());

    await mobile.getByRole('button', { name: 'Show sidebar', exact: true }).click();
    await recent(mobile, 'Photos').click();
    await mobile.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
    for (const page of clients) {
      await expect(prompt(page, 2)).toBeVisible();
      await expect(glow(page)).toHaveAttribute('aria-label', 'View First batch.png');
      await expect(card(page, 'Existing.png')).toBeVisible();
      await expect(card(page, 'Nested/While away.png')).toHaveCount(0);
      await expect(card(page, 'Queued.png')).toHaveCount(0);
      await prompt(page, 2).click();
      await expect(glow(page)).toHaveCount(2);
      await expect(card(page, 'Nested/While away.png')).toHaveClass(/recently-added/);
      await expect(card(page, 'Queued.png')).toHaveClass(/recently-added/);
    }

    await fs.writeFile(path.join(root, 'Before refresh.png'), png);
    for (const page of clients) await expect(prompt(page, 1)).toBeVisible();
    await desktop.getByRole('button', { name: 'Refresh library', exact: true }).click();
    for (const page of clients) {
      await expect(card(page, 'Before refresh.png')).toBeVisible();
      await expect(glow(page)).toHaveCount(0);
      await expect(prompt(page, 1)).toHaveCount(0);
    }

    await recent(desktop, 'Other').click();
    for (const page of clients) await expect(glow(page)).toHaveAttribute('aria-label', 'View Other batch.png');
    await recent(desktop, 'Photos').click();
    for (const page of clients) {
      await expect(card(page, 'Before refresh.png')).toBeVisible();
      await expect(glow(page)).toHaveCount(0);
    }
  } finally { await browser.close(); await app.close(); }
});

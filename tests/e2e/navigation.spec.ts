import { test, expect, chromium, _electron as electron, type Page, type CDPSession } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

async function swipe(session: CDPSession, from: [number, number], to: [number, number]) {
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from[0], y: from[1] }] });
  for (let step = 1; step <= 6; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
      x: from[0] + (to[0] - from[0]) * step / 6, y: from[1] + (to[1] - from[1]) * step / 6,
    }] });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function fixture() {
  const profile = await fs.mkdtemp(path.resolve('.test-data/navigation-'));
  const root = path.join(profile, 'Photos');
  await fs.mkdir(path.join(root, 'Nested'), { recursive: true });
  for (const name of ['A.png', 'B.png', 'Nested/C.png']) {
    await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#55aa99' } }).png().toFile(path.join(root, name));
  }
  return { profile, root };
}

test('touch swipes browse fitted images, dismiss vertically, preserve zoomed pan and pinch, and navigate edges everywhere', async () => {
  const { profile, root } = await fixture();
  const app = await electron.launch({ args: ['.', `--folder=${root}`], env: { ...process.env, LUMEN_TEST_DATA: profile, LUMEN_TEST_SHARE_PORT: '47832' } });
  const browser = await chromium.launch();
  try {
    const desktop = await app.firstWindow();
    await expect(desktop.locator('.image-card')).toHaveCount(3);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    await page.goto('http://127.0.0.1:47832');
    await expect(page.locator('.image-card')).toHaveCount(3);
    await page.locator('.image-card').first().click();
    await expect(page.locator('.original-image')).toHaveJSProperty('naturalWidth', 1200);
    await expect(page.locator('.zoom-value')).toHaveText('26%');
    await swipe(session, [260, 410], [100, 410]);
    await expect(page.locator('.viewer-title strong')).toHaveText('B.png');
    await expect(page.locator('.viewer-image-layer:visible img')).toHaveAttribute('alt', 'B.png');
    await expect(page.getByRole('button', { name: 'Fit', exact: true })).toBeEnabled();
    await swipe(session, [120, 410], [270, 410]);
    await expect(page.locator('.viewer-title strong')).toHaveText('A.png');
    await expect(page.locator('.viewer-image-layer:visible img')).toHaveAttribute('alt', 'A.png');
    await expect(page.getByRole('button', { name: 'Fit', exact: true })).toBeEnabled();
    await swipe(session, [120, 410], [270, 410]); // First-image boundary.
    await expect(page.locator('.viewer-title strong')).toHaveText('A.png');
    await swipe(session, [190, 410], [190, 540]);
    await expect(page.locator('.viewer')).toHaveCount(0);
    await swipe(session, [386, 410], [220, 410]);
    await expect(page.locator('.viewer-title strong')).toHaveText('A.png');
    await expect(page.locator('.zoom-value')).toHaveText('26%');
    await swipe(session, [190, 410], [190, 290]);
    await expect(page.locator('.viewer')).toHaveCount(0);
    await swipe(session, [386, 410], [220, 410]);
    await expect(page.locator('.viewer')).toHaveCount(1);
    await page.getByRole('button', { name: '1:1', exact: true }).click();
    await expect(page.locator('.zoom-value')).toHaveText('100%');
    const before = await page.locator('.zoom-content').getAttribute('style');
    await swipe(session, [190, 410], [300, 410]);
    await expect(page.locator('.viewer-title strong')).toHaveText('A.png');
    await expect(page.locator('.zoom-content')).not.toHaveAttribute('style', before!);
    await swipe(session, [190, 410], [190, 530]);
    await expect(page.locator('.viewer')).toHaveCount(1);
    // Edge back works while zoomed in, then edge forward reopens details.
    await swipe(session, [3, 410], [150, 410]);
    await expect(page.locator('.viewer')).toHaveCount(0);
    await swipe(session, [386, 410], [220, 410]);
    await expect(page.locator('.viewer')).toHaveCount(1);
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await expect(page.locator('.zoom-value')).toHaveText('26%');
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 130, y: 410 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 130, y: 410 }, { x: 260, y: 410 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 80, y: 410 }, { x: 310, y: 410 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.viewer-title strong')).toHaveText('A.png');
    await expect(page.locator('.zoom-value')).not.toHaveText('26%');
    await swipe(session, [3, 410], [150, 410]);
    await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
    await page.locator('.tree-label').filter({ hasText: 'Nested' }).click();
    await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
    await expect(page.locator('.image-card')).toHaveCount(1);
    await swipe(session, [3, 410], [150, 410]);
    await expect(page.locator('.image-card')).toHaveCount(3);
    await swipe(session, [386, 410], [220, 410]);
    await expect(page.locator('.image-card')).toHaveCount(1);
    await page.getByRole('button', { name: 'Open folder', exact: false }).click();
    const picker = page.getByRole('dialog', { name: 'Choose a folder on your PC' });
    await expect(picker.getByRole('button', { name: 'Up one folder' })).toBeEnabled();
    await picker.getByRole('button', { name: 'Up one folder' }).click();
    await expect(picker.getByLabel('PC folder path')).toHaveValue(profile);
    await swipe(session, [3, 410], [150, 410]);
    await expect(picker.getByLabel('PC folder path')).toHaveValue(root);
    await swipe(session, [386, 410], [220, 410]);
    await expect(picker.getByLabel('PC folder path')).toHaveValue(profile);
    await swipe(session, [3, 410], [150, 410]);
    await swipe(session, [3, 410], [150, 410]);
    await expect(picker).toHaveCount(0);
  } finally { await browser.close(); await app.close(); }
});

async function setFilters(page: Page) {
  await page.getByRole('combobox', { name: 'Sort images' }).selectOption('path');
  await page.getByRole('button', { name: 'Sort descending', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search images' }).fill('C.');
  await page.getByRole('combobox', { name: 'Filter file type' }).selectOption('png');
  await page.getByRole('textbox', { name: 'Include folders', exact: true }).fill('Nested');
  await page.getByRole('textbox', { name: 'Exclude folders', exact: true }).fill('Missing');
  await page.getByRole('button', { name: 'Filter by date and time', exact: true }).click();
  await page.getByLabel('Newer than', { exact: true }).fill('2000-01-01T00:00');
  await page.getByLabel('Older than', { exact: true }).fill('2099-01-01T00:00');
  await page.getByRole('button', { name: 'Details view', exact: true }).click();
}

async function expectFilters(page: Page) {
  await expect(page.getByRole('combobox', { name: 'Sort images' })).toHaveValue('path');
  await expect(page.getByRole('button', { name: 'Sort ascending', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Search images' })).toHaveValue('C.');
  await expect(page.getByRole('combobox', { name: 'Filter file type' })).toHaveValue('png');
  await expect(page.getByRole('textbox', { name: 'Include folders', exact: true })).toHaveValue('Nested');
  await expect(page.getByRole('textbox', { name: 'Exclude folders', exact: true })).toHaveValue('Missing');
  await expect(page.getByLabel('Newer than', { exact: true })).toHaveValue('2000-01-01T00:00');
  await expect(page.getByLabel('Older than', { exact: true })).toHaveValue('2099-01-01T00:00');
  await expect(page.locator('.library')).toHaveClass(/list/);
  await expect(page.locator('.image-card')).toHaveCount(1);
}

test('desktop restart and mobile reload restore each library and all browsing filters independently', async () => {
  const { profile, root } = await fixture();
  const other = path.join(profile, 'Other'); await fs.mkdir(other);
  await sharp({ create: { width: 50, height: 50, channels: 3, background: '#9955aa' } }).png().toFile(path.join(other, 'Other.png'));
  const env = { ...process.env, LUMEN_TEST_DATA: profile, LUMEN_TEST_SHARE_PORT: '47832' };
  let app = await electron.launch({ args: ['.', `--folder=${root}`], env });
  const browser = await chromium.launch();
  try {
    let desktop = await app.firstWindow();
    await expect(desktop.locator('.image-card')).toHaveCount(3);
    await desktop.locator('.tree-label').filter({ hasText: 'Nested' }).click();
    await desktop.getByRole('checkbox', { name: 'Include subfolders', exact: true }).uncheck();
    await desktop.getByRole('checkbox', { name: 'Include root folder', exact: true }).uncheck();
    await desktop.getByRole('checkbox', { name: 'Include Nested', exact: true }).check();
    await setFilters(desktop);
    await expectFilters(desktop);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    let mobile = await context.newPage(); await mobile.goto('http://127.0.0.1:47832');
    await expect(mobile.locator('.image-card')).toHaveCount(3); // Desktop filters don't leak.
    await setFilters(mobile);
    await mobile.reload(); await expectFilters(mobile);
    await mobile.close();
    await desktop.evaluate(async folder => { await window.lumen.openFolder(folder); }, other);
    await expect(desktop.locator('h1')).toContainText('All images');
    await desktop.getByRole('textbox', { name: 'Include folders', exact: true }).fill('');
    await expect(desktop.locator('.image-card')).toHaveCount(1);
    // Reopening mobile restores its remembered library even if the host moved.
    mobile = await context.newPage(); await mobile.goto('http://127.0.0.1:47832');
    await expectFilters(mobile);
    await expectFilters(desktop);
    await app.close();
    app = await electron.launch({ args: ['.'], env }); // No --folder on restart.
    desktop = await app.firstWindow();
    await expectFilters(desktop);
    await expect(desktop.locator('h1')).toContainText('Nested');
    await expect(desktop.getByRole('checkbox', { name: 'Include subfolders', exact: true })).not.toBeChecked();
    await expect(desktop.getByRole('checkbox', { name: 'Include Nested', exact: true })).toBeChecked();
    await mobile.reload(); await expectFilters(mobile);
    expect(JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8')).lastRoot).toBe(root);
  } finally { await browser.close(); await app.close(); }
});

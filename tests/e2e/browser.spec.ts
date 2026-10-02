import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const workspace = process.cwd();
const data = path.join(workspace, '.test-data');
const library = path.join(data, 'Library #日本語');
let app: ElectronApplication, page: Page;
const errors: string[] = [];

test.beforeAll(async () => {
  await fs.mkdir(path.join(library, 'Landscapes', 'Mountains'), { recursive: true });
  await fs.mkdir(path.join(library, 'Textures'), { recursive: true });
  await fs.mkdir(path.join(library, 'Empty'), { recursive: true });
  const names = ['Amethyst', 'Blue hour', 'Copper ridge', 'Desert light', 'Emerald coast', 'Forest mist', 'Golden valley', 'Horizon', 'Indigo dusk', 'Juniper'];
  for (let i = 0; i < 40; i++) {
    const color = ['#d5a58d', '#9186b9', '#709696', '#aaa073'][i % 4];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1200"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="#37344b"/></linearGradient></defs><rect width="1800" height="1200" fill="url(#sky)"/><circle cx="${400 + (i % 4) * 260}" cy="${250 + (i % 3) * 70}" r="120" fill="#efdbb9"/><path d="M0 950L480 ${300 + (i % 3) * 120}L980 950L1400 410L1800 870V1200H0Z" fill="#4a4c64"/><path d="M0 950L500 800L880 ${490 + (i % 4) * 40}L1800 1120V1200H0Z" fill="#262d41"/><path d="M0 1080Q500 940 900 1080T1800 1000V1200H0Z" fill="#171f32"/></svg>`;
    const folder = i < 4 ? library : i < 24 ? path.join(library, 'Landscapes') : path.join(library, 'Landscapes', 'Mountains');
    const image = sharp(Buffer.from(svg));
    if (i === 30) image.resize(1200, 1800); // A portrait for navigation across different aspect ratios.
    await image.jpeg({ quality: 80 }).toFile(path.join(folder, `${names[i % 10]} ${String(i).padStart(2, '0')}.jpg`));
  }
  const tile = await sharp({ create: { width: 60, height: 40, channels: 4, background: '#564279' } }).png().toBuffer();
  await Promise.all(Array.from({ length: 1600 }, (_, i) => fs.writeFile(path.join(library, 'Textures', `Texture ${String(i).padStart(4, '0')}.png`), tile)));
  await fs.writeFile(path.join(library, 'broken.png'), 'broken image');
  await sharp(tile).tiff().toFile(path.join(library, 'transparent.tiff'));
  app = await electron.launch({ args: ['.', `--folder=${library}`], cwd: workspace, env: { ...process.env, LUMEN_TEST_DATA: path.join(data, 'profile') } });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByText('1,642 images indexed', { exact: false })).toBeVisible();
});
test.afterAll(async () => { await app?.close(); });

test('virtual gallery, folder filtering, breadcrumbs, all views, and search', async () => {
  await page.getByRole('button', { name: 'Gallery view', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All images' })).toBeVisible();
  expect(await page.locator('.image-card').count()).toBeLessThan(100);
  await expect.poll(() => page.locator('.thumb img').evaluateAll(images => images.filter(img => (img as HTMLImageElement).naturalWidth > 0).length)).toBeGreaterThan(5);
  await page.screenshot({ path: 'test-results/gallery.png' });
  await page.locator('.tree-label').filter({ hasText: 'Landscapes' }).click();
  await expect(page.locator('h1')).toContainText('Landscapes36');
  await page.getByText('Include subfolders', { exact: true }).click();
  await expect(page.locator('h1')).toContainText('Landscapes20');
  await page.getByText('Include subfolders', { exact: true }).click();
  await page.getByRole('button', { name: 'Expand Landscapes' }).click();
  await page.locator('.tree-label').filter({ hasText: 'Mountains' }).click();
  await expect(page.locator('h1')).toContainText('Mountains16');
  await page.locator('.breadcrumb').getByRole('button', { name: 'Landscapes', exact: true }).click();
  await page.getByRole('button', { name: 'Details view', exact: true }).click();
  await expect(page.locator('.library')).toHaveClass(/list/);
  await page.screenshot({ path: 'test-results/details.png' });
  await page.getByRole('button', { name: 'Grouped by folder' }).click();
  await expect(page.locator('.group-heading').first()).toContainText('Landscapes20 images');
  await page.locator('.library').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(page.locator('.group-heading').filter({ hasText: 'Landscapes/Mountains' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Compact view' }).click();
  await expect(page.locator('.library')).toHaveClass(/compact/);
  await page.getByRole('button', { name: 'Gallery view', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search images' }).fill('Amethyst');
  await expect(page.locator('h1')).toContainText('Landscapes3');
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.locator('.all-images').click();
  await page.getByRole('combobox', { name: 'Filter file type' }).selectOption('tiff');
  await expect(page.locator('.image-card')).toHaveCount(1);
  await page.locator('.image-card').click();
  await expect(page.locator('.original-image')).toHaveJSProperty('naturalWidth', 60);
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: 'Filter file type' }).selectOption('all');
});

test('quick folder exclusions, nested include exceptions, navigation, and refresh', async () => {
  await page.locator('.tree-label').filter({ hasText: 'Landscapes' }).click();
  await page.getByRole('checkbox', { name: 'Include Landscapes/Mountains', exact: true }).uncheck();
  await expect(page.locator('h1')).toContainText('Landscapes20');
  await expect(page.getByRole('checkbox', { name: 'Include Landscapes', exact: true })).toHaveAttribute('aria-checked', 'mixed');
  await expect(page.locator('.folder-filter-banner')).toContainText('16 images hidden');
  await page.getByRole('button', { name: 'Details view', exact: true }).click();
  await expect(page.locator('.list-folder').filter({ hasText: 'Mountains' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh library', exact: true }).click();
  await expect(page.getByText('1,642 images indexed', { exact: false })).toBeVisible();
  await expect(page.locator('h1')).toContainText('Landscapes20');
  await expect(page.getByRole('checkbox', { name: 'Include Landscapes/Mountains', exact: true })).not.toBeChecked();
  // A mixed parent includes the whole branch on its next check.
  await page.getByRole('checkbox', { name: 'Include Landscapes', exact: true }).click();
  await expect(page.locator('h1')).toContainText('Landscapes36');
  await page.getByRole('checkbox', { name: 'Include Landscapes', exact: true }).uncheck();
  await expect(page.getByRole('heading', { name: 'No matching images' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Include Landscapes/Mountains', exact: true }).check();
  await expect(page.locator('h1')).toContainText('Landscapes16');
  await expect(page.getByRole('checkbox', { name: 'Include Landscapes', exact: true })).toHaveAttribute('aria-checked', 'mixed');
  await page.locator('.tree-label').filter({ hasText: 'Mountains' }).click();
  await expect(page.locator('h1')).toContainText('Mountains16');
  await page.locator('.all-images').click();
  await expect(page.locator('h1')).toContainText('All images1,622');
  await page.locator('.folder-filter-banner').getByRole('button', { name: 'Include all folders' }).click();
  await expect(page.locator('h1')).toContainText('All images1,642');
  await expect(page.locator('.folder-filter-banner')).toHaveCount(0);
  await page.getByRole('button', { name: 'Gallery view', exact: true }).click();
  await page.screenshot({ path: 'test-results/folder-controls.png' });
});

test('comma-separated folder include and exclude fields combine, survive refresh, and reset', async () => {
  const include = page.getByRole('textbox', { name: 'Include folders', exact: true });
  const exclude = page.getByRole('textbox', { name: 'Exclude folders', exact: true });
  await include.fill('Landscapes, Empty');
  await expect(page.locator('h1')).toContainText('All images36');
  await exclude.fill(' **/Mountains, Textures ');
  await expect(page.locator('h1')).toContainText('All images20');
  await exclude.fill(' **/Mountains, Textures, Empty ');
  await expect(page.getByRole('checkbox', { name: 'Include Empty', exact: true })).not.toBeChecked();
  await exclude.fill(' **/Mountains, Textures ');
  await expect(page.getByRole('checkbox', { name: 'Include Landscapes', exact: true })).toHaveAttribute('aria-checked', 'mixed');
  await page.getByRole('button', { name: 'Refresh library', exact: true }).click();
  await expect(page.getByText('1,642 images indexed', { exact: false })).toBeVisible();
  await expect(page.locator('h1')).toContainText('All images20');
  await page.screenshot({ path: 'test-results/folder-patterns.png' });
  await page.reload();
  await expect(include).toHaveValue('Landscapes, Empty');
  await expect(exclude).toHaveValue(' **/Mountains, Textures ');
  await expect(page.locator('h1')).toContainText('All images20');
  await page.getByRole('button', { name: 'Collapse controls', exact: true }).click();
  await expect(page.locator('.condensed-filters')).toHaveAttribute('title', /Include folders: Landscapes, Empty/);
  await page.getByRole('button', { name: 'Expand controls', exact: true }).click();
  await include.fill('Missing');
  await expect(page.getByRole('heading', { name: 'No matching images' })).toBeVisible();
  await page.locator('.folder-filter-banner').getByRole('button', { name: 'Include all folders' }).click();
  await expect(include).toHaveValue(''); await expect(exclude).toHaveValue('');
  await expect(page.locator('h1')).toContainText('All images1,642');
});

test('original image fit, 1:1, smooth wheel zoom, navigation, and details', async () => {
  await page.locator('.tree-label').filter({ hasText: 'Landscapes' }).click();
  await page.locator('.image-card').first().click();
  await expect(page.getByRole('dialog', { name: /Viewing/ })).toBeVisible();
  await expect(page.locator('.original-image')).toHaveJSProperty('naturalWidth', 1800);
  await expect(page.locator('.viewer-loading')).toHaveCount(0);
  const initialScale = Number((await page.locator('.zoom-value').innerText()).replace('%', ''));
  expect(initialScale).toBeGreaterThan(0); expect(initialScale).toBeLessThan(100);
  await page.getByRole('button', { name: '1:1', exact: true }).click();
  await expect(page.locator('.zoom-value')).toHaveText('100%');
  await expect.poll(async () => Math.round((await page.locator('.original-image').boundingBox())!.width)).toBe(1800);
  await page.locator('.viewer-image-layer:visible').dblclick();
  await expect(page.locator('.zoom-value')).toHaveText(`${initialScale}%`);
  await page.locator('.viewer-image-layer:visible').dblclick();
  await expect(page.locator('.zoom-value')).toHaveText('100%');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(async () => Number((await page.locator('.zoom-value').innerText()).replace('%', ''))).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect(page.locator('.zoom-value')).toHaveText(`${initialScale}%`);
  await page.locator('.viewer-stage').hover();
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => Number((await page.locator('.zoom-value').innerText()).replace('%', ''))).toBeGreaterThan(initialScale);
  const wheelScale = Number((await page.locator('.zoom-value').innerText()).replace('%', ''));
  expect(wheelScale / initialScale).toBeGreaterThan(1.08);
  expect(wheelScale / initialScale).toBeLessThan(1.16);
  await page.keyboard.press('1');
  await expect(page.locator('.zoom-value')).toHaveText('100%');
  await page.getByRole('button', { name: 'Nearest neighbor', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nearest neighbor', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.original-image')).toHaveCSS('image-rendering', 'auto');
  await page.locator('.viewer-stage').hover();
  await page.mouse.wheel(0, -120);
  await expect(page.locator('.zoom-value')).toHaveText('112%');
  const nearestRendering = await page.evaluate(() => CSS.supports('image-rendering', 'crisp-edges') ? 'crisp-edges' : 'pixelated');
  await expect(page.locator('.original-image')).toHaveCSS('image-rendering', nearestRendering);
  await page.keyboard.press('n');
  await expect(page.locator('.original-image')).toHaveCSS('image-rendering', 'auto');
  await page.keyboard.press('n');
  await page.keyboard.press('1');
  await expect(page.locator('.original-image')).toHaveCSS('image-rendering', 'auto');
  await page.mouse.wheel(0, 120);
  await expect(page.locator('.zoom-value')).toHaveText('88%');
  await expect(page.locator('.original-image')).toHaveCSS('image-rendering', 'auto');
  const before = await page.locator('.viewer-title strong').innerText();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.viewer-title strong')).not.toHaveText(before);
  await page.getByRole('button', { name: 'Image details', exact: true }).click();
  await expect(page.locator('.image-info')).toContainText('1,800 × 1,200');
  await page.getByRole('button', { name: 'Copy path', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Image path copied');
  await page.screenshot({ path: 'test-results/viewer.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.viewer')).toHaveCount(0);
  await page.locator('.image-card').first().click();
  await expect(page.getByRole('button', { name: 'Nearest neighbor', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('n');
  await page.keyboard.press('Escape');
});

test('mouse back and forward return to the last detail image, and small images toggle fit and 1:1', async () => {
  const command = (direction: 'backward' | 'forward') => app.evaluate(({ BrowserWindow }, value) => {
    BrowserWindow.getAllWindows()[0].emit('app-command', {}, `browser-${value}`);
  }, direction);
  await page.locator('.tree-label').filter({ hasText: 'Textures' }).click();
  await page.locator('.image-card').first().click();
  await expect(page.locator('.zoom-value')).toHaveText('100%');
  await page.locator('.viewer-image-layer:visible').dblclick();
  await expect.poll(async () => Number((await page.locator('.zoom-value').innerText()).replace('%', ''))).toBeGreaterThan(100);
  await expect.poll(async () => Math.round((await page.locator('.original-image').boundingBox())!.width)).toBeGreaterThan(60);
  // Wait for the animated fit to finish before toggling back.
  const fitPercent = await page.locator('.viewer-stage').evaluate(stage => Math.round(Math.min((stage.clientWidth - 80) / 60, (stage.clientHeight - 80) / 40) * 100));
  await expect(page.locator('.zoom-value')).toHaveText(`${fitPercent}%`);
  await page.locator('.viewer-image-layer:visible').dblclick();
  await expect(page.locator('.zoom-value')).toHaveText('100%');
  await expect.poll(async () => Math.round((await page.locator('.original-image').boundingBox())!.width)).toBe(60);
  await page.keyboard.press('ArrowRight');
  const name = await page.locator('.viewer-title strong').innerText();
  await command('forward');
  await expect(page.locator('.viewer-title strong')).toHaveText(name);
  await command('backward');
  await expect(page.locator('.viewer')).toHaveCount(0);
  await command('backward');
  await expect(page.locator('.viewer')).toHaveCount(0);
  await page.keyboard.press('ArrowRight'); // Collection selection can change independently.
  await command('forward');
  await expect(page.locator('.viewer-title strong')).toHaveText(name);
  await page.keyboard.press('Escape');
  await command('forward');
  await expect(page.locator('.viewer-title strong')).toHaveText(name);
  await command('backward');
  await page.locator('.tree-label').filter({ hasText: 'Landscapes' }).click();
  await command('forward');
  await expect(page.locator('.viewer')).toHaveCount(0);
});

test('side mouse buttons navigate on release without panning, while left drag still pans', async () => {
  await page.locator('.tree-label').filter({ hasText: 'Landscapes' }).click();
  await page.locator('.image-card').first().click();
  await expect(page.locator('.viewer-loading')).toHaveCount(0);
  const name = await page.locator('.viewer-title strong').innerText();
  const stage = (await page.locator('.viewer-stage').boundingBox())!;
  const x = stage.x + stage.width / 2, y = stage.y + stage.height / 2;
  const session = await page.context().newCDPSession(page);
  const transform = () => page.locator('.zoom-content:visible').evaluate(element => getComputedStyle(element).transform);
  const initial = await transform();
  for (const button of ['forward', 'back'] as const) {
    const buttons = button === 'back' ? 8 : 16;
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', button, buttons, x, y, clickCount: 1 });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', button, buttons, x: x + 80, y: y + 40 });
    await expect(page.locator('.viewer-title strong')).toHaveText(name);
    expect(await transform()).toBe(initial);
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button, buttons: 0, x: x + 80, y: y + 40, clickCount: 1 });
    await expect(page.locator('.viewer')).toHaveCount(button === 'back' ? 0 : 1);
  }
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'forward', buttons: 16, x, y, clickCount: 1 });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'forward', buttons: 0, x, y, clickCount: 1 });
  await expect(page.locator('.viewer-title strong')).toHaveText(name);
  await expect(page.locator('.original-image:visible')).toHaveCount(1);
  const beforeDrag = await transform();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 40, { steps: 4 });
  await page.mouse.up();
  expect(await transform()).not.toBe(beforeDrag);
  await session.detach();
  await page.keyboard.press('Escape');
});

test('image navigation retains the original through decoding and skips stale loads without blank frames', async () => {
  await page.locator('.tree-label').filter({ hasText: 'Landscapes' }).click();
  await page.locator('.image-card').first().click();
  const visibleImage = page.locator('.original-image:visible');
  await expect(visibleImage).toHaveCount(1);
  const firstSource = await visibleImage.getAttribute('src');
  await page.evaluate(() => {
    const originalDecode = HTMLImageElement.prototype.decode;
    const first = document.querySelector<HTMLImageElement>('.original-image')!;
    const gates = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
    const toolbar = document.querySelector('.zoom-toolbar')!.getBoundingClientRect();
    const samples = { frames: 0, blank: 0, translucent: 0, toolbarShift: 0 };
    let frame = 0;
    HTMLImageElement.prototype.decode = async function () {
      await originalDecode.call(this);
      if (this.src.startsWith('lumen://image/') && this.src !== first.src) {
        await new Promise<void>((resolve, reject) => { gates.set(this.src, { resolve, reject }); });
      }
    };
    const sample = () => {
      const stage = document.querySelector('.viewer-stage')!.getBoundingClientRect();
      const images = [...document.querySelectorAll<HTMLImageElement>('.original-image')].filter(image => {
        const box = image.getBoundingClientRect();
        return image.checkVisibility() && image.complete && image.naturalWidth > 0
          && box.right > stage.left && box.left < stage.right && box.bottom > stage.top && box.top < stage.bottom;
      });
      samples.frames++;
      const currentToolbar = document.querySelector('.zoom-toolbar')!.getBoundingClientRect();
      samples.toolbarShift = Math.max(samples.toolbarShift,
        ...(['x', 'y', 'width', 'height'] as const).map(key => Math.abs(currentToolbar[key] - toolbar[key])));
      if (!images.length) samples.blank++;
      if (images.some(image => getComputedStyle(image).opacity !== '1')) samples.translucent++;
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    Object.assign(window, { navigationProbe: { gates, samples, first, stop: () => {
      cancelAnimationFrame(frame);
      HTMLImageElement.prototype.decode = originalDecode;
    } } });
  });
  // Hold decoding long enough to observe the previously fitted image across frames.
  await page.getByRole('button', { name: 'Next image', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).navigationProbe.gates.size)).toBe(1);
  const secondSource = await page.locator('.original-image').last().getAttribute('src');
  await expect(visibleImage).toHaveAttribute('src', firstSource!);
  expect(await visibleImage.evaluate(image => image === (window as any).navigationProbe.first)).toBe(true);
  // Skip the pending image, then simulate its decode failing after it was unmounted.
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => (window as any).navigationProbe.gates.size)).toBe(2);
  const thirdSource = await page.locator('.original-image').last().getAttribute('src');
  await page.evaluate(source => {
    const gates = (window as any).navigationProbe.gates;
    gates.get(source).reject(new Error('Stale decode'));
    gates.delete(source);
  }, secondSource);
  await expect(visibleImage).toHaveAttribute('src', firstSource!);
  await expect(page.locator('.viewer-error')).toHaveCount(0);
  await page.evaluate(source => {
    const gates = (window as any).navigationProbe.gates;
    gates.get(source).resolve(); gates.delete(source);
  }, thirdSource);
  await expect(visibleImage).toHaveAttribute('src', thirdSource!);
  await expect(page.locator('.original-image')).toHaveCount(1);
  await expect(visibleImage).toHaveJSProperty('naturalWidth', 1200);
  const fittedBox = await visibleImage.boundingBox(), stageBox = await page.locator('.viewer-stage').boundingBox();
  expect(fittedBox!.height).toBeCloseTo(stageBox!.height - 80, 0);
  expect(fittedBox!.x + fittedBox!.width / 2).toBeCloseTo(stageBox!.x + stageBox!.width / 2, 0);
  expect(Number((await page.locator('.zoom-value').innerText()).replace('%', ''))).toBeLessThan(100);
  // Previous navigation and a cached image use the same seamless handoff.
  await page.getByRole('button', { name: 'Previous image', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).navigationProbe.gates.size)).toBe(1);
  await expect(visibleImage).toHaveAttribute('src', thirdSource!);
  await page.evaluate(source => {
    const gates = (window as any).navigationProbe.gates;
    gates.get(source).resolve(); gates.delete(source);
  }, secondSource);
  await expect(visibleImage).toHaveAttribute('src', secondSource!);
  await page.keyboard.press('ArrowLeft');
  await expect(visibleImage).toHaveAttribute('src', firstSource!);
  const samples = await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const probe = (window as any).navigationProbe;
    probe.stop(); delete (window as any).navigationProbe;
    return probe.samples;
  });
  expect(samples.frames).toBeGreaterThan(5);
  expect(samples.blank).toBe(0);
  expect(samples.translucent).toBe(0);
  expect(samples.toolbarShift).toBeLessThan(0.5);
  await page.keyboard.press('Escape');
});

test('corrupt files, refresh reconciliation, narrow layout, and recent folders', async () => {
  await page.locator('.all-images').click();
  await page.getByRole('textbox', { name: 'Search images' }).fill('broken.png');
  await expect(page.locator('.failed-thumb')).toBeVisible();
  await page.locator('.image-card').click();
  await expect(page.getByRole('heading', { name: 'Unable to display this image' })).toBeVisible();
  await page.keyboard.press('Escape');
  await fs.unlink(path.join(library, 'broken.png'));
  await page.getByRole('button', { name: 'Refresh library', exact: true }).click();
  await expect(page.getByText('1,641 images indexed', { exact: false })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search images' }).fill('broken.png');
  await expect(page.getByRole('heading', { name: 'No matching images' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600));
  await expect(page.getByRole('button', { name: 'Gallery view' })).toBeVisible();
  await page.screenshot({ path: 'test-results/narrow.png' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

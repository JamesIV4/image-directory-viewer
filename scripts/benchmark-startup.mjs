import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';

// Time a fully rendered, usable window, including the portable launcher's extraction.
// Each run starts a new process with the same disposable profile (not the user's).
const executable = path.resolve(process.argv[2] || 'release/Lumen-1.0.0-x64.exe');
const runs = Number(process.argv[3] || 5);
const output = process.argv[4];
if (!Number.isInteger(runs) || runs < 1) throw new Error('Run count must be a positive integer.');
const profile = path.resolve('.test-data/startup-profile');
await fs.mkdir(profile, { recursive: true });
const results = [];
for (let run = 0; run < runs; run++) {
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
  const started = performance.now();
  const child = spawn(executable, [`--remote-debugging-port=${port}`], {
    env: { ...process.env, LUMEN_TEST_DATA: profile }, stdio: 'ignore', windowsHide: true,
  });
  let launchError;
  child.on('error', error => { launchError = error; });
  const exited = new Promise(resolve => child.once('exit', resolve));
  let browser;
  try {
    let listening = false;
    while (performance.now() - started < 30000) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`EXE exited with ${child.exitCode} before startup.`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(100) });
        if (response.ok) { listening = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (!listening) throw new Error('Timed out waiting for Electron.');
    const debugReadyMs = Math.round(performance.now() - started);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.waitForEvent('page');
    await page.getByRole('button', { name: 'Open an image folder', exact: true }).waitFor({ state: 'visible', timeout: 30000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const readyMs = Math.round(performance.now() - started);
    results.push({ run: run + 1, debugReadyMs, readyMs });
    console.log(`Run ${run + 1}: Electron ${debugReadyMs} ms, usable UI ${readyMs} ms`);
    await page.close();
    let exitTimeout;
    try {
      await Promise.race([exited, new Promise((_, reject) => { exitTimeout = setTimeout(() => reject(new Error('EXE did not exit after window close.')), 15000); })]);
    } finally { clearTimeout(exitTimeout); }
  } finally {
    await browser?.close();
    if (child.pid && child.exitCode === null) {
      // Terminate only this benchmark's process tree if a failed run leaves it open.
      await new Promise(resolve => spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true }).once('exit', resolve));
    }
  }
}
const sorted = results.map(result => result.readyMs).sort((a, b) => a - b);
const median = values => Math.round((values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2);
const subsequent = results.slice(1).map(result => result.readyMs).sort((a, b) => a - b);
const report = { executable, measuredAt: new Date().toISOString(), metric: 'spawn to visible Open an image folder button plus two animation frames; includes CDP observation overhead; OS disk cache not flushed', results, medianMs: median(sorted), firstRunMs: results[0].readyMs, subsequentMedianMs: subsequent.length ? median(subsequent) : null };
if (output) await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Median usable UI: ${report.medianMs} ms`);
if (subsequent.length) console.log(`Subsequent launches: median ${report.subsequentMedianMs} ms`);

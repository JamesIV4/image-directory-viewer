const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { preparePackageVersion } = require('../scripts/package.cjs');

test('packaging increments patch once per commit and keeps manifest and lockfile versions synchronized', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumen-version-'));
  const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' });
  try {
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ version: '1.2.9' }));
    await fs.writeFile(path.join(directory, 'package-lock.json'), JSON.stringify({ version: '1.2.9', packages: { '': { version: '1.2.9' } } }));
    git('init'); git('config', 'user.name', 'Lumen Test'); git('config', 'user.email', 'lumen@example.invalid');
    git('add', 'package.json', 'package-lock.json'); git('commit', '-m', 'Initial');
    assert.equal(await preparePackageVersion(directory), '1.2.10');
    assert.equal(await preparePackageVersion(directory), '1.2.10');
    // Uncommitted source changes and switching between dist/pack keep the version.
    await fs.writeFile(path.join(directory, 'new.txt'), 'change');
    assert.equal(await preparePackageVersion(directory), '1.2.10');
    git('add', 'new.txt'); git('commit', '-m', 'New source');
    assert.equal(await preparePackageVersion(directory), '1.2.11');
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    const lock = JSON.parse(await fs.readFile(path.join(directory, 'package-lock.json'), 'utf8'));
    assert.equal(manifest.version, '1.2.11');
    assert.equal(lock.version, manifest.version);
    assert.equal(lock.packages[''].version, manifest.version);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

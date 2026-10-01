const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

async function preparePackageVersion(directory) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim();
  const manifestPath = path.join(directory, 'package.json');
  const lockPath = path.join(directory, 'package-lock.json');
  const statePath = path.join(directory, '.packaged-build.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  let previous;
  try { previous = JSON.parse(await fs.readFile(statePath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous?.commit === commit) {
    if (manifest.version !== previous.version) throw new Error(`This commit was already packaged as ${previous.version}; restore that version or make a new commit before packaging.`);
    console.log(`Reusing version ${manifest.version} for commit ${commit.slice(0, 8)}.`);
    return manifest.version;
  }
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(manifest.version);
  if (!match) throw new Error(`Expected a major.minor.patch version, received ${manifest.version}.`);
  const version = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
  const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  manifest.version = lock.version = lock.packages[''].version = version;
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  await fs.writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
  // Reserve the version before packaging so failed attempts also reuse it.
  await fs.writeFile(statePath, JSON.stringify({ commit, version }, null, 2) + '\n');
  console.log(`Packaging version ${version} for commit ${commit.slice(0, 8)}.`);
  return version;
}

async function main() {
  const directory = path.join(__dirname, '..');
  const target = process.argv[2];
  if (target !== 'dist' && target !== 'pack') throw new Error('Usage: node scripts/package.cjs <dist|pack>');
  // npm provides its CLI path on Windows too, avoiding shell-dependent quoting.
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Run packaging through npm run dist or npm run pack.');
  const compilation = spawnSync(process.execPath, [npmCli, 'run', 'build'], { cwd: directory, stdio: 'inherit' });
  if (compilation.error) throw compilation.error;
  if (compilation.status !== 0) process.exit(compilation.status || 1);
  await preparePackageVersion(directory);
  if (target === 'dist') {
    const packaged = spawnSync(process.execPath, [path.join(__dirname, 'dist.cjs'), ...process.argv.slice(3)], { cwd: directory, stdio: 'inherit' });
    if (packaged.error) throw packaged.error;
    if (packaged.status !== 0) process.exit(packaged.status || 1);
  } else {
    const { build, Platform, Arch } = require('electron-builder');
    await build({ targets: Platform.WINDOWS.createTarget(['dir'], Arch.x64), publish: 'never' });
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { preparePackageVersion };

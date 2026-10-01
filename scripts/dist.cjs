const fs = require('node:fs/promises');
const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');
const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget');

// electron-builder 26 has no custom-script hook for the portable target. Adapt
// its template in memory, leaving dependencies untouched. Fail on template drift
// so a builder upgrade cannot silently revert to extracting on every launch.
const original = NsisTarget.prototype.computeFinalScript;
NsisTarget.prototype.computeFinalScript = async function (script, ...args) {
  if (this.name === 'portable') {
    if (this.options.unpackDirName !== undefined) throw new Error('Runtime caching requires a unique, automatically generated directory for each build.');
    script = script.replace(/\r\n/g, '\n');
    const replace = (before, after) => {
      if (script.split(before).length !== 2) throw new Error(`Portable NSIS template changed at ${JSON.stringify(before)}; review scripts/dist.cjs before packaging.`);
      script = script.replace(before, after);
    };
    replace('StrCpy $INSTDIR "$TEMP\\${UNPACK_DIR_NAME}"', 'StrCpy $INSTDIR "$LOCALAPPDATA\\Lumen\\runtime\\${UNPACK_DIR_NAME}"');
    replace('  RMDir /r $INSTDIR\n  SetOutPath $INSTDIR', await fs.readFile(path.join(__dirname, 'portable-cache-start.nsh'), 'utf8'));
    const environment = `  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'`;
    replace(environment, (await fs.readFile(path.join(__dirname, 'portable-cache-end.nsh'), 'utf8')) + '\n' + environment);
    replace('\tRMDir /r $INSTDIR', '  # Keep this build-specific runtime for subsequent launches.');
  }
  return original.call(this, script, ...args);
};

build({ targets: Platform.WINDOWS.createTarget(['portable'], Arch.x64), publish: process.argv.includes('--publish') ? process.argv[process.argv.indexOf('--publish') + 1] : 'never' })
  .then(async artifacts => {
    const crypto = require('node:crypto');
    for (const file of artifacts.filter(file => file.endsWith('.exe'))) {
      const hash = crypto.createHash('sha256');
      for await (const chunk of require('node:fs').createReadStream(file)) hash.update(chunk);
      await fs.writeFile(`${file}.sha256`, `${hash.digest('hex')}  ${path.basename(file)}\n`);
    }
  }).catch(error => { console.error(error); process.exit(1); });

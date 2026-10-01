# Windows startup measurements

Measured locally on October 1, 2026, using the packaged Windows x64 EXE. Each run started a new process with an isolated test profile. Timing starts before spawning the EXE and ends after the **Open an image folder** button is visible and two animation frames complete. This includes automation connection overhead and measures the usable welcome screen, rather than just process creation. Image-folder scanning and decoding are separate operations.

| Package | First measured launch | Subsequent launches | Subsequent median |
| --- | ---: | ---: | ---: |
| Previous portable EXE | 16,708 ms | 16,510 / 16,352 ms | 16,431 ms |
| Previous unpacked app | 1,297 ms | 265 / 262 ms | 264 ms |
| Updated portable EXE | 4,676 ms | 320 / 315 / 327 / 313 / 308 ms | **315 ms** |

The previous portable EXE's median across all three runs was 16,510 ms. The updated package's first measured launch had no extracted cache for that build. Repeat launches reused the runtime cache; the Windows filesystem cache was **not flushed**. These figures do not establish startup times immediately after reboot, on slower disks, or under other antivirus configurations.

## Changes

- Keep the extracted runtime in `%LOCALAPPDATA%\Lumen\runtime\<build-id>` instead of extracting and deleting it on every launch. Each packaging run gets a new ID, including rebuilds with the same application version. Different builds never reuse each other's runtime.
- Serialize extraction with a Windows mutex. Write a completion marker only after successful extraction. An interrupted extraction is retried on the next launch. Closing one window leaves other windows' runtime files intact.
- Use ZIP compression for faster first extraction. The EXE grew from 107,461,978 to 170,246,156 bytes (about 102.5 to 162.4 MiB). Each extracted build also occupies disk space in the runtime cache; close Lumen before removing old cached builds.
- Load Sharp only when an image needs decoding or metadata, rather than when the app starts.
- Run thumbnail housekeeping in a worker after the window opens. Stop that worker before the first image request, preserving the separation between deletion and serving cached images. Temporary files and entries newer than cleanup's cutoff are excluded.

## Reproduce

```powershell
npm.cmd run dist -- --publish never
npm.cmd run benchmark:startup -- release/Lumen-1.0.0-x64.exe 6 .test-data/startup.json
```

A newly built EXE uses a fresh runtime-cache ID, so its first launch measures extraction. A benchmark of an already launched build measures cached launches throughout. The script prints the first run, every sample, and the median of subsequent runs. It opens and closes real windows with a disposable profile in `.test-data/startup-profile`.

Use `npm.cmd run dist` for this launcher. The installed electron-builder 26.15.3 portable target has no custom-script hook, so `scripts/dist.cjs` adapts its NSIS template in memory. It validates each replacement and fails the build if the template changes; dependencies on disk are untouched. Review this integration when upgrading electron-builder. Overriding `portable.unpackDirName` is rejected because cache isolation requires a fresh ID per build.

## Verification

- Production build and packaging completed, with the generated EXE checksum verified.
- All eight backend tests and five real Electron UI tests passed.
- The actual portable EXE opened two simultaneous cached instances without re-extraction or deleting their runtime on exit.
- Two simultaneous launches recovered an incomplete cache and restored the completion marker, confirming extraction locking and recovery.
- Packaged PNG/TIFF thumbnails, TIFF original conversion, native metadata, and `--folder` argument forwarding worked in both instances.

The [raw measurement record](startup-measurements.json) contains the samples and final package hash.

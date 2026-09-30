# README screenshots

These are captures of the running Electron app with a small landscape collection. The UI is unmodified. The captures are encoded as WebP to keep the four images below 1 MB combined.

## Capture again

From the repository root, with dependencies installed:

```powershell
npm.cmd run build
node docs/capture-screenshots.mjs
```

The script downloads the 15 photos listed in [photos.json](photos.json) into the ignored `.test-data/readme/Field Notes/` directory. Downloads are reused on subsequent runs. It assigns stable file modification dates for the timeline demo and launches the app with a fresh, separate profile under `.test-data/readme/`. The user's library and preferences are unaffected.

It captures the gallery, condensed controls, folder groups with the Alpine branch excluded and date controls expanded, and an original image with its details panel. Each capture waits for thumbnails and originals to load. The window is 1600 × 1080, or 1600 × 900 for the condensed view. The demo originals and app caches are not committed.

## Photo credits

The display names below are descriptive names used for the demo files. Photographs are from [Unsplash](https://unsplash.com) and used under the [Unsplash License](https://unsplash.com/license).

| Demo image | Photographer / original |
| --- | --- |
| Alpine glow | [Tomasz Smal](https://unsplash.com/photos/_HJNQCoXVkU) |
| Amber sands | [Dylan Jenkinson](https://unsplash.com/photos/NZy-F0JNbXc) |
| Blue hour | [Caleb Riston](https://unsplash.com/photos/TXiBwX0kg-Q) |
| Copper dunes | [Zetong Li](https://unsplash.com/photos/HEf0fKgJA1Q) |
| Emerald lake | [Deep Doshi](https://unsplash.com/photos/FGzU-xqz1rw) |
| Golden ridges | [Ivana Cajina](https://unsplash.com/photos/dQejX2ucPBs) |
| High country | [Hendrik Kespohl](https://unsplash.com/photos/1YQDhLtB9yU) |
| Indigo valley | [Paul Pastourmatzis](https://unsplash.com/photos/0drQ2vSQyv4) |
| Light and shadow | [Tim Arterbury](https://unsplash.com/photos/hoT_2bL5LxU) |
| Mountain light | [Nitish Meena](https://unsplash.com/photos/RbbdzZBKRDY) |
| Quiet summit | [Erika](https://unsplash.com/photos/U6GYjO-9jBM) |
| Rose horizon | [David Mullins](https://unsplash.com/photos/3Jnws1iRSwk) |
| Sand and sky | [Emma Van Sant](https://unsplash.com/photos/GkIGSLW04Nc) |
| Sunlit peaks | [Daniel Seßler](https://unsplash.com/photos/Z5TV7ylXLrI) |
| Wild dunes | [Christian Weiss](https://unsplash.com/photos/r8eL7SY3lHA) |

import fs from 'node:fs/promises';
import sharp from 'sharp';
for (const destination of ['dist-pwa', 'dist/remote']) {
  await fs.mkdir(destination, { recursive: true });
  await fs.cp('pwa', destination, { recursive: true });
  for (const size of [192, 512]) await sharp('assets/icon.png').resize(size, size).png().toFile(`${destination}/icon-${size}.png`);
}

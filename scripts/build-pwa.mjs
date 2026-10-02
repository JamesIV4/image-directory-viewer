import fs from 'node:fs/promises';
import sharp from 'sharp';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import crypto from 'node:crypto';
await build({ configFile: false, root: 'pwa', base: './', plugins: [react()], build: { outDir: '../dist-pwa', emptyOutDir: true } });
const assets = (await fs.readdir('dist-pwa/assets')).filter(name => /\.(js|css)$/.test(name));
const html = (await fs.readFile('dist-pwa/index.html', 'utf8')).replace(/\.\/assets\/manifest-[^" ]+\.webmanifest/, './manifest.webmanifest');
await fs.writeFile('dist-pwa/index.html', html);
const shell = ['index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', ...assets.map(name => `assets/${name}`)];
const version = crypto.createHash('sha256').update(assets.join(',')).digest('hex').slice(0, 12);
const worker = (await fs.readFile('pwa/sw.js', 'utf8')).replace("'lumen-shell-v1'", JSON.stringify(`lumen-shell-${version}`)).replace(/const SHELL = .*;/, `const SHELL = ${JSON.stringify(shell.map(name => './' + name))};`);
await fs.writeFile('dist-pwa/sw.js', worker);
for (const name of ['manifest.webmanifest']) await fs.copyFile(`pwa/${name}`, `dist-pwa/${name}`);
for (const destination of ['dist-pwa', 'dist/remote']) {
  await fs.mkdir(destination, { recursive: true });
  if (destination !== 'dist-pwa') await fs.cp('dist-pwa', destination, { recursive: true });
  for (const size of [192, 512]) await sharp('assets/icon.png').resize(size, size).png().toFile(`${destination}/icon-${size}.png`);
}

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

async function main() {
  const assets = path.join(__dirname, '..', 'assets');
  const source = await fs.readFile(path.join(assets, 'icon.svg'));
  await sharp(source).png().toFile(path.join(assets, 'icon.png'));

  // PNG-backed ICO entries cover Windows title bars, taskbars, and Explorer.
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const images = await Promise.all(sizes.map(size => sharp(source).resize(size, size).png().toBuffer()));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2); // ICO, rather than a cursor.
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    header[entry] = sizes[index] % 256; // Zero represents 256 pixels.
    header[entry + 1] = sizes[index] % 256;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  await fs.writeFile(path.join(assets, 'icon.ico'), Buffer.concat([header, ...images]));
  console.log('Generated assets/icon.png and assets/icon.ico from assets/icon.svg');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

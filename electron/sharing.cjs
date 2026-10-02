const http = require('node:http');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const PAGE_ORIGIN = 'https://jamesiv4.github.io';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp' };
class SharingService {
  constructor({ state, indexed, service, beforeImages, staticDir }) {
    Object.assign(this, { state, indexed, service, beforeImages, staticDir });
  }
  status() {
    const port = this.server?.address()?.port;
    const addresses = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => `http://${i.address}:${port}`);
    return { active: !!port, token: port ? this.token : '', addresses: port ? [...new Set(addresses)] : [], port };
  }
  async start(port = 47831, host = '0.0.0.0') {
    if (this.server) return this.status();
    this.token = crypto.randomBytes(24).toString('hex');
    const server = http.createServer((req, res) => this.handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(404, { 'Cache-Control': 'no-store' });
      res.end('Resource unavailable');
    }));
    server.requestTimeout = 30000; server.headersTimeout = 10000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    this.server = server;
    return this.status();
  }
  async stop() {
    const server = this.server; this.server = null; this.token = '';
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    return this.status();
  }
  async handle(req, res) {
    // Reject DNS rebinding; accept only IP literal hosts or localhost.
    const host = new URL(`http://${req.headers.host}`).hostname;
    if (!require('node:net').isIP(host) && host !== 'localhost') { res.writeHead(403); return res.end(); }
    const origin = req.headers.origin;
    const allowed = !origin || origin === PAGE_ORIGIN || origin === `http://${req.headers.host}`;
    if (!allowed) { res.writeHead(403); return res.end(); }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Authorization', 'Access-Control-Allow-Private-Network': 'true' }); return res.end();
    }
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!['index.html', 'app.js', 'style.css', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'].includes(name)) { res.writeHead(404); return res.end(); }
      const file = path.join(this.staticDir, name);
      res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
      return res.end(await fs.readFile(file));
    }
    const supplied = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${this.token}`);
    if (!this.token || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) { res.writeHead(401); return res.end('Pairing key required'); }
    if (url.pathname === '/api/library') {
      const state = this.state();
      const q = (url.searchParams.get('q') || '').toLowerCase(), folder = url.searchParams.get('folder') || '';
      const all = (state.snapshot?.items || []).filter(i => (!folder || i.folder === folder || i.folder.startsWith(folder + '/')) && i.relativePath.toLowerCase().includes(q)).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      const items = all.slice(offset, offset + 100).map(({ path: _path, ...item }) => item);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ name: path.basename(state.root), generation: state.generation, scanning: state.scanning, total: all.length, items, folders: state.snapshot?.folders || [] }));
    }
    const match = /^\/api\/(thumb|image)\/([a-f0-9]+)$/.exec(url.pathname);
    if (!match) { res.writeHead(404); return res.end(); }
    const item = this.indexed(match[2]);
    const state = this.state(), actual = await fs.realpath(item.path), root = await fs.realpath(state.root);
    const relative = path.relative(root, actual);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) { res.writeHead(403); return res.end(); }
    await this.beforeImages();
    const safeItem = { ...item, path: actual };
    const file = match[1] === 'thumb' ? await this.service.thumbnail(safeItem) : await this.service.full(safeItem);
    if (state.generation !== this.state().generation) { res.writeHead(409); return res.end('Library changed'); }
    res.setHeader('Content-Type', mime[path.extname(file).toLowerCase()] || 'application/octet-stream');
    await pipeline(createReadStream(file), res);
  }
}
module.exports = { SharingService };

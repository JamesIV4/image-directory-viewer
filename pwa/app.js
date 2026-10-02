const $ = id => document.getElementById(id);
let base = '', token = '', items = [], selected = 0, generation, version = 0, controller = new AbortController();
let automatic = true, connectionAttempt = 0, reconnectTimer, recovering = false;
const blobs = new Set();
function clearFull() { const url = $('full').getAttribute('src'); if (url?.startsWith('blob:')) { URL.revokeObjectURL(url); blobs.delete(url); } $('full').removeAttribute('src'); }
const message = text => { $('status').textContent = text; };
const failure = error => { if (error.name !== 'AbortError') message(error.message || 'Connection lost. Check that Lumen is running and sharing is enabled.'); };
async function request(route) {
  const response = await fetch(base + route, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: 'no-store' });
  if (!response.ok) throw new Error(response.status === 401 ? 'Pairing key rejected. Copy the current key from Lumen on your PC.' : 'Image or library unavailable. Refresh the collection.');
  return response;
}
function release() { controller.abort(); controller = new AbortController(); version++; for (const url of blobs) URL.revokeObjectURL(url); blobs.clear(); }
async function image(id, kind, element, current) {
  try {
    const response = await request(`/api/${kind}/${id}`), blob = await response.blob();
    if (current !== version || !element.isConnected || element.dataset.id !== id) return;
    const url = URL.createObjectURL(blob); blobs.add(url); element.src = url;
  } catch (error) { if (error.name !== 'AbortError') { element.alt = 'Image unavailable'; if (kind === 'image') failure(error); } }
}
const observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); void image(entry.target.dataset.id, 'thumb', entry.target, version); } }, { rootMargin: '300px' });
async function load(append = false) {
  if (!append) { release(); observer.disconnect(); $('viewer').close(); }
  const current = version;
  $('more').disabled = true; $('refresh').disabled = true;
  try {
    const params = new URLSearchParams({ q: $('search').value, folder: $('folder').value, offset: String(append ? items.length : 0) });
    const data = await (await request(`/api/library?${params}`)).json();
    if (current !== version) return;
    if (append && generation !== data.generation) return load();
    generation = data.generation;
    if (!append) { items = []; $('gallery').replaceChildren(); }
    $('library-name').textContent = data.name || 'Choose a folder on your PC';
    const previous = $('folder').value;
    $('folder').replaceChildren(new Option('All folders', ''), ...data.folders.filter(folder => folder.path).map(folder => new Option(folder.path, folder.path)));
    $('folder').value = previous;
    for (const item of data.items) {
      const index = items.length; items.push(item);
      const card = document.createElement('button'); card.className = 'card'; card.title = item.relativePath;
      const img = document.createElement('img'); img.alt = item.name; img.dataset.id = item.id;
      const name = document.createElement('span'); name.textContent = item.name;
      card.append(img, name); card.onclick = () => { void view(index); }; $('gallery').append(card); observer.observe(img);
    }
    $('count').textContent = `${data.total.toLocaleString()} images${data.scanning ? ' · PC is indexing…' : ''}`;
    $('more').hidden = items.length >= data.total;
    $('connect').hidden = true; $('collection').hidden = false; $('disconnect').hidden = false;
    message('');
    try { localStorage.setItem('lumen.remote', JSON.stringify({ base, token })); sessionStorage.removeItem('lumen.remote'); } catch { /* Storage may be disabled; the live connection still works. */ }
  } catch (error) {
    if (current === version && error.name !== 'AbortError') recovering = true;
    if (error instanceof TypeError) message('Cannot reach your PC. Check the address, Wi-Fi, sharing and Windows firewall. Allow local-network access in Chrome/Edge. If blocked, open the PC address directly.');
    else failure(error);
    throw error;
  } finally { if (current === version) { $('more').disabled = false; $('refresh').disabled = false; } }
}
async function view(index) {
  selected = index; const item = items[index]; if (!item) return;
  $('image-name').textContent = item.name; $('image-detail').textContent = `${item.relativePath} · ${(item.size / 1024).toFixed(0)} KB`;
  clearFull(); $('full').alt = 'Loading image…'; $('full').dataset.id = item.id;
  $('previous').disabled = index === 0; $('next').disabled = index === items.length - 1;
  if (!$('viewer').open) $('viewer').showModal();
  await image(item.id, 'image', $('full'), version);
}
$('address').value = location.protocol === 'http:' ? location.origin : '';
try {
  const saved = JSON.parse(localStorage.getItem('lumen.remote') || sessionStorage.getItem('lumen.remote'));
  if (saved && typeof saved.base === 'string' && /^[a-z0-9]{5}$/i.test(saved.token)) { $('address').value = saved.base; $('key').value = saved.token; }
} catch { /* Start unpaired if saved data or browser storage is unavailable. */ }
async function discover(address) {
  const response = await fetch(address + '/api/discover', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('Lumen unavailable');
  const data = await response.json();
  if (data.service !== 'lumen' || data.version !== 1 || !/^[A-Z0-9]{5}$/.test(data.token)) throw new Error('Lumen unavailable');
  return data.token;
}
async function findLumen() {
  if (!automatic) return;
  const attempt = ++connectionAttempt;
  try {
    // Keep an active connection; rediscover when the PC goes away or changes address.
    if (!$('collection').hidden) {
      try {
        const key = await discover(base);
        if (!automatic || attempt !== connectionAttempt) return;
        if (recovering || key !== token) { token = key; $('key').value = key; await load(); recovering = false; }
        return;
      } catch {
        if (!automatic || attempt !== connectionAttempt) return;
        recovering = true;
        message('Connection lost. Looking for Lumen on your network…');
      }
    } else message('Looking for Lumen on your network…');
    const candidates = [...new Set([base, $('address').value, 'http://lumen.local:47831', 'http://127.0.0.1:47831'].filter(Boolean))];
    for (const address of candidates) {
      try {
        const key = await discover(address);
        if (!automatic || attempt !== connectionAttempt) return;
        base = address; token = key;
        $('address').value = base; $('key').value = token;
        await load();
        recovering = false;
        return;
      } catch { if (!automatic || attempt !== connectionAttempt) return; }
    }
    message('Looking for Lumen. Keep your PC on the same Wi-Fi with sharing enabled and allow local-network access. You can also enter the PC address below.');
  } finally {
    if (automatic && attempt === connectionAttempt) reconnectTimer = setTimeout(() => void findLumen(), 5000);
  }
}
$('find').onclick = () => { automatic = true; connectionAttempt++; clearTimeout(reconnectTimer); void findLumen(); };
$('pair').onsubmit = async event => {
  event.preventDefault();
  automatic = false; connectionAttempt++; clearTimeout(reconnectTimer);
  try {
    const url = new URL($('address').value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Enter just the PC address, for example http://192.168.1.10:47831.');
    base = url.origin; token = $('key').value.trim().toUpperCase(); message('Connecting…');
    if (!token) { token = await discover(base); $('key').value = token; }
    await load();
    automatic = true; reconnectTimer = setTimeout(() => void findLumen(), 5000);
  } catch (error) { if (!(error instanceof TypeError)) failure(error); }
};
$('refresh').onclick = () => { void load().catch(() => {}); };
$('more').onclick = () => { void load(true).catch(() => {}); };
let searchTimer;
$('search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { void load().catch(() => {}); }, 250); };
$('folder').onchange = () => { void load().catch(() => {}); };
$('disconnect').onclick = () => { automatic = false; connectionAttempt++; clearTimeout(reconnectTimer); clearTimeout(searchTimer); release(); observer.disconnect(); base = ''; token = ''; items = []; try { localStorage.removeItem('lumen.remote'); sessionStorage.removeItem('lumen.remote'); } catch {} $('key').value = ''; $('gallery').replaceChildren(); $('collection').hidden = true; $('connect').hidden = false; $('disconnect').hidden = true; message('Disconnected.'); };
$('close').onclick = () => $('viewer').close();
$('viewer').addEventListener('close', () => { clearFull(); $('full').dataset.id = ''; });
$('previous').onclick = () => { void view(selected - 1); }; $('next').onclick = () => { void view(selected + 1); };
document.addEventListener('keydown', event => { if (!$('viewer').open) return; if (event.key === 'ArrowLeft' && selected > 0) void view(selected - 1); if (event.key === 'ArrowRight' && selected < items.length - 1) void view(selected + 1); });
let installPrompt;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('install').hidden = false; });
$('install').onclick = async () => { await installPrompt?.prompt(); $('install').hidden = true; };
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./sw.js').catch(() => {});

void findLumen();

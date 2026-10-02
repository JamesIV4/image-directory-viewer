const $ = id => document.getElementById(id);
let base = '', token = '', items = [], selected = 0, generation, version = 0, controller = new AbortController();
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
    message(''); sessionStorage.setItem('lumen.remote', JSON.stringify({ base, token }));
  } catch (error) {
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
try { const saved = JSON.parse(sessionStorage.getItem('lumen.remote')); if (saved) { $('address').value = saved.base; $('key').value = saved.token; } } catch { /* A fresh session starts unpaired. */ }
$('pair').onsubmit = async event => {
  event.preventDefault();
  try {
    const url = new URL($('address').value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Enter just the PC address, for example http://192.168.1.10:47831.');
    base = url.origin; token = $('key').value.trim(); message('Connecting…'); await load();
  } catch (error) { if (!(error instanceof TypeError)) failure(error); }
};
$('refresh').onclick = () => { void load().catch(() => {}); };
$('more').onclick = () => { void load(true).catch(() => {}); };
let searchTimer;
$('search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { void load().catch(() => {}); }, 250); };
$('folder').onchange = () => { void load().catch(() => {}); };
$('disconnect').onclick = () => { clearTimeout(searchTimer); release(); observer.disconnect(); token = ''; items = []; sessionStorage.removeItem('lumen.remote'); $('key').value = ''; $('gallery').replaceChildren(); $('collection').hidden = true; $('connect').hidden = false; $('disconnect').hidden = true; message('Disconnected.'); };
$('close').onclick = () => $('viewer').close();
$('viewer').addEventListener('close', () => { clearFull(); $('full').dataset.id = ''; });
$('previous').onclick = () => { void view(selected - 1); }; $('next').onclick = () => { void view(selected + 1); };
document.addEventListener('keydown', event => { if (!$('viewer').open) return; if (event.key === 'ArrowLeft' && selected > 0) void view(selected - 1); if (event.key === 'ArrowRight' && selected < items.length - 1) void view(selected + 1); });
let installPrompt;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('install').hidden = false; });
$('install').onclick = async () => { await installPrompt?.prompt(); $('install').hidden = true; };
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./sw.js').catch(() => {});

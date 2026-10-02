import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import type { IndexEvent } from './types';
import './style.css';
import '../pwa/style.css';

type Connection = { base: string; token: string };
type State = Awaited<ReturnType<Window['lumen']['getState']>>;
function savedConnection(): Connection | null {
  try { return JSON.parse(localStorage.getItem('lumen.remote') || 'null'); } catch { return null; }
}
async function discover(base: string) {
  const response = await fetch(base + '/api/discover', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
  const data = await response.json();
  if (!response.ok || data.service !== 'lumen' || data.version !== 1 || !/^[A-Z0-9]{5}$/.test(data.token)) throw new Error('Lumen unavailable');
  return data.token as string;
}
function Remote() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [address, setAddress] = useState(() => savedConnection()?.base || (location.protocol === 'http:' ? location.origin : ''));
  const [key, setKey] = useState(() => savedConnection()?.token || '');
  const [automatic, setAutomatic] = useState(true), [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('Looking for Lumen on your network…');
  const [install, setInstall] = useState<(Event & { prompt(): Promise<void> }) | null>(null);
  useEffect(() => {
    const handler = (event: Event) => { event.preventDefault(); setInstall(event as Event & { prompt(): Promise<void> }); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  useEffect(() => {
    if (!automatic || connection) return;
    let alive = true, timer: ReturnType<typeof setTimeout>;
    const find = async () => {
      const candidates = [...new Set([savedConnection()?.base, location.protocol === 'http:' ? location.origin : '', 'http://lumen.local:47831', 'http://127.0.0.1:47831'].filter(Boolean))] as string[];
      for (const base of candidates) {
        try { const token = await discover(base); if (alive) { setConnection({ base, token }); setAddress(base); setKey(token); } return; } catch { /* Try the next advertised address. */ }
      }
      if (alive) { setStatus('Looking for Lumen. Keep your PC on the same Wi-Fi with sharing enabled and allow local-network access. You can also enter the PC address below.'); timer = setTimeout(() => void find(), 5000); }
    };
    void find(); return () => { alive = false; clearTimeout(timer); };
  }, [automatic, connection, attempt]);
  const disconnect = useCallback(() => { try { localStorage.removeItem('lumen.remote'); } catch {} setAutomatic(false); setConnection(null); setKey(''); setStatus('Disconnected.'); }, []);
  return connection ? <><Connected key={connection.base} connection={connection} disconnect={disconnect} />{install && <button className="button remote-install" onClick={async () => { await install.prompt(); setInstall(null); }}>Install</button>}</> : <div className="remote-connect">
    <header><img src="./icon-192.png" width="36" height="36" alt="" /><strong>Lumen</strong>{install && <button className="button" onClick={async () => { await install.prompt(); setInstall(null); }}>Install</button>}</header>
    <main><p className="eyebrow">ON YOUR HOME NETWORK</p><h1>A window into your PC.</h1><p>Open Lumen on your PC and choose an image folder. This page finds and connects to it automatically on the same Wi-Fi.</p>
      <button className="button primary" onClick={() => { setAutomatic(true); setAttempt(value => value + 1); }}>Find Lumen automatically</button>
      <details><summary>Connect using a PC address</summary><form onSubmit={async event => {
        event.preventDefault(); setAutomatic(false);
        try {
          const url = new URL(address);
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Enter just the PC address, for example http://192.168.1.10:47831.');
          const token = key.trim().toUpperCase() || await discover(url.origin);
          const response = await fetch(url.origin + '/api/state', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
          if (!response.ok) throw new Error('Pairing key rejected. Copy the current key from Lumen on your PC.');
          setConnection({ base: url.origin, token });
        } catch (error) { setStatus(error instanceof TypeError ? 'Cannot reach your PC. Check Wi-Fi, sharing and Windows firewall.' : (error as Error).message); }
      }}><label>PC address<input type="url" required value={address} onChange={event => setAddress(event.target.value)} /></label><label>Pairing key<input value={key} onChange={event => setKey(event.target.value)} minLength={5} maxLength={5} placeholder="Automatic" autoComplete="off" /></label><button className="button primary">Connect to Lumen</button></form></details>
      <p role="status">{status}</p><p>Keep both devices on the same Wi-Fi. Allow local-network access when prompted. Your PC must stay on with sharing enabled.</p>
    </main></div>;
}
function Connected({ connection, disconnect }: { connection: Connection; disconnect(): void }) {
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout>, last: State | null = null, stamp = '';
    const abort = new AbortController(), listeners = new Set<(event: IndexEvent) => void>();
    let token = connection.token;
    async function request(route: string, body?: unknown) {
      const response = await fetch(connection.base + route, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: abort.signal });
      if (!response.ok) throw new Error(response.status === 401 ? 'Pairing key rejected. Disconnect and pair again.' : 'Image or library unavailable. Refresh the collection.');
      return response.json();
    }
    const emit = (event: IndexEvent) => listeners.forEach(listener => listener(event));
    async function update() {
      const next: State | null = await request(`/api/state?revision=${encodeURIComponent(stamp)}`);
      if (!next && last) { if (alive) setError(''); return last; }
      if (!next) throw new Error('Library unavailable');
      if (!alive) return next;
      const nextStamp = JSON.stringify([next.generation, next.scanning, next.snapshot?.scannedAt, next.snapshot?.items.length]);
      if (last && last.root !== next.root) emit({ type: 'start', root: next.root, refresh: false, generation: next.generation });
      else if (last && !last.scanning && next.scanning) emit({ type: 'start', root: next.root, refresh: true, generation: next.generation });
      if (nextStamp !== stamp && next.snapshot) emit({ type: next.scanning ? 'cached' : 'complete', data: next.snapshot, generation: next.generation });
      last = next; stamp = nextStamp; setError(''); setReady(true);
      try { localStorage.setItem('lumen.remote', JSON.stringify({ base: connection.base, token })); } catch {}
      return next;
    }
    const action = async (action: string, argument?: string) => { const result = await request('/api/action', { action, argument }); await update(); return result; };
    window.lumen = {
      remote: { disconnect }, mediaUrl: (kind, id) => `${connection.base}/api/${kind}/${id}?key=${encodeURIComponent(token)}`,
      getState: () => last ? Promise.resolve(last) : update(), onIndex: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      openFolder: path => action('open', path), rescan: () => action('rescan'), cancel: () => action('cancel'),
      metadata: id => request(`/api/metadata/${id}`), reveal: id => action('reveal', id),
      copyPath: async id => { const item = last?.snapshot?.items.find(item => item.id === id); if (!item) throw new Error('Image unavailable'); if (!navigator.clipboard) throw new Error('Copy path requires the HTTPS PWA.'); await navigator.clipboard.writeText(item.path); },
      fullscreen: async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); return !!document.fullscreenElement; },
      droppedPath: () => { throw new Error('Choose the image folder on your PC using Open folder.'); },
      sharingState: async () => ({ active: true, token, addresses: [connection.base] }), setSharing: async () => { throw new Error('Manage sharing on your PC.'); },
    };
    const poll = async () => {
      try { await update(); } catch {
        if (!alive) return;
        setError('Cannot reach your PC. Looking for Lumen on your network…');
        try { token = await discover(connection.base); await update(); } catch { /* Retry while retaining the collection. */ }
      } finally { if (alive) timer = setTimeout(() => void poll(), 2000); }
    };
    void poll(); return () => { alive = false; clearTimeout(timer); abort.abort(); listeners.clear(); };
  }, [connection, disconnect]);
  return <div className="remote-app">{ready && <App />}{error && <div className="remote-status" role="status">{error}<button className="button" onClick={disconnect}>Disconnect</button></div>}</div>;
}
createRoot(document.getElementById('root')!).render(<Remote />);
if ('serviceWorker' in navigator && window.isSecureContext) void navigator.serviceWorker.register('./sw.js').catch(() => {});

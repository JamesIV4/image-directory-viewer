import { useEffect, useRef, useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
export type FolderListing = { path: string; parent: string | null; folders: { name: string; path: string }[] };
export default function RemoteFolderPicker({ initial, browse, choose }: { initial: string; browse(path: string): Promise<FolderListing>; choose(path?: string): void }) {
  const [listing, setListing] = useState<FolderListing | null>(null), [path, setPath] = useState(initial);
  const [target, setTarget] = useState(initial), [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement; input.current?.focus(); return () => { if (previous?.isConnected) previous.focus(); }; }, []);
  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    browse(target).then(data => { if (alive) { setListing(data); setPath(data.path); } }).catch(error => { if (alive) setError(error.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [target, revision, browse]);
  const navigate = (path: string) => { setTarget(path); setRevision(value => value + 1); };
  return <div className="remote-folder-backdrop" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') choose();
    if (event.key === 'Tab') {
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href]'));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <section className="remote-folder-picker" role="dialog" aria-modal="true" aria-label="Choose a folder on your PC">
      <header><h2>Choose a folder on your PC</h2><button className="icon-button" aria-label="Cancel folder selection" onClick={() => choose()}><X size={20} /></button></header>
      <form onSubmit={event => { event.preventDefault(); navigate(path); }}><label htmlFor="remote-folder-path">PC folder path</label><div><input ref={input} id="remote-folder-path" readOnly={loading} value={path} onChange={event => setPath(event.target.value)} placeholder="Enter a folder path" /><button className="button" type="submit" disabled={loading}>Go</button></div></form>
      <nav><button className="button" onClick={() => navigate('')}>Drives &amp; home</button><button className="button" disabled={loading || !listing?.parent} onClick={() => navigate(listing!.parent!)}>Up one folder</button></nav>
      {loading && <p role="status">Loading PC folders...</p>}
      {error && <p role="alert">{error}</p>}
      <div className="remote-folder-list" aria-busy={loading}>{!loading && !error && listing?.folders.map(folder => <button key={folder.path} onClick={() => navigate(folder.path)}><FolderOpen size={18} /><span>{folder.name}</span></button>)}{!loading && !error && listing?.path && !listing.folders.length && <p>No subfolders. You can select this folder.</p>}</div>
      <footer><button className="button" onClick={() => choose()}>Cancel</button><button className="button primary" disabled={loading || !!error || !listing?.path} onClick={() => choose(listing!.path)}>Select this folder</button></footer>
    </section>
  </div>;
}

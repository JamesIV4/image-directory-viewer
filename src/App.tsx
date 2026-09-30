import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Aperture, ArrowDownWideNarrow, ArrowUpWideNarrow, Check, ChevronRight, FolderOpen, Folders, Grid2X2, Image, LayoutGrid, List, LoaderCircle, PanelLeftClose, PanelLeftOpen, RefreshCw, Search, X, Keyboard, CircleAlert, Copy, CornerDownLeft, CalendarClock, ChevronsUp, ChevronsDown, ListFilter } from 'lucide-react';
import Library, { FolderTree, type View } from './Library';
import Viewer from './Viewer';
import { rootName, type ImageItem, type Folder, type Snapshot } from './types';
import { folderIncluded, setBranchIncluded, type FolderRules } from './folder-filter';
import ImageContextMenu from './ImageContextMenu';
import DateRangeSlider from './DateRangeSlider';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function saved<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}

export default function App() {
  const [root, setRoot] = useState(''), [recent, setRecent] = useState<string[]>([]);
  const [items, setItems] = useState<ImageItem[]>([]), [folders, setFolders] = useState<Folder[]>([]);
  const [scanning, setScanning] = useState(false), [directories, setDirectories] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]), [error, setError] = useState('');
  const [folder, setFolder] = useState(''), [recursive, setRecursive] = useState(true);
  const [folderRules, setFolderRules] = useState<FolderRules>(new Map());
  const [excludedDirectImages, setExcludedDirectImages] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState(''), [extension, setExtension] = useState('all');
  const [newerThan, setNewerThan] = useState(''), [olderThan, setOlderThan] = useState('');
  const [dateBoundsInclusive, setDateBoundsInclusive] = useState(false);
  const [dateFiltersOpen, setDateFiltersOpen] = useState(false);
  const [controlsCollapsed, setControlsCollapsed] = useState<boolean>(saved('lumen.controlsCollapsed', false));
  const condensed = controlsCollapsed && !!root;
  useEffect(() => { localStorage.setItem('lumen.controlsCollapsed', JSON.stringify(controlsCollapsed)); }, [controlsCollapsed]);
  const [view, setView] = useState<View>(saved('lumen.view', 'grid'));
  const [size, setSize] = useState<number>(saved('lumen.size', 230));
  const [sort, setSort] = useState<string>(saved('lumen.sort', 'name'));
  const [descending, setDescending] = useState(false), [sidebar, setSidebar] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState<number>(saved('lumen.sidebarWidth', 242));
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ item: ImageItem; x: number; y: number } | null>(null);
  const sidebarMaximum = () => Math.max(160, Math.min(600, window.innerWidth - 420));
  const clampSidebar = (width: number) => Math.max(160, Math.min(sidebarMaximum(), width));
  useEffect(() => {
    const resize = () => setSidebarWidth(width => Math.max(160, Math.min(600, window.innerWidth - 420, width)));
    resize(); window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => { localStorage.setItem('lumen.sidebarWidth', JSON.stringify(sidebarWidth)); }, [sidebarWidth]);
  const [selected, setSelected] = useState(''), [viewer, setViewer] = useState(false);
  const [toast, setToast] = useState(''), [dragging, setDragging] = useState(false), [help, setHelp] = useState(false), [showWarnings, setShowWarnings] = useState(false);
  const search = useRef<HTMLInputElement>(null), generation = useRef(0), indexed = useRef(new Map<string, ImageItem>());
  const focusSearchPending = useRef(false);
  useEffect(() => {
    if (!controlsCollapsed && focusSearchPending.current) {
      focusSearchPending.current = false; search.current?.focus();
    }
  }, [controlsCollapsed]);
  const focusSearch = useCallback(() => {
    if (controlsCollapsed) { focusSearchPending.current = true; setControlsCollapsed(false); }
    else search.current?.focus();
  }, [controlsCollapsed]);
  const deferredQuery = useDeferredValue(query);
  const applySnapshot = useCallback((data: Snapshot) => {
    indexed.current = new Map(data.items.map(item => [item.path, item]));
    setItems(data.items); setFolders(data.folders); setWarnings(data.warnings); setRoot(data.root);
  }, []);
  useEffect(() => {
    let alive = true, dirty = false;
    const unsubscribe = window.lumen.onIndex(event => {
      if (event.generation < generation.current) return;
      generation.current = event.generation;
      if (event.type === 'start') {
        dirty = false; setRoot(event.root);
        if (!event.refresh) {
          indexed.current = new Map(); setItems([]); setFolders([]); setFolder(''); setQuery(''); setExtension('all');
          setFolderRules(new Map());
          setExcludedDirectImages(new Set()); setContextMenu(null);
          setNewerThan(''); setOlderThan(''); setDateFiltersOpen(false);
          setDateBoundsInclusive(false);
          setViewer(false); setSelected('');
        }
        setScanning(true); setWarnings([]); setError(''); setDirectories(0);
      } else if (event.type === 'batch') {
        for (const item of event.items) indexed.current.set(item.path, item);
        dirty = true;
      } else if (event.type === 'progress') setDirectories(event.directories);
      else if (event.type === 'cached' || event.type === 'complete') {
        dirty = false; applySnapshot(event.data);
        if (event.type === 'complete') setScanning(false);
      } else if (event.type === 'error') { setError(event.message); setScanning(false); }
    });
    const timer = setInterval(() => {
      if (!dirty) return;
      dirty = false; const all = [...indexed.current.values()]; setItems(all);
      // A lightweight interim tree makes folders browsable before indexing finishes.
      const map = new Map<string, Folder>();
      map.set('', { path: '', name: 'Root folder', count: 0, ownCount: 0 });
      for (const item of all) {
        const parts = item.folder ? item.folder.split('/') : [];
        for (let i = 0; i <= parts.length; i++) {
          const p = parts.slice(0, i).join('/');
          if (!map.has(p)) map.set(p, { path: p, name: parts[i - 1], count: 0, ownCount: 0 });
          map.get(p)!.count++; if (i === parts.length) map.get(p)!.ownCount++;
        }
      }
      setFolders([...map.values()]);
    }, 200);
    window.lumen.getState().then(state => {
      if (!alive) return;
      setRecent(state.recent);
      if (state.generation < generation.current) return;
      generation.current = state.generation;
      setRoot(state.root); setScanning(state.scanning);
      if (state.snapshot) applySnapshot(state.snapshot);
    }).catch(error => setError(error.message));
    return () => { alive = false; clearInterval(timer); unsubscribe(); };
  }, [applySnapshot]);
  useEffect(() => { localStorage.setItem('lumen.view', JSON.stringify(view)); }, [view]);
  useEffect(() => { localStorage.setItem('lumen.size', JSON.stringify(size)); }, [size]);
  useEffect(() => { localStorage.setItem('lumen.sort', JSON.stringify(sort)); }, [sort]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 2800); return () => clearTimeout(timer); } }, [toast]);
  const open = useCallback(async (path?: string) => {
    try { const result = await window.lumen.openFolder(path); if (result) setRecent(result.recent); }
    catch (error) { setError((error as Error).message); }
  }, []);
  const extensions = useMemo(() => [...new Set(items.map(i => i.extension))].sort(), [items]);
  const { includedFolders, includedCounts } = useMemo(() => {
    const includedFolders = new Set<string>();
    const includedCounts = new Map<string, number>();
    for (const entry of folders) if (folderIncluded(entry.path, folderRules) && !excludedDirectImages.has(entry.path)) includedFolders.add(entry.path);
    for (const item of items) if (includedFolders.has(item.folder)) {
      let current = item.folder;
      while (true) {
        includedCounts.set(current, (includedCounts.get(current) || 0) + 1);
        if (!current) break;
        const slash = current.lastIndexOf('/'); current = slash < 0 ? '' : current.slice(0, slash);
      }
    }
    return { includedFolders, includedCounts };
  }, [items, folders, folderRules, excludedDirectImages]);
  const hiddenInScope = useMemo(() => items.filter(item => !includedFolders.has(item.folder)
    && (recursive ? (!folder || item.folder === folder || item.folder.startsWith(folder + '/')) : item.folder === folder)).length,
  [items, folder, recursive, includedFolders]);
  const eligibleItems = useMemo(() => {
    const q = deferredQuery.trim().toLocaleLowerCase();
    const result = items.filter(item => (recursive ? (!folder || item.folder === folder || item.folder.startsWith(folder + '/')) : item.folder === folder)
      && includedFolders.has(item.folder)
      && (extension === 'all' || item.extension === extension) && (!q || item.relativePath.toLocaleLowerCase().includes(q)));
    result.sort((a, b) => {
      const value = sort === 'modified' ? a.modified - b.modified : sort === 'size' ? a.size - b.size
        : sort === 'path' ? collator.compare(a.relativePath, b.relativePath) : collator.compare(a.name, b.name);
      return (descending ? -1 : 1) * (value || collator.compare(a.relativePath, b.relativePath));
    }); return result;
  }, [items, folder, recursive, extension, deferredQuery, sort, descending, includedFolders]);
  const dateDomain = useMemo(() => {
    let minimum = Infinity, maximum = -Infinity;
    for (const item of eligibleItems) { minimum = Math.min(minimum, item.modified); maximum = Math.max(maximum, item.modified); }
    return { minimum: minimum === Infinity ? null : minimum, maximum: maximum === -Infinity ? null : maximum };
  }, [eligibleItems]);
  const filtered = useMemo(() => {
    const after = newerThan ? new Date(newerThan).getTime() : -Infinity;
    const before = olderThan ? new Date(olderThan).getTime() : Infinity;
    return eligibleItems.filter(item => dateBoundsInclusive ? item.modified >= after && item.modified <= before : item.modified > after && item.modified < before);
  }, [eligibleItems, newerThan, olderThan, dateBoundsInclusive]);
  const selectedIndex = filtered.findIndex(item => item.id === selected);
  const current = selectedIndex >= 0 ? filtered[selectedIndex] : null;
  useEffect(() => { if (viewer && !current) setViewer(false); }, [viewer, current]);
  const navigate = useCallback((direction: number) => {
    const next = Math.min(filtered.length - 1, Math.max(0, selectedIndex + direction));
    if (filtered[next]) setSelected(filtered[next].id);
  }, [filtered, selectedIndex]);
  const closeViewer = useCallback(() => setViewer(false), []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || contextMenu || (event.target as HTMLElement).closest('[role="separator"], [role="slider"]')) return;
      const input = (event.target as HTMLElement).matches('input, select, textarea');
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); void open(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); focusSearch(); }
      else if (event.key === 'F5') { event.preventDefault(); void window.lumen.rescan().catch(error => setError(error.message)); }
      else if (!viewer && !input && !help) {
        if (event.key === '/') { event.preventDefault(); focusSearch(); }
        else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); navigate(1); }
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); navigate(-1); }
        else if (event.key === 'Enter' && current) { event.preventDefault(); setViewer(true); }
        else if (event.key === '?') setHelp(true);
      }
      if (event.key === 'Escape') { setHelp(false); setShowWarnings(false); if (input) search.current?.blur(); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [open, viewer, help, navigate, current, contextMenu, focusSearch]);
  const chooseFolder = (path: string) => { setFolder(path); setSelected(''); };
  const resetFolderFilters = () => { setFolderRules(new Map()); setExcludedDirectImages(new Set()); };
  const hasFolderFilters = folderRules.size > 0 || excludedDirectImages.size > 0;
  const setFolderBranch = (path: string, included: boolean) => {
    setFolderRules(previous => setBranchIncluded(previous, path, included));
    setExcludedDirectImages(previous => new Set([...previous].filter(p => path && p !== path && !p.startsWith(path + '/'))));
    setSelected('');
  };
  const setDirectImages = (path: string, included: boolean) => {
    setExcludedDirectImages(previous => { const next = new Set(previous); if (included) next.delete(path); else next.add(path); return next; });
    setSelected('');
  };
  const parts = folder ? folder.split('/') : [];
  const dateRangeInvalid = !!newerThan && !!olderThan && (dateBoundsInclusive ? new Date(newerThan).getTime() > new Date(olderThan).getTime() : new Date(newerThan).getTime() >= new Date(olderThan).getTime());
  const activeFilterSummary = [
    query.trim() ? `Search: ${query.trim()}` : '',
    extension !== 'all' ? `File type: ${extension.toUpperCase()}` : '',
    newerThan ? `Modified newer than ${new Date(newerThan).toLocaleString()}` : '',
    olderThan ? `Modified older than ${new Date(olderThan).toLocaleString()}` : '',
    !recursive ? 'Subfolders excluded' : '',
    hasFolderFilters ? `Folder filters: ${hiddenInScope.toLocaleString()} images hidden in this view` : '',
  ].filter(Boolean);
  const totalBytes = useMemo(() => items.reduce((n, i) => n + i.size, 0), [items]);

  return <div className={`app ${sidebar ? '' : 'sidebar-hidden'} ${resizingSidebar ? 'resizing-sidebar' : ''} ${condensed ? 'controls-collapsed' : ''}`}
    style={{ gridTemplateColumns: `${sidebar ? sidebarWidth : 0}px minmax(0,1fr)` }}
    onDragOver={event => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) setDragging(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
    onDrop={event => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) void open(window.lumen.droppedPath(file)); }}>
    <header className="app-header" inert={viewer || help || showWarnings}>
      <div className="brand"><span className="brand-icon"><Aperture size={23} strokeWidth={1.7} /></span><strong>Lumen</strong><span className="brand-divider" /><span className="brand-description">IMAGE BROWSER</span></div>
      <div className="header-actions"><span className="local-badge"><span />Local & private</span><button className="button primary" onClick={() => void open()}><FolderOpen size={16} />Open folder<kbd>Ctrl O</kbd></button></div>
    </header>
    <aside id="folder-sidebar" className="sidebar" inert={viewer || help || showWarnings}>
      <div className="sidebar-label"><span className="eyebrow">LIBRARY</span><button className="icon-button" title="Hide sidebar" aria-label="Hide sidebar" onClick={() => setSidebar(false)}><PanelLeftClose size={16} /></button></div>
      <button className={`all-images ${folder === '' && recursive ? 'active' : ''}`} onClick={() => { chooseFolder(''); setRecursive(true); }}><Image size={18} /><span>All images</span><small>{items.length.toLocaleString()}</small></button>
      <div className="sidebar-section"><span className="eyebrow">FOLDERS</span>{hasFolderFilters ? <button className="folder-reset" aria-label="Include all folders" title="Include all folders and direct images" onClick={resetFolderFilters}>Reset</button> : scanning && <LoaderCircle className="spin" size={13} />}</div>
      {root ? <FolderTree key={root} folders={folders} selected={folder} onSelect={chooseFolder} rootLabel={rootName(root)} rules={folderRules} counts={includedCounts}
        onInclusionChange={setFolderBranch} /> : <p className="sidebar-empty">Open a folder to explore its images.</p>}
      <div className="recent-folders"><span className="eyebrow">RECENT FOLDERS</span>
        {recent.length ? recent.slice(0, 5).map(path => <button key={path} title={path} onClick={() => void open(path)}><FolderOpen size={14} /><span>{rootName(path)}</span></button>) : <span className="muted">Your folders will appear here.</span>}
      </div>
      <button className="shortcuts-link" onClick={() => setHelp(true)}><Keyboard size={16} />Keyboard shortcuts<kbd>?</kbd></button>
    </aside>
    {sidebar && <div className="sidebar-resizer" style={{ left: sidebarWidth - 3, top: condensed ? 0 : 70 }} role="separator" aria-label="Resize folder sidebar"
      aria-controls="folder-sidebar" aria-orientation="vertical" aria-valuemin={160} aria-valuemax={sidebarMaximum()} aria-valuenow={sidebarWidth}
      tabIndex={0} inert={viewer || help || showWarnings} title="Drag to resize sidebar · Double-click to reset"
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setResizingSidebar(true); }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setSidebarWidth(clampSidebar(event.clientX)); }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setResizingSidebar(false); }}
      onLostPointerCapture={() => setResizingSidebar(false)} onDoubleClick={() => setSidebarWidth(clampSidebar(242))}
      onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          setSidebarWidth(clampSidebar(event.key === 'Home' ? 160 : event.key === 'End' ? sidebarMaximum() : sidebarWidth + (event.key === 'ArrowRight' ? 20 : -20)));
        }
      }} />}
    <main inert={viewer || help || showWarnings}>
      {root ? <>
        {controlsCollapsed && <div className="condensed-bar" role="region" aria-label="Condensed collection controls">
          {!sidebar && <button className="icon-button" title="Show sidebar" aria-label="Show sidebar" onClick={() => setSidebar(true)}><PanelLeftOpen size={17} /></button>}
          <div className="condensed-location" title={root + (folder ? '/' + folder : '')}>
            <button onClick={() => chooseFolder('')} title="Go to root folder"><FolderOpen size={15} /><span>{rootName(root)}</span></button>
            {folder && <><ChevronRight size={13} /><strong>{folder}</strong></>}
          </div>
          <span className="condensed-count" title={`${filtered.length.toLocaleString()} visible images / ${items.length.toLocaleString()} indexed images`}>{filtered.length.toLocaleString()}<span> images</span></span>
          {activeFilterSummary.length > 0 && <button className="condensed-filters" title={activeFilterSummary.join('\n')} aria-label="Show active filters" onClick={() => setControlsCollapsed(false)}><ListFilter size={15} /><span>{activeFilterSummary.length} filters</span></button>}
          {(error || dateRangeInvalid) && <button className="icon-button condensed-error" title={error || '“Newer than” must be before “Older than”.'} aria-label="Show filter or library error" onClick={() => setControlsCollapsed(false)}><CircleAlert size={17} /></button>}
          <button className="icon-button" aria-label="Refresh library" title="Refresh library (F5)" disabled={scanning} onClick={() => void window.lumen.rescan().catch(error => setError(error.message))}><RefreshCw size={17} /></button>
          <button className="controls-toggle" aria-label="Expand controls" aria-expanded={false} aria-controls="collection-controls" title="Expand browsing controls and filters" onClick={() => setControlsCollapsed(false)}><ChevronsDown size={17} /><span>Controls</span></button>
        </div>}
        <div id="collection-controls" className="collection-controls" hidden={controlsCollapsed}>
        <div className="collection-heading"><div><div className="breadcrumb" title={root + (folder ? '/' + folder : '')}>
          {!sidebar && <button className="icon-button" title="Show sidebar" aria-label="Show sidebar" onClick={() => setSidebar(true)}><PanelLeftOpen size={17} /></button>}
          <button onClick={() => chooseFolder('')}><FolderOpen size={14} />{rootName(root)}</button>
          {parts.map((part, index) => <span key={index}><ChevronRight size={13} /><button onClick={() => chooseFolder(parts.slice(0, index + 1).join('/'))}>{part}</button></span>)}
        </div><h1>{folder ? parts.at(-1) : recursive ? 'All images' : rootName(root)}<span>{filtered.length.toLocaleString()}</span></h1>
        <p className="collection-path" title={root}>{root}</p></div>
        <div className="heading-actions"><div className="scope-toggles">
          <label className="toggle-label direct-images-toggle" title="Include images directly in this folder; subfolders are controlled separately">
            <input type="checkbox" checked={!excludedDirectImages.has(folder)} disabled={!folderIncluded(folder, folderRules)}
              onChange={event => setDirectImages(folder, event.target.checked)} /><span className="toggle-track" />{folder ? 'Include folder images' : 'Include root images'}
          </label>
          <label className="toggle-label"><input type="checkbox" checked={recursive} onChange={event => setRecursive(event.target.checked)} /><span className="toggle-track" />Include subfolders</label>
        </div>
          <button className="icon-button" aria-label="Refresh library" title="Refresh library (F5)" disabled={scanning} onClick={() => void window.lumen.rescan().catch(error => setError(error.message))}><RefreshCw size={17} /></button>
          <button className="controls-toggle" aria-label="Collapse controls" aria-expanded={true} aria-controls="collection-controls" title="Condense the header and filters to make more room for images" onClick={() => setControlsCollapsed(true)}><ChevronsUp size={17} /><span>Condense</span></button></div>
        </div>
        <div className="toolbar"><label className="search"><Search size={17} /><input ref={search} placeholder="Search names or paths…" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search images" />
          {query ? <button className="icon-button" title="Clear search" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button> : <kbd>/</kbd>}</label>
          <select value={extension} onChange={event => setExtension(event.target.value)} aria-label="Filter file type"><option value="all">All types</option>{extensions.map(ext => <option key={ext} value={ext}>{ext.toUpperCase()}</option>)}</select>
          <div className="sort-control"><select value={sort} onChange={event => setSort(event.target.value)} aria-label="Sort images"><option value="name">Name</option><option value="path">Path</option><option value="modified">Modified</option><option value="size">File size</option></select>
            <button className="icon-button" aria-label={descending ? 'Sort ascending' : 'Sort descending'} title={descending ? 'Sort ascending' : 'Sort descending'} onClick={() => setDescending(!descending)}>{descending ? <ArrowDownWideNarrow size={17} /> : <ArrowUpWideNarrow size={17} />}</button></div>
          <button className={`date-filter-button ${newerThan || olderThan ? 'active' : ''}`} aria-label="Filter by date and time" aria-expanded={dateFiltersOpen}
            title="Filter by file modification date and time" onClick={() => setDateFiltersOpen(value => !value)}><CalendarClock size={16} />Date{(newerThan || olderThan) && <span>{Number(!!newerThan) + Number(!!olderThan)}</span>}</button>
          <div className="toolbar-spacer" />
          {view !== 'list' && <label className="size-control" title="Thumbnail size"><Image size={14} /><input aria-label="Thumbnail size" type="range" min="150" max="360" step="10" value={size} onChange={event => setSize(Number(event.target.value))} /><Image size={18} /></label>}
          <div className="view-switch" aria-label="Collection view">{([
            ['grid', LayoutGrid, 'Gallery view'], ['compact', Grid2X2, 'Compact view'], ['list', List, 'Details view'], ['folders', Folders, 'Grouped by folder'],
          ] as const).map(([value, Icon, label]) => <button key={value} aria-label={label} title={label} aria-pressed={view === value} className={view === value ? 'active' : ''} onClick={() => setView(value)}><Icon size={17} /></button>)}</div>
        </div>
        {dateFiltersOpen && <div className="date-filter-panel" role="region" aria-label="Date and time filters">
          <div className="date-filter-description"><CalendarClock size={17} /><div><strong>Modified date & time</strong><span>In your local time zone</span></div></div>
          <DateRangeSlider {...dateDomain} newerThan={newerThan} olderThan={olderThan} onChange={(start, end) => { setDateBoundsInclusive(true); setNewerThan(start); setOlderThan(end); setSelected(''); }} />
          <label>Newer than<input type="datetime-local" step="any" aria-label="Newer than" value={newerThan} onChange={event => { setDateBoundsInclusive(false); setNewerThan(event.target.value); setSelected(''); }} /></label>
          <label>Older than<input type="datetime-local" step="any" aria-label="Older than" value={olderThan} onChange={event => { setDateBoundsInclusive(false); setOlderThan(event.target.value); setSelected(''); }} /></label>
          <button className="text-button" disabled={!newerThan && !olderThan} onClick={() => { setNewerThan(''); setOlderThan(''); }}><X size={14} />Clear dates</button>
          {dateRangeInvalid && <p className="date-filter-error" role="alert">“Newer than” must be before “Older than”.</p>}
        </div>}
        {hasFolderFilters && <div className="folder-filter-banner"><Folders size={14} /><span>Folder filters active<span className="filter-summary"> · {hiddenInScope.toLocaleString()} images hidden in this view</span></span><button onClick={resetFolderFilters}>Include all folders</button></div>}
        {error && <div className="error-banner"><CircleAlert size={16} /><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
        </div>
        {filtered.length ? <Library key={`${root}:${folder}:${recursive}:${extension}:${deferredQuery}:${sort}:${descending}:${[...folderRules].map(([p, included]) => `${p}=${included}`).join('|')}:${[...excludedDirectImages].join('|')}`} items={filtered} view={view} size={size} selected={selected} onSelect={setSelected}
          onOpen={item => { setSelected(item.id); setViewer(true); }} onFolder={chooseFolder}
          onContextMenu={(item, x, y) => { setSelected(item.id); setContextMenu({ item, x, y }); }} /> :
          <div className="no-results">{scanning ? <><LoaderCircle size={36} className="spin" /><h2>Discovering your images…</h2><p>You can browse as soon as the first images are indexed.</p></> : <><Search size={36} /><h2>{items.length ? 'No matching images' : 'No images in this folder'}</h2><p>{items.length ? 'Try another search, date range, file type, or folder.' : 'Choose another folder, or refresh after adding images.'}</p>{(query || extension !== 'all' || !recursive || newerThan || olderThan) && <button className="button" onClick={() => { setQuery(''); setExtension('all'); setRecursive(true); setNewerThan(''); setOlderThan(''); }}>Reset filters</button>}</>}</div>}
      </> : <div className="welcome">
        <div className="welcome-art"><div className="art-tile tile-back"><div /></div><div className="art-tile tile-front"><div className="art-sun" /><div className="art-mountain mountain-back" /><div className="art-mountain mountain-front" /></div><span className="art-aperture"><Aperture size={30} /></span></div>
        <span className="eyebrow">YOUR IMAGES, IN ONE PLACE</span><h1>A little light on<br />your image library.</h1><p>Explore every image in a folder and its subfolders.<br />Fast previews. Clear paths. Room to see the details.</p>
        <button className="button primary welcome-open" onClick={() => void open()}><FolderOpen size={18} />Open an image folder<CornerDownLeft size={16} /></button>
        <span className="welcome-drop">or drop a folder anywhere in this window</span>
        <div className="welcome-features"><span><Check size={14} />Recursive indexing</span><span><Check size={14} />Cached previews</span><span><Check size={14} />Original-size viewing</span></div>
        {error && <div className="welcome-error"><CircleAlert size={16} />{error}</div>}
      </div>}
    </main>
    <footer className="statusbar" inert={viewer || help || showWarnings}><div>{scanning ? <><LoaderCircle className="spin" size={13} /><span>Indexing · {items.length.toLocaleString()} images · {directories.toLocaleString()} folders</span><button onClick={() => void window.lumen.cancel()}>Stop</button></> : <><span className="status-dot" /><span>{root ? `${items.length.toLocaleString()} images indexed · ${Math.max(0, folders.length - 1).toLocaleString()} subfolders` : 'Ready to explore'}</span></>}
      {warnings.length > 0 && <button className="warning-link" onClick={() => setShowWarnings(true)}><CircleAlert size={12} />{warnings.length} notices</button>}</div>
      <span>{root ? `${(totalBytes / 1024 ** 3).toFixed(2)} GB on disk` : 'JPG · PNG · WebP · GIF · AVIF · TIFF · SVG'}<i />{root ? `${view === 'folders' ? 'Folder groups' : view === 'list' ? 'Details' : view === 'compact' ? 'Compact' : 'Gallery'} view` : 'Files stay on your computer'}</span>
    </footer>
    {viewer && current && <Viewer item={current} index={selectedIndex} count={filtered.length} onClose={closeViewer} onPrevious={() => navigate(-1)} onNext={() => navigate(1)} onMessage={setToast} />}
    {contextMenu && <ImageContextMenu item={contextMenu.item} x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}
      onOpen={() => { setSelected(contextMenu.item.id); setViewer(true); }} onBrowse={() => chooseFolder(contextMenu.item.folder)}
      onExcludeDirect={() => setDirectImages(contextMenu.item.folder, false)} onExcludeBranch={() => setFolderBranch(contextMenu.item.folder, false)} onMessage={setToast} />}
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    {dragging && <div className="drop-overlay"><FolderOpen size={44} /><h2>Drop a folder to explore</h2><p>All subfolders are included.</p></div>}
    {(help || showWarnings) && <div className="modal-scrim" onClick={() => { setHelp(false); setShowWarnings(false); }}><div className="modal" role="dialog" aria-modal="true" aria-label={help ? 'Keyboard shortcuts' : 'Indexing notices'} onClick={event => event.stopPropagation()}>
      <button className="icon-button modal-close" aria-label="Close dialog" onClick={() => { setHelp(false); setShowWarnings(false); }}><X size={19} /></button>
      {help ? <><Keyboard size={25} /><h2>Make yourself at home.</h2><p>A few shortcuts for a smoother browse.</p><dl className="shortcut-list">
        {[["Open folder", 'Ctrl O'], ['Search collection', 'Ctrl F / /'], ['Refresh index', 'F5'], ['Select / navigate images', '← → ↑ ↓'], ['Open selected image', 'Enter'], ['Close viewer', 'Esc'], ['Zoom in / out', '+ / −'], ['Fit to window', 'F / 0'], ['Actual size', '1'], ['Image details', 'I'], ['Nearest neighbor above 100%', 'N']].map(([label, key]) => <div key={label}><dt>{label}</dt><dd><kbd>{key}</kbd></dd></div>)}
      </dl><p className="modal-note">In the viewer: scroll or pinch to zoom, drag to pan, and double-click to zoom.</p></> : <><CircleAlert size={25} /><h2>Indexing notices</h2><p>Accessible folders are still available to browse.</p><ul className="warning-list">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul><button className="button" onClick={() => { navigator.clipboard.writeText(warnings.join('\n')).then(() => setToast('Notices copied')).catch(() => setToast('Unable to copy notices')); }}><Copy size={15} />Copy notices</button></>}
    </div></div>}
  </div>;
}

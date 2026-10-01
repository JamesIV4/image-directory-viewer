import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, Folder as FolderIcon, ImageOff } from 'lucide-react';
import { bytes, thumbnail, type ImageItem, type Folder } from './types';
import { folderIncluded, type FolderRules } from './folder-filter';

export type View = 'grid' | 'compact' | 'list' | 'folders';
export function Thumb({ item }: { item: ImageItem }) {
  const [failed, setFailed] = useState(false);
  return failed ? <div className="failed-thumb"><ImageOff size={25} /><span>Preview unavailable</span></div> :
    <img src={thumbnail(item)} alt={item.name} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />;
}

function FolderCheck({ folder, rules, counts, patternIncluded, onChange }: {
  folder: Folder; rules: FolderRules; counts: Map<string, number>; patternIncluded: (folder: string) => boolean; onChange: (folder: string, included: boolean) => void;
}) {
  const included = counts.get(folder.path) || 0;
  const checked = folder.count ? included === folder.count : folderIncluded(folder.path, rules) && patternIncluded(folder.path);
  const mixed = included > 0 && included < folder.count;
  return <input className="folder-check" type="checkbox" checked={checked}
    ref={element => { if (element) element.indeterminate = mixed; }}
    aria-label={`Include ${folder.path || 'root folder'}`} aria-checked={mixed ? 'mixed' : checked}
    title={`${checked ? 'Exclude' : 'Include'} ${folder.path || 'root folder'} and its subfolders`}
    onChange={event => onChange(folder.path, event.target.checked)} />;
}

export function FolderTree({ folders, selected, onSelect, rootLabel, rules, counts, patternIncluded, onInclusionChange }: {
  folders: Folder[]; selected: string; onSelect: (path: string) => void; rootLabel: string;
  rules: FolderRules; counts: Map<string, number>; patternIncluded: (folder: string) => boolean; onInclusionChange: (folder: string, included: boolean) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setExpanded(previous => {
      const next = new Set(previous); const parts = selected.split('/');
      for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join('/'));
      return next;
    });
  }, [selected]);
  const rows = useMemo(() => {
    const children = new Map<string, Folder[]>();
    for (const folder of folders) if (folder.path) {
      const parent = folder.path.includes('/') ? folder.path.slice(0, folder.path.lastIndexOf('/')) : '';
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent)!.push(folder);
    }
    for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const rows: { folder: Folder; depth: number; children: boolean }[] = [];
    const add = (parent: string, depth: number) => {
      for (const folder of children.get(parent) || []) {
        rows.push({ folder, depth, children: children.has(folder.path) });
        if (expanded.has(folder.path)) add(folder.path, depth + 1);
      }
    };
    add('', 0); return rows;
  }, [folders, expanded]);
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => 36, overscan: 8 });
  return <>
    <div className={`tree-root-row ${selected === '' ? 'active' : ''}`}>
      <FolderCheck folder={folders.find(f => !f.path) || { path: '', name: rootLabel, count: 0, ownCount: 0 }} rules={rules} counts={counts} patternIncluded={patternIncluded} onChange={onInclusionChange} />
      <button className="tree-root" onClick={() => onSelect('')} title={rootLabel}>
        <FolderIcon size={17} /><span>{rootLabel}</span><small>{(counts.get('') || 0).toLocaleString()}</small>
      </button>
    </div>
    <div className="folder-tree" ref={scroller} role="navigation" aria-label="Folders">
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map(row => {
          const { folder, depth, children } = rows[row.index];
          const excluded = folder.count ? !counts.get(folder.path) : !folderIncluded(folder.path, rules) || !patternIncluded(folder.path);
          return <div key={folder.path} className={`tree-row ${selected === folder.path ? 'active' : ''} ${excluded ? 'excluded' : ''}`}
            style={{ transform: `translateY(${row.start}px)`, paddingLeft: 6 + depth * 14 }}>
            <button className="tree-toggle" aria-label={`${expanded.has(folder.path) ? 'Collapse' : 'Expand'} ${folder.name}`}
              disabled={!children} onClick={() => setExpanded(previous => {
                const next = new Set(previous); if (next.has(folder.path)) next.delete(folder.path); else next.add(folder.path); return next;
              })}>{children && (expanded.has(folder.path) ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}</button>
            <FolderCheck folder={folder} rules={rules} counts={counts} patternIncluded={patternIncluded} onChange={onInclusionChange} />
            <button className="tree-label" onClick={() => onSelect(folder.path)} title={folder.path}>
              <FolderIcon size={15} /><span>{folder.name}</span><small title={`${(counts.get(folder.path) || 0).toLocaleString()} included / ${folder.count.toLocaleString()} indexed`}>{(counts.get(folder.path) || 0).toLocaleString()}</small>
            </button>
          </div>;
        })}
      </div>
    </div>
  </>;
}

type Row = { type: 'images'; items: ImageItem[] } | { type: 'folder'; folder: string; count: number };
export default function Library({ items, view, size, selected, scrollReset, onSelect, onOpen, onFolder, onContextMenu }: {
  items: ImageItem[]; view: View; size: number; selected: string; scrollReset: number; onSelect: (id: string) => void;
  onOpen: (item: ImageItem) => void; onFolder: (path: string) => void;
  onContextMenu: (item: ImageItem, x: number, y: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    if (scroller.current) observer.observe(scroller.current);
    return () => observer.disconnect();
  }, []);
  const columns = view === 'list' ? 1 : Math.max(1, Math.floor((width - 40 + 16) / ((view === 'compact' ? size * 0.68 : size) + 16)));
  const tileWidth = (width - 40 - (columns - 1) * 16) / columns;
  const height = view === 'list' ? 74 : Math.round(tileWidth * (view === 'compact' ? 0.8 : 0.74) + (view === 'compact' ? 42 : 62) + 16);
  const rows = useMemo(() => {
    const rows: Row[] = [];
    if (view === 'folders') {
      const groups = new Map<string, ImageItem[]>();
      for (const item of items) { if (!groups.has(item.folder)) groups.set(item.folder, []); groups.get(item.folder)!.push(item); }
      for (const [folder, group] of [...groups].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
        rows.push({ type: 'folder', folder, count: group.length });
        for (let i = 0; i < group.length; i += columns) rows.push({ type: 'images', items: group.slice(i, i + columns) });
      }
    } else for (let i = 0; i < items.length; i += columns) rows.push({ type: 'images', items: items.slice(i, i + columns) });
    return rows;
  }, [items, view, columns]);
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current,
    estimateSize: index => rows[index].type === 'folder' ? 58 : height, overscan: 3,
  });
  useEffect(() => { virtual.measure(); }, [height, rows, virtual]);
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [view, scrollReset]);
  useEffect(() => {
    if (!selected) return;
    const index = rows.findIndex(row => row.type === 'images' && row.items.some(i => i.id === selected));
    if (index >= 0) virtual.scrollToIndex(index, { align: 'auto' });
  }, [selected, rows, virtual]);
  return <div className={`library ${view}`} ref={scroller} role="region" aria-label="Image collection">
    {view === 'list' && <div className="list-heading"><span>Image / name</span><span>Folder</span><span>File size</span><span>Modified</span></div>}
    <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
      {virtual.getVirtualItems().map(virtualRow => {
        const row = rows[virtualRow.index];
        return <div key={virtualRow.key} className="image-row" style={{ transform: `translateY(${virtualRow.start}px)`, height: virtualRow.size, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {row.type === 'folder' ? <button className="group-heading" onClick={() => onFolder(row.folder)} title={`Browse ${row.folder || 'root folder'}`}>
            <FolderIcon size={17} /><strong>{row.folder || 'Root folder'}</strong><span>{row.count.toLocaleString()} images</span><ChevronRight size={16} />
          </button> : row.items.map(item => <button key={item.id} data-image-id={item.id} className={`image-card ${selected === item.id ? 'selected' : ''}`}
            aria-label={`View ${item.relativePath}`} title={item.relativePath} onFocus={() => onSelect(item.id)} onClick={() => { onSelect(item.id); onOpen(item); }}
            onContextMenu={event => { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); onContextMenu(item, event.clientX || rect.left + 20, event.clientY || rect.top + 20); }}
            onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); onContextMenu(item, rect.left + 20, rect.top + 20); } }}>
            <div className="thumb"><Thumb item={item} /><span className="format-badge">{item.extension.toUpperCase()}</span></div>
            <div className="card-caption"><strong>{item.name}</strong><span>{view === 'list' ? item.extension.toUpperCase() : item.folder || 'Root folder'}</span></div>
            {view === 'list' && <><span className="list-folder">{item.folder || 'Root folder'}</span><span className="list-size">{bytes(item.size)}</span><span className="list-date">{new Date(item.modified).toLocaleDateString()}</span></>}
          </button>)}
        </div>;
      })}
    </div>
  </div>;
}

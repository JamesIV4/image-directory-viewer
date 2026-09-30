import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy, FolderOpen, Folders, Image, ImageMinus, FolderMinus } from 'lucide-react';
import type { ImageItem } from './types';

export default function ImageContextMenu({ item, x, y, onClose, onOpen, onBrowse, onExcludeDirect, onExcludeBranch, onMessage }: {
  item: ImageItem; x: number; y: number; onClose: () => void; onOpen: () => void; onBrowse: () => void;
  onExcludeDirect: () => void; onExcludeBranch: () => void; onMessage: (message: string) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onClose }); callbacks.current = { onClose };
  const [position, setPosition] = useState({ x, y });
  useLayoutEffect(() => {
    const rect = menu.current!.getBoundingClientRect();
    setPosition({ x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) });
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [x, y]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) callbacks.current.onClose(); };
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); callbacks.current.onClose(); } };
    const resize = () => callbacks.current.onClose();
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', keydown);
    window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', keydown); window.removeEventListener('resize', resize); };
  }, []);
  const run = (action: () => void | Promise<unknown>, message?: string) => {
    onClose();
    Promise.resolve().then(action).then(() => { if (message) onMessage(message); }).catch(error => onMessage(error.message));
  };
  return <div ref={menu} className="image-context-menu" role="menu" aria-label="Image actions" style={{ left: position.x, top: position.y }}
    onContextMenu={event => event.preventDefault()} onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>('button')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
    <div className="context-image-name" title={item.relativePath}>{item.name}<span>{item.folder || 'Root folder'}</span></div>
    <button role="menuitem" onClick={() => run(onOpen)}><Image size={16} />Open image</button>
    <button role="menuitem" onClick={() => run(() => window.lumen.reveal(item.id))}><FolderOpen size={16} />Reveal in File Explorer</button>
    <button role="menuitem" onClick={() => run(() => window.lumen.copyPath(item.id), 'Image path copied')}><Copy size={16} />Copy image path</button>
    <button role="menuitem" onClick={() => run(onBrowse)}><Folders size={16} />Browse this folder</button>
    <hr />
    <button role="menuitem" onClick={() => run(onExcludeDirect)}><ImageMinus size={16} />Exclude images in this folder</button>
    <button role="menuitem" onClick={() => run(onExcludeBranch)}><FolderMinus size={16} />Exclude folder and subfolders</button>
  </div>;
}

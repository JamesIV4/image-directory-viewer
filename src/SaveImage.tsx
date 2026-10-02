import { useEffect, useRef, useState } from 'react';
import { Download, Share2, X } from 'lucide-react';
import { original, type ImageItem } from './types';

export default function SaveImage({ item, onClose }: { item: ImageItem; onClose(): void }) {
  const [prepared, setPrepared] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState(''), [sharing, setSharing] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    close.current?.focus();
    const abort = new AbortController();
    let url = '';
    void (async () => {
      try {
        const response = await fetch(original(item), { cache: 'no-store', signal: abort.signal });
        if (!response.ok) throw new Error('Image unavailable. Check that your PC is connected and sharing is enabled.');
        const blob = await response.blob();
        if (abort.signal.aborted) return;
        const converted = ['tif', 'tiff', 'svg', 'heic', 'heif'].includes(item.extension.toLowerCase());
        const name = converted ? item.name.replace(/\.[^.]+$/, '') + '.png' : item.name;
        const file = new File([blob], name, { type: blob.type });
        url = URL.createObjectURL(file);
        setPrepared({ file, url });
      } catch (error) { if (!abort.signal.aborted) setError((error as Error).message); }
    })();
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [item]);
  const canShare = !!prepared && !!navigator.share && !!navigator.canShare?.({ files: [prepared.file] });
  return <section className="save-image-panel" role="region" aria-label="Save image options" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
  }}>
    <div className="save-image-heading"><strong>Save image</strong><button ref={close} className="icon-button" aria-label="Close save options" onClick={onClose}><X size={18} /></button></div>
    <p className="save-image-name">{item.name}</p>
    {!prepared && !error && <p role="status">Preparing full-size image...</p>}
    {prepared && <>
      {canShare && <><button className="button primary" disabled={sharing} onClick={async () => {
        setError(''); setSharing(true);
        try { await navigator.share({ files: [prepared.file] }); }
        catch (error) { if ((error as Error).name !== 'AbortError') setError('Could not open the share sheet. Try Download or Open image below.'); }
        finally { setSharing(false); }
      }}><Share2 size={16} />Save or share</button><p>Choose Save Image, Photos, or your preferred app in your device's share sheet.</p></>}
      <a className="button" href={prepared.url} download={prepared.file.name}><Download size={16} />Download image</a>
      <a className="button" href={prepared.url} target="_blank" rel="noopener noreferrer">Open image</a>
      <p>To save to your camera roll, open the image and touch and hold it, or use your browser's share menu. Available save options depend on your device.</p>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

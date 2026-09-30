import { useCallback, useEffect, useRef, useState } from 'react';
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, FolderOpen, Maximize, Minimize, Minus, Plus, Scan, ImageOff, Info, X, Grid2X2 } from 'lucide-react';
import { original, bytes, type ImageItem, type Metadata } from './types';

export default function Viewer({ item, index, count, onClose, onPrevious, onNext, onMessage }: {
  item: ImageItem; index: number; count: number; onClose: () => void; onPrevious: () => void; onNext: () => void; onMessage: (message: string) => void;
}) {
  const transform = useRef<ReactZoomPanPinchRef>(null);
  const stage = useRef<HTMLDivElement>(null);
  const currentId = useRef(item.id);
  currentId.current = item.id;
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [scale, setScale] = useState(1), [failed, setFailed] = useState(false), [ready, setReady] = useState(false);
  const [info, setInfo] = useState(false), [fullscreen, setFullscreen] = useState(false);
  const [nearestNeighbor, setNearestNeighbor] = useState(() => localStorage.getItem('lumen.nearestNeighbor') === 'true');
  useEffect(() => { localStorage.setItem('lumen.nearestNeighbor', String(nearestNeighbor)); }, [nearestNeighbor]);
  const nearestRendering = CSS.supports('image-rendering', 'crisp-edges') ? 'crisp-edges' : 'pixelated';
  const fitScale = useCallback(() => {
    if (!stage.current || !dimensions) return 1;
    return Math.min((stage.current.clientWidth - 80) / dimensions.width, (stage.current.clientHeight - 80) / dimensions.height, 1);
  }, [dimensions]);
  const fit = useCallback((duration = 200) => {
    if (!dimensions || !stage.current || !transform.current) return;
    const scale = fitScale();
    transform.current.setTransform((stage.current.clientWidth - dimensions.width * scale) / 2, (stage.current.clientHeight - dimensions.height * scale) / 2, scale, duration);
  }, [dimensions, fitScale]);
  const actual = useCallback(() => {
    if (!stage.current || !dimensions) return;
    transform.current?.setTransform((stage.current.clientWidth - dimensions.width) / 2, (stage.current.clientHeight - dimensions.height) / 2, 1, 220);
  }, [dimensions]);
  useEffect(() => {
    setReady(false); setFailed(false); setDimensions(null); setMetadata(null);
    let alive = true;
    window.lumen.metadata(item.id).then(data => { if (alive) setMetadata(data); }).catch(() => {});
    return () => { alive = false; };
  }, [item.id]);
  useEffect(() => { if (dimensions) { fit(0); setReady(true); } }, [dimensions, fit]);
  useEffect(() => {
    const observer = new ResizeObserver(() => { if (ready && Math.abs((transform.current?.state.scale || 1) - fitScale()) < 0.1) fit(0); });
    if (stage.current) observer.observe(stage.current);
    return () => observer.disconnect();
  }, [ready, fit, fitScale]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); onPrevious(); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); onNext(); }
      else if (event.key === '+' || event.key === '=') transform.current?.zoomIn();
      else if (event.key === '-') transform.current?.zoomOut();
      else if (event.key === '0' || event.key.toLowerCase() === 'f') fit();
      else if (event.key === '1') actual();
      else if (event.key.toLowerCase() === 'i') setInfo(value => !value);
      else if (event.key.toLowerCase() === 'n') setNearestNeighbor(value => !value);
    };
    document.addEventListener('keydown', keydown); return () => document.removeEventListener('keydown', keydown);
  }, [onClose, onNext, onPrevious, fit, actual]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    document.getElementById('viewer-close')?.focus();
    return () => {
      requestAnimationFrame(() => {
        const selected = document.querySelector<HTMLElement>(`[data-image-id="${currentId.current}"]`);
        (selected || previous)?.focus({ preventScroll: true });
      });
    };
  }, []);
  const invoke = (action: Promise<unknown>, message?: string) => action.then(() => { if (message) onMessage(message); }).catch(error => onMessage(error.message));
  return <div className="viewer" role="dialog" aria-modal="true" aria-label={`Viewing ${item.name}`}>
    <header className="viewer-header">
      <button id="viewer-close" className="icon-button" title="Back to collection (Esc)" aria-label="Close viewer" onClick={onClose}><ArrowLeft size={20} /></button>
      <div className="viewer-title"><strong>{item.name}</strong><span title={item.path}>{item.path}</span></div>
      <span className="viewer-counter">{index + 1} / {count.toLocaleString()}</span>
      <button className={`icon-button ${info ? 'active' : ''}`} title="Image details (I)" aria-label="Image details" onClick={() => setInfo(!info)}><Info size={19} /></button>
      <button className="icon-button" title="Fullscreen" aria-label="Toggle fullscreen" onClick={() => invoke(window.lumen.fullscreen().then(setFullscreen))}>{fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}</button>
      <button className="icon-button" title="Close viewer" aria-label="Back to collection" onClick={onClose}><X size={19} /></button>
    </header>
    <div className="viewer-body">
      <div className="viewer-stage" ref={stage}>
        {!ready && !failed && <div className="viewer-loading"><span className="spinner" />Loading original…</div>}
        {failed ? <div className="viewer-error"><ImageOff size={40} /><h2>Unable to display this image</h2><p>The file may be damaged, removed, or use an unsupported codec.</p><button className="button" onClick={() => invoke(window.lumen.reveal(item.id))}><FolderOpen size={16} />Show in Explorer</button></div> :
          <TransformWrapper key={item.id} ref={transform} initialScale={1} minScale={Math.min(0.01, fitScale() / 2)} maxScale={16}
            limitToBounds={false} centerZoomedOut={false}
            // Smooth wheel mode multiplies step by deltaY (usually 100–120 px per tick).
            // Scale the step with current zoom so a tick stays modest even on tiny/huge images.
            wheel={{ step: scale * 0.001 }} doubleClick={{ mode: 'toggle', step: 1 }}
            keyboard={{ disabled: true }} onTransform={(_ref, state) => setScale(state.scale)}>
            <TransformComponent wrapperClass="zoom-wrapper" contentClass="zoom-content">
              <img className="original-image" src={original(item)} alt={item.name} draggable={false}
                style={{ opacity: ready ? 1 : 0, imageRendering: nearestNeighbor && scale > 1 ? nearestRendering : 'auto' }} onLoad={event => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
                onError={() => setFailed(true)} />
            </TransformComponent>
          </TransformWrapper>}
        <button className="viewer-nav previous" aria-label="Previous image" title="Previous (←)" disabled={index === 0} onClick={onPrevious}><ChevronLeft size={26} /></button>
        <button className="viewer-nav next" aria-label="Next image" title="Next (→)" disabled={index === count - 1} onClick={onNext}><ChevronRight size={26} /></button>
      </div>
      {info && <aside className="image-info"><span className="eyebrow">IMAGE DETAILS</span><h3>{item.name}</h3>
        <dl><dt>Dimensions</dt><dd>{dimensions ? `${dimensions.width.toLocaleString()} × ${dimensions.height.toLocaleString()}` : 'Reading…'}</dd>
          <dt>File size</dt><dd>{bytes(item.size)}</dd><dt>Format</dt><dd>{item.extension.toUpperCase()}</dd>
          <dt>Modified</dt><dd>{new Date(item.modified).toLocaleString()}</dd>
          {metadata && <><dt>Color space</dt><dd>{metadata.space || 'Unknown'}</dd><dt>Frames / pages</dt><dd>{metadata.pages}</dd></>}
          <dt>Full path</dt><dd className="full-path">{item.path}</dd></dl>
        <button className="button" onClick={() => invoke(window.lumen.copyPath(item.id), 'Image path copied')}><Copy size={15} />Copy path</button>
        <button className="button" onClick={() => invoke(window.lumen.reveal(item.id))}><FolderOpen size={15} />Show in Explorer</button>
      </aside>}
    </div>
    <footer className="viewer-footer"><span>{dimensions ? `${dimensions.width.toLocaleString()} × ${dimensions.height.toLocaleString()}` : 'Original image'}<i />{bytes(item.size)}</span>
      <div className="zoom-toolbar"><button className="icon-button" title="Zoom out (-)" aria-label="Zoom out" disabled={!ready} onClick={() => transform.current?.zoomOut()}><Minus size={18} /></button>
        <span className="zoom-value">{Math.round(scale * 100)}%</span>
        <button className="icon-button" title="Zoom in (+)" aria-label="Zoom in" disabled={!ready} onClick={() => transform.current?.zoomIn()}><Plus size={18} /></button>
        <i /><button className="text-button" title="Fit to window (F / 0)" disabled={!ready} onClick={() => fit()}><Scan size={16} />Fit</button>
        <button className="text-button" title="Actual size (1)" disabled={!ready} onClick={actual}>1:1</button>
        <i /><button className={`text-button nearest-toggle ${nearestNeighbor ? 'active' : ''}`} title="Nearest neighbor above 100% zoom (N)" aria-label="Nearest neighbor" aria-pressed={nearestNeighbor} onClick={() => setNearestNeighbor(value => !value)}><Grid2X2 size={15} /><span>Nearest</span></button>
      </div><span className="viewer-hint">Scroll to zoom · Drag to pan</span>
    </footer>
  </div>;
}

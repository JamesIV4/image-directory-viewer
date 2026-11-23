import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, FolderOpen, Maximize, Minimize, Minus, Plus, Scan, ImageOff, Info, X, Grid2X2, Download, Play, Pause } from 'lucide-react';
import { original, bytes, type ImageItem, type Metadata } from './types';
import SaveImage from './SaveImage';
import { screenEdge, useTouchSwipe } from './touch-swipe';
import { PlaybackBuffer, type PlaybackDirection } from './playback-buffer';

type Dimensions = { width: number; height: number };
type Layer = { key: string; item: ImageItem; bitmap?: ImageBitmap };
const defaultFps = 12, minFps = 0.1, maxFps = 60;
const validFps = (value: number) => value >= minFps && value <= maxFps;

function ImageLayer({ source, visible, interactive, nearestNeighbor, onReady, onFailure, onScale, onDoubleClick }: {
  source: Layer; visible: boolean; interactive: boolean; nearestNeighbor: boolean;
  onReady: (source: Layer, dimensions: Dimensions, transform: ReactZoomPanPinchRef) => void;
  onFailure: (id: string) => void; onScale: (id: string, scale: number) => void;
  onDoubleClick: () => void;
}) {
  const { item, bitmap, key } = source;
  const layer = useRef<HTMLDivElement>(null), transform = useRef<ReactZoomPanPinchRef>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState<Dimensions | null>(null), [scale, setScale] = useState(1);
  const viewportScale = dimensions && layer.current
    ? Math.min((layer.current.clientWidth - 80) / dimensions.width, (layer.current.clientHeight - 80) / dimensions.height) : 1;
  const fitScale = Math.min(viewportScale, 1);
  const nearestRendering = CSS.supports('image-rendering', 'crisp-edges') ? 'crisp-edges' : 'pixelated';
  const imageRendering = nearestNeighbor && scale > 1 ? nearestRendering : 'auto';
  useLayoutEffect(() => {
    if (!bitmap?.width || !canvas.current) return;
    const { width, height } = bitmap;
    canvas.current.width = width;
    canvas.current.height = height;
    const output = canvas.current.getContext('bitmaprenderer');
    if (output) output.transferFromImageBitmap(bitmap);
    else {
      const context = canvas.current.getContext('2d');
      context?.drawImage(bitmap, 0, 0);
      bitmap.close();
      if (!context) { onFailure(key); return; }
    }
    setDimensions({ width, height });
  }, [bitmap, key, onFailure]);
  useLayoutEffect(() => {
    if (!dimensions || !layer.current || !transform.current) return;
    const scale = Math.min((layer.current.clientWidth - 80) / dimensions.width, (layer.current.clientHeight - 80) / dimensions.height, 1);
    transform.current.setTransform((layer.current.clientWidth - dimensions.width * scale) / 2, (layer.current.clientHeight - dimensions.height * scale) / 2, scale, 0);
    onReady(source, dimensions, transform.current);
  }, [dimensions, source, onReady]);
  return <div className="viewer-image-layer" ref={layer} aria-hidden={!visible} onDoubleClick={onDoubleClick}
    style={{ visibility: visible ? 'visible' : 'hidden', pointerEvents: interactive ? 'auto' : 'none' }}>
    <TransformWrapper ref={transform} initialScale={1} minScale={Math.min(0.01, fitScale / 2)} maxScale={Math.max(16, viewportScale)}
      limitToBounds={false} centerZoomedOut={false}
      // Smooth wheel mode multiplies step by deltaY (usually 100–120 px per tick).
      // Scale the step with current zoom so a tick stays modest even on tiny/huge images.
      wheel={{ step: scale * 0.001 }} doubleClick={{ disabled: true }} keyboard={{ disabled: true }}
      onTransform={(_ref, state) => { setScale(state.scale); onScale(key, state.scale); }}>
      <TransformComponent wrapperClass="zoom-wrapper" contentClass="zoom-content">
        {bitmap ? <canvas ref={canvas} className="original-image" role="img" aria-label={item.name} style={{ imageRendering }} /> :
        <img className="original-image" src={original(item)} alt={item.name} draggable={false} style={{ imageRendering }}
          onLoad={async event => {
            const image = event.currentTarget;
            try {
              await image.decode();
              if (image.isConnected) setDimensions({ width: image.naturalWidth, height: image.naturalHeight });
            } catch { if (image.isConnected) onFailure(key); }
          }} onError={() => onFailure(key)} />}
      </TransformComponent>
    </TransformWrapper>
  </div>;
}

export default function Viewer({ items, index, onClose, onPrevious, onNext, onMessage }: {
  items: ImageItem[]; index: number; onClose: () => void; onPrevious: () => void; onNext: () => void; onMessage: (message: string) => void;
}) {
  const item = items[index], count = items.length;
  const transform = useRef<ReactZoomPanPinchRef>(null);
  const stage = useRef<HTMLDivElement>(null);
  const currentId = useRef(item.id);
  currentId.current = item.id;
  const [submittedFrame, setSubmittedFrame] = useState<{ id: string; bitmap: ImageBitmap } | null>(null);
  const inTransfer = useRef<ImageBitmap | null>(null);
  const bitmap = submittedFrame?.id === item.id ? submittedFrame.bitmap : undefined;
  const activeLayer = useMemo(() => ({ item, bitmap, key: bitmap ? `${item.id}:playback` : item.id }), [item, bitmap]);
  const currentLayer = useRef(activeLayer.key);
  currentLayer.current = activeLayer.key;
  const [displayed, setDisplayed] = useState<{ source: Layer; dimensions: Dimensions } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const failed = failedKey === activeLayer.key, ready = !failed && displayed?.source.key === activeLayer.key;
  const dimensions = ready ? displayed.dimensions : null;
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [scale, setScale] = useState(1);
  const [info, setInfo] = useState(false), [fullscreen, setFullscreen] = useState(false);
  const [saveId, setSaveId] = useState<string | null>(null);
  const [playback, setPlayback] = useState<PlaybackDirection | null>(null);
  const [buffer] = useState(() => new PlaybackBuffer((window.lumen.remote ? 96 : 144) * 1024 * 1024, window.lumen.remote ? 3 : 4));
  const [buffering, setBuffering] = useState(false);
  const warmingUp = useRef(true);
  const [fps, setFps] = useState(() => {
    const saved = Number(localStorage.getItem('lumen.playbackFps'));
    return validFps(saved) ? saved : defaultFps;
  });
  const [nearestNeighbor, setNearestNeighbor] = useState(() => localStorage.getItem('lumen.nearestNeighbor') === 'true');
  useEffect(() => { localStorage.setItem('lumen.nearestNeighbor', String(nearestNeighbor)); }, [nearestNeighbor]);
  useEffect(() => { localStorage.setItem('lumen.playbackFps', String(fps)); }, [fps]);
  const atStart = index <= 0, atEnd = index >= count - 1;
  const playbackEnded = (playback === -1 && atStart) || (playback === 1 && atEnd);
  const stopPlayback = useCallback(() => {
    setPlayback(null);
    setBuffering(false);
    inTransfer.current?.close();
    inTransfer.current = null;
    setSubmittedFrame(null);
  }, []);
  useEffect(() => { if (playbackEnded) stopPlayback(); }, [playbackEnded, stopPlayback]);
  const currentBytes = dimensions ? dimensions.width * dimensions.height * 4 : 0;
  useLayoutEffect(() => {
    if (playback && !playbackEnded) buffer.prepare(items, index, playback, fps, currentBytes);
    else buffer.clear();
  }, [buffer, items, index, playback, playbackEnded, fps, currentBytes]);
  useLayoutEffect(() => () => { buffer.clear(); inTransfer.current?.close(); }, [buffer]);
  const playbackTick = useEffectEvent((direction: PlaybackDirection) => {
    if ((!ready && !failed) || playbackEnded) return;
    const next = items[index + direction];
    if (!next) return;
    const minimum = warmingUp.current ? Math.min(8, Math.ceil(fps * 0.4)) : 1;
    if (!buffer.ready(next.id, minimum)) {
      warmingUp.current = true;
      setBuffering(true);
      return;
    }
    const bitmap = buffer.take(next.id);
    inTransfer.current?.close();
    inTransfer.current = bitmap ?? null;
    setSubmittedFrame(bitmap ? { id: next.id, bitmap } : null);
    warmingUp.current = false;
    setBuffering(false);
    if (direction === 1) onNext();
    else onPrevious();
  });
  useEffect(() => {
    if (!playback || playbackEnded) return;
    const timer = window.setInterval(() => playbackTick(playback), 1000 / fps);
    return () => window.clearInterval(timer);
  }, [playback, playbackEnded, fps]);
  const step = useCallback((direction: PlaybackDirection) => {
    stopPlayback();
    if (direction === 1) onNext();
    else onPrevious();
  }, [onNext, onPrevious, stopPlayback]);
  const togglePlayback = (direction: PlaybackDirection) => {
    setSaveId(null);
    if (playback === direction) stopPlayback();
    else {
      warmingUp.current = true;
      setBuffering(false);
      setPlayback(direction);
    }
  };
  const openSave = () => {
    stopPlayback();
    setSaveId(item.id);
  };
  const imageReady = useCallback((source: Layer, dimensions: Dimensions, controls: ReactZoomPanPinchRef) => {
    if (source.key !== currentLayer.current) return;
    transform.current = controls;
    setFailedKey(null);
    setScale(controls.state.scale);
    setDisplayed({ source, dimensions });
  }, []);
  const imageFailure = useCallback((key: string) => { if (key === currentLayer.current) setFailedKey(key); }, []);
  const imageScale = useCallback((key: string, scale: number) => { if (key === currentLayer.current) setScale(scale); }, []);
  // Keep the fitted image mounted until its decoded replacement is ready to paint.
  const layers = displayed && displayed.source.key !== activeLayer.key ? [displayed.source, activeLayer] : [activeLayer];
  const fitScale = useCallback(() => {
    if (!stage.current || !dimensions) return 1;
    return Math.min((stage.current.clientWidth - 80) / dimensions.width, (stage.current.clientHeight - 80) / dimensions.height);
  }, [dimensions]);
  const fit = useCallback((duration = 200) => {
    if (!dimensions || !stage.current || !transform.current) return;
    const scale = fitScale();
    transform.current.setTransform((stage.current.clientWidth - dimensions.width * scale) / 2, (stage.current.clientHeight - dimensions.height * scale) / 2, scale, duration);
  }, [dimensions, fitScale]);
  useTouchSwipe(stage, (x, _y, target) => {
    // Accept touches on both the fitted image and its surrounding viewer area.
    // The wrapper excludes navigation buttons and other viewer controls.
    if (screenEdge(x) || !ready || saveId === item.id || !(target instanceof Element) || !target.closest('.zoom-wrapper')) return null;
    const fitted = fitScale();
    const currentScale = transform.current?.state.scale ?? scale;
    if (currentScale > Math.min(fitted, 1) * 1.01 && Math.abs(currentScale - fitted) > fitted * 0.01) return null;
    return direction => {
      if (direction === 'left') step(1);
      else if (direction === 'right') step(-1);
      else onClose();
    };
  });
  const actual = useCallback(() => {
    if (!stage.current || !dimensions) return;
    transform.current?.setTransform((stage.current.clientWidth - dimensions.width) / 2, (stage.current.clientHeight - dimensions.height) / 2, 1, 220);
  }, [dimensions]);
  const toggleZoom = useCallback(() => {
    if (!ready || !transform.current) return;
    if (Math.abs(transform.current.state.scale - 1) < 0.001) fit();
    else actual();
  }, [ready, fit, actual]);
  useEffect(() => {
    setMetadata(null);
    if (!info) return;
    let alive = true;
    window.lumen.metadata(item.id).then(data => { if (alive) setMetadata(data); }).catch(() => {});
    return () => { alive = false; };
  }, [item.id, info]);
  useEffect(() => {
    const observer = new ResizeObserver(() => { if (ready && Math.abs((transform.current?.state.scale || 1) - fitScale()) < 0.1) fit(0); });
    if (stage.current) observer.observe(stage.current);
    return () => observer.disconnect();
  }, [ready, fit, fitScale]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
      else if (ready && (event.key === '+' || event.key === '=')) transform.current?.zoomIn();
      else if (ready && event.key === '-') transform.current?.zoomOut();
      else if (event.key === '0' || event.key.toLowerCase() === 'f') fit();
      else if (event.key === '1') actual();
      else if (event.key.toLowerCase() === 'i') setInfo(value => !value);
      else if (event.key.toLowerCase() === 'n') setNearestNeighbor(value => !value);
    };
    document.addEventListener('keydown', keydown); return () => document.removeEventListener('keydown', keydown);
  }, [onClose, step, fit, actual, ready]);
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
      {window.lumen.remote && <button className="icon-button" title="Save image" aria-label="Save image" aria-expanded={saveId === item.id} onClick={() => saveId === item.id ? setSaveId(null) : openSave()}><Download size={19} /></button>}
      <button className={`icon-button ${info ? 'active' : ''}`} title="Image details (I)" aria-label="Image details" onClick={() => setInfo(!info)}><Info size={19} /></button>
      <button className="icon-button" title="Fullscreen" aria-label="Toggle fullscreen" onClick={() => invoke(window.lumen.fullscreen().then(setFullscreen))}>{fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}</button>
      <button className="icon-button" title="Close viewer" aria-label="Back to collection" onClick={onClose}><X size={19} /></button>
    </header>
    {window.lumen.remote && saveId === item.id && <SaveImage key={item.id} item={item} onClose={() => setSaveId(null)} />}
    <div className="viewer-body">
      <div className="viewer-stage" ref={stage}>
        {!displayed && !failed && <div className="viewer-loading"><span className="spinner" />Loading original…</div>}
        {layers.map(layer => <ImageLayer key={layer.key} source={layer} visible={!failed && displayed?.source.key === layer.key}
          interactive={ready && layer.key === activeLayer.key} nearestNeighbor={nearestNeighbor}
          onReady={imageReady} onFailure={imageFailure} onScale={imageScale} onDoubleClick={toggleZoom} />)}
        {buffering && <span className="playback-buffering" role="status">Buffering frames…</span>}
        {failed && <div className="viewer-error"><ImageOff size={40} /><h2>Unable to display this image</h2><p>The file may be damaged, removed, or use an unsupported codec.</p><button className="button" onClick={() => invoke(window.lumen.reveal(item.id))}><FolderOpen size={16} />Show in Explorer</button></div>}
        <button className="viewer-nav previous" aria-label="Previous image" title="Previous (←)" disabled={atStart} onClick={() => step(-1)}><ChevronLeft size={26} /></button>
        <button className="viewer-nav next" aria-label="Next image" title="Next (→)" disabled={atEnd} onClick={() => step(1)}><ChevronRight size={26} /></button>
      </div>
      {info && <aside className="image-info"><span className="eyebrow">IMAGE DETAILS</span><h3>{item.name}</h3>
        <dl><dt>Dimensions</dt><dd>{dimensions ? `${dimensions.width.toLocaleString()} × ${dimensions.height.toLocaleString()}` : 'Reading…'}</dd>
          <dt>File size</dt><dd>{bytes(item.size)}</dd><dt>Format</dt><dd>{item.extension.toUpperCase()}</dd>
          <dt>Modified</dt><dd>{new Date(item.modified).toLocaleString()}</dd>
          {metadata && <><dt>Color space</dt><dd>{metadata.space || 'Unknown'}</dd><dt>Frames / pages</dt><dd>{metadata.pages}</dd></>}
          <dt>Full path</dt><dd className="full-path">{item.path}</dd></dl>
        <button className="button" onClick={() => invoke(window.lumen.copyPath(item.id), 'Image path copied')}><Copy size={15} />Copy path</button>
        {window.lumen.remote && <button className="button" onClick={openSave}><Download size={15} />Save image</button>}
        <button className="button" onClick={() => invoke(window.lumen.reveal(item.id))}><FolderOpen size={15} />Show in Explorer</button>
      </aside>}
    </div>
    <footer className="viewer-footer"><div className="viewer-footer-meta">
      <span className="viewer-summary">{dimensions ? `${dimensions.width.toLocaleString()} × ${dimensions.height.toLocaleString()}` : 'Original image'}<i />{bytes(item.size)}</span>
      <span className="viewer-hint">{window.lumen.remote ? 'Pinch to zoom · Swipe at fit to browse or close' : 'Scroll to zoom · Drag to pan'}</span>
    </div>
      <div className="zoom-toolbar"><button className="icon-button" title="Zoom out (-)" aria-label="Zoom out" disabled={!ready} onClick={() => transform.current?.zoomOut()}><Minus size={18} /></button>
        <span className="zoom-value">{Math.round(scale * 100)}%</span>
        <button className="icon-button" title="Zoom in (+)" aria-label="Zoom in" disabled={!ready} onClick={() => transform.current?.zoomIn()}><Plus size={18} /></button>
        <i /><button className="text-button" title="Fit to window (F / 0)" disabled={!ready} onClick={() => fit()}><Scan size={16} />Fit</button>
        <button className="text-button" title="Actual size (1)" disabled={!ready} onClick={actual}>1:1</button>
        <i /><button className={`text-button nearest-toggle ${nearestNeighbor ? 'active' : ''}`} title="Nearest neighbor above 100% zoom (N)" aria-label="Nearest neighbor" aria-pressed={nearestNeighbor} onClick={() => setNearestNeighbor(value => !value)}><Grid2X2 size={15} /><span>Nearest</span></button>
      </div>
      <div className="playback-toolbar" role="group" aria-label="Image playback">
        <button className={`icon-button ${playback === -1 ? 'active' : ''}`} disabled={atStart} aria-label={playback === -1 ? 'Pause playback' : 'Play backward'}
          title={playback === -1 ? 'Pause playback' : 'Play backward'} onClick={() => togglePlayback(-1)}>
          {playback === -1 ? <Pause size={17} /> : <Play className="reverse-play" size={17} />}
        </button>
        <button className={`icon-button ${playback === 1 ? 'active' : ''}`} disabled={atEnd} aria-label={playback === 1 ? 'Pause playback' : 'Play forward'}
          title={playback === 1 ? 'Pause playback' : 'Play forward'} onClick={() => togglePlayback(1)}>
          {playback === 1 ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <label className="playback-rate" title={`Playback frame rate (${minFps}–${maxFps} FPS)`}>
          <input aria-label="Playback frame rate" type="number" min={minFps} max={maxFps} step="any" defaultValue={fps}
            onChange={event => { if (validFps(event.target.valueAsNumber)) setFps(event.target.valueAsNumber); }}
            onBlur={event => { event.target.value = String(fps); }} /> FPS
        </label>
      </div>
    </footer>
  </div>;
}

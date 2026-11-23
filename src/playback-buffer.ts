import FrameWorker from './playback-frame.worker?worker&inline';
import { original, type ImageItem } from './types';

export type PlaybackDirection = -1 | 1;
type Loader = { worker: Worker; id: string | null };

const maxFrames = 32;
const rgbaBytes = (bitmap: ImageBitmap) => bitmap.width * bitmap.height * 4;

export class PlaybackBuffer {
  private loaders = new Set<Loader>();
  private frames = new Map<string, ImageBitmap | null>();
  private upcoming: ImageItem[] = [];
  private bytes = 0;
  private estimate = 4 * 1024 * 1024;
  private nativeOnly = false;

  constructor(private budget: number, private parallel: number) {}

  prepare(items: ImageItem[], index: number, direction: PlaybackDirection, fps: number, currentBytes: number) {
    const depth = Math.min(maxFrames, Math.max(6, Math.ceil(fps * 2)));
    const upcoming: ImageItem[] = [];
    for (let i = index + direction; items[i] && upcoming.length < depth; i += direction) upcoming.push(items[i]);
    this.upcoming = upcoming;
    if (currentBytes) this.estimate = currentBytes;
    const keep = new Set(upcoming.map(item => item.id));
    for (const id of this.frames.keys()) if (!keep.has(id)) this.evict(id);
    for (const loader of this.loaders) {
      if (loader.id && !keep.has(loader.id)) this.stop(loader);
    }
    this.fill();
  }

  ready(id: string, minimum: number) {
    if (this.upcoming[0]?.id !== id) return false;
    let available = 0;
    for (const item of this.upcoming) {
      if (!this.frames.has(item.id)) break;
      available++;
    }
    // Large originals may fill the memory budget before we reach the startup target.
    return available >= Math.min(minimum, this.upcoming.length) || (available > 0 && !this.running());
  }

  take(id: string) {
    const bitmap = this.frames.get(id);
    this.frames.delete(id);
    if (bitmap) this.bytes -= rgbaBytes(bitmap);
    this.upcoming.shift();
    return bitmap;
  }

  clear() {
    this.upcoming = [];
    for (const loader of this.loaders) this.stop(loader);
    for (const id of this.frames.keys()) this.evict(id);
  }

  private running() {
    return Array.from(this.loaders).filter(loader => loader.id).length;
  }

  private stop(loader: Loader) {
    loader.worker.terminate();
    this.loaders.delete(loader);
  }

  private evict(id: string) {
    const bitmap = this.frames.get(id);
    if (bitmap) {
      this.bytes -= rgbaBytes(bitmap);
      bitmap.close();
    }
    this.frames.delete(id);
  }

  private fill() {
    if (this.nativeOnly) {
      for (const { id } of this.upcoming) if (!this.frames.has(id)) this.frames.set(id, null);
      return;
    }
    const requested = new Set(Array.from(this.loaders, loader => loader.id));
    let running = this.running();
    for (const item of this.upcoming) {
      if (this.frames.has(item.id) || requested.has(item.id)) continue;
      const next = item === this.upcoming[0];
      if (running >= this.parallel || (!next && this.bytes + (running + 1) * this.estimate > this.budget)) break;
      const loader = Array.from(this.loaders).find(loader => !loader.id) ?? this.spawn();
      if (!loader) return;
      loader.id = item.id;
      loader.worker.postMessage(original(item));
      running++;
    }
  }

  private spawn(): Loader | undefined {
    try {
      const worker = new FrameWorker();
      const loader: Loader = { worker, id: null };
      this.loaders.add(loader);
      worker.onmessage = ({ data: { bitmap } }: MessageEvent<{ bitmap: ImageBitmap | null }>) => {
        const id = loader.id;
        if (!id || !this.loaders.has(loader)) { bitmap?.close(); return; }
        loader.id = null;
        this.frames.set(id, bitmap);
        if (bitmap) {
          const size = rgbaBytes(bitmap);
          this.estimate = Math.max(this.estimate, size);
          this.bytes += size;
          // Keep the nearest frame even when a single original exceeds the preview budget.
          for (let i = this.upcoming.length - 1; i > 0 && this.bytes > this.budget; i--) this.evict(this.upcoming[i].id);
        }
        this.fill();
      };
      worker.onerror = event => { event.preventDefault(); this.fallback(); };
      worker.onmessageerror = () => this.fallback();
      return loader;
    } catch {
      this.fallback();
    }
  }

  private fallback() {
    this.nativeOnly = true;
    for (const loader of this.loaders) this.stop(loader);
    this.fill();
  }
}

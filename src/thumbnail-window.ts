import { thumbnail, type ImageItem } from './types';

const radius = 500;
const maxBytes = 48 * 1024 * 1024;
const parallel = 4;
const belowBatch = 150, aboveBatch = 100;

type Preview = { url: string | null; bytes: number };

export class ThumbnailWindow {
  private previews = new Map<string, Preview>();
  private listeners = new Map<string, Set<() => void>>();
  private pending = new Map<string, AbortController>();
  private visible = new Set<string>();
  private order: ImageItem[] = [];
  private cursor = 0;
  private bytes = 0;
  private prefetchFull = false;

  get(id: string) { return this.previews.get(id)?.url; }

  subscribe(id: string, listener: () => void) {
    if (!this.listeners.has(id)) this.listeners.set(id, new Set());
    const listeners = this.listeners.get(id)!;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(id);
    };
  }

  show(items: ImageItem[], start: number, end: number) {
    const inView = items.slice(start, end);
    const order = [...inView];
    const before = Math.max(0, start - radius), after = Math.min(items.length, end + radius);
    for (let below = end, above = start; below < after || above > before; below += belowBatch, above -= aboveBatch) {
      order.push(...items.slice(below, Math.min(below + belowBatch, after)));
      if (above > before) order.push(...items.slice(Math.max(before, above - aboveBatch), above).reverse());
    }

    const keep = new Set(order.map(item => item.id));
    const visible = new Set(inView.map(item => item.id));
    for (const id of this.previews.keys()) if (!keep.has(id)) this.evict(id);
    // After a jump, start with the new viewport even if an old request is still within the buffer.
    this.cancelOutside(inView.some(item => this.visible.has(item.id)) ? keep : visible);
    this.visible = visible;
    this.order = order;
    this.cursor = 0;
    this.prefetchFull = false;
    this.drain();
  }

  pause() {
    this.order = [];
    this.cancelOutside(new Set());
  }

  clear() {
    this.pause();
    for (const id of this.previews.keys()) this.evict(id);
  }

  private cancelOutside(keep: Set<string>) {
    for (const [id, controller] of this.pending) {
      if (keep.has(id)) continue;
      this.pending.delete(id);
      controller.abort();
    }
  }

  private evict(id: string) {
    const preview = this.previews.get(id);
    if (!preview) return;
    if (preview.url) URL.revokeObjectURL(preview.url);
    this.bytes -= preview.bytes;
    this.previews.delete(id);
    this.notify(id);
  }

  private notify(id: string) {
    this.listeners.get(id)?.forEach(listener => listener());
  }

  private drain() {
    while (this.pending.size < parallel && this.cursor < this.order.length) {
      const item = this.order[this.cursor];
      if (this.previews.has(item.id) || this.pending.has(item.id)) {
        this.cursor++;
        continue;
      }
      // Leave one request slot free for visible images during scrolling.
      if (!this.visible.has(item.id) && (this.pending.size >= parallel - 1 || this.prefetchFull)) break;
      this.cursor++;
      const controller = new AbortController();
      this.pending.set(item.id, controller);
      void this.load(item, controller);
    }
  }

  private async load(item: ImageItem, controller: AbortController) {
    try {
      const response = await fetch(thumbnail(item), { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Thumbnail unavailable');
      const blob = await response.blob();
      if (controller.signal.aborted) return;

      if (this.visible.has(item.id) && this.bytes + blob.size > maxBytes) {
        // A visible preview can displace the farthest prefetched previews.
        for (let i = this.order.length - 1; i >= this.visible.size && this.bytes + blob.size > maxBytes; i--) {
          this.evict(this.order[i].id);
        }
      }
      if (!this.visible.has(item.id) && this.bytes + blob.size > maxBytes) {
        this.prefetchFull = true;
        return;
      }
      this.bytes += blob.size;
      this.previews.set(item.id, { url: URL.createObjectURL(blob), bytes: blob.size });
      this.notify(item.id);
    } catch {
      if (controller.signal.aborted) return;
      this.previews.set(item.id, { url: null, bytes: 0 });
      this.notify(item.id);
    } finally {
      if (!controller.signal.aborted) {
        this.pending.delete(item.id);
        this.drain();
      }
    }
  }
}

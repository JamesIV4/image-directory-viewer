import { thumbnail, type ImageItem } from './types';

type Request = { controller: AbortController; visible: boolean; ticket: number };
type Thumbnail = { item: ImageItem; visible: boolean };
let lastTicket = 0;

export class ViewportThumbnails {
  private queue: Thumbnail[] = [];
  private requests = new Map<string, Request>();
  private previews = new Map<string, string | null>();
  private listeners = new Map<string, Set<() => void>>();

  get(id: string) { return this.previews.get(id); }

  subscribe(id: string, listener: () => void) {
    const listeners = this.listeners.get(id) ?? new Set();
    this.listeners.set(id, listeners);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(id);
    };
  }

  show(visible: ImageItem[], nearby: ImageItem[]) {
    this.queue = [...visible.map(item => ({ item, visible: true })), ...nearby.map(item => ({ item, visible: false }))];
    const wanted = new Map(this.queue.map(({ item, visible }) => [item.id, visible]));
    this.cancelObsolete(wanted);
    for (const [id, url] of this.previews) {
      if (wanted.has(id)) continue;
      this.previews.delete(id);
      if (url) URL.revokeObjectURL(url);
      this.notify(id);
    }
    this.drain();
  }

  clear() { this.show([], []); }

  pause() {
    this.queue = [];
    this.cancelObsolete(new Map());
  }

  private cancelObsolete(wanted: Map<string, boolean>) {
    let canceled = false;
    for (const [id, request] of this.requests) {
      if (wanted.get(id) === request.visible) continue;
      this.requests.delete(id);
      request.controller.abort();
      canceled = true;
    }
    if (canceled) window.lumen.retainThumbnailRequests?.(lastTicket, [...this.requests.values()].map(request => request.ticket));
  }

  private notify(id: string) { this.listeners.get(id)?.forEach(listener => listener()); }

  private drain() {
    for (const { item, visible } of this.queue) {
      if (this.previews.has(item.id) || this.requests.has(item.id)) continue;
      // The host has four decoders. Leave room to start a new viewport while old decodes wind down.
      if (this.requests.size >= (visible ? 3 : 2)) break;
      const request = { controller: new AbortController(), visible, ticket: ++lastTicket };
      this.requests.set(item.id, request);
      void this.load(item, request);
    }
  }

  private async load(item: ImageItem, { controller, visible, ticket }: Request) {
    const { signal } = controller;
    let url: string | null = null;
    try {
      const source = new URL(thumbnail(item));
      if (!visible) source.searchParams.set('priority', 'nearby');
      if (window.lumen.retainThumbnailRequests) source.searchParams.set('request', String(ticket));
      const response = await fetch(source, { signal });
      if (response.ok) {
        const blob = await response.blob();
        if (!signal.aborted) url = URL.createObjectURL(blob);
      }
    } catch { /* A failed thumbnail leaves the preview placeholder. */ }
    if (signal.aborted) return;
    this.requests.delete(item.id);
    this.previews.set(item.id, url);
    this.notify(item.id);
    this.drain();
  }
}

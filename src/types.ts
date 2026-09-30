export interface ImageItem {
  id: string; name: string; path: string; relativePath: string; folder: string;
  size: number; modified: number; extension: string;
}
export interface Folder { path: string; name: string; ownCount: number; count: number }
export interface Snapshot { root: string; items: ImageItem[]; folders: Folder[]; warnings: string[]; scannedAt: number }
export interface Metadata { width?: number; height?: number; format: string; pages: number; space?: string; hasAlpha: boolean }
export type IndexEvent = { generation: number } & (
  { type: 'start'; root: string; refresh: boolean } | { type: 'batch'; items: ImageItem[] } |
  { type: 'progress'; files: number; directories: number } |
  { type: 'cached' | 'complete'; data: Snapshot } | { type: 'error'; message: string }
);
declare global {
  interface Window {
    lumen: {
      getState(): Promise<{ root: string; recent: string[]; scanning: boolean; snapshot: Snapshot | null; generation: number }>;
      openFolder(path?: string): Promise<{ root: string; recent: string[] } | null>;
      rescan(): Promise<unknown>; cancel(): Promise<unknown>;
      metadata(id: string): Promise<Metadata>; reveal(id: string): Promise<void>; copyPath(id: string): Promise<void>;
      fullscreen(): Promise<boolean>; droppedPath(file: File): string;
      onIndex(callback: (event: IndexEvent) => void): () => void;
    }
  }
}
export const thumbnail = (item: ImageItem) => `lumen://thumb/${item.id}`;
export const original = (item: ImageItem) => `lumen://image/${item.id}`;
export const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
export const rootName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

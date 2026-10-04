import type { View } from './Library';

export type BrowsingState = {
  folder: string; recursive: boolean; folderRules: [string, boolean][]; excludedDirectImages: string[];
  includeFolders: string; excludeFolders: string; query: string; extension: string;
  newerThan: string; olderThan: string; dateBoundsInclusive: boolean; dateFiltersOpen: boolean;
  descending: boolean; sort: string; view: View; size: number; controlsCollapsed: boolean;
};
type Stored = { lastRoot: string; libraries: Record<string, BrowsingState> };
const key = () => `lumen.browsing:${window.lumen.remote?.base ?? 'desktop'}`;
export function readBrowsing(): Stored {
  try {
    const data = JSON.parse(localStorage.getItem(key()) || 'null');
    if (typeof data?.lastRoot === 'string' && data.libraries && typeof data.libraries === 'object') return data;
  } catch { /* Storage may be unavailable or from an older version. */ }
  return { lastRoot: '', libraries: {} };
}
export function defaultBrowsing(): BrowsingState {
  const saved = <T,>(key: string, fallback: T): T => {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
  };
  return { folder: '', recursive: true, folderRules: [], excludedDirectImages: [],
    includeFolders: saved('lumen.includeFolders', ''), excludeFolders: saved('lumen.excludeFolders', ''),
    query: '', extension: 'all', newerThan: '', olderThan: '', dateBoundsInclusive: false, dateFiltersOpen: false,
    descending: false, sort: saved('lumen.sort', 'name'), view: saved('lumen.view', 'grid'),
    size: saved('lumen.size', window.lumen.remote && window.innerWidth <= 600 ? 150 : 230),
    controlsCollapsed: saved('lumen.controlsCollapsed', false) };
}
export function writeBrowsing(root: string, state: BrowsingState) {
  try {
    const stored = readBrowsing();
    stored.lastRoot = root; stored.libraries[root] = state;
    localStorage.setItem(key(), JSON.stringify(stored));
  } catch { /* Browsing still works when storage is disabled. */ }
}

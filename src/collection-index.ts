import type { Folder, ImageItem } from './types';

type FolderImages = { all: ImageItem[]; byExtension: Map<string, ImageItem[]> };

export function indexCollection(items: ImageItem[]) {
  const folders = new Map<string, FolderImages>();
  const extensions = new Set<string>();
  for (const item of items) {
    let folder = folders.get(item.folder);
    if (!folder) {
      folder = { all: [], byExtension: new Map() };
      folders.set(item.folder, folder);
    }
    folder.all.push(item);
    let ofType = folder.byExtension.get(item.extension);
    if (!ofType) {
      ofType = [];
      folder.byExtension.set(item.extension, ofType);
    }
    ofType.push(item);
    extensions.add(item.extension);
  }
  return { folders, folderPaths: [...folders.keys()].sort(), extensions: [...extensions].sort() };
}

export function summarizeFolders(index: ReturnType<typeof indexCollection>, folders: Folder[], includesFolder: (path: string) => boolean) {
  const includedFolders = new Set<string>();
  const includedCounts = new Map<string, number>();
  const folderCounts = new Map(folders.map(folder => [folder.path, { ...folder, count: 0, ownCount: 0 }]));
  for (const [path, images] of index.folders) {
    const count = images.all.length;
    const directFolder = folderCounts.get(path);
    if (directFolder) directFolder.ownCount = count;
    const included = !!directFolder && includesFolder(path);
    if (included) includedFolders.add(path);
    let current = path;
    while (true) {
      const folder = folderCounts.get(current);
      if (folder) folder.count += count;
      if (included) includedCounts.set(current, (includedCounts.get(current) || 0) + count);
      if (!current) break;
      const slash = current.lastIndexOf('/');
      current = slash < 0 ? '' : current.slice(0, slash);
    }
  }
  return { includedFolders, includedCounts, galleryFolders: [...folderCounts.values()] };
}

function lowerBound(paths: string[], prefix: string) {
  let start = 0, end = paths.length;
  while (start < end) {
    const mid = Math.floor((start + end) / 2);
    if (paths[mid] < prefix) start = mid + 1;
    else end = mid;
  }
  return start;
}

export function selectCollection(index: ReturnType<typeof indexCollection>, folder: string, recursive: boolean,
  extension: string, includedFolders: ReadonlySet<string>) {
  const items: ImageItem[] = [];
  let hiddenInScope = 0;
  const add = (path: string, images: FolderImages) => {
    if (!includedFolders.has(path)) {
      hiddenInScope += images.all.length;
      return;
    }
    const matching = extension === 'all' ? images.all : images.byExtension.get(extension);
    if (matching) for (const item of matching) items.push(item);
  };

  if (!folder && recursive) {
    for (const [path, images] of index.folders) add(path, images);
  } else {
    const direct = index.folders.get(folder);
    if (direct) add(folder, direct);
    if (recursive) {
      // All paths under this branch are contiguous in the sorted folder list.
      const prefix = `${folder}/`;
      const paths = index.folderPaths;
      for (let i = lowerBound(paths, prefix); i < paths.length && paths[i].startsWith(prefix); i++) {
        const path = paths[i];
        add(path, index.folders.get(path)!);
      }
    }
  }
  return { items, hiddenInScope };
}

const searchablePaths = new WeakMap<ImageItem, string>();
export function matchesPath(item: ImageItem, query: string) {
  if (!query) return true;
  let path = searchablePaths.get(item);
  if (path === undefined) {
    path = item.relativePath.toLocaleLowerCase();
    searchablePaths.set(item, path);
  }
  return path.includes(query);
}

const recentSearches = new WeakMap<ImageItem[], { query: string; matches: ImageItem[] }>();
export function searchCollection(items: ImageItem[], query: string) {
  if (!query) {
    recentSearches.delete(items);
    return items;
  }
  const previous = recentSearches.get(items);
  if (previous?.query === query) return previous.matches;
  // Extending a substring query can only narrow the previous result.
  const candidates = previous && query.startsWith(previous.query) ? previous.matches : items;
  const matches = candidates.filter(item => matchesPath(item, query));
  recentSearches.set(items, { query, matches });
  return matches;
}

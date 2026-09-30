// Most-specific folder rule wins. A child can be included inside an excluded
// parent, and changing a branch clears older rules below it.
export type FolderRules = Map<string, boolean>;
export function folderIncluded(folder: string, rules: FolderRules): boolean {
  let current = folder;
  while (true) {
    if (rules.has(current)) return rules.get(current)!;
    if (!current) return true;
    const slash = current.lastIndexOf('/');
    current = slash < 0 ? '' : current.slice(0, slash);
  }
}
export function setBranchIncluded(rules: FolderRules, folder: string, included: boolean): FolderRules {
  const next = new Map(rules);
  for (const key of next.keys()) if (!folder || key === folder || key.startsWith(folder + '/')) next.delete(key);
  // An override is only necessary when it differs from the inherited value.
  if (folderIncluded(folder, next) !== included) next.set(folder, included);
  return next;
}

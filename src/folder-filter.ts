import picomatch from 'picomatch';

// Commas inside glob braces or character classes belong to that pattern.
export function splitFolderPatterns(input: string): string[] {
  const patterns: string[] = [];
  let start = 0, braces = 0, brackets = 0;
  for (let i = 0; i < input.length; i++) {
    const character = input[i];
    if (character === '[') brackets++;
    else if (character === ']') brackets = Math.max(0, brackets - 1);
    else if (!brackets && character === '{') braces++;
    else if (!brackets && character === '}') braces = Math.max(0, braces - 1);
    else if (character === ',' && !braces && !brackets) { patterns.push(input.slice(start, i).trim()); start = i + 1; }
  }
  patterns.push(input.slice(start).trim());
  return patterns.filter(Boolean);
}

function compileFolderPatterns(input: string): ((folder: string) => boolean)[] {
  return splitFolderPatterns(input).map(value => {
    const normalized = value.replace(/\\/g, '/');
    const anchored = normalized.startsWith('./') || normalized.startsWith('/');
    const pattern = normalized.replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
    if (!pattern || pattern === '.' || pattern === '**') return () => true;
    const matches = picomatch(anchored ? pattern : `**/${pattern}`, {
      dot: true, nocase: true, windows: false, nonegate: true, noext: true,
    });
    return folder => matches(folder);
  });
}

// A matching folder includes its descendants. Include is an optional allowlist;
// exclude always wins. Compile once per input change, then reuse for the tree.
export function createFolderPatternFilter(include: string, exclude: string): (folder: string) => boolean {
  const inclusions = compileFolderPatterns(include), exclusions = compileFolderPatterns(exclude);
  return folder => {
    const ancestors: string[] = [];
    let current = folder;
    while (true) {
      ancestors.push(current);
      if (!current) break;
      const slash = current.lastIndexOf('/');
      current = slash < 0 ? '' : current.slice(0, slash);
    }
    const matches = (patterns: ((folder: string) => boolean)[]) => patterns.some(match => ancestors.some(match));
    return (!inclusions.length || matches(inclusions)) && !matches(exclusions);
  };
}

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

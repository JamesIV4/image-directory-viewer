const { test } = require('node:test');
const assert = require('node:assert/strict');

test('comma-separated folder patterns support nested branches, globs, and exclusion precedence', async () => {
  const { createFolderPatternFilter: filter, splitFolderPatterns } = await import('../src/folder-filter.ts');
  assert.deepEqual(splitFolderPatterns(' Photos, , {Screenshots,Scans}, [a,b] '), ['Photos', '{Screenshots,Scans}', '[a,b]']);
  const included = filter(' Photos, {Screenshots,Scans} ', '**/Cache, Thumbnails');
  for (const folder of ['Photos', 'Archive/Photos/Trip', 'Scans', 'Screenshots/Today']) assert.equal(included(folder), true, folder);
  for (const folder of ['', 'Other', 'Photos Extra', 'Photos/Cache/Small', 'Archive/Photos/Thumbnails']) assert.equal(included(folder), false, folder);
  assert.equal(filter('./Photos', '')('Photos/Trip'), true);
  assert.equal(filter('./Photos', '')('Archive/Photos'), false);
  assert.equal(filter('Photos\\Trip', '')('Photos/Trip/Day 1'), true);
  assert.equal(filter('photo?', '')('Archive/Photos'), true);
  assert.equal(filter('Trip[1-3]', '')('Trip2/Day1'), true);
  assert.equal(filter('', '.git, **/cache/**')('.git/objects'), false);
  assert.equal(filter('', '.git, **/cache/**')('Photos/cache'), false);
  assert.equal(filter(' , ', ' , ')(''), true);
  assert.equal(filter('.', '')(''), true);
  // A partly entered pattern is safe while typing.
  assert.doesNotThrow(() => filter('[', '{')('Photos'));
});

test('folder inclusion respects branch boundaries, child exceptions, and subtree resets', async () => {
  const { folderIncluded, setBranchIncluded } = await import('../src/folder-filter.ts');
  let rules = setBranchIncluded(new Map(), 'Photos', false);
  assert.equal(folderIncluded('Photos', rules), false);
  assert.equal(folderIncluded('Photos/Trip/Day 1', rules), false);
  assert.equal(folderIncluded('Photos Extra', rules), true);
  assert.equal(folderIncluded('', rules), true);
  rules = setBranchIncluded(rules, 'Photos/Trip', true);
  assert.equal(folderIncluded('Photos/Trip/Day 1', rules), true);
  assert.equal(folderIncluded('Photos/Other', rules), false);
  rules = setBranchIncluded(rules, 'Photos', true);
  assert.equal(rules.size, 0);
  rules = setBranchIncluded(rules, '', false);
  assert.equal(folderIncluded('Photos/Trip', rules), false);
  rules = setBranchIncluded(rules, 'Photos/Trip', true);
  assert.equal(folderIncluded('Photos/Trip/Day 1', rules), true);
  assert.equal(folderIncluded('Other', rules), false);
  rules = setBranchIncluded(rules, '', true);
  assert.equal(rules.size, 0);
});

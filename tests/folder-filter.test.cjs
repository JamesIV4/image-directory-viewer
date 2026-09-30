const { test } = require('node:test');
const assert = require('node:assert/strict');

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

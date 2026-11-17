const { test } = require('node:test');
const assert = require('node:assert/strict');

const image = relativePath => ({
  relativePath,
  folder: relativePath.slice(0, Math.max(0, relativePath.lastIndexOf('/'))),
  extension: relativePath.split('.').at(-1).toLowerCase(),
});

test('collection scopes skip unrelated branches and select only indexed file types', async () => {
  const { indexCollection, selectCollection, summarizeFolders } = await import('../src/collection-index.ts');
  const items = ['Photos Extra/Side.png', 'Photos/Trip/Day 1.JPG', 'Root.png', 'Photos/Trip/Day 2.PNG',
    'Photos/Skip/Hidden.png', 'Photos/Trip-old/Old.png'].map(image);
  const index = indexCollection(items);
  const folders = ['', 'Photos', ...index.folderPaths.filter(Boolean), 'Empty'].map(path => ({ path }));
  const { includedFolders: included, includedCounts, galleryFolders } = summarizeFolders(index, folders, path => path !== 'Photos/Skip');
  const totals = new Map(galleryFolders.map(folder => [folder.path, [folder.count, folder.ownCount]]));
  assert.deepEqual(totals.get('Photos'), [4, 0]);
  assert.deepEqual(totals.get('Empty'), [0, 0]);
  assert.equal(includedCounts.get('Photos'), 3);
  assert.deepEqual(index.extensions, ['jpg', 'png']);
  assert.deepEqual(selectCollection(index, 'Photos', true, 'png', included), { items: [items[3], items[5]], hiddenInScope: 1 });
  assert.deepEqual(selectCollection(index, 'Photos/Trip', true, 'all', included).items, [items[1], items[3]]);
  assert.deepEqual(selectCollection(index, 'Photos', false, 'all', included).items, []);
  assert.deepEqual(selectCollection(index, '', false, 'all', included).items, [items[2]]);
  assert.deepEqual(selectCollection(index, 'Empty', true, 'all', included).items, []);
});

test('refined path searches preserve order and broaden again after deletion or scope changes', async () => {
  const { searchCollection } = await import('../src/collection-index.ts');
  const [first, second, third] = ['Gallery/FOREST.PNG', 'Forest Archive/Tree.jpg', 'Portrait.png'].map(image);
  const scope = [second, third, first];
  assert.deepEqual(searchCollection(scope, 'forest'), [second, first]);
  assert.deepEqual(searchCollection(scope, 'forest.'), [first]);
  assert.deepEqual(searchCollection(scope, 'forest'), [second, first]);
  assert.deepEqual(searchCollection(scope, 'portrait'), [third]);
  assert.deepEqual(searchCollection([first, third], 'forest'), [first]);
  assert.equal(searchCollection(scope, ''), scope);
});

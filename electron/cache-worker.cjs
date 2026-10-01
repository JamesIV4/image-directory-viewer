const { workerData } = require('node:worker_threads');
const { pruneCache } = require('./images.cjs');
pruneCache(workerData.cacheDir, undefined, workerData.cutoff).catch(() => {});

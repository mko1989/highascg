const path = require('path');
const { scanServerModules, scanClientModules, crossReferenceWorkOrders } = require('./ast-scanner');

const repoRoot = path.resolve(__dirname, '../../');
const woDir = path.resolve(repoRoot, 'work/work-orders');

console.time('scanServerModules');
const { modules, allFiles } = scanServerModules(repoRoot);
console.timeEnd('scanServerModules');

console.time('scanClientModules');
const { clientChildren, allClientNodes } = scanClientModules(repoRoot);
console.timeEnd('scanClientModules');

const allNodesGlobal = [...allFiles, ...allClientNodes];

console.log(`Total nodes for crossref: ${allNodesGlobal.length}`);

console.time('crossReferenceWorkOrders');
crossReferenceWorkOrders(allNodesGlobal, woDir);
console.timeEnd('crossReferenceWorkOrders');

console.log('Done.');

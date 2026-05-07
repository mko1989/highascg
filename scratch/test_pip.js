const po = require('/home/casparcg/highascg/src/engine/pip-overlay');
const cf = { x: 0.3341796875, y: 0.0595703125, scaleX: 0.31319444444444444, scaleY: 0.880859375 };
const overlay = { type: 'border', params: { width: 50, side: 'outside' } };
const lines = po.buildPipOverlayAmcpLines(overlay, 2, 10, cf, { config: {} });
console.log('Resulting AMCP lines:');
lines.forEach(l => console.log('  ' + l));

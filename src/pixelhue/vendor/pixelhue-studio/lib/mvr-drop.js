import { fail } from './pixelhue.js';
import { fitSourceReplacement } from './source-aspect.js';
import { ratioSize, matchesRatio, overlaps, windowLimit } from '../public/mvr-geometry.js';

export const sourceRatio = source => source.width > 0 && source.height > 0 ? source.width / source.height : 16 / 9;

// Fit inside the reserved full rectangle, centred for creation or top-left anchored for replacement. Unknown UMD is never guessed.
export function fitMvrSource(rect, source, offset, model, keepPosition = false) {
  if (offset === null || offset === undefined) throw fail('UMD height is unavailable. Reconnect to read device configuration before dropping this source.', 409);
  const ratio = sourceRatio(source), limit = windowLimit(model, source.type);
  if (keepPosition) return fitSourceReplacement({ ...rect, width: Math.min(rect.width, limit?.width ?? Infinity),
    height: Math.min(rect.height, limit?.height ?? Infinity) }, { width: ratio, height: 1 }, offset);
  const size = ratioSize(ratio, Math.min(rect.width, limit?.width ?? Infinity), Math.min(rect.height, limit?.height ?? Infinity), rect.width, offset);
  if (!size) throw fail('No room for this source aspect ratio including UMD at the 64 px minimum.', 409);
  return { x: rect.x + Math.floor((rect.width - size.width) / 2), y: rect.y + Math.floor((rect.height - size.height) / 2), ...size };
}

export const dropMatches = (layer, source, target) => layer && layer.sourceId === source.id && layer.sourceType === source.type &&
  Boolean(layer.aspectLock) && layer.aspectMode === (layer.umdHeight ? 5 : 8) && matchesRatio(layer.window, sourceRatio(source), layer.umdHeight) &&
  ['x', 'y', 'width', 'height'].every(key => layer.window[key] === target[key]);

// Firmware decides the new layer's UMD default. Reconcile using actual readback, including UMD off.
export async function finishMvrDrop(client, state, id, source, reserved, verify, keepPosition = false) {
  const layer = state.layers.find(l => l.id === id), target = fitMvrSource(reserved, source, layer?.umdHeight, client.model, keepPosition);
  if (state.layers.some(other => other.id !== id && other.screenId === layer.screenId && overlaps(target, other.window))) throw fail('MVR windows cannot overlap.', 409);
  if (!['x', 'y', 'width', 'height'].every(key => layer.window[key] === target[key])) await client.call('layers/window', [{ layerId: id, window: target }]);
  const mode = layer.umdHeight ? 5 : 8;
  if (!layer.aspectLock || layer.aspectMode !== mode) await client.call('layers/aspect-ratio', [{ layerId: id, aspectRatio: mode, locked: 1 }]);
  return verify(client, next => { const l = next.layers.find(l => l.id === id);
    return dropMatches(l, source, target) && !next.layers.some(o => o.id !== id && o.screenId === l.screenId && overlaps(l.window, o.window)) && l;
  }, 'the source aspect ratio and lock');
}

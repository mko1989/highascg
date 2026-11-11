import { fail } from './pixelhue.js';

// Source defaults for normal/program layers. Fit around the existing centre; native lock handles
// sources without usable timing when they acquire a signal. Minimum dimension is 64 pixels.
export function fitSourceWindow(rect, source) {
  if (!(source?.width > 0 && source?.height > 0)) return { ...rect };
  const scale = Math.max(Math.min(rect.width / source.width, rect.height / source.height), 64 / source.width, 64 / source.height);
  const width = Math.round(source.width * scale), height = Math.round(source.height * scale);
  return { x: Math.round(rect.x + (rect.width - width) / 2), y: Math.round(rect.y + (rect.height - height) / 2), width, height };
}
// Replacement is contained in the previous rectangle, anchored at its top-left.
// Refuse an impossible minimum rather than expanding either old dimension.
export function fitSourceReplacement(rect, source, umdHeight = 0) {
  if (!(source?.width > 0 && source?.height > 0)) return { ...rect };
  const ratio = source.width / source.height;
  // Original locks derive width from height on P20. Round height down first so
  // relocking cannot turn a rounded-up height into a width beyond the old box.
  const contentHeight = Math.floor(Math.min(rect.height - umdHeight, rect.width / ratio));
  const size = { width: Math.round(contentHeight * ratio), height: contentHeight + umdHeight };
  if (size.width < 64 || size.height < 64 || contentHeight <= 0 || size.width > rect.width || size.height > rect.height) throw fail('This source cannot fit inside the previous layer at the 64 px minimum.', 409);
  return { x: rect.x, y: rect.y, ...size };
}
export const sourceAspectMatches = (layer, source) => layer?.aspectLocked && layer.aspectMode === 8 &&
  (!(source?.width > 0 && source?.height > 0) || Math.abs(layer.window.height - layer.window.width * source.height / source.width) <= 1);

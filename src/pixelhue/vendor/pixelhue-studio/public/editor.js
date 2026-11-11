import { hasOverlap, ratioSize, matchesRatio } from './mvr-geometry.js';

export const keys = ['x', 'y', 'width', 'height'];
export const sameWindow = (a, b) => a && b && keys.every((key) => a[key] === b[key]);
export const clone = (value) => structuredClone(value);
const bound = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));

export function fit(window, screen) {
  const width = bound(window.width, 64, screen.width);
  const height = bound(window.height, 64, screen.height);
  return { x: bound(window.x, 0, screen.width - width), y: bound(window.y, 0, screen.height - height), width, height };
}

export function dragWindow(original, dx, dy, screen, handle, snap = 1, lockAspect = false, umdHeight = 0, max = null) {
  const snapTo = (n) => Math.round(n / snap) * snap;
  if (!handle) return fit({ ...original, x: snapTo(original.x + dx), y: snapTo(original.y + dy) }, screen);
  const leftHandle = handle.includes('w');
  const topHandle = handle.includes('n');
  const anchorX = leftHandle ? original.x + original.width : original.x;
  const anchorY = topHandle ? original.y + original.height : original.y;
  // max: per-window size cap (WO-028 input window limit), on top of the output bounds.
  const limitW = Math.min(leftHandle ? anchorX : screen.width - anchorX, max?.width ?? Infinity);
  const limitH = Math.min(topHandle ? anchorY : screen.height - anchorY, max?.height ?? Infinity);
  let width = bound(snapTo(original.width + (leftHandle ? -dx : dx)), 64, limitW);
  let height = bound(snapTo(original.height + (topHandle ? -dy : dy)), 64, limitH);
  if (lockAspect) {
    const ratio = typeof lockAspect === 'number' ? lockAspect : original.width / (original.height - (umdHeight ?? 0));
    const size = ratioSize(ratio, limitW, limitH, Math.max(64, Math.ceil(Math.max(1, 64 - umdHeight) * ratio), width, (height - umdHeight) * ratio), umdHeight);
    if (!size) return { ...original };
    ({ width, height } = size);
  }
  return { x: leftHandle ? anchorX - width : anchorX, y: topHandle ? anchorY - height : anchorY, width, height };
}

export function readLayout(document, state, screenId) {
  if (document?.format !== 'pixelhue-mvr-layout' || document.version !== 1 || !Array.isArray(document.windows)) {
    throw new Error('Choose a valid MVR Studio layout JSON file.');
  }
  if (document.serial !== state.device.serial) throw new Error('This layout belongs to another device. Connect to that device first.');
  const screen = state.screens.find((item) => item.id === screenId);
  if (document.screenId !== screen.id || document.width !== screen.width || document.height !== screen.height) {
    throw new Error('This layout uses a different MVR output or resolution.');
  }
  const current = state.layers.filter((layer) => layer.screenId === screenId);
  if (document.windows.length !== current.length) throw new Error('The number of MVR windows has changed. Save a new layout.');
  const seen = new Set();
  const layout = document.windows.map((item) => {
    if (!item || seen.has(item.id) || !current.some((layer) => layer.id === item.id) ||
      !keys.every((key) => Number.isSafeInteger(item.window?.[key])) || !sameWindow(fit(item.window, screen), item.window)) {
      throw new Error('The layout contains an unknown window, duplicate ID, or invalid geometry.');
    }
    seen.add(item.id);
    const layer = current.find((layer) => layer.id === item.id), offset = layer.umdHeight ?? 0;
    if (Object.hasOwn(item, 'umdHeight') && item.umdHeight !== layer.umdHeight) throw new Error('The window UMD settings changed. Refresh and save a new layout.');
    let lock = item.aspectLock, mode = item.aspectMode ?? 5;
    // Old layouts stored the ratio of the whole rectangle. Preserve their geometry
    // while converting the lock to a content ratio for the current UMD strip.
    if (lock && !Object.hasOwn(item, 'umdHeight') && offset) { lock = item.window.width / (item.window.height - offset); mode = 5; }
    if (lock != null && (typeof lock !== 'number' || !Number.isFinite(lock) || lock < 1 / 256 || lock > 256 || !matchesRatio(item.window, lock, offset))) throw new Error('The layout contains an invalid aspect ratio lock.');
    if (Object.hasOwn(item, 'aspectMode') && ![5, 8].includes(item.aspectMode)) throw new Error('The layout contains an invalid aspect mode.');
    return { id: item.id, window: Object.fromEntries(keys.map((key) => [key, item.window[key]])),
      ...(Object.hasOwn(item, 'aspectLock') ? { aspectLock: lock ?? null, aspectMode: mode } : {}) };
  });
  if (hasOverlap(layout.map((item) => ({ ...item, screenId })))) throw new Error('The layout contains overlapping MVR windows.');
  return layout;
}

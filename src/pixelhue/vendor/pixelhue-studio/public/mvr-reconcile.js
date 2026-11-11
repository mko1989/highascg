import { sameWindow } from './editor.js';
export const sameEdit = (a, b) => Boolean(a && b) && sameWindow(a.window, b.window) && a.aspectLock === b.aspectLock && a.aspectMode === b.aspectMode;

export function reconcileMvr(local, base, next, sent) {
  const merged = structuredClone(next), submitted = new Map(sent.map(item => [item.id, item]));
  for (const actual of merged.layers) {
    const current = local.layers.find(item => item.id === actual.id);
    const previous = submitted.get(actual.id) || base.layers.find(item => item.id === actual.id);
    if (current && !sameEdit(current, previous)) {
      actual.window = structuredClone(current.window); actual.aspectLock = current.aspectLock; actual.aspectMode = current.aspectMode;
    }
  }
  return merged;
}

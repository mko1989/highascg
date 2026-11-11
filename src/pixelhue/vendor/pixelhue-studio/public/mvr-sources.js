import { overlaps, ratioSize } from './mvr-geometry.js';

// MVR source palette (WO-020): screen PGM/PVW and inputs not yet in the MVR. Drag onto empty
// space to add a window, onto a window to change its source; double-click places automatically.
export const MVR_SOURCE = 'text/x-pixelhue-mvr-source';

export function placeWindow(source, screen, layers, point, limit = null) {
  const ratio = source.width && source.height ? source.width / source.height : 16 / 9;
  const offset = source.umdHeight ?? 0;
  let width = Math.round(screen.width / 4);
  if (limit) width = Math.min(width, limit.width); // WO-028 input window limit includes UMD.
  const free = w => !layers.some(l => overlaps(w, l.window));
  for (let attempt = 0; attempt < 12 && width >= 64; attempt++, width = Math.round(width * 0.8)) {
    const size = ratioSize(ratio, Math.min(screen.width, limit?.width ?? Infinity), Math.min(screen.height, limit?.height ?? Infinity), width, offset);
    if (!size) continue;
    width = size.width;
    const height = size.height;
    const clamp = (x, y) => ({ x: Math.max(0, Math.min(screen.width - width, Math.round(x))), y: Math.max(0, Math.min(screen.height - height, Math.round(y))), width, height });
    const at = point || { x: screen.width / 2, y: screen.height / 2 };
    const first = clamp(at.x - width / 2, at.y - height / 2);
    if (free(first)) return first;
    const candidates = [];
    for (let y = 0; y + height <= screen.height; y += 8) for (let x = 0; x + width <= screen.width; x += 8) candidates.push({ x, y, width, height });
    candidates.sort((a, b) => Math.hypot(a.x - first.x, a.y - first.y) - Math.hypot(b.x - first.x, b.y - first.y));
    const spot = candidates.find(free);
    if (spot) return spot;
  }
  return null;
}

export function renderMvrSources(container, sources, { onAdd, onSelect, busy }) {
  container.replaceChildren();
  for (const source of sources || []) {
    const row = document.createElement('button');
    row.type = 'button'; row.className = `mvr-source${source.usedBy ? ' used' : ''}`; row.disabled = busy;
    row.textContent = source.name;
    const meta = document.createElement('small');
    meta.textContent = source.usedBy ? 'In MVR' : source.width ? `${source.width} × ${source.height}` : 'No signal';
    row.append(meta);
    if (source.usedBy) { row.title = 'Already in the MVR; click to select its window.'; row.onclick = () => onSelect(source.usedBy); }
    else {
      row.title = 'Drag onto the layout, or double-click to place it in free space.'; row.draggable = true;
      row.ondragstart = event => { event.dataTransfer.setData(MVR_SOURCE, `${source.type}:${source.id}`); event.dataTransfer.effectAllowed = 'copy'; };
      row.ondblclick = () => onAdd(source);
    }
    container.append(row);
  }
}

export function sourceOptions(select, sources, layer) {
  select.replaceChildren();
  for (const source of sources || []) {
    if (source.usedBy && source.usedBy !== layer.id) continue;
    select.add(new Option(source.name, `${source.type}:${source.id}`));
  }
  select.value = `${layer.sourceType}:${layer.sourceId}`;
  if (select.value !== `${layer.sourceType}:${layer.sourceId}`) { select.add(new Option(layer.source || 'Current source', ''), 0); select.value = ''; }
}

export const parseKey = key => { const [type, id] = String(key).split(':').map(Number); return { type, id }; };

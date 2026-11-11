import { el, text } from './ui.js';
import { groupOf, unionWindow, splitWindow } from './group-geometry.js';

// Program-layer stages (WO-016, WO-023): layers roam freely like PixelFlow (device X/Y ±500000) and
// snap to screen edges/centre and other layers (hold Alt to place without snapping).
// The stage shows the screen inside a margin of canvas (CANVAS_MARGIN of the screen size per side),
// so sources can be dropped into empty space next to a full-screen layer; dropping onto a layer swaps
// its source (hold Shift to add a new layer instead). Aspect-locked layers resize proportionally.
export const SOURCE_MIME = 'text/x-pixelhue-source';
export const CANVAS_MARGIN = 0.2;
const MIN = 64;

export const canvasOf = screen => {
  const mx = Math.round(screen.width * CANVAS_MARGIN), my = Math.round(screen.height * CANVAS_MARGIN);
  return { mx, my, width: screen.width + 2 * mx, height: screen.height + 2 * my };
};

export function moveWindow(original, dx, dy, handle, ratio = null) {
  if (!handle) return { ...original, x: Math.round(original.x + dx), y: Math.round(original.y + dy) };
  const left = handle.includes('w'), top = handle.includes('n');
  const right = original.x + original.width, bottom = original.y + original.height;
  let width = Math.max(MIN, Math.round(original.width + (left ? -dx : dx)));
  let height = Math.max(MIN, Math.round(original.height + (top ? -dy : dy)));
  if (ratio) {
    // Follow whichever axis moved more, keep the opposite corner anchored.
    if (Math.abs(width - original.width) / original.width >= Math.abs(height - original.height) / original.height) height = Math.round(width / ratio);
    else width = Math.round(height * ratio);
    if (height < MIN) { height = MIN; width = Math.round(MIN * ratio); }
    if (width < MIN) { width = MIN; height = Math.round(MIN / ratio); }
  }
  return { x: left ? right - width : original.x, y: top ? bottom - height : original.y, width, height };
}

function nearest(values, lines, threshold) {
  let best = null;
  for (const value of values) for (const line of lines) {
    const delta = line - value;
    if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best))) best = delta;
  }
  return best;
}

export function snapWindow(win, screen, others, threshold, handle, ratio = null) {
  const xs = [0, screen.width / 2, screen.width], ys = [0, screen.height / 2, screen.height];
  for (const o of others) { xs.push(o.x, o.x + o.width / 2, o.x + o.width); ys.push(o.y, o.y + o.height / 2, o.y + o.height); }
  const next = { ...win };
  if (!handle) {
    const dx = nearest([win.x, win.x + win.width / 2, win.x + win.width], xs, threshold);
    const dy = nearest([win.y, win.y + win.height / 2, win.y + win.height], ys, threshold);
    if (dx !== null) next.x = Math.round(win.x + dx);
    if (dy !== null) next.y = Math.round(win.y + dy);
    return next;
  }
  const edge = (value, lines) => { const d = nearest([value], lines, threshold); return d === null ? value : Math.round(value + d); };
  if (handle.includes('w')) { const x = Math.min(edge(win.x, xs), win.x + win.width - MIN); next.width = win.x + win.width - x; next.x = x; }
  if (handle.includes('e')) next.width = Math.max(MIN, edge(win.x + win.width, xs) - win.x);
  if (ratio) { // Locked: snap the horizontal edge only, derive the height from the ratio.
    const height = Math.max(MIN, Math.round(next.width / ratio));
    if (handle.includes('n')) next.y = win.y + win.height - height;
    next.height = height;
    return next;
  }
  if (handle.includes('n')) { const y = Math.min(edge(win.y, ys), win.y + win.height - MIN); next.height = win.y + win.height - y; next.y = y; }
  if (handle.includes('s')) next.height = Math.max(MIN, edge(win.y + win.height, ys) - win.y);
  return next;
}

// New layers use the source's native resolution (WO-023); unknown size falls back to 1920 × 1080.
export function dropWindow(source, screen, point) {
  const width = Math.max(MIN, source?.width || 1920), height = Math.max(MIN, source?.height || 1080);
  return { x: Math.round(point.x - width / 2), y: Math.round(point.y - height / 2), width, height };
}

export function paintStage(stage, screen, layers, selectedId, background = null) {
  stage.replaceChildren();
  const c = canvasOf(screen), pct = (value, total) => `${100 * value / total}%`;
  const frame = el('div', { className: 'screen-frame' });
  if (background) { frame.style.backgroundImage = `url("${background}")`; frame.classList.add('has-bkg'); }
  Object.assign(frame.style, { left: pct(c.mx, c.width), top: pct(c.my, c.height), width: pct(screen.width, c.width), height: pct(screen.height, c.height) });
  stage.append(frame);
  for (const [index, l] of layers.slice().sort((a, b) => a.zorder - b.zorder).entries()) {
    const node = el('div', { className: `program-layer${l.id === selectedId ? ' selected' : ''}${l.aspectLocked ? ' aspect-locked' : ''}`, 'data-id': l.id });
    Object.assign(node.style, { left: pct(l.window.x + c.mx, c.width), top: pct(l.window.y + c.my, c.height),
      width: pct(l.window.width, c.width), height: pct(l.window.height, c.height), zIndex: index + 1, opacity: l.enabled ? '1' : '.5' });
    node.append(el('span', { className: 'window-title' }, l.name), text(l.sourceName || `Source ${l.sourceId}`));
    const group = groupOf(layers, l);
    if (group) node.classList.add('grouped');
    if (l.id === selectedId && !group) for (const corner of ['nw', 'ne', 'sw', 'se']) node.append(el('span', { className: `handle ${corner}`, 'data-handle': corner }));
    stage.append(node);
  }
  // Grouped inputs (WO-025): one frame with handles around both members of the selected group.
  const selected = layers.find(l => l.id === selectedId), group = selected && groupOf(layers, selected);
  if (group) {
    const u = unionWindow(group.a.window, group.b.window), frame = el('div', { className: 'group-frame', 'data-id': selected.id });
    Object.assign(frame.style, { left: pct(u.x + c.mx, c.width), top: pct(u.y + c.my, c.height), width: pct(u.width, c.width), height: pct(u.height, c.height) });
    for (const corner of ['nw', 'ne', 'sw', 'se']) frame.append(el('span', { className: `handle ${corner}`, 'data-handle': corner }));
    stage.append(frame);
  }
}

// ctx: { layers(), select(id), commit(layer, window), drop(key, point), replace(key, layer), busy(), locked(), onLocked(), repaint() }
export function bindStage(stage, screen, ctx) {
  let drag = null;
  const c = canvasOf(screen);
  const local = (event, rect) => ({ x: (event.clientX - rect.left) * c.width / rect.width - c.mx, y: (event.clientY - rect.top) * c.height / rect.height - c.my });
  stage.onpointerdown = event => {
    if (ctx.busy() || event.button !== 0) return;
    const target = event.target.closest('.program-layer, .group-frame'); if (!target) return;
    const layer = ctx.layers().find(l => l.id === Number(target.dataset.id)); if (!layer) return;
    ctx.select(layer.id);
    if (ctx.locked?.()) return; // PGM lock (WO-022): select only, no move/resize.
    const group = groupOf(ctx.layers(), layer);
    const before = group ? unionWindow(group.a.window, group.b.window) : structuredClone(layer.window);
    const locked = group ? group.a.aspectLocked || group.b.aspectLocked : layer.aspectLocked;
    drag = { layer, group, before, x: event.clientX, y: event.clientY, handle: event.target.dataset.handle, rect: stage.getBoundingClientRect(),
      ratio: locked ? before.width / before.height : null,
      share: group && (group.orient === 'H' ? group.a.window.width / before.width : group.a.window.height / before.height),
      originals: group && [structuredClone(group.a.window), structuredClone(group.b.window)] };
    stage.setPointerCapture(event.pointerId); event.preventDefault();
  };
  stage.onpointermove = event => {
    if (!drag) return;
    const sx = c.width / drag.rect.width, sy = c.height / drag.rect.height;
    let next = moveWindow(drag.before, (event.clientX - drag.x) * sx, (event.clientY - drag.y) * sy, drag.handle, drag.ratio);
    const others = ctx.layers().filter(l => l.id !== drag.layer.id && (!drag.group || ![drag.group.a.id, drag.group.b.id].includes(l.id))).map(l => l.window);
    if (!event.altKey) next = snapWindow(next, screen, others, 10 * sx, drag.handle, drag.ratio);
    const changed = JSON.stringify(next) !== JSON.stringify(drag.next || drag.before);
    if (drag.group) { [drag.group.a.window, drag.group.b.window] = splitWindow(next, drag.group.orient, drag.share); }
    else drag.layer.window = next;
    drag.next = next;
    if (ctx.preview && changed) { drag.published = true; ctx.preview(drag.layer, next, Boolean(drag.group)); }
    else ctx.repaint();
  };
  const end = event => {
    if (!drag) return;
    const { layer, before, group, originals, published } = drag, next = group ? drag.next || before : structuredClone(layer.window); drag = null;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (!ctx.preview || event.type === 'pointercancel') {
      if (group) { group.a.window = originals[0]; group.b.window = originals[1]; } else layer.window = before;
    }
    if (event.type === 'pointercancel' && published) {
      if (group) ctx.commitGroup(layer, before); else ctx.commit(layer, before);
      return;
    }
    const changed = event.type !== 'pointercancel' && JSON.stringify(before) !== JSON.stringify(next);
    if (changed && group) ctx.commitGroup(layer, next);
    else if (changed) ctx.commit(layer, next);
    else ctx.repaint();
  };
  stage.onpointerup = end; stage.onpointercancel = end;
  stage.ondragover = event => {
    if (ctx.busy() || ctx.locked?.() || !event.dataTransfer.types.includes(SOURCE_MIME)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; stage.classList.add('drop-target');
    const over = event.shiftKey ? null : event.target.closest('.program-layer');
    for (const node of stage.querySelectorAll('.program-layer.replace-target')) if (node !== over) node.classList.remove('replace-target');
    over?.classList.add('replace-target');
  };
  stage.ondragleave = event => {
    if (stage.contains(event.relatedTarget)) return;
    stage.classList.remove('drop-target'); for (const node of stage.querySelectorAll('.replace-target')) node.classList.remove('replace-target');
  };
  stage.ondrop = event => {
    stage.classList.remove('drop-target'); for (const node of stage.querySelectorAll('.replace-target')) node.classList.remove('replace-target');
    const key = event.dataTransfer.getData(SOURCE_MIME); if (!key || ctx.busy()) return;
    if (ctx.locked?.()) { event.preventDefault(); ctx.onLocked?.(); return; }
    event.preventDefault();
    const target = event.shiftKey ? null : event.target.closest('.program-layer');
    const layer = target && ctx.layers().find(l => l.id === Number(target.dataset.id));
    if (layer) ctx.replace(key, layer);
    else ctx.drop(key, local(event, stage.getBoundingClientRect()));
  };
  return { dragging: () => Boolean(drag) };
}

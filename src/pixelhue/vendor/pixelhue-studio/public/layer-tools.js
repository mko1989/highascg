import { el, button, input, select, field } from './ui.js';
import { groupOf, unionWindow, groupSize } from './group-geometry.js';

// Selected-layer position/size bar under the screens (WO-026; moved out of the inspector).
// PixelFlow parity: X/Y/W/H with aspect lock, aspect presets (layer_2.xml AspectRatioType), align to screen,
// fill screen / width / height / output, native 1:1, stacking and Clear. Fills honour the aspect lock:
// a locked layer is fitted inside the target keeping its ratio (owner: "fit to screen overrides the aspect lock").
export const ASPECTS = [[8, 'Source'], [3, '16:9'], [4, '16:10'], [1, '4:3'], [2, '3:2'], [7, '5:4'], [0, '1:1'], [5, 'Custom']];
const RATIOS = { 0: 1, 1: 4 / 3, 2: 3 / 2, 3: 16 / 9, 4: 16 / 10, 7: 5 / 4 };
const MIN = 64;

export function alignWindow(w, screen, where) {
  const x = { left: 0, hcenter: Math.round((screen.width - w.width) / 2), right: screen.width - w.width }[where];
  const y = { top: 0, vcenter: Math.round((screen.height - w.height) / 2), bottom: screen.height - w.height }[where];
  if (where === 'center') return { ...w, x: Math.round((screen.width - w.width) / 2), y: Math.round((screen.height - w.height) / 2) };
  return { ...w, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}) };
}

// Output tile (screen-local) under the layer centre, else the first tile; null when the screen has none.
export function outputTile(w, screen) {
  const tiles = (screen.outputs || []).map(o => ({ x: o.pos.x - screen.x, y: o.pos.y - screen.y, width: o.pos.width, height: o.pos.height }));
  const cx = w.x + w.width / 2, cy = w.y + w.height / 2;
  return tiles.find(t => cx >= t.x && cx < t.x + t.width && cy >= t.y && cy < t.y + t.height) || tiles[0] || null;
}

export function nativeWindow(w, source) {
  if (!source?.width || !source?.height) return null;
  return { x: Math.round(w.x + w.width / 2 - source.width / 2), y: Math.round(w.y + w.height / 2 - source.height / 2), width: source.width, height: source.height };
}

// Fill target; with a ratio, fit inside it (contain) and centre.
export function fillWindow(target, ratio = null) {
  if (!ratio) return { ...target };
  if (target.width / target.height > ratio) {
    const height = target.height, width = Math.max(MIN, Math.round(height * ratio));
    return { x: Math.round(target.x + (target.width - width) / 2), y: target.y, width, height };
  }
  const width = target.width, height = Math.max(MIN, Math.round(width / ratio));
  return { x: target.x, y: Math.round(target.y + (target.height - height) / 2), width, height };
}
// Fill one axis; the other keeps its size (unlocked) or follows the ratio (locked), centred on the layer.
export function fillAxis(w, target, axis, ratio = null) {
  if (axis === 'width') {
    const height = ratio ? Math.max(MIN, Math.round(target.width / ratio)) : w.height;
    return { x: target.x, y: Math.round(w.y + w.height / 2 - height / 2), width: target.width, height };
  }
  const width = ratio ? Math.max(MIN, Math.round(target.height * ratio)) : w.width;
  return { x: Math.round(w.x + w.width / 2 - width / 2), y: target.y, width, height: target.height };
}

export function renderLayerToolbar(node, { state, layer: l, screen, command, locked, liveGeometry, finishGeometry }) {
  node.replaceChildren();
  if (!l) { node.append(el('span', { className: 'muted' }, 'Select a layer to position and size it.')); return; }
  const group = groupOf(state.layers, l), win = group ? unionWindow(group.a.window, group.b.window) : l.window;
  const currentWindow = () => group ? unionWindow(group.a.window, group.b.window) : l.window;
  const keepRatio = group ? group.a.aspectLocked || group.b.aspectLocked : l.aspectLocked, ratio = keepRatio ? win.width / win.height : null;
  const save = (window, message = 'Layer position saved.', live = false) => (live && liveGeometry ? liveGeometry : command)(group ? { action: 'group-window', screenId: l.screenId, id: l.id, window }
    : { action: 'window', screenId: l.screenId, id: l.id, window }, group ? message.replace('Layer', 'Group') : message);
  const sourceOf = layer => state.sources.find(s => s.type === layer.sourceType && s.id === layer.sourceId);
  const tile = outputTile(win, screen), screenRect = { x: 0, y: 0, width: screen.width, height: screen.height };
  const native = group ? nativeWindow(win, groupSize(sourceOf(group.a), sourceOf(group.b), group.orient)) : nativeWindow(l.window, sourceOf(l));
  const block = (label, ...children) => { const b = el('div', { className: 'tool-block' }); b.append(el('span', { className: 'tool-label' }, label), ...children); return b; };

  const name = el('div', { className: 'tool-block tool-name' });
  name.append(el('strong', {}, group ? `Group ${group.group}` : l.name), el('span', { className: 'muted' }, `${screen.name} · ${l.scene === 2 ? 'PGM' : 'PVW'}${locked ? ' · locked' : ''}`));

  const fields = el('div', { className: 'tool-fields' });
  for (const [key, label] of [['x', 'X'], ['y', 'Y'], ['width', 'W'], ['height', 'H']]) {
    const control = input(win[key], `Layer ${label === 'W' ? 'Width' : label === 'H' ? 'Height' : label}`, 'number'); if (label === 'W' || label === 'H') control.min = MIN;
    const change = live => {
      if (control.value === '' || !control.validity.valid || !Number.isSafeInteger(Number(control.value))) return;
      const next = { ...currentWindow(), [key]: Number(control.value) };
      if (ratio && key === 'width') next.height = Math.max(MIN, Math.round(next.width / ratio));
      if (ratio && key === 'height') next.width = Math.max(MIN, Math.round(next.height * ratio));
      save(next, 'Layer position saved.', live);
    };
    if (liveGeometry) control.oninput = () => change(true);
    control.onchange = () => { if (liveGeometry) finishGeometry?.(); else change(false); };
    fields.append(field(label, control));
  }
  const aspect = select(ASPECTS, l.aspectMode, 'Layer aspect ratio');
  aspect.onchange = () => {
    const mode = Number(aspect.value), r = RATIOS[mode];
    command({ action: 'aspect', screenId: l.screenId, id: l.id, mode, locked: mode !== 5 || l.aspectLocked,
      ...(r ? { window: { ...l.window, height: Math.max(MIN, Math.round(l.window.width / r)) } } : {}) }, `Aspect ratio set to ${aspect.selectedOptions[0].text}.`);
  };
  const keep = input('', 'Keep aspect ratio', 'checkbox'); keep.checked = Boolean(l.aspectLocked);
  keep.onchange = () => command({ action: 'aspect', screenId: l.screenId, id: l.id, locked: keep.checked }, keep.checked ? 'Aspect ratio locked to the source.' : 'Aspect ratio unlocked.');
  const keepLabel = el('label', { className: 'checkbox-label' }); keepLabel.append(keep, document.createTextNode(' Lock'));

  const align = el('div', { className: 'tool-buttons', role: 'group', 'aria-label': 'Align to screen' });
  for (const [where, label] of [['left', 'Left'], ['hcenter', 'Centre H'], ['right', 'Right'], ['top', 'Top'], ['vcenter', 'Centre V'], ['bottom', 'Bottom'], ['center', 'Centre']]) {
    align.append(button(label, () => save(alignWindow(currentWindow(), screen, where), `Layer aligned ${label.toLowerCase()}.`)));
  }
  const fill = el('div', { className: 'tool-buttons', role: 'group', 'aria-label': 'Fill' });
  const fills = [['Screen', () => save(fillWindow(screenRect, ratio), ratio ? 'Layer fitted to the screen (aspect kept).' : 'Layer fills the screen.')],
    ['Width', () => save(fillAxis(currentWindow(), screenRect, 'width', ratio), 'Layer fills the screen width.')],
    ['Height', () => save(fillAxis(currentWindow(), screenRect, 'height', ratio), 'Layer fills the screen height.')],
    ['Output', () => { const target = outputTile(currentWindow(), screen); if (target) save(fillWindow(target, ratio), ratio ? 'Layer fitted to its output (aspect kept).' : 'Layer fills its output.'); }],
    ['Native 1:1', () => native && save(nativeWindow(currentWindow(), group ? groupSize(sourceOf(group.a), sourceOf(group.b), group.orient) : sourceOf(l)), 'Layer set to the source resolution.')]];
  for (const [label, action] of fills) fill.append(button(label, action));
  if (!tile) fill.children[3].dataset.fixed = 'true';
  if (!native) { fill.children[4].dataset.fixed = 'true'; fill.children[4].title = 'The source has no signal resolution.'; }

  const order = el('div', { className: 'tool-buttons' });
  order.append(button('Front', () => command({ action: 'zorder', screenId: l.screenId, id: l.id, to: 3 }, 'Layer brought to front.')),
    button('Back', () => command({ action: 'zorder', screenId: l.screenId, id: l.id, to: 4 }, 'Layer sent to back.')),
    button('Duplicate', () => command({ action: 'copy', screenId: l.screenId, id: l.id }, 'Layer duplicated.')),
    button('Mirror', () => command({ action: 'copy', screenId: l.screenId, id: l.id, mirror: true }, 'Mirrored copy created.')),
    button('Clear', () => clearLayer(state, l, command), 'button danger'));
  node.append(name, block('Position & size', fields), block('Aspect', aspect, keepLabel), block('Align to screen', align), block('Fill', fill), block('Layer', order));
  if (locked) for (const control of node.querySelectorAll('input,select,button')) control.dataset.fixed = 'true';
}

// Clear (PixelFlow "CLEAR" for layers): remove the selected layer, or both members of its group.
export function clearLayer(state, l, command) {
  const group = groupOf(state.layers, l);
  if (group) { command({ action: 'group-delete', screenId: l.screenId, id: l.id }, `Group ${group.group} cleared.`); return; }
  command({ action: 'delete', screenId: l.screenId, id: l.id }, 'Layer cleared.');
}

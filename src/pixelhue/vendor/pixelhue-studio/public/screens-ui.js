import { $, el, text, button, input, select, field, panelHeader, sessionPath, setDisabled } from './ui.js';
import { snapWindow } from './program-stage.js';
import { renderScreenExtras } from './screen-extras-ui.js';

// Output tiles (WO-016): explicit Add/Remove, drag tiles on the map with edge snapping,
// and the screen grows to the outputs' bounding box so tiles always fit.
const bbox = outputs => ({ width: Math.max(64, ...outputs.map(o => o.pos.x + o.pos.width)), height: Math.max(64, ...outputs.map(o => o.pos.y + o.pos.height)) });
function grow(draft) { const box = bbox(draft.outputs); draft.window.width = Math.max(draft.window.width, box.width); draft.window.height = Math.max(draft.window.height, box.height); }

export function createScreensUI({ api, notice, operation, getSession, invalidate }) {
  const root = $('screens-content'); let state, session, selectedId, busy = false, drafts = new Map();
  const selected = () => state?.screens.find(s => s.id === selectedId);
  function draftFor(s) {
    return { window: { x: s.x, y: s.y, width: s.width, height: s.height }, outputs: s.outputs.map(o => ({ id: o.id,
      pos: { ...o.pos, x: o.pos.x - s.x, y: o.pos.y - s.y } })) };
  }
  function dirty() { return (state?.screens || []).some(s => JSON.stringify(drafts.get(s.id)) !== JSON.stringify(draftFor(s))); }
  function adopt(next, preserve = false) {
    const old = drafts; state = next; session = next.session;
    selectedId = next.screens.some(s => s.id === selectedId) ? selectedId : next.screens[0]?.id;
    drafts = new Map(next.screens.map(s => [s.id, preserve && old.has(s.id) ? old.get(s.id) : draftFor(s)])); render();
  }
  async function refresh() {
    if (!getSession()) return;
    if (dirty() && !window.confirm('Discard pending screen changes?')) return;
    await operation(async () => adopt(await api(sessionPath('screens', getSession()))));
  }
  async function command(request, preserve = true) {
    await operation(async () => {
      const oldIds = state.screens.map(s => s.id);
      const next = await api('screens', { session, ...request }, 'PUT');
      if (request.action === 'update') drafts.delete(request.id);
      if (request.action === 'create') selectedId = next.screens.find(s => !oldIds.includes(s.id))?.id;
      adopt(next, preserve); invalidate('screens'); notice('Screen settings saved.', 'success');
    });
  }
  function draw() {
    const stage = $('screen-map'); if (!stage || !selected()) return;
    const draft = drafts.get(selectedId), w = Math.max(64, draft.window.width), h = Math.max(64, draft.window.height);
    stage.style.aspectRatio = `${w}/${h}`; stage.style.width = `min(100%, calc(48dvh * ${(w / h).toFixed(5)}))`; stage.replaceChildren();
    for (const mapping of draft.outputs) {
      const p = mapping.pos, o = state.outputs.find(o => o.id === mapping.id);
      const node = el('div', { className: 'screen-tile', 'data-id': mapping.id }, `${o?.name || `Output ${mapping.id}`} · ${p.width} × ${p.height}`);
      Object.assign(node.style, { left: `${100 * p.x / w}%`, top: `${100 * p.y / h}%`, width: `${100 * p.width / w}%`, height: `${100 * p.height / h}%` }); stage.append(node);
    }
    $('screen-pending').textContent = dirty() ? 'Pending screen changes' : 'No pending changes';
  }
  function bindMap(stage) {
    let drag = null;
    stage.onpointerdown = event => {
      const tile = event.target.closest('.screen-tile'); if (busy || !tile || event.button !== 0) return;
      const draft = drafts.get(selectedId), mapping = draft.outputs.find(o => o.id === Number(tile.dataset.id));
      drag = { mapping, before: { ...mapping.pos }, x: event.clientX, y: event.clientY, rect: stage.getBoundingClientRect(), draft };
      stage.setPointerCapture(event.pointerId); event.preventDefault();
    };
    stage.onpointermove = event => {
      if (!drag) return;
      const { draft } = drag, scale = draft.window.width / drag.rect.width;
      let pos = { ...drag.before, x: Math.round(drag.before.x + (event.clientX - drag.x) * scale), y: Math.round(drag.before.y + (event.clientY - drag.y) * scale) };
      if (!event.altKey) pos = snapWindow(pos, draft.window, draft.outputs.filter(o => o !== drag.mapping).map(o => o.pos), 12 * scale);
      drag.mapping.pos = { ...pos, x: Math.max(0, pos.x), y: Math.max(0, pos.y) }; draw();
    };
    const end = event => {
      if (!drag) return; const { draft } = drag; drag = null;
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
      grow(draft); render();
    };
    stage.onpointerup = end; stage.onpointercancel = end;
  }
  function render() {
    root.replaceChildren(); if (!state) { root.append(text('Connect a device to configure screens.')); return; }
    root.append(panelHeader('Screens', refresh));
    let next = 1; while (state.screens.some(s => s.name === `Screen ${next}`)) next++;
    const createBar = el('div', { className: 'studio-bulk' }), prefix = input(`Screen ${next}`, 'New screen name');
    const type = select([[2, 'Main screen'], [4, 'AUX screen']], 2, 'New screen type');
    createBar.append(field('Name', prefix), field('Type', type), button('Create screen', () => command({ action: 'create', name: prefix.value, type: Number(type.value) })));
    root.append(createBar);
    const layout = el('div', { className: 'screen-editor' }), list = el('aside', { className: 'screen-list' });
    for (const s of state.screens) list.append(button(`${s.name} · ${s.width} × ${s.height}${s.enabled ? '' : ' · off'}`, () => { selectedId = s.id; render(); }, `button screen-choice${s.id === selectedId ? ' selected' : ''}`));
    layout.append(list); const content = el('div', { className: 'screen-editor-main' }); layout.append(content); root.append(layout);
    const screen = selected(); if (!screen) { content.append(text('Create a screen to start mapping outputs.')); setDisabled(root, busy); return; }
    const draft = drafts.get(screen.id);
    const heading = el('div', { className: 'tool-heading' }); heading.append(el('h2', {}, screen.name), text(screen.type === 4 ? 'AUX' : screen.type === 32 ? 'LED' : 'Main'));
    if (!screen.enabled) heading.append(el('span', { className: 'screen-off', title: 'The device reports enable 0 for this screen. PixelFlow hides such screens; presets and Take/Cut skip it.' }, 'Disabled on device'));
    heading.append(button(screen.freeze ? 'Unfreeze' : 'Freeze', () => command({ action: 'freeze', id: screen.id, enable: screen.freeze ? 0 : 1 }, true)),
      button(screen.ftb ? 'Clear blackout' : 'Blackout', () => command({ action: 'ftb', id: screen.id, enable: screen.ftb ? 0 : 1 }, true)),
      button('Delete screen', () => { if (window.confirm(`Delete ${screen.name} and its layers?`)) command({ action: 'delete', id: screen.id }); }, 'button danger'));
    content.append(heading);
    const extras = renderScreenExtras(screen, state.options, command); if (extras) content.append(extras);
    if (screen.type === 32) { content.append(text('This screen uses LED topology. Its current dimensions are shown; LCD output mapping is unavailable.')); setDisabled(root, busy); return; }
    const dimensions = el('div', { className: 'studio-bulk' });
    for (const [key, label] of [['x', 'Origin X'], ['y', 'Origin Y'], ['width', 'Width'], ['height', 'Height']]) {
      const control = input(draft.window[key], `Screen ${label}`, 'number');
      control.onchange = () => { draft.window[key] = Number(control.value); render(); }; dimensions.append(field(label, control));
    }
    content.append(dimensions);
    const stage = el('div', { id: 'screen-map', className: 'screen-map' }); content.append(stage, text('Drag output tiles to arrange them; they snap to each other and the screen edges (hold Alt to place freely).')); bindMap(stage);
    const mappingList = el('div', { className: 'mapping-list' }), available = el('div', { className: 'output-palette' });
    available.append(el('h3', {}, 'Available outputs'));
    for (const output of state.outputs.filter(o => (screen.type === 4) === (o.role === 'AUX'))) {
      const owner = state.screens.find(s => s.id !== screen.id && s.outputs.some(o => o.id === output.id));
      const mapping = draft.outputs.find(o => o.id === output.id);
      const size = `${output.timing?.width || '?'} × ${output.timing?.height || '?'}`;
      if (!mapping) {
        const add = button(`+ ${output.name}`, () => {
          const right = draft.outputs.length ? Math.max(...draft.outputs.map(o => o.pos.x + o.pos.width)) : 0;
          draft.outputs.push({ id: output.id, pos: { x: right, y: 0, width: output.timing?.width || 1920, height: output.timing?.height || 1080 } });
          grow(draft); render();
        }, 'button secondary output-add');
        add.title = owner ? `Used by ${owner.name}` : `${output.connector} · ${size}`; add.dataset.fixed = String(Boolean(owner));
        const option = el('div', { className: 'output-option' });
        option.append(add, text(owner ? `Used by ${owner.name}` : `${output.connector} · ${size}`)); available.append(option);
        continue;
      }
      const row = el('div', { className: 'mapping-row' });
      row.append(el('strong', {}, output.name), text(`${output.connector} · ${size}`));
      for (const key of ['x', 'y', 'width', 'height']) {
        const control = input(mapping.pos[key], `${output.name} tile ${key}`, 'number');
        control.onchange = () => { mapping.pos[key] = Number(control.value); grow(draft); render(); }; row.append(field(key.toUpperCase(), control));
      }
      row.append(button('Remove', () => { draft.outputs = draft.outputs.filter(o => o.id !== output.id); render(); }, 'button quiet'));
      mappingList.append(row);
    }
    if (!draft.outputs.length) mappingList.append(text('No outputs on this screen yet. Add one from Available outputs.'));
    const columns = input(Math.max(1, draft.outputs.length), 'Output tile columns', 'number'); columns.min = 1; columns.max = 32;
    const tile = button('Tile selected outputs', () => {
      const cols = Math.max(1, Math.min(32, Number(columns.value) || 1)), rows = Math.max(1, Math.ceil(draft.outputs.length / cols));
      draft.outputs.forEach((o, i) => {
        const x = Math.round((i % cols) * draft.window.width / cols), y = Math.round(Math.floor(i / cols) * draft.window.height / rows);
        o.pos = { x, y, width: Math.round(((i % cols) + 1) * draft.window.width / cols) - x,
          height: Math.round((Math.floor(i / cols) + 1) * draft.window.height / rows) - y };
      }); render();
    });
    const fitScreen = button('Fit screen to outputs', () => { if (draft.outputs.length) { Object.assign(draft.window, bbox(draft.outputs)); render(); } });
    const tiling = el('div', { className: 'studio-bulk' }); tiling.append(field('Columns', columns), tile, fitScreen);
    const outputsArea = el('div', { className: 'screen-outputs' }); outputsArea.append(mappingList, available);
    content.append(tiling, outputsArea);
    const footer = el('footer', { className: 'action-bar' }); footer.append(el('span', { id: 'screen-pending' }), button('Apply screen layout', () => command({ action: 'update', id: screen.id, ...draft }), 'button primary'));
    content.append(footer); draw(); setDisabled(root, busy);
  }
  render();
  return { open: () => state ? undefined : refresh(), refresh, hasChanges: dirty,
    reset(next) { if (session === next) return; session = next; state = undefined; drafts.clear(); render(); },
    setBusy(value) { busy = value; setDisabled(root, busy); } };
}

import { $, el, text, button, input, select, field, sessionPath, setDisabled } from './ui.js';
import { paintStage, bindStage, dropWindow, canvasOf, SOURCE_MIME } from './program-stage.js';
import { renderPresets } from './presets-ui.js';
import { renderLayerPanel } from './layer-inspector.js';
import { renderLayerToolbar, clearLayer } from './layer-tools.js';
import { renderSourceTabs, parseDragKey } from './source-tabs.js';
import { groupSize } from './group-geometry.js';
import { groupOf, unionWindow, splitWindow } from './group-geometry.js';
import { createProgramSync } from './program-sync.js';

// Programming (WO-016): several screens at once, PGM band on top and PVW below, drag sources
// onto a stage to create layers, free layer roaming, preset bank.
const STORE = 'program-screens';
export function createProgrammingUI({ api, notice, operation, getSession, invalidate }) {
  const root = $('programming-content');
  let sourceTimer, sourceVersion = 0, sourceDragging = false, sourcePolling = false, sourceFilter = '';
  let state, session, selectedId, sourceKey, busy = false, refreshTimer, durationMs = 500, shouldSwap = true;
  let shown = null, sideTab = 'layer', sourceTab = 'inputs', gallery = null, loadTarget = 4, savingFrom = null, editingPresets = false, loadOptions = { keyframes: false, effect: false }; const stages = [];
  try { shown = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch {}
  const visible = () => state.screens.filter(s => shown.includes(s.id));
  const layer = () => state?.layers.find(l => l.id === selectedId);
  const active = () => state.screens.find(s => s.id === layer()?.screenId && shown.includes(s.id)) || visible()[0];
  const sourceFor = key => state?.sources.find(s => `${s.type}:${s.id}` === key);
  const remember = () => { try { localStorage.setItem(STORE, JSON.stringify(shown)); } catch {} };
  let geometryFailed = false, geometryRevision = 0, geometrySuccess = '';
  const geometrySync = createProgramSync({
    canSend: () => Boolean(session) && session === getSession() && !busy,
    submit: changes => api('programming/geometry', { session, changes }, 'PUT'),
    onResult(next, accepted) {
      const ids = new Set(accepted.flatMap(change => {
        const l = state?.layers.find(l => l.id === change.id), g = change.action === 'group-window' && groupOf(state.layers, l);
        return g ? [g.a.id, g.b.id] : [change.id];
      }));
      if (!stages.some(s => s.dragging())) for (const actual of next.layers) {
        const local = state?.layers.find(l => l.id === actual.id);
        if (local && ids.has(local.id)) local.window = { ...actual.window };
      }
      if (accepted.length) invalidate('programming');
      paintAll(); updateGeometryFields();
      if (geometryFailed || (accepted.length && !geometrySync.dirty && !stages.some(s => s.dragging()))) {
        geometryFailed = false; notice(geometrySuccess || 'Layer position saved.', 'success'); geometrySuccess = '';
      }
    },
    onError(error) { geometryFailed = true; notice(`Layer position not saved: ${error.message}`, 'error'); },
    onStatus: geometryStatus,
  });
  function geometryStatus() {
    const label = $('program-save-status'), retry = $('program-retry');
    if (label) label.textContent = geometrySync.error ? 'Not saved' : geometrySync.saving || geometrySync.dirty ? 'Sending…' : 'Live · saved';
    if (retry) retry.hidden = !geometrySync.error;
  }
  function updateGeometryFields() {
    const l = layer(); if (!l) return;
    const group = groupOf(state.layers, l), w = group ? unionWindow(group.a.window, group.b.window) : l.window;
    for (const [key, label] of [['x', 'X'], ['y', 'Y'], ['width', 'Width'], ['height', 'Height']]) {
      const control = root.querySelector(`input[aria-label="Layer ${label}"]`);
      if (control && control !== document.activeElement) control.value = w[key];
    }
  }
  function editGeometry(request, immediate = true) {
    if (!state || busy) return;
    const l = state.layers.find(l => l.id === request.id && l.screenId === request.screenId);
    if (!l || (l.scene === 2 && state.screens.find(s => s.id === l.screenId)?.pgmLocked)) return;
    const w = request.window;
    if (!w || !['x', 'y', 'width', 'height'].every(k => Number.isSafeInteger(w[k])) || w.width < 64 || w.height < 64) return;
    const group = request.action === 'group-window' && groupOf(state.layers, l);
    if (request.action === 'group-window' && !group) return;
    if (group) {
      const share = group.orient === 'H' ? group.a.window.width / (group.a.window.width + group.b.window.width)
        : group.a.window.height / (group.a.window.height + group.b.window.height);
      [group.a.window, group.b.window] = splitWindow(w, group.orient, share);
      request = { ...request, id: group.a.id };
    } else l.window = { ...w };
    geometryRevision++; geometrySync.put(request, immediate); paintAll(); updateGeometryFields();
  }
  function adopt(next) {
    sourceVersion++;
    state = next; session = next.session;
    const ids = next.screens.map(s => s.id);
    shown = (shown || []).filter(id => ids.includes(id));
    if (!shown.length) shown = next.screens.filter(s => s.enabled && s.outputs.length).map(s => s.id);
    if (!shown.length) shown = ids.slice(0, 1);
    if (!next.layers.some(l => l.id === selectedId)) selectedId = undefined;
    sourceKey ||= next.sources.find(s => s.type === 2) ? `2:${next.sources.find(s => s.type === 2).id}` : undefined;
    render(); scheduleSources();
  }
  async function refresh() {
    if (!getSession()) return;
    if (!await geometrySync.drain()) {
      if (!window.confirm('Discard the unsaved layer position changes and refresh?')) return;
      geometrySync.reset();
    }
    await operation(async () => adopt(await api(sessionPath('programming', getSession()))));
  }
  const sourcePollSafe = () => state && session === getSession() && !$('programming-panel').hidden && !document.hidden &&
    !busy && !geometrySync.dirty && !geometrySync.saving && !sourceDragging && !stages.some(s => s.dragging());
  function scheduleSources() {
    clearTimeout(sourceTimer);
    if (!state || $('programming-panel').hidden) return;
    const epoch = session;
    sourceTimer = setTimeout(async () => {
      const version = sourceVersion;
      try {
        if (!sourcePolling && sourcePollSafe()) {
          sourcePolling = true;
          try {
            const next = await api(sessionPath('programming/sources', epoch));
            if (version === sourceVersion && epoch === session && sourcePollSafe()) {
              state.sources = [...next.sources, ...state.sources.filter(s => s.type !== 2)];
              if (sourceTab === 'inputs') renderSources();
            }
          } finally { sourcePolling = false; }
        }
      } catch {
        if (version === sourceVersion && epoch === session && sourcePollSafe()) {
          state.sources = state.sources.map(s => s.type === 2 ? { ...s, connected: false, signalLabel: 'Status unavailable', signalHealth: 'off' } : s);
          if (sourceTab === 'inputs') renderSources();
        }
      }
      finally { if (epoch === session) scheduleSources(); }
    }, 2000);
  }
  root.addEventListener('dragstart', () => { sourceDragging = true; });
  root.addEventListener('drop', () => { sourceDragging = false; });
  document.addEventListener('dragend', () => { sourceDragging = false; });
  const editing = () => root.contains(document.activeElement) && document.activeElement.matches('input,select,textarea');
  function scheduleRefresh(delay) {
    const epoch = session; clearTimeout(refreshTimer);
    const update = async (attempt = 0) => {
      if (session !== epoch) return;
      if (busy || geometrySync.dirty || geometrySync.saving || stages.some(s => s.dragging()) || editing()) { if (attempt < 30) refreshTimer = setTimeout(() => update(attempt + 1), 150); return; }
      try { const version = geometryRevision, next = await api(sessionPath('programming', epoch)); if (session === epoch && version === geometryRevision && !geometrySync.dirty && !geometrySync.saving && !stages.some(s => s.dragging()) && !editing()) adopt(next); }
      catch (error) { if (!$('programming-panel').hidden) notice(error.message, 'error'); }
    };
    refreshTimer = setTimeout(update, delay);
  }
  async function command(request, success = 'Programming updated.') {
    if (['window', 'group-window'].includes(request.action)) { geometrySuccess = success; editGeometry(request); return; }
    if (!await geometrySync.drain()) { notice('Retry the unsaved layer positions before this action.', 'error'); return; }
    await operation(async () => {
      const before = new Set(state.layers.map(l => l.id));
      const next = await api('programming', { session, ...request }, 'PUT');
      if (request.action === 'create') selectedId = next.layers.find(l => !before.has(l.id))?.id ?? selectedId;
      adopt(next); invalidate('programming');
      notice(next.skipped?.length ? `${success} Skipped disabled ${next.skipped.join(', ')}.` : success, 'success');
      if (['take', 'cut'].includes(request.action)) scheduleRefresh(request.action === 'take' ? (request.time || 500) + 150 : 150);
      if (request.action === 'preset-load') scheduleRefresh(600);
      if (request.action === 'preset-autotake') scheduleRefresh((request.time || 500) + 150);
    });
    setDisabled(root, busy);
  }
  function addLayer(key, screen, scene, point) {
    const drag = parseDragKey(key), at = point || { x: screen?.width / 2, y: screen?.height / 2 };
    if (!screen) { notice('Show a screen first.'); return; }
    if (drag.kind === 'bkg') return command({ action: 'bkg', screenId: screen.id, scene, pictureId: drag.id, enable: true }, `Background set on ${screen.name} ${scene === 2 ? 'PGM' : 'PVW'}.`);
    if (drag.kind === 'logo') return command({ action: 'logo', screenId: screen.id, scene, pictureId: drag.id, point: { x: Math.round(at.x), y: Math.round(at.y) } }, 'Logo placed.');
    if (drag.kind === 'group') {
      const g = state.groupSources.find(x => x.id === drag.id); if (!g) return;
      if (!g.available) { notice('A source of this group is no longer available.', 'error'); return; }
      const size = groupSize(sourceFor(`${g.a.type}:${g.a.id}`), sourceFor(`${g.b.type}:${g.b.id}`), g.orient);
      const window = { x: Math.round(at.x - size.width / 2), y: Math.round(at.y - size.height / 2), width: size.width, height: size.height };
      return command({ action: 'group-create', screenId: screen.id, scene, orientation: g.orient, sources: [g.a, g.b], window }, `${g.name} placed.`);
    }
    const source = sourceFor(key); if (!source) { notice('Choose a source first.'); return; }
    if ([3, 4].includes(source.type) && source.id === screen.id) { notice('A screen cannot show its own PGM/PVW.', 'error'); return; }
    const window = dropWindow(source, screen, point || { x: screen.width / 2, y: screen.height / 2 });
    command({ action: 'create', screenId: screen.id, scene, source: { id: source.id, type: source.type }, window, name: 'Layer' }, 'Layer created.');
  }
  function paintAll() {
    for (const node of root.querySelectorAll('.program-stage')) {
      const screen = state.screens.find(s => s.id === Number(node.dataset.screen)), scene = Number(node.dataset.scene);
      const bkg = state.backgrounds?.find(b => b.screenId === screen.id && b.scene === scene && b.enabled && b.pictureId != null);
      paintStage(node, screen, state.layers.filter(l => l.screenId === screen.id && l.scene === scene), selectedId,
        bkg ? `/api/gallery/thumb?session=${encodeURIComponent(session)}&id=${bkg.pictureId}` : null);
    }
  }
  function band(scene, label) {
    const wrap = el('section', { className: `program-band ${scene === 2 ? 'pgm' : 'pvw'}` });
    wrap.append(el('h2', {}, label));
    const row = el('div', { className: 'program-band-row' }), screens = visible();
    // Cells flex by pixel width so all screens share one scale; the row is capped so the
    // tallest stage leaves room for both bands (stage height = rowWidth * height / totalWidth).
    const total = screens.reduce((sum, s) => sum + canvasOf(s).width, 0), tallest = Math.max(...screens.map(s => canvasOf(s).height));
    row.style.maxWidth = `max(320px, calc((100dvh - 330px) / 2 * ${(total / tallest).toFixed(5)}))`;
    for (const screen of screens) {
      const cell = el('div', { className: 'program-cell' }); cell.style.flex = `${canvasOf(screen).width} 1 0`;
      const locked = scene === 2 && screen.pgmLocked;
      const stage = el('div', { className: `program-stage${locked ? ' locked' : ''}`, tabindex: 0, 'data-screen': screen.id, 'data-scene': scene, 'aria-label': `${screen.name} ${label}${locked ? ' (locked)' : ''}` });
      stage.style.aspectRatio = `${canvasOf(screen).width}/${canvasOf(screen).height}`;
      const head = el('div', { className: 'program-cell-head' }); head.append(el('span', {}, `${screen.name} · ${screen.width} × ${screen.height}`));
      const bkg = state.backgrounds?.find(b => b.screenId === screen.id && b.scene === scene);
      if (bkg?.pictureId != null) {
        const chip = button(bkg.enabled ? 'BKG on' : 'BKG off', () => command({ action: 'bkg', screenId: screen.id, scene, enable: !bkg.enabled }, `Background ${bkg.enabled ? 'off' : 'on'} on ${screen.name} ${label}.`), `button lock-toggle${bkg.enabled ? ' on' : ''}`);
        chip.title = `Background: ${bkg.name || `picture ${bkg.pictureId}`}`; head.append(chip);
      }
      if (scene === 2) {
        const lock = button(screen.pgmLocked ? 'PGM locked' : 'PGM unlocked', () => command({ action: 'pgm-lock', screenId: screen.id, locked: !screen.pgmLocked },
          screen.pgmLocked ? `${screen.name} PGM unlocked.` : `${screen.name} PGM locked.`), `button lock-toggle${screen.pgmLocked ? ' on' : ''}`);
        lock.setAttribute('aria-pressed', String(screen.pgmLocked)); lock.title = screen.pgmLocked ? 'PGM editing is locked. Click to allow editing PGM layers.' : 'PGM layers can be edited. Click to lock.';
        head.append(lock);
      }
      cell.append(head, stage); row.append(cell);
      stages.push(bindStage(stage, screen, {
        layers: () => state.layers.filter(l => l.screenId === screen.id && l.scene === scene),
        select: id => { selectedId = id; paintAll(); renderInspector(); }, busy: () => busy, repaint: paintAll,
        locked: () => scene === 2 && Boolean(state.screens.find(s => s.id === screen.id)?.pgmLocked),
        onLocked: () => notice(`PGM of ${screen.name} is locked. Unlock it to edit.`, 'error'),
        commit: (l, window) => command({ action: 'window', screenId: screen.id, id: l.id, window }, 'Layer position saved.'),
        commitGroup: (l, window) => command({ action: 'group-window', screenId: screen.id, id: l.id, window }, 'Group position saved.'),
        preview: (l, window, group) => editGeometry({ action: group ? 'group-window' : 'window', screenId: screen.id, id: l.id, window }, false),
        drop: (key, point) => addLayer(key, screen, scene, point),
        replace: (key, l) => {
          // Backgrounds, logos and groups are placed, not swapped into a layer.
          if (parseDragKey(key).kind !== 'source') { addLayer(key, screen, scene, { x: l.window.x + l.window.width / 2, y: l.window.y + l.window.height / 2 }); return; }
          const source = sourceFor(key); if (!source) return;
          if ([3, 4].includes(source.type) && source.id === screen.id) { notice('A screen cannot show its own PGM/PVW.', 'error'); return; }
          selectedId = l.id;
          command({ action: 'source', screenId: screen.id, id: l.id, source: { id: source.id, type: source.type } }, `${l.name} now shows ${source.name}.`);
        },
      }));
    }
    wrap.append(row); return wrap;
  }
  function render() {
    root.replaceChildren(); stages.length = 0;
    if (!state) { root.append(text('Connect a device to program screens.')); return; }
    const bar = el('div', { className: 'program-toolbar' }), chips = el('div', { className: 'screen-chips', role: 'group', 'aria-label': 'Shown screens' });
    for (const s of state.screens) {
      const on = shown.includes(s.id);
      const chip = button(s.name, () => {
        shown = on ? shown.filter(id => id !== s.id) : [...shown, s.id];
        if (!shown.length) shown = [s.id];
        shown.sort((a, b) => state.screens.findIndex(x => x.id === a) - state.screens.findIndex(x => x.id === b)); remember(); render();
      }, `button chip${on ? ' active' : ''}${s.enabled ? '' : ' disabled-screen'}`);
      chip.setAttribute('aria-pressed', String(on));
      if (!s.enabled) { chip.title = 'Disabled on the device: shown for editing, but presets and Take/Cut skip it (PixelFlow hides it).'; chip.append(el('small', {}, ' off')); }
      chips.append(chip);
    }
    const duration = input(durationMs, 'Transition duration ms', 'number'); duration.min = 0; duration.max = 10000;
    duration.onchange = () => { durationMs = Number(duration.value); };
    const swap = select([[1, 'Swap'], [0, 'Copy']], shouldSwap ? 1 : 0, 'Transition mode'); swap.onchange = () => { shouldSwap = swap.value === '1'; };
    const ids = () => visible().map(s => s.id);
    bar.append(chips, el('span', { className: 'toolbar-spacer' }), field('ms', duration), swap,
      button('Cut', () => command({ action: 'cut', screenIds: ids(), swap: shouldSwap }, 'Cut sent.')),
      button('Take', () => command({ action: 'take', screenIds: ids(), time: Number(duration.value), swap: shouldSwap }, 'Take sent.'), 'button primary take'),
      button('Refresh', refresh, 'button quiet'));
    const retry = button('Retry save', () => geometrySync.retry(), 'button secondary'); retry.id = 'program-retry';
    bar.append(el('small', { id: 'program-save-status', 'aria-live': 'polite' }), retry);
    root.append(bar);
    if (!state.screens.length) { root.append(text('Create or map a screen in Screens first.')); return; }
    const workspace = el('div', { className: 'program-workspace' }), sources = el('aside', { className: 'program-sources' });
    sources.append(el('h2', {}, 'Sources'), el('div', { id: 'source-tabs-body', className: 'source-tabs-body' }));
    const views = el('section', { className: 'program-views' });
    // WO-026: the selected layer's position/size tools sit under the screens; presets moved to an inspector tab.
    views.append(band(2, 'PGM'), band(4, 'PVW'), el('section', { id: 'layer-tools', className: 'layer-tools', 'aria-label': 'Selected layer position and size' }));
    workspace.append(sources, views, el('aside', { id: 'program-properties', className: 'program-properties' })); root.append(workspace);
    paintAll(); renderInspector(); renderSources(); setDisabled(root, busy); geometryStatus();
    if (!gallery) loadGallery();
  }
  // Source tabs (WO-027): Inputs, Screens, Groups, Backgrounds, Logos.
  function renderSources() {
    const body = $('source-tabs-body'); if (!body) return;
    const filterFocused = body.contains(document.activeElement) && document.activeElement.getAttribute('aria-label') === 'Filter programming sources';
    const focusedKey = body.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    const caret = filterFocused ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    const scroll = body.querySelector('.source-list')?.scrollTop || 0;
    renderSourceTabs(body, { state, gallery, session, filter: sourceFilter, setFilter: value => { sourceFilter = value; }, tab: sourceTab, sourceKey, notice, command, screenId: () => active()?.id,
      setTab: t => { sourceTab = t; renderSources(); if (['bkg', 'logo'].includes(t) && !gallery) loadGallery(); },
      pick: key => { sourceKey = key; for (const n of body.querySelectorAll('[data-key]')) n.classList.toggle('selected', n.dataset.key === key); },
      addToPvw: key => { sourceKey = key; addLayer(key, active(), 4); }, upload, galleryEdit, setGalleryEdit: v => { galleryEdit = v; renderSources(); },
      manage: async (body, done) => { await operation(async () => { notice(body.action === 'capture' ? 'Capturing…' : 'Updating gallery…'); gallery = await api(`gallery/manage?session=${encodeURIComponent(session)}`, body, 'PUT'); notice(done, 'success'); }); renderSources(); } });
    const list = body.querySelector('.source-list'); if (list) list.scrollTop = scroll;
    if (filterFocused) { const filter = body.querySelector('[aria-label="Filter programming sources"]'); filter?.focus({ preventScroll: true }); if (filter && caret) filter.setSelectionRange(...caret); }
    else if (focusedKey) [...body.querySelectorAll('[data-key]')].find(n => n.dataset.key === focusedKey)?.focus({ preventScroll: true });
  }
  let galleryEdit = false;
  async function loadGallery() {
    try { gallery = await api(sessionPath('gallery', session)); } catch (error) { gallery = { pictures: [], support: {} }; notice(error.message, 'error'); }
    renderSources();
  }
  async function upload(type, file) {
    let size; try { const bitmap = await createImageBitmap(file); size = { width: bitmap.width, height: bitmap.height }; bitmap.close?.(); }
    catch { notice('That file is not a readable image.', 'error'); return; }
    const name = file.name.replace(/\.[^.]+$/, '').slice(0, 64) || 'Picture';
    await operation(async () => {
      notice(`Uploading ${file.name}…`);
      const query = new URLSearchParams({ session, type, name, width: size.width, height: size.height });
      const response = await fetch(`/api/gallery/upload?${query}`, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || `Upload failed (${response.status}).`);
      gallery = result; notice(`${result.uploaded.name} uploaded to the device gallery.`, 'success');
    });
    renderSources();
  }
  function presetsPanel() {
    return renderPresets({ presets: state.presets, loadTarget, saving: savingFrom, editing: editingPresets,
      setLoadTarget: r => { loadTarget = r; renderInspector(); }, setSaving: v => { savingFrom = v; renderInspector(); },
      loadOptions, setLoadOptions: v => { loadOptions = { ...loadOptions, ...v }; renderInspector(); },
      transition: () => ({ time: durationMs, swap: shouldSwap }), layersFor: scene => visible().flatMap(s => state.layers.filter(l => l.screenId === s.id && l.scene === scene).map(l => ({ ...l, screenName: s.name }))),
      setEditing: v => { editingPresets = v; renderInspector(); }, command, screenIds: () => visible().map(s => s.id) });
  }
  function renderInspector() {
    const node = $('program-properties'); if (!node) return; node.replaceChildren();
    const l = layer(), screen = l && state.screens.find(s => s.id === l.screenId);
    const tools = $('layer-tools'); if (tools) renderLayerToolbar(tools, { state, layer: l, screen, command, liveGeometry: request => editGeometry(request, false), finishGeometry: () => geometrySync.flush(true), locked: Boolean(l && l.scene === 2 && screen?.pgmLocked) });
    const tabs = el('div', { className: 'inspector-tabs', role: 'tablist', 'aria-label': 'Inspector' });
    for (const [id, label] of [['layer', 'Layer'], ['presets', 'Presets']]) {
      const tab = button(label, () => { sideTab = id; renderInspector(); }, `button inspector-tab${sideTab === id ? ' active' : ''}`);
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(sideTab === id)); tabs.append(tab);
    }
    node.append(tabs);
    if (sideTab === 'presets') { node.append(presetsPanel()); setDisabled(node, busy); return; }
    if (!l) node.append(text('Click a layer, or drag a source onto PGM or PVW.'));
    else {
      node.append(el('strong', {}, l.name), text(`${screen.name} · ${l.scene === 2 ? 'PGM' : 'PVW'}`));
      const lockedLayer = l.scene === 2 && screen.pgmLocked;
      if (lockedLayer) node.append(text('PGM is locked: unlock it above the PGM view to edit this layer.', 'lock-note'));
      renderLayerPanel(node, { state, layer: l, command });
      if (lockedLayer) for (const control of node.querySelectorAll('input,select,button')) control.dataset.fixed = 'true';
    }
    const s = active(); if (!s) return;
    const list = el('div', { className: 'program-layer-list' }); list.append(el('h2', {}, `${s.name} layers`));
    for (const scene of [2, 4]) for (const item of state.layers.filter(x => x.screenId === s.id && x.scene === scene).sort((a, b) => b.zorder - a.zorder)) {
      list.append(button(`${scene === 2 ? 'PGM' : 'PVW'} · ${item.name} · ${item.sourceName || `Source ${item.sourceId}`}`,
        () => { selectedId = item.id; paintAll(); renderInspector(); }, `button${item.id === selectedId ? ' selected' : ''}`));
    }
    node.append(list); setDisabled(node, busy);
  }
  // Arrow keys nudge the selected layer (1 px, Shift 10 px) while a stage has focus (WO-024).
  root.addEventListener('keydown', event => {
    const keys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    const l = layer(), clear = ['Delete', 'Backspace'].includes(event.key);
    if ((!keys && !clear) || !l || busy || !event.target.closest?.('.program-stage')) return;
    const scr = state.screens.find(s => s.id === l.screenId); if (l.scene === 2 && scr?.pgmLocked) return;
    if (clear) { event.preventDefault(); clearLayer(state, l, command); return; }
    event.preventDefault(); const step = event.shiftKey ? 10 : 1, group = groupOf(state.layers, l);
    const w = group ? unionWindow(group.a.window, group.b.window) : l.window, moved = { ...w, x: w.x + keys[0] * step, y: w.y + keys[1] * step };
    command(group ? { action: 'group-window', screenId: l.screenId, id: l.id, window: moved } : { action: 'window', screenId: l.screenId, id: l.id, window: moved }, 'Layer position saved.');
  });
  render();
  return { open: () => { if (!state) return refresh(); scheduleSources(); }, refresh, hasChanges: () => geometrySync.dirty || geometrySync.saving || stages.some(s => s.dragging()),
    reset(next) { if (session === next) return; clearTimeout(sourceTimer); sourceVersion++; sourceDragging = false; sourceFilter = ''; clearTimeout(refreshTimer); geometrySync.reset(); session = next; state = undefined; render(); },
    setBusy(value) { busy = value; setDisabled(root, busy); if (!busy) geometrySync.resume(); } };
}

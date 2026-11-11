import { keys, sameWindow, clone, fit, dragWindow, readLayout } from './editor.js';
import { createInputsUI } from './inputs.js';
import { createMvrSync } from './mvr-sync.js';
import { reconcileMvr, sameEdit } from './mvr-reconcile.js';
import { createStudioPanels } from './studio-panels.js';
import { createDiscoveryUI } from './discovery-ui.js';
import { createMvrTemplates } from './mvr-templates.js';
import { canPlace, fixAspectRatios, ratioSize, sourceSignal, matchesRatio, windowLimit, growsPastLimit, shrinkToLimit } from './mvr-geometry.js';
import { renderMvrSources, placeWindow, sourceOptions, parseKey, MVR_SOURCE } from './mvr-sources.js';

const $ = (id) => document.getElementById(id);
const color = () => '#aebdcb';
const sourceLabel = (layer) => `${layer.source || ''}${layer.sourceType === 3 ? ' PGM' : layer.sourceType === 4 ? ' PVW' : ''}`.trim();
let state, base, screenId, selectedId, busy = false, drag;
let undo = [], redo = [];
let activeTab = 'device', mvrStale = false, inputsStale = false;
let mvrSaveFailed = false;
const tabs = ['device', 'inputs', 'outputs', 'screens', 'programming', 'mvr', 'audio'];
const screen = () => state?.screens.find((item) => item.id === screenId);
const selected = () => state?.layers.find((item) => item.id === selectedId);
const windows = () => state?.layers.filter((item) => item.screenId === screenId) || [];
const geometry = () => state.layers.map(({ id, window, aspectLock, aspectMode }) => ({ id, window: clone(window), aspectLock, aspectMode }));
const changes = () => state?.layers.filter((item) => !sameEdit(item, base.layers.find((old) => old.id === item.id))) || [];

function notice(message, kind = '') {
  $('notice').textContent = message;
  $('notice').className = kind;
  $('notice').setAttribute('role', kind === 'error' ? 'alert' : 'status');
}

async function api(path, body, method = 'POST') {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || `Request failed (${response.status}).`), { snapshot: result.snapshot });
  return result;
}

function adopt(next) {
  state = clone(next);
  base = clone(next);
  inputsUI.reset(next.session); panels.reset(next.session); sync.reset(); mvrStale = false; mvrSaveFailed = false;
  screenId = next.screens.some((item) => item.id === screenId) ? screenId : next.screens[0]?.id;
  selectedId = windows().some((item) => item.id === selectedId) ? selectedId : windows()[0]?.id;
  undo = []; redo = [];
  $('screen').replaceChildren(...state.screens.map((item) => new Option(item.name, item.id)));
  if (!state.screens.length) $('screen').add(new Option('No MVR outputs found', ''));
  $('audio-tab').hidden = !next.capabilities?.audio;
  showTab((next.capabilities?.mvr === false && activeTab === 'mvr') || (!next.capabilities?.audio && activeTab === 'audio') ? 'device' : activeTab, false);
  render();
}

async function operation(action) {
  if (busy) return;
  busy = true; renderControls();
  try { await action(); } catch (error) { notice(error.message, 'error'); }
  finally { busy = false; render(); sync.schedule(0); }
}

function canDiscard() {
  return (!changes().length && !inputsUI.hasChanges() && !panels.hasChanges()) || window.confirm('Discard your pending changes?');
}

async function connect() {
  await finishMvrSave();
  if (!canDiscard()) return;
  let connected = false;
  await operation(async () => {
    notice('Identifying the device at this address…');
    const next = await api('connect', { host: $('host').value.trim(), apiPort: $('api-port').value, serial: $('serial').value.trim() });
    adopt(next); connected = true;
    document.querySelector('.advanced').open = false;
    try { localStorage.setItem('mvr-connection', JSON.stringify({ host: $('host').value, apiPort: $('api-port').value, serial: $('serial').value })); } catch {}
    const fallback = next.screens.some((item) => item.dimensionsAssumed) ? ' Output dimensions were unavailable; 1920 × 1080 is assumed.' : '';
    notice(`Connected to ${next.device.model}.${fallback}`, 'success');
  });
  if (connected) await openActivePanel();
}

async function finishMvrSave() {
  await sync.idle();
  while (changes().length && !sync.error && !busy && !drag) { await sync.flush(); await sync.idle(); }
  return !sync.error && !changes().length;
}

function remember(before = geometry()) {
  undo.push(before);
  if (undo.length > 100) undo.shift();
  redo = [];
}

function restore(layout) {
  for (const item of layout) {
    const layer = state.layers.find((layer) => layer.id === item.id);
    if (layer) { layer.window = clone(item.window); layer.aspectLock = item.aspectLock ?? null; layer.aspectMode = item.aspectMode ?? 5; }
  }
}

const limitOf = (layer) => windowLimit(state?.device?.model, layer?.sourceType);
// While resizing, never grow past the limit; an already larger window can only shrink (cap = its start size).
const dragLimit = () => { const limit = limitOf(selected()); return limit && drag ? { width: Math.max(limit.width, drag.window.width), height: Math.max(limit.height, drag.window.height) } : null; };
function edit(window) {
  if (busy || !selected() || sameWindow(window, selected().window)) return;
  const limit = limitOf(selected());
  let next = fit(window, screen());
  if (growsPastLimit(next, selected().window, limit)) {
    next = shrinkToLimit(next, limit, selected().aspectLock, selected().umdHeight);
    notice(`Input windows are limited to ${limit.width} × ${limit.height} on ${state.device.model} (glitch-free size). Resized to ${next.width} × ${next.height}.`);
  }
  if (!canPlace(selected(), next, state.layers)) { notice('MVR windows cannot overlap. Choose a smaller size or a free position.', 'error'); render(); return; }
  const resized = next.width !== selected().window.width || next.height !== selected().window.height;
  if (resized && selected().aspectLock && !matchesRatio(next, selected().aspectLock, selected().umdHeight)) { notice('This size cannot fit while keeping the locked aspect ratio.', 'error'); render(); return; }
  remember(); selected().window = next; render(); sync.schedule();
}

function renderControls() {
  const connected = Boolean(state);
  const dirty = changes().length;
  for (const id of ['connect', 'host', 'api-port', 'serial']) $(id).disabled = busy;
  for (const tab of tabs) $(`${tab}-tab`).disabled = busy || (tab === 'mvr' && state?.capabilities?.mvr === false);
  $('mvr-tab').title = $('mvr-tab').disabled ? 'Multiviewer editing is available for P20 and Q8' : '';
  inputsUI.setBusy(busy); panels.setBusy(busy); discovery.setBusy(busy); templates.setBusy(busy);
  $('screen').disabled = busy || !state?.screens.length;
  $('refresh').disabled = busy || !connected;
  $('save').disabled = busy || !windows().length;
  $('load').disabled = busy || !windows().length;
  $('fix-aspect').disabled = busy || !windows().length;
  $('apply').disabled = busy || sync.saving || !dirty;
  $('apply').hidden = !sync.error;
  $('undo').disabled = busy || !undo.length;
  $('redo').disabled = busy || !redo.length;
  $('inspector').disabled = busy || !selected();
  $('apply').textContent = 'Retry save';
  $('dirty-label').textContent = sync.error ? 'Not saved' : sync.saving ? 'Saving…' : dirty ? 'Waiting to save…' : 'Saved · changes send automatically';
  $('dirty-label').className = dirty ? 'pending' : '';
}

function renderList() {
  $('window-list').replaceChildren();
  windows().forEach((layer) => {
    const row = document.createElement('button');
    row.className = `window-row${layer.id === selectedId ? ' selected' : ''}`;
    row.setAttribute('aria-pressed', String(layer.id === selectedId));
    const swatch = document.createElement('span'); swatch.className = 'swatch'; swatch.style.background = color(layer);
    const text = document.createElement('span');
    const name = document.createElement('span'); name.className = 'row-name'; name.textContent = sourceLabel(layer) || layer.name;
    const size = document.createElement('span'); size.className = 'row-size'; size.textContent = `${layer.window.width} × ${layer.window.height}`;
    text.append(name, size); row.append(swatch, text);
    if (!sameEdit(layer, base.layers.find((item) => item.id === layer.id))) {
      const marker = document.createElement('span'); marker.className = 'row-dirty'; marker.textContent = '•'; row.append(marker);
    }
    row.onclick = () => { if (!busy) { selectedId = layer.id; render(); } };
    $('window-list').append(row);
  });
}

function renderStage() {
  if (!state) return;
  const stage = $('stage'); stage.replaceChildren();
  if (!screen()) return;
  stage.style.aspectRatio = `${screen().width} / ${screen().height}`;
  windows().forEach((layer, i) => {
    const node = document.createElement('div');
    node.className = `window${layer.id === selectedId ? ' selected' : ''}`;
    node.dataset.id = layer.id;
    node.style.setProperty('--window-color', color(layer));
    const { x, y, width, height } = layer.window;
    Object.assign(node.style, { left: `${100 * x / screen().width}%`, top: `${100 * y / screen().height}%`,
      width: `${100 * width / screen().width}%`, height: `${100 * height / screen().height}%` });
    const name = document.createElement('span'); name.className = 'window-title'; name.textContent = layer.name;
    const source = document.createElement('span'); source.className = 'window-source'; source.textContent = sourceLabel(layer);
    const number = document.createElement('span'); number.className = 'window-number'; number.textContent = String(i + 1).padStart(2, '0');
    node.append(number, name, source);
    if (layer.umdHeight > 0) {
      const strip = document.createElement('span'); strip.className = 'window-umd';
      strip.style.height = `${100 * layer.umdHeight / height}%`; strip.title = `UMD: ${layer.umdHeight} output pixels`;
      node.append(strip);
    }
    if (layer.id === selectedId) for (const direction of ['nw', 'ne', 'sw', 'se']) {
      const handle = document.createElement('span'); handle.className = `handle ${direction}`; handle.dataset.handle = direction; node.append(handle);
    }
    stage.append(node);
  });
  if (!windows().length) {
    const hint = document.createElement('div'); hint.className = 'welcome'; hint.textContent = 'No MVR windows. Drag a screen or input from Add to MVR.'; stage.append(hint);
  }
}

// MVR structure changes (WO-020): saves pending geometry first, then rereads the device.
async function mvrStructure(request, success) {
  if (busy || !state) return;
  if (!(await finishMvrSave())) { notice('Save or retry pending MVR edits before adding or removing windows.', 'error'); return; }
  await operation(async () => {
    const next = await api('mvr-layers', { session: state.session, screenId, ...request }, 'PUT');
    adopt(next); if (next.changedId) selectedId = next.changedId;
    notice(success, 'success');
  });
}
function addSource(source, point) {
  if (source.umdHeight === null) { notice('UMD height is unavailable. Reconnect to read device configuration before dropping this source.', 'error'); return; }
  const window = placeWindow(source, screen(), windows(), point, windowLimit(state.device.model, source.type));
  if (!window) { notice('No free space in this MVR output. Shrink or delete a window first.', 'error'); return; }
  mvrStructure({ action: 'create', source: { type: source.type, id: source.id }, window }, `${source.name} added to the MVR.`);
}

function render(keepEditing = false) {
  renderControls();
  if (!state) return;
  $('connection-label').textContent = `${state.device.model} · ${state.device.host} · ${state.device.serial}`;
  $('connection-dot').className = 'dot connected';
  $('window-count').textContent = windows().length;
  $('screen').value = screenId ?? '';
  $('resolution').textContent = screen() ? `${screen().width} × ${screen().height}` : '—';
  $('canvas-end').textContent = screen() ? `${screen().width} / ${screen().height} PX` : '—';
  $('inspector-empty').hidden = Boolean(selected());
  $('inspector').hidden = !selected();
  if (selected()) {
    $('selected-name').textContent = selected().name;
    $('selected-source').textContent = sourceLabel(selected()) || 'MVR window';
    $('selected-swatch').style.background = color(selected());
    $('layer-id').textContent = `Window ID ${selected().id}`;
    for (const key of keys) if (!keepEditing || document.activeElement !== $(key)) $(key).value = selected().window[key];
    $('x').max = screen().width - selected().window.width;
    $('y').max = screen().height - selected().window.height;
    $('width').max = screen().width - selected().window.x;
    $('height').max = screen().height - selected().window.y;
    $('aspect').checked = Boolean(selected().aspectLock);
    const signal = sourceSignal(selected(), state.signals || []);
    $('aspect-info').textContent = [signal?.connected ? `${selected().sourceType === 2 ? 'Input' : 'Screen'} ${signal.width} × ${signal.height}` : '', selected().umdHeight === null ? 'UMD height unavailable' : selected().umdHeight ? `UMD ${selected().umdHeight} px` : '', selected().aspectLock ? 'Content ratio locked' : ''].filter(Boolean).join(' · ');
  }
  if (selected()) sourceOptions($('mvr-source'), state.sources, selected());
  renderMvrSources($('mvr-sources'), state.sources, { busy, onAdd: source => addSource(source),
    onSelect: id => { if (windows().some(l => l.id === id)) { selectedId = id; render(); } } });
  renderList(); renderStage();
}

const inputsUI = createInputsUI({ api, notice, operation, getSession: () => state?.session, onApplied: () => panels.invalidate('inputs') });
const panels = createStudioPanels({ api, notice, operation, getSession: () => state?.session,
  invalidate(source) { mvrStale = true; if (source === 'device') inputsStale = true; } });
const sync = createMvrSync({
  getChanges: () => changes().map(({ id, window, aspectLock, aspectMode }) => ({ id, window, aspectLock, aspectMode })),
  submit: pending => api('windows', { session: state.session, changes: pending }, 'PUT'),
  canSend: () => Boolean(state?.capabilities?.mvr) && !busy && !drag,
  onResult(next, sent) { state = reconcileMvr(state, base, next, sent); base = clone(next); if (mvrSaveFailed) { mvrSaveFailed = false; notice('MVR saved.', 'success'); } render(true); },
  onError(error) { mvrSaveFailed = true; if (error.snapshot?.layers && state) { state = reconcileMvr(state, base, error.snapshot, []); base = clone(error.snapshot); } notice(`MVR not saved: ${error.message}`, 'error'); render(true); },
  onStatus: () => renderControls(),
});
const templates = createMvrTemplates({ api, operation, notice, getState: () => (changes().length || sync.saving ? null : state), adopt });
const discovery = createDiscoveryUI({ api, notice, getSeed: () => $('host').value,
  async connectDevice(device) {
    $('host').value = device.host; $('api-port').value = device.apiPort; $('serial').value = device.serial; await connect();
  } });
async function openActivePanel() {
  if (!state || busy) return;
  if (activeTab === 'inputs') { if (inputsStale && !inputsUI.hasChanges()) { inputsStale = false; return inputsUI.refresh(); } return inputsUI.open(); }
  if (activeTab === 'mvr') {
    if (mvrStale && !changes().length && !sync.saving) await operation(async () => adopt(await api('state')));
    return templates.load(state);
  }
  await panels.open(activeTab);
}
function showTab(name, load = true) {
  if (name === 'mvr' && state?.capabilities?.mvr === false) return;
  activeTab = name;
  for (const tab of tabs) {
    $(`${tab}-tab`).setAttribute('aria-selected', String(tab === name));
    $(`${tab}-tab`).tabIndex = tab === name ? 0 : -1; $(`${tab}-panel`).hidden = tab !== name;
  }
  if (load) openActivePanel();
}
for (const name of tabs) {
  $(`${name}-tab`).onclick = () => showTab(name);
  $(`${name}-tab`).onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); const enabled = tabs.filter(tab => !$(`${tab}-tab`).disabled && !$(`${tab}-tab`).hidden);
    const index = enabled.indexOf(name), step = event.key === 'ArrowRight' ? 1 : -1;
    const next = enabled[(index + step + enabled.length) % enabled.length]; showTab(next); $(`${next}-tab`).focus();
  };
}
$('connect-form').onsubmit = (event) => { event.preventDefault(); connect(); };
$('screen').onchange = () => { screenId = Number($('screen').value); selectedId = windows()[0]?.id; render(); };
$('undo').onclick = () => { if (busy || !undo.length) return; redo.push(geometry()); restore(undo.pop()); render(); sync.schedule(0); };
$('redo').onclick = () => { if (busy || !redo.length) return; undo.push(geometry()); restore(redo.pop()); render(); sync.schedule(0); };

for (const key of keys) $(key).onchange = () => {
  if (!selected() || busy) return;
  const value = Number($(key).value);
  if ($(key).value === '' || !Number.isSafeInteger(value)) { notice('Enter a whole number of pixels.', 'error'); render(); return; }
  let next = { ...selected().window, [key]: value };
  if (selected().aspectLock && (key === 'width' || key === 'height')) {
    const ratio = selected().aspectLock;
    const offset = selected().umdHeight;
    const desiredWidth = key === 'width' ? value : (value - (offset ?? 0)) * ratio;
    const limit = limitOf(selected());
    const size = ratioSize(ratio, Math.min(screen().width - next.x, limit?.width ?? Infinity), Math.min(screen().height - next.y, limit?.height ?? Infinity), Math.max(64, Math.ceil(Math.max(1, 64 - (offset ?? 0)) * ratio), desiredWidth), offset);
    if (!size) { notice('No room for this locked aspect ratio at the minimum window size.', 'error'); render(); return; }
    next = { ...next, ...size };
  }
  edit(next);
};
$('center-x').onclick = () => { if (selected()) edit({ ...selected().window, x: Math.round((screen().width - selected().window.width) / 2) }); };
$('center-y').onclick = () => { if (selected()) edit({ ...selected().window, y: Math.round((screen().height - selected().window.height) / 2) }); };
$('aspect').onchange = () => {
  if (!selected() || busy) return;
  if ($('aspect').checked && selected().umdHeight === null) { notice('UMD height is unavailable. Reconnect to read device configuration before locking the content ratio.', 'error'); render(); return; }
  remember(); selected().aspectLock = $('aspect').checked ? selected().window.width / (selected().window.height - (selected().umdHeight ?? 0)) : null;
  selected().aspectMode = 5; render(); sync.schedule(0);
};
$('fix-aspect').onclick = async () => {
  if (!await finishMvrSave()) { notice('Retry the pending MVR save before fixing aspect ratios.', 'error'); return; }
  await operation(async () => {
  notice('Reading input and screen resolutions…');
  const fresh = await api('state');
  const output = fresh.screens.find((item) => item.id === screenId);
  if (fresh.session !== state.session || output?.width !== screen().width || output?.height !== screen().height ||
    fresh.layers.filter((layer) => layer.screenId === screenId).length !== windows().length || windows().some((layer) => {
      const actual = fresh.layers.find((item) => item.id === layer.id), original = base.layers.find((item) => item.id === layer.id);
      return !actual || !sameWindow(actual.window, original.window) || actual.sourceId !== layer.sourceId || actual.sourceType !== layer.sourceType || actual.umdHeight !== layer.umdHeight;
    })) throw new Error('The device layout or connection changed. Refresh before fixing aspect ratios.');
  const result = fixAspectRatios(windows(), fresh.signals || [], screen());
  if (result.layers.some((layer) => !sameEdit(layer, state.layers.find((item) => item.id === layer.id)))) { remember(); restore(result.layers); }
  state.signals = fresh.signals; sync.schedule(0);
  const tooSmall = result.skipped.filter((item) => item.reason.includes('64 px')).length;
  notice(result.fixed.length ? `Fixed and locked ${result.fixed.length} input/screen windows; ${result.skipped.length} other windows unchanged.${tooSmall ? ` ${tooSmall} cannot fit the 64 px minimum.` : ''} Saving these changes automatically.${result.skipped.some((item) => item.reason.includes('UMD')) ? ' Some windows were skipped because the device UMD height is unavailable.' : ''}` :
    tooSmall ? 'Source ratios cannot fit at the 64 px minimum. Make room first.' : 'No connected inputs or screen sources with usable resolution and UMD height were found.');
  });
};

$('stage').onpointerdown = (event) => {
  if (busy || !state || event.button !== 0) return;
  const target = event.target.closest('.window');
  if (!target) return;
  selectedId = Number(target.dataset.id);
  drag = { id: selectedId, x: event.clientX, y: event.clientY, window: clone(selected().window),
    before: geometry(), handle: event.target.dataset.handle, rect: $('stage').getBoundingClientRect() };
  $('stage').setPointerCapture(event.pointerId); $('stage').focus(); event.preventDefault(); render();
};
$('stage').onpointermove = (event) => {
  if (!drag || busy) return;
  const next = dragWindow(drag.window, (event.clientX - drag.x) * screen().width / drag.rect.width,
    (event.clientY - drag.y) * screen().height / drag.rect.height, screen(), drag.handle, Number($('snap').value), selected().aspectLock || false, selected().umdHeight, dragLimit());
  drag.blocked = !canPlace(selected(), next, state.layers);
  if (!drag.blocked) selected().window = next;
  render();
};
function endDrag(event) {
  if (!drag) return;
  if (event.type === 'pointercancel') restore(drag.before);
  else if (!sameWindow(drag.window, selected().window)) remember(drag.before);
  if (drag.blocked) notice('Movement or resizing was limited to avoid overlapping another MVR window.');
  drag = null; sync.schedule(0);
  if ($('stage').hasPointerCapture(event.pointerId)) $('stage').releasePointerCapture(event.pointerId);
  render();
}
$('stage').ondragover = (event) => { if (!busy && state && event.dataTransfer.types.includes(MVR_SOURCE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } };
$('stage').ondrop = (event) => {
  const key = event.dataTransfer.getData(MVR_SOURCE); if (!key || busy || !screen()) return;
  event.preventDefault();
  const source = state.sources.find(s => `${s.type}:${s.id}` === key); if (!source) return;
  const target = event.target.closest('.window');
  if (target) { mvrStructure({ action: 'source', layerId: Number(target.dataset.id), source: parseKey(key) }, `Window source changed to ${source.name}.`); return; }
  const rect = $('stage').getBoundingClientRect();
  addSource(source, { x: (event.clientX - rect.left) * screen().width / rect.width, y: (event.clientY - rect.top) * screen().height / rect.height });
};
$('mvr-source').onchange = () => { if ($('mvr-source').value && selected()) mvrStructure({ action: 'source', layerId: selected().id, source: parseKey($('mvr-source').value) }, 'Window source changed.'); };
$('delete-window').onclick = () => { const layer = selected(); if (layer && window.confirm(`Delete MVR window ${layer.source || layer.name}?`)) mvrStructure({ action: 'delete', layerId: layer.id }, 'MVR window deleted.'); };
$('stage').onpointerup = endDrag;
$('stage').onpointercancel = endDrag;

document.addEventListener('keydown', (event) => {
  if (busy || !state || activeTab !== 'mvr' || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault(); (event.shiftKey ? $('redo') : $('undo')).click(); return;
  }
  if (!selected() || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const amount = event.shiftKey ? 10 : 1;
  const next = { ...selected().window };
  if (event.key === 'ArrowLeft') next.x -= amount;
  if (event.key === 'ArrowRight') next.x += amount;
  if (event.key === 'ArrowUp') next.y -= amount;
  if (event.key === 'ArrowDown') next.y += amount;
  edit(next);
});

$('refresh').onclick = async () => {
  await finishMvrSave();
  if (changes().length && !window.confirm('Discard your pending window changes?')) return;
  operation(async () => { notice('Reading layout…'); adopt(await api('state')); notice('Layout refreshed.', 'success'); });
};
$('apply').onclick = () => sync.retry();
$('save').onclick = () => {
  const document = { format: 'pixelhue-mvr-layout', version: 1, serial: state.device.serial, screenId,
    width: screen().width, height: screen().height, windows: windows().map(({ id, window, aspectLock, aspectMode, umdHeight }) => ({ id, window, aspectLock, aspectMode, umdHeight })) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }));
  const link = window.document.createElement('a'); link.href = url; link.download = `mvr-layout-${screenId}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notice('Layout saved.');
};
$('load').onclick = () => $('layout-file').click();
$('layout-file').onchange = async () => {
  const file = $('layout-file').files[0]; $('layout-file').value = '';
  if (!file || busy) return;
  await operation(async () => {
    if (file.size > 256_000) throw new Error('Layout file is too large.');
    let document;
    try { document = JSON.parse(await file.text()); } catch { throw new Error('Layout file is not valid JSON.'); }
    const layout = readLayout(document, state, screenId);
    const tooBig = layout.find(item => { const layer = state.layers.find(l => l.id === item.id); return growsPastLimit(item.window, layer.window, limitOf(layer)); });
    if (tooBig) { const limit = limitOf(state.layers.find(l => l.id === tooBig.id)); throw new Error(`This layout makes an input window larger than ${limit.width} × ${limit.height}, the glitch-free limit on ${state.device.model}. Not loaded.`); }
    remember(); restore(layout); render(); sync.schedule(0); notice('Layout loaded. Saving…');
  });
};
window.addEventListener('beforeunload', (event) => { if (changes().length || sync.saving || inputsUI.hasChanges() || panels.hasChanges()) { event.preventDefault(); event.returnValue = ''; } });
try {
  const settings = JSON.parse(localStorage.getItem('mvr-connection') || '{}');
  for (const [key, id] of [['host', 'host'], ['apiPort', 'api-port'], ['serial', 'serial']]) $(id).value = settings[key] || '';
} catch {}
render();

discovery.find();

import { el, text, button, input, select, field, setDisabled, sessionPath } from './ui.js';
import { renderInputEdid } from './input-edid-ui.js';

export function createInputAdvanced({ api, operation, notice, getSession, hasBasicChanges }) {
  const root = el('details', { className: 'input-advanced', id: 'input-advanced' });
  root.append(el('summary', {}, 'Advanced'));
  const body = el('section', { className: 'advanced-input-content' }); root.append(body);
  document.getElementById('inputs-panel').append(root);
  let revision = 0;
  let state, selectedId, values = {}, mosaic, busy = false, loading = false, stale = true, pairTouched = false;
  const selected = () => state?.inputs.find(i => i.id === selectedId);
  const settings = () => Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== selected()?.values[key]));
  const mosaicChanged = () => mosaic && (mosaic.side !== selected()?.mosaic.side || mosaic.group !== selected()?.mosaic.group);
  const dirty = () => Boolean(selected() && (Object.keys(settings()).length || mosaicChanged())) || pairTouched;
  function choose(id) { selectedId = id; values = { ...selected()?.values }; mosaic = selected() ? { ...selected().mosaic } : undefined; }
  function controls() {
    setDisabled(body, busy);
    const count = Object.keys(settings()).length + Number(Boolean(mosaicChanged()));
    const label = body.querySelector('.advanced-input-pending'); if (label) label.textContent = count ? `${count} pending advanced settings` : 'No pending advanced settings';
    const save = body.querySelector('#save-input-advanced'); if (save) save.disabled = busy || !count;
  }
  async function refresh() {
    if (!getSession() || busy || loading) return;
    if (dirty() && !window.confirm('Discard pending Advanced input settings?')) return;
    loading = true;
    try { await operation(async () => {
      const epoch = revision, session = getSession(), next = await api(sessionPath('input-advanced', session));
      if (epoch !== revision || session !== getSession()) return;
      state = next; stale = false; pairTouched = false;
      choose(state.inputs.some(i => i.id === selectedId) ? selectedId : state.inputs[0]?.id); render();
    }); } finally { loading = false; }
  }
  async function apply(changes, selectedDraft = false) {
    if (!selectedDraft && (Object.keys(settings()).length || mosaicChanged())) { notice('Apply or discard the selected input’s pending Advanced settings first.', 'error'); return; }
    if (hasBasicChanges()) { notice('Apply or discard the pending input port/EDID settings first.', 'error'); return; }
    await operation(async () => {
      const epoch = revision, session = getSession(), next = await api('input-advanced', { session: state.session, changes }, 'PUT');
      if (epoch !== revision || session !== getSession()) return;
      state = next; pairTouched = false;
      choose(state.inputs.some(i => i.id === selectedId) ? selectedId : state.inputs[0]?.id); render();
      notice('Advanced input settings saved.', 'success');
    });
  }
  function render() {
    body.replaceChildren();
    if (!state) { body.append(text('Connect a device to load Advanced input settings.')); return; }
    const heading = el('div', { className: 'tool-heading' });
    const picker = select(state.inputs.map(i => [i.id, `${i.name} · ${i.connector} · Slot ${i.slot} / Port ${i.port}`]), selectedId, 'Advanced input');
    picker.onchange = () => { if (!dirty() || window.confirm('Discard pending Advanced input settings?')) { pairTouched = false; choose(Number(picker.value)); render(); } else picker.value = selectedId; };
    heading.append(picker, button('Refresh advanced', refresh)); body.append(heading);
    const row = selected(); if (!row) { body.append(text('No active input connectors were returned.')); return; }
    const sections = new Map();
    for (const f of row.fields) {
      if (!sections.has(f.section)) {
        const section = el('section', { className: 'advanced-input-group' }), grid = el('div', { className: 'settings-grid' });
        section.append(el('h2', {}, f.section), grid); body.append(section); sections.set(f.section, grid);
      }
      const control = f.options ? select(f.options, values[f.key], f.label) : input(values[f.key], f.label, 'number');
      if (!f.options) { control.min = f.min; control.max = f.max; control.step = f.step; }
      const update = () => { values[f.key] = Number(control.value); controls(); };
      if (f.options) control.onchange = update; else control.oninput = update;
      sections.get(f.section).append(field(f.label, control));
    }
    if (!row.fields.length) body.append(text('No editable Advanced settings were advertised for this connector.'));
    if (row.mosaicSupported) {
      const grid = el('div', { className: 'studio-bulk' }), side = select([['none', 'Off'], ['left', 'Left'], ['right', 'Right']], mosaic.side, 'Mac tile position');
      const group = select(Array.from({ length: 17 }, (_, i) => [i, i ? `Group ${i}` : 'None']), mosaic.group, 'Mac tile group');
      side.onchange = () => { mosaic.side = side.value; mosaic.group = side.value === 'none' ? 0 : mosaic.group || 1; group.value = mosaic.group; controls(); };
      group.onchange = () => { mosaic.group = Number(group.value); if (!mosaic.group) { mosaic.side = 'none'; side.value = 'none'; } controls(); };
      grid.append(field('Mac tile position', side), field('Group', group)); body.append(grid);
    }
    const actions = el('div', { className: 'studio-bulk' }), save = button('Apply advanced input', () => apply([{ id: row.id, settings: settings(), ...(mosaicChanged() ? { mosaic: { ...mosaic } } : {}) }], true), 'button primary');
    save.id = 'save-input-advanced'; actions.append(save, el('span', { className: 'advanced-input-pending' }));
    const defaults = row.fields.filter(f => !f.options && Number.isFinite(f.default));
    if (defaults.length) actions.append(button('Reset image quality', () => { for (const f of defaults) values[f.key] = f.default; render(); }));
    body.append(actions);
    renderInputEdid(body, row, { api, operation, notice, session: state.session, adopt: next => { state = next; pairTouched = false; choose(state.inputs.some(i => i.id === selectedId) ? selectedId : state.inputs[0]?.id); render(); } });
    const compat = state.inputs.filter(i => i.fields.some(f => f.key === 'compatibilityMode'));
    if (compat.length) {
      const mode = select([[1, 'On'], [0, 'Off']], 1, 'Bulk Mac compatibility'), bulk = el('div', { className: 'studio-bulk' });
      bulk.append(field('Mac compatibility', mode), button('Apply Mac mode to all supported inputs', () => apply(compat.map(i => ({ id: i.id, settings: { compatibilityMode: Number(mode.value) } })))));
      body.append(bulk);
    }
    renderTiles(); controls();
  }
  function renderTiles() {
    const inputs = state.inputs.filter(i => i.mosaicSupported);
    if (!inputs.length) return;
    const section = el('section', { className: 'advanced-input-group' });
    section.append(el('h2', {}, 'Mac tiled groups · 1 × 2'), text('Use matching connector types and detailed EDID timings. These are the Mac display tiles, separate from Programming layer groups.'));
    const names = inputs.map(i => [i.id, i.name]), used = new Set(inputs.map(i => i.mosaic.group));
    const left = select(names, inputs[0]?.id, 'Left tile input'), right = select(names, inputs[1]?.id, 'Right tile input');
    const group = select(Array.from({ length: 16 }, (_, i) => [i + 1, `Group ${i + 1}`]), Array.from({ length: 16 }, (_, i) => i + 1).find(n => !used.has(n)) || 1, 'New tile group');
    const enable = input('', 'Enable Mac compatibility for both tiles', 'checkbox'); enable.checked = true;
    for (const control of [left, right, group, enable]) control.onchange = () => { pairTouched = true; };
    const grid = el('div', { className: 'studio-bulk' });
    grid.append(field('Left', left), field('Right', right), field('Group', group), field('Mac compatibility on', enable), button('Apply tiled pair', () => {
      if (left.value === right.value) { notice('Choose two different inputs for the tiled pair.', 'error'); return; }
      apply([[left.value, 'left'], [right.value, 'right']].map(([id, side]) => ({ id: Number(id), mosaic: { group: Number(group.value), side }, ...(enable.checked ? { settings: { compatibilityMode: 1 } } : {}) })));
    })); section.append(grid);
    for (const n of [...used].filter(Boolean).sort((a, b) => a - b)) {
      const members = inputs.filter(i => i.mosaic.group === n), row = el('div', { className: 'studio-bulk' });
      row.append(text(`Group ${n}: ${members.map(i => `${i.mosaic.side} — ${i.name}`).join(' / ')}`), button(`Remove tile group ${n}`, () => apply(members.map(i => ({ id: i.id, mosaic: { side: 'none', group: 0 } }))))); section.append(row);
    }
    body.append(section);
  }
  root.ontoggle = () => { if (root.open && stale) refresh(); };
  return { hasChanges: dirty,
    invalidate() { revision++; stale = true; state = undefined; values = {}; mosaic = undefined; pairTouched = false; body.replaceChildren(); },
    setBusy(value) { busy = value; controls(); if (!busy && root.open && stale && !loading) setTimeout(refresh, 0); },
  };
}

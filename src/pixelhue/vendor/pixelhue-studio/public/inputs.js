import { createInputAdvanced } from './input-advanced.js';
const $ = (id) => document.getElementById(id);
const edidKeys = ['width', 'height', 'frame', 'standardType', 'interlaced'];
const sameEdid = (a, b) => a && b && edidKeys.every((key) => a[key] === b[key]);
const presets = [['', 'Keep current EDID'], ['1920,1080,60', '1080p60'], ['1920,1080,50', '1080p50'], ['3840,2160,30', '2160p30'], ['3840,2160,60', '2160p60']];
const capacityLabel = (value) => ['SL', 'DL', '4K'][value] || 'Device managed';

function select(options, value, label) {
  const node = document.createElement('select'); node.setAttribute('aria-label', label);
  for (const [key, name] of options) node.add(new Option(name, key));
  node.value = value ?? '';
  return node;
}
function field(value, label, type = 'text') {
  const node = document.createElement('input'); node.type = type; node.value = value ?? ''; node.setAttribute('aria-label', label); return node;
}
function cell(row, ...nodes) { const td = document.createElement('td'); td.append(...nodes); row.append(td); return td; }
function small(text, className = 'input-signal') { const node = document.createElement('small'); node.className = className; node.textContent = text; return node; }

export function createInputsUI({ api, notice, operation, getSession, onApplied = () => {} }) {
  let state, session, busy = false;
  let drafts = new Map(), checked = new Set();
  const advanced = createInputAdvanced({ api, notice, operation, getSession, hasBasicChanges: () => pending().length > 0 });
  function makeDraft(row) {
    const port = row.ports.find((port) => port.key === row.portKey) || row.ports[0];
    return { key: row.key, portKey: row.portKey, capacity: row.capacity, name: port.name,
      edid: structuredClone(port.edid), nameTouched: false, edidTouched: false };
  }
  function pending() {
    if (!state) return [];
    return state.inputs.flatMap((row) => {
      const draft = drafts.get(row.key), port = row.ports.find((port) => port.key === draft.portKey);
      const modeChanged = draft.portKey !== row.portKey || draft.capacity !== row.capacity;
      const nameChanged = draft.nameTouched && draft.name !== port?.name;
      const edidChanged = draft.edidTouched && (!sameEdid(draft.edid, port?.edid) || port?.edid.mode !== 0);
      if (!modeChanged && !nameChanged && !edidChanged) return [];
      return [{ key: row.key, portKey: draft.portKey, capacity: draft.capacity,
        ...(nameChanged ? { name: draft.name } : {}), ...(edidChanged ? { edid: Object.fromEntries(edidKeys.map((key) => [key, draft.edid[key]])) } : {}) }];
    });
  }
  function controls() {
    const count = pending().length;
    $('inputs-dirty-label').textContent = count ? `${count} pending input ${count === 1 ? 'change' : 'changes'}` : 'No pending input changes';
    $('inputs-dirty-label').className = count ? 'pending' : '';
    $('apply-inputs').disabled = busy || !count;
    $('apply-inputs').textContent = busy ? 'Working…' : 'Apply inputs';
    $('refresh-inputs').disabled = busy || !getSession();
    $('fill-inputs').disabled = busy || !checked.size;
    $('input-select-all').disabled = busy || !state?.inputs.length;
    $('input-select-all').checked = Boolean(state?.inputs.length) && checked.size === state.inputs.length;
    $('input-select-all').indeterminate = checked.size > 0 && checked.size < state?.inputs.length;
    for (const node of document.querySelectorAll('#input-rows input, #input-rows select, .input-bulk select, #bulk-name')) node.disabled = busy || node.dataset.fixed === 'true';
    const changedKeys = new Set(pending().map((item) => item.key));
    for (const row of document.querySelectorAll('#input-rows tr[data-key]')) row.classList.toggle('pending', changedKeys.has(row.dataset.key));
    advanced.setBusy(busy);
  }
  function adopt(next) {
    state = next; session = next.session;
    drafts = new Map(next.inputs.map((row) => [row.key, makeDraft(row)]));
    checked = new Set(next.inputs.map((row) => row.key)); advanced.invalidate(); render();
  }
  function choosePort(row, draft, key) {
    const port = row.ports.find((port) => port.key === key);
    if (!port) return;
    draft.portKey = key; draft.name = port.name; draft.edid = structuredClone(port.edid);
    draft.nameTouched = false; draft.edidTouched = false;
  }
  function preset(draft, value) {
    if (!value) return;
    const [width, height, frame] = value.split(',').map(Number);
    draft.edid = { width, height, frame, standardType: 6, interlaced: 0 }; draft.edidTouched = true;
  }
  function render() {
    const body = $('input-rows'); body.replaceChildren();
    $('bulk-port').dataset.fixed = String(Boolean(state?.inputs.length) && state.inputs.every((row) => row.fixedPort));
    $('bulk-port').title = Boolean(state?.inputs.length) && state.inputs.every((row) => row.fixedPort) ? 'Inputs use the physical ports on their installed cards' : '';
    const bulkCapacity = $('bulk-capacity'), previousCapacity = bulkCapacity.value;
    bulkCapacity.replaceChildren(new Option('Keep capacity', ''), ...(state?.capacityChoices || []).map((value) => new Option(capacityLabel(value), value)));
    bulkCapacity.value = state?.capacityChoices?.some((value) => String(value) === previousCapacity) ? previousCapacity : '';
    const sdiCount = state?.inputs.filter((row) => row.family === 'SDI').length || 0;
    const otherCount = state?.inputs.filter((row) => row.family === 'Other').length || 0;
    $('inputs-count').textContent = state ? `${state.inputs.length} inputs · ${state.inputs.length - sdiCount - otherCount} HDMI/DP + ${sdiCount} SDI${otherCount ? ` + ${otherCount} other` : ''}` : 'Not loaded';
    $('input-help').textContent = state ? ['P80', 'Q8'].includes(state.device.model) ?
      `${state.device.model} ports follow the installed cards. SDI uses source timing.` :
      'Bulk EDID changes apply to HDMI/DP inputs. SDI uses source timing.' : 'Connect a P10, P20, P80 or Q8 to load its inputs.';
    if (!state?.inputs.length) {
      const tr = document.createElement('tr'), td = cell(tr, document.createTextNode(state ? `No supported ${state.device.model} inputs were returned. Refresh after the device is ready.` : 'Connect to a device, then refresh inputs.'));
      td.colSpan = 7; td.className = 'inputs-empty'; body.append(tr); controls(); return;
    }
    for (const row of state.inputs) {
      const draft = drafts.get(row.key), port = row.ports.find((port) => port.key === draft.portKey);
      const tr = document.createElement('tr'); tr.dataset.key = row.key;
      const check = field('', `Select ${row.label}`, 'checkbox'); check.checked = checked.has(row.key);
      check.onchange = () => { check.checked ? checked.add(row.key) : checked.delete(row.key); controls(); };
      const title = document.createElement('label'); title.className = 'checkbox-label input-title'; title.append(check, row.label);
      cell(tr, title, small(row.location, 'input-slot'));
      const portSelect = select(row.fixedPort ? [[draft.portKey, port?.label || row.ports[0].label]] : [['', 'Select a port'], ...row.ports.map((port) => [port.key, port.label])], draft.portKey, `${row.label} port`);
      portSelect.dataset.fixed = String(row.fixedPort);
      portSelect.onchange = () => { choosePort(row, draft, portSelect.value); render(); };
      cell(tr, portSelect, small(port ? `${port.workMode === 0 ? '' : 'Inactive · '}${port.signal}` : 'Choose HDMI or DP'));
      const capacityOptions = row.capacityEditable ? row.capacityChoices.map((value) => [value, capacityLabel(value)]) : [[draft.capacity, capacityLabel(draft.capacity)]];
      if (row.capacityEditable && !row.capacityChoices.includes(draft.capacity)) capacityOptions.unshift([draft.capacity, `Current: ${capacityLabel(draft.capacity)}`]);
      const capacity = select(capacityOptions, draft.capacity, `${row.label} capacity`);
      if (row.capacityEditable && !row.capacityChoices.includes(draft.capacity)) capacity.options[0].disabled = true;
      capacity.dataset.fixed = String(!row.capacityEditable);
      capacity.onchange = () => { draft.capacity = Number(capacity.value); controls(); };
      cell(tr, capacity);
      const name = field(draft.name, `${row.label} name`); name.maxLength = 32; name.placeholder = row.label;
      name.oninput = () => { draft.name = name.value; draft.nameTouched = true; controls(); };
      cell(tr, name, small(port?.id != null ? `Interface ${port.id}` : 'ID available when port is enabled', 'input-slot'));
      if (!row.supportsEdid) {
        const timingCell = cell(tr, small(row.family === 'SDI' ? 'SDI uses source timing.' : 'EDID editing is unavailable for this connector.', 'input-edid-note'), small(port?.signal || 'No signal data'));
        timingCell.colSpan = 3; body.append(tr); continue;
      }
      const size = document.createElement('div'); size.className = 'input-edid-size';
      for (const [i, key] of ['width', 'height'].entries()) {
        if (i) { const cross = document.createElement('span'); cross.textContent = '×'; size.append(cross); }
        const input = field(draft.edid[key], `${row.label} EDID ${key}`, 'number'); input.min = 64; input.max = 8192; input.step = 1;
        input.oninput = () => { draft.edid[key] = input.value === '' ? null : Number(input.value); draft.edidTouched = true; controls(); }; size.append(input);
      }
      const presetSelect = select(presets, '', `${row.label} EDID preset`); presetSelect.className = 'input-presets';
      presetSelect.onchange = () => { preset(draft, presetSelect.value); render(); };
      const timingCell = cell(tr, size, presetSelect);
      if (!draft.edidTouched && port?.edid.mode === 2) timingCell.append(small(`File: ${port.edid.fileName || 'Imported EDID'} · kept until edited`, 'input-edid-note'));
      if (!draft.edidTouched && port?.edid.mode === 1) timingCell.append(small('Detailed timing · kept until edited', 'input-edid-note'));
      const hz = field(draft.edid.frame, `${row.label} EDID Hz`, 'number'); hz.min = 1; hz.max = 240; hz.step = .01;
      hz.oninput = () => { draft.edid.frame = hz.value === '' ? null : Number(hz.value); draft.edidTouched = true; controls(); }; cell(tr, hz);
      const standard = select([[0, 'Custom'], [1, 'DMT'], [2, 'CVT'], [3, 'CVT-RB v1'], [4, 'CVT-RB v2'], [5, 'CVT-RB v3'], [6, 'CEA'], [7, 'SMPTE']], draft.edid.standardType, `${row.label} EDID standard`);
      standard.onchange = () => { draft.edid.standardType = Number(standard.value); draft.edidTouched = true; controls(); };
      const scan = select([[0, 'Progressive'], [1, 'Interlaced']], draft.edid.interlaced, `${row.label} scan`); scan.className = 'input-presets';
      scan.onchange = () => { draft.edid.interlaced = Number(scan.value); draft.edidTouched = true; controls(); }; cell(tr, standard, scan);
      body.append(tr);
    }
    controls();
  }
  async function refresh() {
    if (!getSession()) { notice('Connect to your device first.'); return; }
    if ((pending().length || advanced.hasChanges()) && !window.confirm('Discard your pending input changes?')) return;
    await operation(async () => { notice('Reading input ports and EDIDs…'); adopt(await api(`inputs?session=${encodeURIComponent(getSession())}`)); notice('Inputs loaded.', 'success'); });
  }
  $('input-select-all').onchange = () => { checked = new Set($('input-select-all').checked ? state.inputs.map((row) => row.key) : []); render(); };
  $('fill-inputs').onclick = () => {
    if (busy || !state) return;
    for (const row of state.inputs.filter((row) => checked.has(row.key))) {
      const draft = drafts.get(row.key), family = $('bulk-port').value;
      if (family && !row.fixedPort) {
        const port = row.ports.find((port) => port.type === (family === 'hdmi' ? 6 : 8));
        if (port) choosePort(row, draft, port.key);
      }
      if (row.capacityEditable && row.capacityChoices.includes(Number($('bulk-capacity').value)) && $('bulk-capacity').value !== '') draft.capacity = Number($('bulk-capacity').value);
      if ($('bulk-name').value) { draft.name = $('bulk-name').value.replaceAll('{n}', row.number); draft.nameTouched = true; }
      if (row.supportsEdid) preset(draft, $('bulk-edid').value);
    }
    render(); notice('Selected rows updated. Apply inputs to save.');
  };
  $('refresh-inputs').onclick = refresh;
  $('apply-inputs').onclick = () => operation(async () => {
    if (advanced.hasChanges()) { notice('Apply or discard the pending Advanced input settings first.', 'error'); return; }
    notice('Applying inputs…');
    adopt(await api('inputs', { session, changes: pending() }, 'PUT'));
    onApplied();
    notice('Inputs applied.', 'success');
  });
  return {
    reset(nextSession) { if (session === nextSession) return; session = nextSession; state = undefined; drafts.clear(); checked.clear(); advanced.invalidate(); render(); },
    hasChanges: () => pending().length > 0 || advanced.hasChanges(),
    setBusy(value) { busy = value; controls(); },
    refresh,
    open() { if (!state) return refresh(); },
  };
}

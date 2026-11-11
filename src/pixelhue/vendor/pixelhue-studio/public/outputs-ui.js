import { $, el, text, button, input, select, field, cell, table, panelHeader, sessionPath, setDisabled } from './ui.js';
import { createOutputAdvanced } from './output-advanced.js';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function createOutputsUI({ api, notice, operation, getSession, invalidate }) {
  const root = $('outputs-content'); let state, session, busy = false, drafts = new Map(), checked = new Set();
  const advanced = createOutputAdvanced({ api, notice, operation, getSession });
  function pending() {
    return (state?.outputs || []).flatMap(row => {
      const draft = drafts.get(row.id), change = { id: row.id };
      for (const key of ['name', 'timing', 'timingMode', 'colorDepth', 'hdcp', 'testPattern']) if (!same(draft[key], row[key])) change[key] = draft[key];
      if (change.timing) change.timingMode = draft.timingMode === 0 ? 0 : 3;
      if (change.timingMode !== undefined && !change.timing) change.timing = draft.timing;
      return Object.keys(change).length > 1 ? [change] : [];
    });
  }
  function controls() {
    if (!$('output-save')) return;
    const count = pending().length; $('output-dirty').textContent = count ? `${count} pending ${count === 1 ? 'change' : 'changes'}` : 'No pending changes';
    setDisabled(root, busy); $('output-save').disabled = busy || !count;
  }
  function adopt(next) {
    state = next; session = next.session; drafts = new Map(next.outputs.map(o => [o.id, structuredClone(o)]));
    checked = new Set(next.outputs.map(o => o.id)); render();
  }
  async function refresh() {
    if (!getSession()) return;
    if (pending().length && !window.confirm('Discard pending output changes?')) return;
    await operation(async () => adopt(await api(sessionPath('outputs', getSession())))); await advanced.refresh();
  }
  const presetTiming = p => Object.fromEntries(['width', 'height', 'frame', 'standardType', 'interlaced'].map(k => [k, p[k]]));
  function renderCapacity() {
    for (const group of state.capacityGroups || []) {
      const box = el('div', { className: 'studio-bulk' });
      const modes = select(group.options.map(o => [o.value, `${o.label} · ${o.independent.length} independent outputs`]), group.capacity, `Output slot ${group.slotId} capacity`);
      const summary = text('');
      const describe = () => { const option = group.options.find(o => o.value === Number(modes.value)); summary.textContent = `Independent HDMI: ${option?.independent.join(', ')}. Other HDMI ports copy their primary. Optical, AUX and MVR unchanged.`; }; describe(); modes.onchange = describe;
      const apply = button('Apply output capacity', async () => {
        if (pending().length) { notice('Apply or discard pending output edits before changing capacity.', 'error'); return; }
        const option = group.options.find(o => o.value === Number(modes.value));
        if (!option || option.value === group.capacity) return;
        if (!window.confirm(`Switch this P20 output card to ${option.label}? Independent HDMI outputs: ${option.independent.join(', ')}. Normal screen configuration may reset; output copy relationships will change. Continue?`)) return;
        await operation(async () => { adopt(await api('output-capacity', { session, slotId: group.slotId, capacity: option.value, confirmReset: true }, 'PUT')); invalidate('outputs'); notice('Output capacity and copy relationships saved. Refresh Screens to inspect the current configuration.', 'success'); });
      });
      box.append(field(`P20 HDMI output capacity · Slot ${group.slotId}`, modes), apply, summary); root.append(box);
    }
  }
  function render() {
    root.replaceChildren();
    if (!state) { root.append(text('Connect a device to load its outputs.')); return; }
    const head = panelHeader('Outputs', refresh); head.append(text(`${state.outputs.length} physical ports`)); root.append(head); renderCapacity();
    const bulk = el('div', { className: 'studio-bulk' });
    const all = input('', 'Select all outputs', 'checkbox'); all.checked = checked.size === state.outputs.length;
    all.onchange = () => { checked = new Set(all.checked ? state.outputs.map(o => o.id) : []); render(); };
    const naming = input('', 'Output name pattern'); naming.placeholder = 'Output {n}';
    const presets = [...new Map(state.outputs.filter(o => o.timingEditable).flatMap(o => o.presets).map(p => [p.key, p])).values()];
    const resolution = select([['', 'Keep timing'], ...presets.map(p => [p.key, p.label])], '', 'Bulk output timing');
    const depth = select([['', 'Keep depth'], [8, '8 bit'], [10, '10 bit'], [12, '12 bit']], '', 'Bulk output depth');
    const hdcp = select([['', 'Keep HDCP'], [0, 'Off'], [1, 'On']], '', 'Bulk output HDCP');
    bulk.append(field('All', all), field('Name pattern', naming), field('Timing', resolution), field('Color depth', depth), field('HDCP', hdcp), button('Fill selected', () => {
      let skipped = 0;
      for (const row of state.outputs.filter(o => checked.has(o.id))) {
        const draft = drafts.get(row.id);
        if (naming.value) draft.name = naming.value.replaceAll('{n}', row.number);
        if (resolution.value && row.timingEditable) {
          const preset = row.presets.find(p => p.key === resolution.value);
          if (preset) { draft.timing = presetTiming(preset); draft.timingMode = 0; } else skipped++;
        }
        if (depth.value && row.colorDepth !== null) draft.colorDepth = Number(depth.value);
        if (hdcp.value && row.hdcp !== null) draft.hdcp = Number(hdcp.value);
      }
      render();
      if (skipped) notice(`${skipped} selected output(s) do not support this standard timing at their current capacity.`, 'error');
    })); root.append(bulk);
    const { wrap, body } = table(['Port', 'Capacity', 'Name', 'Output timing', 'Hz', 'Depth', 'HDCP', 'Pattern']);
    for (const row of state.outputs) {
      const draft = drafts.get(row.id), tr = el('tr'), check = input('', `Select output ${row.number}`, 'checkbox');
      check.checked = checked.has(row.id); check.onchange = () => { check.checked ? checked.add(row.id) : checked.delete(row.id); };
      const title = el('label', { className: 'checkbox-label' }); title.append(check, `${row.role} ${row.number} · ${row.connector}`);
      cell(tr, title, text(`Slot ${row.slotId} · Port ${row.port}${row.copyFrom ? ` · Copy of port ${state.outputs.find(o => o.id === row.copyFrom)?.port ?? "?"}` : ''}`));
      cell(tr, document.createTextNode(['SL', 'DL', '4K'][row.capacity] || 'Managed'));
      const naming = input(draft.name, `Output ${row.number} name`); naming.maxLength = 32;
      naming.oninput = () => { draft.name = naming.value; controls(); };
      cell(tr, naming, text(row.screen || 'Unassigned'));
      if (draft.timing) {
        const dimensions = el('div', { className: 'compact-fields' });
        for (const key of ['width', 'height']) {
          const control = input(draft.timing[key], `Output ${row.number} ${key}`, 'number'); control.min = row.limits[key]?.min ?? 64; control.max = row.limits[key]?.max ?? 16384; control.step = row.limits[key]?.step ?? 1;
          control.dataset.fixed = String(!row.timingEditable);
          control.oninput = () => { draft.timing[key] = Number(control.value); draft.timingMode = 3; draft.timing.standardType = 0; draft.timing.interlaced = 0; preset.value = 'custom'; controls(); }; dimensions.append(control);
        }
        const match = draft.timingMode === 0 && row.presets.find(p => same(presetTiming(p), draft.timing));
        const preset = select([['custom', 'Custom'], ...row.presets.map(p => [p.key, p.label])], match ? match.key : 'custom', `Output ${row.number} resolution`);
        preset.dataset.fixed = String(!row.timingEditable);
        preset.onchange = () => { const chosen = row.presets.find(p => p.key === preset.value); draft.timingMode = chosen ? 0 : 3; if (chosen) draft.timing = presetTiming(chosen); else draft.timing = { ...draft.timing, standardType: 0, interlaced: 0 }; render(); };
        cell(tr, preset, dimensions, text(row.timingEditable ? 'Standard preset or custom dimensions' : 'Timing follows primary port'));
        const hz = input(draft.timing.frame, `Output ${row.number} Hz`, 'number'); hz.step = '.01'; hz.min = 1; hz.max = 240;
        hz.dataset.fixed = String(!row.timingEditable); hz.oninput = () => { draft.timing.frame = Number(hz.value); draft.timingMode = 3; draft.timing.standardType = 0; draft.timing.interlaced = 0; preset.value = 'custom'; controls(); }; cell(tr, hz);
      } else { cell(tr, text('Device-managed')); cell(tr, text('—')); }
      const bits = select([[8, '8 bit'], [10, '10 bit'], [12, '12 bit'], ...(draft.colorDepth === 255 ? [[255, 'Auto']] : [])], draft.colorDepth, `Output ${row.number} depth`);
      bits.dataset.fixed = String(row.colorDepth === null); bits.onchange = () => { draft.colorDepth = Number(bits.value); controls(); }; cell(tr, bits);
      for (const key of ['hdcp', 'testPattern']) {
        const control = select([[0, 'Off'], [1, 'On']], draft[key], `Output ${row.number} ${key === 'hdcp' ? 'HDCP' : 'pattern'}`);
        control.dataset.fixed = String(row[key] === null); control.onchange = () => { draft[key] = Number(control.value); controls(); }; cell(tr, control);
      }
      body.append(tr);
    }
    root.append(wrap, text('Copy ports retain their routing. Timing changes apply to primary ports.'), advanced.element);
    const footer = el('footer', { className: 'action-bar' });
    const dirty = el('span', { id: 'output-dirty' });
    const save = button('Apply outputs', () => operation(async () => {
      const changes = pending(), affected = changes.filter(c => c.timing && (state.syncActive || state.outputs.find(o => o.id === c.id)?.screen));
      if (affected.length) {
        if (!window.confirm('Changing these output timings can resize/reset screen configuration or affect synchronization. Continue?')) return;
        for (const c of affected) c.confirmTimingReset = true;
      }
      adopt(await api('outputs', { session, changes }, 'PUT')); invalidate('outputs'); notice('Outputs saved.', 'success');
    }), 'button primary'); save.id = 'output-save'; footer.append(dirty, save); root.append(footer); controls();
  }
  render();
  return { open: () => state ? undefined : refresh(), refresh, hasChanges: () => pending().length > 0 || advanced.hasChanges(),
    reset(next) { if (session === next) return; session = next; state = undefined; drafts.clear(); advanced.reset(); render(); },
    setBusy(value) { busy = value; controls(); advanced.setBusy(value); } };
}

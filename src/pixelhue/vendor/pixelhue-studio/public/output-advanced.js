import { el, text, button, input, select, field, setDisabled, sessionPath } from './ui.js';

// Outputs "Advanced" (WO-037): format (sampling, range, gamut) and colour correction per primary output,
// with "copy to all" for the same connector type. Collapsed by default; loaded when first opened.
export function createOutputAdvanced({ api, operation, notice, getSession }) {
  const root = el('details', { className: 'input-advanced output-advanced' }); root.append(el('summary', {}, 'Advanced · format and colour'));
  const body = el('section', { className: 'advanced-input-content' }); root.append(body);
  let state, selectedId, values = {}, busy = false;
  const selected = () => state?.outputs.find(o => o.id === selectedId);
  const pending = () => Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== selected()?.values[key]));
  function choose(id) { selectedId = id; values = { ...selected()?.values }; }
  function adopt(next) { state = next; choose(state.outputs.some(o => o.id === selectedId) ? selectedId : state.outputs[0]?.id); render(); }
  const load = () => getSession() ? operation(async () => adopt(await api(sessionPath('output-advanced', getSession())))) : undefined;
  const save = (changes, done) => operation(async () => { adopt(await api('output-advanced', { session: state.session, changes }, 'PUT')); notice(done, 'success'); });
  function controls() { const count = Object.keys(pending()).length, apply = body.querySelector('#save-output-advanced'); if (apply) apply.disabled = busy || !count; }
  function render() {
    body.replaceChildren();
    if (!state) { body.append(text('Open to load output format and colour settings.')); return; }
    const output = selected();
    if (!output) { body.append(text('No output on this device exposes format or colour settings.')); return; }
    const pick = select(state.outputs.map(o => [o.id, `${o.role} · ${o.name} · ${o.connector}`]), selectedId, 'Advanced output');
    pick.onchange = () => { if (Object.keys(pending()).length && !window.confirm('Discard pending output settings?')) { pick.value = String(selectedId); return; } choose(Number(pick.value)); render(); };
    const head = el('div', { className: 'studio-bulk' }); head.append(field('Output', pick)); body.append(head);
    for (const section of [...new Set(output.fields.map(f => f.section))]) {
      const box = el('div', { className: 'settings-grid advanced-fields-grid' });
      for (const f of output.fields.filter(x => x.section === section)) {
        const control = f.options ? select(f.options, values[f.key], `Output ${f.label}`) : input(values[f.key], `Output ${f.label}`, 'number');
        if (!f.options) { control.min = f.min; control.max = f.max; control.step = f.step; }
        control[f.options ? 'onchange' : 'oninput'] = () => { values[f.key] = Number(control.value); controls(); };
        box.append(field(f.label, control));
      }
      body.append(el('h3', {}, section), box);
    }
    const quality = output.fields.filter(f => f.key.startsWith('imageQuality.') && Number.isFinite(f.default));
    const peers = state.outputs.filter(o => o.id !== output.id && o.connector === output.connector && o.role === output.role);
    const actions = el('div', { className: 'studio-bulk' });
    const apply = button('Apply output settings', () => save([{ id: output.id, settings: pending() }], 'Output settings saved.'), 'button primary'); apply.id = 'save-output-advanced';
    actions.append(apply);
    if (quality.length) actions.append(button('Reset colour', () => { for (const f of quality) values[f.key] = f.default; render(); }, 'button quiet'));
    if (peers.length) actions.append(button(`Copy to all ${output.role === 'Output' ? 'outputs' : output.role} (${peers.length})`, () => {
      // Sends this output's current draft to its peers; only settings each peer exposes.
      const changes = [output, ...peers].map(o => ({ id: o.id, settings: Object.fromEntries(o.fields.filter(f => values[f.key] !== undefined && values[f.key] !== o.values[f.key]).map(f => [f.key, values[f.key]])) })).filter(c => Object.keys(c.settings).length);
      if (!changes.length) { notice('All of these outputs already match.', 'success'); return; }
      save(changes, `Settings copied to ${changes.length} output${changes.length === 1 ? '' : 's'}.`);
    }));
    body.append(actions, text('Sampling changes can exceed the link bandwidth at high resolutions; the device refuses those.'));
    setDisabled(body, busy); controls();
  }
  root.ontoggle = () => { if (root.open && !state) load(); };
  render();
  return { element: root, hasChanges: () => Boolean(state && Object.keys(pending()).length),
    refresh: () => { if (root.open) return load(); state = undefined; render(); },
    reset() { state = undefined; root.open = false; render(); }, setBusy(value) { busy = value; setDisabled(body, busy); controls(); } };
}

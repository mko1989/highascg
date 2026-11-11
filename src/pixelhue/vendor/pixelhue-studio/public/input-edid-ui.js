import { el, text, button, input, select, field } from './ui.js';

// Inputs Advanced: detailed timing and EDID file import/export for the selected HDMI/DP input (WO-037).
const AXES = [['horizontal', 'H'], ['vertical', 'V']];
export function renderInputEdid(body, row, { api, operation, notice, session, adopt }) {
  if (!row.edid) return;
  const section = el('section', { className: 'advanced-input-group' }); section.append(el('h2', {}, 'Detailed timing and EDID file'));
  if (row.timing) {
    const draft = structuredClone(row.timing), grid = el('div', { className: 'settings-grid' });
    const number = (label, get, set, min, max, step = 1) => { const control = input(get(), `Timing ${label}`, 'number'); control.min = min; control.max = max; control.step = step;
      control.oninput = () => { set(Number(control.value)); info(); }; grid.append(field(label, control)); };
    number('Refresh Hz', () => draft.refresh, v => { draft.refresh = v; }, 1, 240, 0.01);
    for (const [axis, short] of AXES) {
      number(`${short} active`, () => draft[axis].active, v => { draft[axis].active = v; }, 64, 16384);
      number(`${short} front porch`, () => draft[axis].front, v => { draft[axis].front = v; }, 0, 8192);
      number(`${short} sync`, () => draft[axis].sync, v => { draft[axis].sync = v; }, 1, 8192);
      number(`${short} total`, () => draft[axis].total, v => { draft[axis].total = v; }, 64, 32768);
      const polarity = select([[1, 'Positive'], [0, 'Negative']], draft[axis].polarity, `Timing ${short} sync polarity`); polarity.onchange = () => { draft[axis].polarity = Number(polarity.value); };
      grid.append(field(`${short} sync polarity`, polarity));
    }
    const summary = text(''), apply = button('Apply detailed timing', () => operation(async () => { adopt(await api('input-timing', { session, id: row.id, timing: draft }, 'PUT')); notice('Detailed timing saved.', 'success'); }));
    // Back porch and pixel clock are derived, shown so a wrong total is obvious before applying.
    function info() {
      const back = a => a.total - a.active - a.front - a.sync, h = draft.horizontal, v = draft.vertical, ok = back(h) >= 0 && back(v) >= 0;
      summary.textContent = ok ? `Back porch H ${back(h)} / V ${back(v)} · pixel clock ${(h.total * v.total * draft.refresh / 1e6).toFixed(2)} MHz` : 'Total must be at least active + front porch + sync.';
      apply.disabled = !ok;
    }
    section.append(grid, summary, apply); info();
  }
  const file = el('input', { type: 'file', accept: '.bin,.edid,application/octet-stream', hidden: true }), files = el('div', { className: 'studio-bulk' });
  file.onchange = () => {
    const chosen = file.files[0]; file.value = ''; if (!chosen) return;
    operation(async () => {
      const response = await fetch(`/api/edid?session=${encodeURIComponent(session)}&id=${row.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: chosen });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || `EDID import failed (${response.status}).`);
      adopt(result); notice(`${chosen.name} loaded into ${row.name}.`, 'success');
    });
  };
  const save = el('a', { className: 'button secondary', href: `/api/edid?session=${encodeURIComponent(session)}&id=${row.id}`, download: '' }, 'Export EDID…');
  files.append(button('Import EDID file…', () => file.click()), save, file, text(row.edidFile ? `Loaded file: ${row.edidFile}` : 'No EDID file loaded; the timing above is used.'));
  section.append(files); body.append(section);
}

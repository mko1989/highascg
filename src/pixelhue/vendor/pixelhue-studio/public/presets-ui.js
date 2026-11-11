import { el, text, button, input, select, field } from './ui.js';

// Preset bank under the PGM/PVW bands (WO-016, reworked WO-022).
// Load and save are independent: a "Load to" target, and separate Save from PVW / Save from PGM
// buttons that open a small form with name + slot (1–128; occupied slots overwrite after confirmation).
// WO-024: Load to PVW | PGM | Auto-take (load to PVW, confirm, Take); load options for keyframes and the
// PGM load transition; saves can be absolute (all layers) or relative (chosen layers + parameter groups).
// ctx: { presets, loadTarget, setLoadTarget(r), loadOptions, setLoadOptions(v), transition(), saving, setSaving(v),
//        editing, setEditing(v), command(request, msg), screenIds(), layersFor(scene) }
const SLOTS = 128, AUTO = 'auto';
const sceneName = scene => scene === 2 ? 'PGM' : 'PVW';
// preset_param.xml layer groups (WO-024).
const PARAMS = [['3-2', 'Source'], ['3-3', 'Position'], ['3-4', 'Size'], ['3-5', 'Flip'], ['3-6', 'Border'], ['3-7', 'Shadow'],
  ['3-8', 'Mask'], ['3-9', 'Crop'], ['3-10', 'Effects'], ['3-11', 'Cut-Fill'], ['3-12', 'KeyFrame'], ['3-13', 'Cutout']];
const checkbox = (label, checked, onchange) => {
  const box = el('input', { type: 'checkbox', 'aria-label': label }); box.checked = checked; if (onchange) box.onchange = () => onchange(box.checked);
  const wrap = el('label', { className: 'checkbox-label' }); wrap.append(box, document.createTextNode(` ${label}`)); return { box, wrap };
};

function saveForm(ctx) {
  const scene = ctx.saving, presets = ctx.presets;
  const free = []; for (let n = 1; n <= SLOTS && free.length < 1; n++) if (!presets.some(p => p.serial === n)) free.push(n);
  const options = [];
  for (let n = 1; n <= SLOTS; n++) {
    const p = presets.find(item => item.serial === n);
    if (p) options.push([n, `${n} · ${p.name} (overwrite)`]);
    else if (n <= Math.max(free[0] ?? 0, ...presets.map(x => x.serial)) + 8) options.push([n, `${n} · empty`]);
  }
  const slot = select(options, free[0] ?? 1, 'Preset slot');
  const name = input(`Preset ${free[0] ?? 1}`, 'Preset name'); name.maxLength = 64;
  slot.onchange = () => { const p = presets.find(item => item.serial === Number(slot.value)); name.value = p ? p.name : `Preset ${slot.value}`; };
  const form = el('form', { className: 'preset-save-form' });
  const kind = select([['absolute', 'Absolute: all layers'], ['relative', 'Relative: chosen layers & settings']], 'absolute', 'Preset type');
  const relative = el('div', { className: 'preset-relative' }); relative.hidden = true;
  const params = PARAMS.map(([id, label]) => ({ id, ...checkbox(label, ['3-2', '3-3', '3-4', '3-12'].includes(id)) }));
  const layers = ctx.layersFor(scene).map(l => ({ id: l.id, ...checkbox(`${l.screenName} · ${l.name} · ${l.sourceName || `Source ${l.sourceId}`}`, true) }));
  const paramBox = el('fieldset', { className: 'preset-checks' }); paramBox.append(el('legend', {}, 'Settings'), ...params.map(p => p.wrap));
  const layerBox = el('fieldset', { className: 'preset-checks' }); layerBox.append(el('legend', {}, `${sceneName(scene)} layers`), ...(layers.length ? layers.map(l => l.wrap) : [text('No layers on the shown screens.')]));
  relative.append(paramBox, layerBox);
  kind.onchange = () => { relative.hidden = kind.value !== 'relative'; };
  const submit = () => {
    const serial = Number(slot.value), occupant = presets.find(p => p.serial === serial), isRelative = kind.value === 'relative';
    if (!name.value.trim()) { name.focus(); return; }
    if (occupant && !window.confirm(`Overwrite preset ${serial} · ${occupant.name} with ${sceneName(scene)} of the shown screens?`)) return;
    ctx.setSaving(null);
    ctx.command({ action: 'preset-save', name: name.value.trim(), scene, serial, overwrite: Boolean(occupant), screenIds: ctx.screenIds(),
      ...(isRelative ? { relative: true, params: params.filter(p => p.box.checked).map(p => p.id), layerIds: layers.filter(l => l.box.checked).map(l => l.id) } : {}) },
      `${occupant ? `Preset ${serial} overwritten` : `Preset ${serial} saved`} from ${sceneName(scene)}${isRelative ? ' (relative)' : ''}.`);
  };
  form.onsubmit = event => { event.preventDefault(); submit(); };
  form.append(el('strong', {}, `Save from ${sceneName(scene)}`), field('Slot', slot), field('Name', name), field('Type', kind),
    button('Save', submit, 'button primary'), button('Cancel', () => ctx.setSaving(null), 'button quiet'), relative);
  setTimeout(() => name.select(), 0);
  return form;
}

export function renderPresets(ctx) {
  const bar = el('section', { className: 'preset-bar', 'aria-label': 'Presets' });
  const head = el('div', { className: 'preset-head' }); head.append(el('h2', {}, 'Presets'));
  if (!ctx.presets) { bar.append(head, text('Presets are unavailable on this device.')); return bar; }
  const target = el('div', { className: 'segmented', role: 'group', 'aria-label': 'Load presets to' });
  target.append(el('span', { className: 'segment-label' }, 'Load to'));
  for (const value of [4, 2, AUTO]) {
    const b = button(value === AUTO ? 'Auto-take' : sceneName(value), () => ctx.setLoadTarget(value), `button segment${ctx.loadTarget === value ? ' active' : ''}`);
    b.setAttribute('aria-pressed', String(ctx.loadTarget === value));
    if (value === AUTO) b.title = 'Load to PVW, confirm PVW matches the preset, then Take its screens with the transition time above.';
    target.append(b);
  }
  const opts = el('div', { className: 'preset-options' });
  if (ctx.loadTarget === 2) opts.append(checkbox('Transition on load', ctx.loadOptions.effect, v => ctx.setLoadOptions({ effect: v })).wrap);
  if (ctx.loadTarget !== 4) opts.append(checkbox('Run keyframes', ctx.loadOptions.keyframes, v => ctx.setLoadOptions({ keyframes: v })).wrap);
  head.append(target, opts, button('Save from PVW…', () => ctx.setSaving(ctx.saving === 4 ? null : 4)),
    button('Save from PGM…', () => ctx.setSaving(ctx.saving === 2 ? null : 2)),
    button(ctx.editing ? 'Done' : 'Edit', () => ctx.setEditing(!ctx.editing), 'button quiet'));
  bar.append(head);
  if (ctx.saving) bar.append(saveForm(ctx));
  const list = el('div', { className: 'preset-list' });
  if (!ctx.presets.length) list.append(text('No presets yet. Build a look and use Save from PVW or Save from PGM.'));
  const auto = ctx.loadTarget === AUTO, loadName = auto ? 'Auto-take' : sceneName(ctx.loadTarget);
  const run = preset => {
    const { time, swap } = ctx.transition();
    if (auto) return ctx.command({ action: 'preset-autotake', guid: preset.guid, time, swap }, `${preset.name}: loaded to PVW, confirmed, taken.`);
    const pgm = ctx.loadTarget === 2, effect = pgm && ctx.loadOptions.effect;
    ctx.command({ action: 'preset-load', guid: preset.guid, target: ctx.loadTarget, effect, keyframes: ctx.loadOptions.keyframes && effect, time: effect ? time : 0, swap },
      `${preset.name} loaded to ${loadName}.`);
  };
  for (const preset of ctx.presets) {
    const item = el('div', { className: 'preset-item' });
    const load = button(`${preset.serial}. ${preset.name}${preset.loadType === 2 ? ' ·rel' : ''}`, () => run(preset), 'button preset-load');
    load.title = `${auto ? 'Auto-take' : `Load to ${loadName}`} · ${preset.loadType === 2 ? 'relative' : 'absolute'} · saved from ${sceneName(preset.sourceRegion)}${preset.screens.length ? ` · ${preset.screens.join(', ')}` : ''}`;
    item.append(load);
    if (ctx.editing) item.append(
      button('Rename', () => { const name = window.prompt('Rename preset:', preset.name); if (name?.trim() && name.trim() !== preset.name) ctx.command({ action: 'preset-rename', guid: preset.guid, name: name.trim() }, 'Preset renamed.'); }, 'button quiet'),
      button('Delete', () => { if (window.confirm(`Delete preset ${preset.name}?`)) ctx.command({ action: 'preset-delete', guid: preset.guid }, 'Preset deleted.'); }, 'button danger'));
    list.append(item);
  }
  bar.append(list);
  return bar;
}

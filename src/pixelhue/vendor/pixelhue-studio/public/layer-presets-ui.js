import { el, text, button, input, select, field } from './ui.js';

// Inspector "Layer presets" (WO-037): one click applies a stored look to the selected layer.
const DEFAULT_PARTS = ['pos', 'size', 'border', 'effect', 'shadow', 'flip', 'mask', 'crop']; // not the source: a look, not a route
let chosen;
try { chosen = JSON.parse(localStorage.getItem('layer-preset-parts') || 'null'); } catch {}
export function renderLayerPresets(node, { state, layer: l, command }) {
  const info = state.layerPresets; if (!info?.supported) return;
  const box = el('section', { className: 'inspector-section layer-presets' }); box.append(el('h3', {}, 'Layer presets'));
  const list = el('div', { className: 'layer-preset-list' });
  for (const preset of info.list) {
    const row = el('div', { className: 'preset-item' });
    const apply = button(preset.name, () => command({ action: 'layerpreset-apply', screenId: l.screenId, id: l.id, presetId: preset.id }, `${preset.name} applied.`), 'button layer-preset-apply');
    apply.style.borderLeft = `6px solid ${preset.color}`; apply.title = `Applies: ${preset.parts.map(key => info.parts.find(p => p[0] === key)?.[1] || key).join(', ') || 'nothing'}`;
    const rename = button('✎', () => { const next = window.prompt('Layer preset name', preset.name); if (next && next !== preset.name) command({ action: 'layerpreset-update', presetId: preset.id, name: next }, 'Layer preset renamed.'); }, 'button quiet');
    rename.setAttribute('aria-label', `Rename ${preset.name}`); rename.dataset.keep = 'true';
    const remove = button('×', () => { if (window.confirm(`Delete layer preset ${preset.name}?`)) command({ action: 'layerpreset-delete', presetId: preset.id }, 'Layer preset deleted.'); }, 'button quiet');
    remove.setAttribute('aria-label', `Delete ${preset.name}`); remove.dataset.keep = 'true';
    row.append(apply, rename, remove); list.append(row);
  }
  if (!info.list.length) list.append(text('None stored. Save the selected layer’s look to reuse it.'));
  const save = el('details', { className: 'fx-section' }); save.append(el('summary', {}, 'Save this layer as a preset'));
  const name = input('', 'Layer preset name'); name.maxLength = 32; name.placeholder = `Layer preset ${info.list.length + 1}`;
  const color = select(info.colors.map((c, i) => [c, `Colour ${i + 1}`]), info.colors[0], 'Layer preset colour'); for (const option of color.options) option.style.background = option.value;
  const parts = new Set((Array.isArray(chosen) ? chosen : DEFAULT_PARTS).filter(key => info.parts.some(p => p[0] === key))), checks = el('div', { className: 'fx-toggles' });
  for (const [key, label] of info.parts) {
    if (key === 'cutFill' && !l.fx?.cutFill?.enable) continue; // PixelFlow stores it only for a Cut & Fill layer
    const check = input('', `Store ${label}`, 'checkbox'); check.checked = parts.has(key);
    check.onchange = () => { check.checked ? parts.add(key) : parts.delete(key); chosen = [...parts]; try { localStorage.setItem('layer-preset-parts', JSON.stringify(chosen)); } catch {} };
    const wrap = el('label', { className: 'checkbox-label' }); wrap.append(check, ` ${label}`); checks.append(wrap);
  }
  save.append(field('Name', name), field('Colour', color), checks, button('Save layer preset', () => command({ action: 'layerpreset-save', screenId: l.screenId, id: l.id,
    name: name.value.trim() || name.placeholder, color: color.value, parts: [...parts].filter(key => key !== 'cutFill' || l.fx?.cutFill?.enable) }, 'Layer preset saved.')));
  box.append(list, save); node.append(box);
}

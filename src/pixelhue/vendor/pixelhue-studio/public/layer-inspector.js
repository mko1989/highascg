import { el, text, button, input, select, field } from './ui.js';
import { groupOf } from './group-geometry.js';
import { renderLayerEffects } from './layer-effects-ui.js';
import { renderLayerPresets } from './layer-presets-ui.js';

// Inspector "Layer" tab (WO-024, WO-026): source, group info and per-layer KeyFrame. Position/size tools
// live in the bar under the screens (public/layer-tools.js).
const CURVES = [[3, 'Linear'], [0, 'S-curve'], [1, 'Logarithmic'], [2, 'Exponential']];

export function renderLayerPanel(node, { state, layer: l, command }) {
  // Grouped inputs (WO-025): position/size tools act on the group's combined rectangle.
  const group = groupOf(state.layers, l);
  if (group) {
    const info = el('section', { className: 'inspector-section group-info' });
    info.append(el('h3', {}, `Group ${group.group} · ${group.orient === 'H' ? 'side by side' : 'top / bottom'}`),
      text(`${group.orient === 'H' ? 'Left' : 'Top'}: ${group.a.sourceName || group.a.name} · ${group.orient === 'H' ? 'Right' : 'Bottom'}: ${group.b.sourceName || group.b.name}`),
      text('Position, size, align, fill and Clear act on both layers. Source and keyframe here apply to the selected member.'),
      button('Ungroup', () => command({ action: 'group-ungroup', screenId: l.screenId, id: l.id }, 'Layers ungrouped.'), 'button quiet'));
    node.append(info);
  }
  const options = state.sources.filter(s => s.type === 2 || s.id !== l.screenId).map(s => [`${s.type}:${s.id}`, s.name]);
  const current = `${l.sourceType}:${l.sourceId}`; if (!options.some(([key]) => key === current)) options.unshift([current, l.sourceName || 'Current source']);
  const routing = select(options, current, 'Selected layer source');
  routing.onchange = () => { const [type, id] = routing.value.split(':').map(Number); command({ action: 'source', screenId: l.screenId, id: l.id, source: { id, type } }, 'Layer source saved.'); };
  node.append(field('Source', routing));

  const kf = l.keyFrame, frames = el('section', { className: 'inspector-section' }); frames.append(el('h3', {}, 'KeyFrame'));
  const kfSave = (changes, message) => command({ action: 'keyframe', screenId: l.screenId, id: l.id, keyFrame: changes }, message);
  const enable = input('', 'Layer keyframe', 'checkbox'); enable.checked = kf.enable === 1;
  enable.onchange = () => kfSave({ enable: enable.checked ? 1 : 0 }, enable.checked ? 'KeyFrame on: the layer animates on Take.' : 'KeyFrame off.');
  const enableLabel = el('label', { className: 'checkbox-label' }); enableLabel.append(enable, document.createTextNode(' Animate on Take'));
  const curve = select(CURVES, kf.speedType, 'KeyFrame curve'); curve.onchange = () => kfSave({ speedType: Number(curve.value) }, 'KeyFrame curve saved.');
  const start = input(kf.startTime / 10, 'KeyFrame start percent', 'number'); start.min = 0; start.max = 99.9; start.step = 0.1;
  start.onchange = () => kfSave({ startTime: Math.round(Number(start.value) * 10) }, 'KeyFrame start saved.');
  const length = input(kf.animationTime / 10, 'KeyFrame duration percent', 'number'); length.min = 0.1; length.max = 100; length.step = 0.1;
  length.onchange = () => kfSave({ animationTime: Math.round(Number(length.value) * 10) }, 'KeyFrame duration saved.');
  const timing = el('div', { className: 'field-grid' }); timing.append(field('Start % of take', start), field('Duration % of take', length));
  frames.append(enableLabel, field('Curve', curve), timing, text('Presets store keyframes when they include KF (absolute presets always do).'));

  node.append(frames);
  renderLayerPresets(node, { state, layer: l, command });
  renderLayerEffects(node, { state, layer: l, command });
}

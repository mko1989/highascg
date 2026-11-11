import { el, text, button, input, select, field } from './ui.js';

// Inspector effect sections (WO-036): opacity/flip/lock, border, mask, shadow, colour and source crop.
// Each control applies on change; sections the device XML does not support are not rendered.
const open = new Set(['look']);
function section(node, id, title, active) {
  const box = el('details', { className: 'inspector-section fx-section' }); box.open = open.has(id); scope = title;
  box.ontoggle = () => { box.open ? open.add(id) : open.delete(id); };
  const summary = el('summary', {}, title); if (active) summary.append(el('span', { className: 'fx-on' }, 'on'));
  box.append(summary); node.append(box); return box;
}
function check(label, value, apply) {
  const box = input('', label, 'checkbox'); box.checked = Boolean(value); box.onchange = () => apply(box.checked);
  const wrap = el('label', { className: 'checkbox-label' }); wrap.append(box, document.createTextNode(` ${label}`)); return wrap;
}
// Visible labels stay short; the accessible name carries the section ("Border Width") so it is unique on the page.
let scope = 'Layer';
function number(label, value, min, max, apply, step = 1) {
  const control = input(value, `${scope} ${label}`, 'number'); control.min = min; control.max = max; control.step = step;
  control.onchange = () => { const next = Number(control.value); if (!Number.isFinite(next) || next < min || next > max) { control.value = value; return; } apply(next); };
  return field(label, control);
}
function colour(label, value, apply) { const control = input(value, `${scope} ${label}`, 'color'); control.onchange = () => apply(control.value); return field(label, control); }
const grid = (...children) => { const node = el('div', { className: 'field-grid' }); node.append(...children); return node; };

export function renderLayerEffects(node, { state, layer: l, command }) {
  const fx = l.fx, can = state.effects || {}; if (!fx) return;
  const send = (effect, message) => command({ action: 'effect', screenId: l.screenId, id: l.id, effect }, message);
  const look = section(node, 'look', 'Look', fx.opacity !== null && fx.opacity < 100 || fx.flipH || fx.flipV || fx.mono || fx.inverse || fx.locked);
  look.append(check('Locked on device', fx.locked, v => send({ locked: v }, v ? 'Layer locked.' : 'Layer unlocked.')));
  if (fx.locked) { look.append(text('Unlock to edit effects.')); return; }
  if (can.opacity && fx.opacity !== null) {
    const slider = input(fx.opacity, 'Layer opacity', 'range'); slider.min = 0; slider.max = 100; const out = el('span', {}, `${fx.opacity}%`);
    slider.oninput = () => { out.textContent = `${slider.value}%`; }; slider.onchange = () => send({ opacity: Number(slider.value) }, 'Opacity saved.');
    const row = field('Opacity', slider); row.append(out); look.append(row);
  }
  const toggles = el('div', { className: 'fx-toggles' });
  if (can.flip) toggles.append(check('Flip H', fx.flipH, v => send({ flipH: v }, 'Flip saved.')), check('Flip V', fx.flipV, v => send({ flipV: v }, 'Flip saved.')));
  if (can.mono) toggles.append(check('Mono', fx.mono, v => send({ mono: v }, 'Monochrome saved.')));
  if (can.inverse) toggles.append(check('Invert', fx.inverse, v => send({ inverse: v }, 'Invert saved.')));
  look.append(toggles);
  if (can.border && fx.border && l.type === 2) {
    const b = fx.border, box = section(node, 'border', 'Border', b.enable), set = (change, message = 'Border saved.') => send({ border: change }, message);
    const style = select(can.borderStyles || [[b.style, `Style ${b.style}`]], b.style, 'Border style'); style.onchange = () => set({ style: Number(style.value) });
    box.append(check('Show border', b.enable, v => set({ enable: v })), grid(number('Width', b.h, 0, 512, v => set({ h: v })), number('Height', b.v, 0, 512, v => set({ v }))),
      grid(field('Style', style), colour('Colour', b.color, v => set({ color: v }))),
      button('Reset border', () => set({ enable: false, style: 1, h: 2, v: 2, color: '#3460d8', opacity: 100 }), 'button quiet')); // layer_2.xml defaults
  }
  if (can.mask && fx.mask && [2, 4].includes(l.type)) {
    const m = fx.mask, box = section(node, 'mask', 'Mask', m.enable), set = change => send({ mask: change }, 'Mask saved.');
    box.append(check('Mask edges', m.enable, v => set({ enable: v })),
      grid(number('Left px', m.left, 0, l.window.width, v => set({ left: v })), number('Right px', m.right, 0, l.window.width, v => set({ right: v }))),
      grid(number('Top px', m.top, 0, l.window.height, v => set({ top: v })), number('Bottom px', m.bottom, 0, l.window.height, v => set({ bottom: v }))),
      button('Reset mask', () => set({ enable: false, left: 0, right: 0, top: 0, bottom: 0 }), 'button quiet'));
  }
  if (can.shadow && fx.shadow && l.type === 2) {
    const s = fx.shadow, box = section(node, 'shadow', 'Shadow', s.enable), set = change => send({ shadow: change }, 'Shadow saved.');
    box.append(check('Drop shadow', s.enable, v => set({ enable: v })),
      grid(number('Offset X %', s.x, -100, 100, v => set({ x: v })), number('Offset Y %', s.y, -100, 100, v => set({ y: v }))),
      grid(number('Width %', s.width, 5, 200, v => set({ width: v })), number('Height %', s.height, 5, 200, v => set({ height: v }))),
      grid(number('Feather', s.feather, 0, 100, v => set({ feather: v })), number('Opacity %', s.opacity, 0, 100, v => set({ opacity: v }))),
      colour('Colour', s.color, v => set({ color: v })),
      button('Reset shadow', () => set({ enable: false, feather: 5, width: 100, height: 100, x: 5, y: 5, color: '#000000', opacity: 100 }), 'button quiet'));
  }
  if (can.quality && fx.quality) {
    const q = fx.quality, changed = q.brightness !== 100 || q.contrast !== 100 || q.hue !== 0 || q.saturation !== 100;
    const box = section(node, 'colour', 'Colour', changed), set = change => send({ quality: change }, 'Colour saved.');
    box.append(grid(number('Brightness', q.brightness, 0, 200, v => set({ brightness: v })), number('Contrast', q.contrast, 0, 200, v => set({ contrast: v }))),
      grid(number('Saturation', q.saturation, 0, 200, v => set({ saturation: v })), number('Hue °', q.hue, -180, 180, v => set({ hue: v }))),
      button('Reset colour', () => set({ brightness: 100, contrast: 100, hue: 0, saturation: 100 }), 'button quiet'));
  }
  if (can.crop && fx.crop && [2, 4].includes(l.type) && l.sourceType === 2) {
    // Device ratios are 0–100000 of the source; shown as percent with one decimal.
    const c = fx.crop, box = section(node, 'crop', 'Source crop', c.enable), set = change => send({ crop: change }, 'Source crop saved.');
    const pct = v => Math.round(v / 100) / 10, raw = v => Math.round(v * 1000);
    box.append(check('Crop source', c.enable, v => set({ enable: v })),
      grid(number('X %', pct(c.x), 0, 99.9, v => set({ x: raw(v), width: Math.min(c.width, 100000 - raw(v)) }), 0.1), number('Y %', pct(c.y), 0, 99.9, v => set({ y: raw(v), height: Math.min(c.height, 100000 - raw(v)) }), 0.1)),
      grid(number('Width %', pct(c.width), 0.1, 100, v => set({ width: Math.min(raw(v), 100000 - c.x) }), 0.1), number('Height %', pct(c.height), 0.1, 100, v => set({ height: Math.min(raw(v), 100000 - c.y) }), 0.1)),
      button('Reset crop', () => set({ enable: false, x: 0, y: 0, width: 100000, height: 100000 }), 'button quiet'));
  }
  if (can.key && fx.key && l.type === 2 && l.sourceType === 2) {
    const k = fx.key, box = section(node, 'key', 'Keying', k.enable), set = (change, message = 'Keying saved.') => send({ key: change }, message);
    const type = select([[0, 'Luma'], [1, 'Chroma'], [2, 'Smart']], k.type, 'Key type'); type.onchange = () => set({ type: Number(type.value) });
    box.append(check('Key this layer', k.enable, v => set({ enable: v })), field('Type', type));
    if (k.type === 0) box.append(grid(number('Threshold', k.threshold, 0, 100, v => set({ threshold: v })), number('Gain', k.gain, 0, 100, v => set({ gain: v }))),
      grid(check('Fill colour', k.fill, v => set({ fill: v })), colour('Fill', k.fillColor, v => set({ fillColor: v }))));
    else if (k.type === 1) box.append(grid(colour('Key colour', k.color, v => set({ color: v })), check('Smooth edges', k.edgeSmooth, v => set({ edgeSmooth: v }))),
      grid(number('Hue tolerance', k.hueClip, 5, 180, v => set({ hueClip: v })), number('Hue threshold', k.hueRamp, 5, 180, v => set({ hueRamp: v }))),
      grid(number('Saturation', k.satClip, 0, 100, v => set({ satClip: v })), number('Softness', k.softness, 1, 100, v => set({ softness: v }))),
      grid(number('Spill', k.spill, 0, 100, v => set({ spill: v })), number('Shadow', k.shadow, 0, 100, v => set({ shadow: v }))), number('Highlight', k.highlight, 0, 100, v => set({ highlight: v })));
    else box.append(grid(colour('Key colour', k.smartColor, v => set({ smartColor: v })), number('Strength', k.strength, 0, 100, v => set({ strength: v }))), number('Gain', k.gainAdjust, 0, 100, v => set({ gainAdjust: v })));
    box.append(button('Reset keying', () => set({ enable: false, type: 2, threshold: 10, gain: 50, fill: false, fillColor: '#ffffff', hueClip: 10, hueRamp: 90, satClip: 10, softness: 100, spill: 50, shadow: 0, highlight: 0, edgeSmooth: false, color: '#000000', smartColor: '#000000', strength: 50, gainAdjust: 0 }), 'button quiet'));
  }
  if (can.cutFill && fx.cutFill && l.type === 2) {
    const c = fx.cutFill, box = section(node, 'cutfill', 'Cut & Fill', c.enable), set = (change, message = 'Cut & Fill saved.') => send({ cutFill: change }, message);
    box.append(check('Cut this layer with a key source', c.enable, v => set({ enable: v }, v ? 'Cut & Fill on.' : 'Cut & Fill off.')));
    if (!c.enable) return;
    // The cut source supplies the shape; this layer supplies the fill.
    const options = [['0:0', 'No cut source'], ...state.sources.filter(s => s.type === 2).map(s => [`2:${s.id}`, s.name])], current = `${c.sourceType === 2 ? 2 : 0}:${c.sourceType === 2 ? c.sourceId : 0}`;
    if (c.sourceType === 5) options.push([`5:${c.sourceId}`, 'Gallery image']);
    const source = select(options, c.sourceType === 5 ? `5:${c.sourceId}` : current, 'Cut source');
    source.onchange = () => { const [type, id] = source.value.split(':').map(Number); if (type) set({ source: { id, type } }, 'Cut source saved.'); else set({ reset: true }, 'Cut & Fill reset.'); };
    box.append(field('Cut source', source), check('Invert cut', c.inverse, v => set({ inverse: v })),
      grid(number('Offset X %', c.x, -100, 100, v => set({ x: v })), number('Offset Y %', c.y, -100, 100, v => set({ y: v }))),
      grid(number('Width %', c.width, 5, 200, v => set({ width: v })), number('Height %', c.height, 5, 200, v => set({ height: v }))),
      grid(number('Black in', c.startX, 0, 255, v => set({ startX: v })), number('Black out', c.startY, 0, 255, v => set({ startY: v }))),
      grid(number('White in', c.endX, 0, 255, v => set({ endX: v })), number('White out', c.endY, 0, 255, v => set({ endY: v }))),
      button('Reset Cut & Fill', () => set({ reset: true }, 'Cut & Fill reset.'), 'button quiet'));
  }
}

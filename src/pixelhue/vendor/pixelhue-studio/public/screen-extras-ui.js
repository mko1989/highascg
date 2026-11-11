import { el, text, button, input, select, field } from './ui.js';

// Screens tab: test pattern and colour for the selected screen (WO-037). Applies on change.
const isLine = type => type >= 512 && type <= 517, isGrid = type => (type >= 5 && type <= 7) || (type >= 256 && type <= 263);
let open = false;
export function renderScreenExtras(screen, options, command) {
  const limits = options?.[screen.type]; if (!limits || (!limits.pattern && !limits.quality.length && !limits.format)) return null;
  const box = el('details', { className: 'screen-extras' }); box.open = open || Boolean(screen.pattern?.enable); box.ontoggle = () => { open = box.open; };
  const summary = el('summary', {}, 'Test pattern, colour and format'); if (screen.pattern?.enable) summary.append(el('span', { className: 'fx-on' }, 'pattern on')); box.append(summary);
  if (limits.pattern && screen.pattern) {
    const p = screen.pattern, row = el('div', { className: 'studio-bulk' }), set = pattern => command({ action: 'pattern', id: screen.id, pattern }, true);
    const type = select([['off', 'Off'], ...limits.pattern.types], p.enable ? p.type : 'off', 'Screen test pattern');
    type.onchange = () => set(type.value === 'off' ? { enable: false } : { enable: true, type: Number(type.value) });
    const bright = select(limits.pattern.bright.map(v => [v, `${v * 25}%`]), p.bright, 'Pattern brightness'); bright.onchange = () => set({ bright: Number(bright.value) });
    row.append(field('Pattern', type), field('Brightness', bright));
    if (isGrid(p.type)) { const gear = select(limits.pattern.gear.map(v => [v, `${Math.round(2048 / 2 ** v)} px`]), p.grid, 'Pattern spacing'); gear.onchange = () => set({ grid: Number(gear.value) }); row.append(field('Spacing', gear)); }
    if (isLine(p.type)) {
      const number = (label, value, min, max, key) => { const control = input(value, label, 'number'); control.min = min; control.max = max;
        control.onchange = () => { const next = Number(control.value); if (Number.isInteger(next) && next >= min && next <= max) set({ [key]: next }); else control.value = value; }; return control; };
      const speed = select(limits.pattern.speed.map(v => [v, v ? `Speed ${v}` : 'Still']), p.speed, 'Pattern motion'); speed.onchange = () => set({ speed: Number(speed.value) });
      row.append(field('Spacing px', number('Pattern spacing', p.grid, limits.pattern.pixel.min, limits.pattern.pixel.max, 'grid')),
        field('Line px', number('Pattern line width', p.lineWidth, limits.pattern.line.min, limits.pattern.line.max, 'lineWidth')), field('Motion', speed));
    }
    box.append(row);
  }
  if (limits.quality.length && screen.quality) {
    const q = screen.quality, row = el('div', { className: 'studio-bulk' }), set = quality => command({ action: 'quality', id: screen.id, quality }, true);
    for (const [key, label, min, max] of [['brightness', 'Brightness', 0, 200], ['contrast', 'Contrast', 0, 200], ['saturation', 'Saturation', 0, 200], ['hue', 'Hue °', -180, 180]]) {
      if (!limits.quality.includes(key)) continue;
      const control = input(q[key], `Screen ${label}`, 'number'); control.min = min; control.max = max;
      control.onchange = () => { const next = Number(control.value); if (Number.isInteger(next) && next >= min && next <= max) set({ [key]: next }); else control.value = q[key]; };
      row.append(field(label, control));
    }
    const defaults = Object.fromEntries([['brightness', 100], ['contrast', 100], ['saturation', 100], ['hue', 0]].filter(([key]) => limits.quality.includes(key)));
    row.append(button('Reset colour', () => set(defaults), 'button quiet')); box.append(row);
  }
  if (limits.format && screen.format) {
    const f = screen.format, rule = limits.format.rules[f.dynamicRange] || limits.format.rules[0], row = el('div', { className: 'studio-bulk' }), set = format => command({ action: 'format', id: screen.id, format }, true);
    const pick = (label, options, value, apply) => { const control = select(options, value, `Screen ${label}`); control.onchange = () => apply(Number(control.value)); row.append(field(label, control)); return control; };
    // Entering HDR also moves depth and gamut to values that range allows, in one request.
    pick('Dynamic range', limits.format.ranges.map(v => [v, ['SDR', 'HDR10', 'HLG'][v]]), f.dynamicRange, v => { const next = limits.format.rules[v];
      set({ dynamicRange: v, ...(next.depths.includes(f.colorDepth) || (f.colorSpace === 1 && next.fixed422) ? {} : { colorDepth: next.depths[0] }), ...(next.gamuts.includes(f.colorGamut) ? {} : { colorGamut: next.gamuts.at(-1) }) }); });
    pick('Sampling', [[0, 'RGB 4:4:4'], [1, 'YCbCr 4:2:2'], [2, 'YCbCr 4:4:4']].filter(([v]) => limits.format.spaces.includes(v)), f.colorSpace, v => set({ colorSpace: v }));
    const depth = pick('Bit depth', (f.colorSpace === 1 && rule.fixed422 ? [rule.fixed422] : rule.depths).map(v => [v, `${v} bit`]), f.colorDepth, v => set({ colorDepth: v })); depth.dataset.fixed = String(f.colorSpace === 1 && Boolean(rule.fixed422));
    pick('Gamut', rule.gamuts.map(v => [v, ['Rec.601', 'Rec.709', 'DCI-P3', 'Rec.2020'][v]]), f.colorGamut, v => set({ colorGamut: v }));
    if (!screen.outputs.length) for (const control of row.querySelectorAll('select')) control.dataset.fixed = 'true';
    box.append(row);
  }
  box.append(text('Applies to the whole screen output, on top of layer and output settings.'));
  return box;
}

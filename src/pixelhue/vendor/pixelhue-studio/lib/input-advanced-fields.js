import { child } from './configuration.js';
import { allowed, find } from './interface-config.js';
import { supportsEdid } from './input-models.js';

const color = {
  colorSpace: ['Sampling', 'ColorSpace', 'ColorSpaces', { 0: 'RGB 4:4:4', 1: 'YCbCr 4:2:2', 2: 'YCbCr 4:4:4', 3: 'YCbCr 4:2:0', 255: 'Auto' }],
  colorDepth: ['Bit depth', 'ColorDepth', 'ColorDepths', { 8: '8 bit', 10: '10 bit', 12: '12 bit', 255: 'Auto' }],
  colorRange: ['Quantization range', 'ColorRange', 'ColorRanges', { 0: 'Limited', 1: 'Full', 255: 'Auto' }],
  colorGamut: ['Colour gamut', 'ColorGamut', 'ColorGamuts', { 0: 'Rec.601', 1: 'Rec.709', 2: 'DCI-P3', 3: 'Rec.2020', 4: 'NTSC', 5: 'Adobe RGB', 255: 'Auto' }],
  colorDynamicRange: ['Dynamic range', 'DynamicRange', 'DynamicRange', { 0: 'SDR', 1: 'HDR10', 2: 'HLG', 255: 'Auto' }],
};
export const valueAt = (object, path) => path.split('.').reduce((obj, key) => obj?.[key], object);
const enums = node => {
  const values = find(node, n => n.children.some(c => c.name === 'Enum'));
  return values?.children.filter(n => n.name === 'Enum').map(n => Number(n.attributes.Value)).filter(Number.isFinite) || [];
};
export function inputAdvancedFields(raw, config) {
  const fields = [], values = {}, type = raw.auxiliaryInfo.connectorInfo.type;
  const add = (key, label, section, value, options, extra = {}) => {
    if (value === undefined || value === null || !Number.isFinite(value)) return;
    fields.push({ key, label, section, ...(options ? { options } : {}), ...extra }); values[key] = value;
  };
  if (supportsEdid(type) && allowed(config.property('CompatibilityMode'))) add('compatibilityMode', 'Mac compatibility', 'Mac', raw.compatibilityMode, [[0, 'Off'], [1, 'On']]);
  const hdcp = config.property('HDCP');
  if (hdcp) {
    if (allowed(child(hdcp, 'Enable'))) add('hdcp.enable', 'HDCP', 'Signal', raw.hdcp?.enable, [[0, 'Off'], [1, 'On']]);
  }
  for (const [key, [label, name, plural, labels]] of Object.entries(color)) {
    const node = config.property(name, plural), options = node && enums(node);
    if (options?.length) add(`${key}.preset`, label, 'Signal overrides', raw[key]?.preset, options.map(v => [v, labels[v] || `Mode ${v}`]));
  }
  const quality = config.property('ImageQuality');
  const numeric = (path, names, label, scale = 1) => {
    const node = names.reduce((p, n) => allowed(p) ? child(p, n) : undefined, quality);
    const min = Number(node?.attributes.Min), max = Number(node?.attributes.Max);
    if (allowed(node) && Number.isFinite(min) && Number.isFinite(max)) add(`imageQuality.${path}`, label, 'Image quality', valueAt(raw.imageQuality, path) / scale, null,
      { min, max, step: node.attributes.DataType === '1' || scale !== 1 ? Number(node.attributes.Step) || 0.01 : 1, scale, default: Number(node.attributes.Value) });
  };
  for (const [key, xml, label] of [['brightness', 'Brightness', 'Brightness'], ['contrast', 'Contrast', 'Contrast'], ['shadow', 'Shadow', 'Shadow'], ['highLight', 'HighLight', 'Highlight']]) {
    for (const channel of ['R', 'G', 'B', 'W', 'coefficient']) numeric(`${key}.${channel}`, [xml, channel === 'coefficient' ? 'Coefficient' : channel], `${label} ${channel === 'coefficient' ? 'master' : channel}`);
  }
  numeric('hue', ['Hue'], 'Hue'); numeric('saturation', ['Saturation'], 'Saturation');
  numeric('gamma', ['Gamma'], 'Gamma', raw.imageQuality?.gammaScale || 1);
  return { fields, values };
}

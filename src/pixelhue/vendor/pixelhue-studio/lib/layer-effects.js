import { fail } from './pixelhue.js';
import { integer, choice, verified } from './studio-common.js';
import { configuration, xmlFile, xmlTree, child } from './configuration.js';

// Per-layer effects (WO-036), contracts from PixelFlow LayerAttribute/presenter/layerAttrEventHandle/* and
// api/layer/layer.ts: every PUT takes [{ layerId, <section> }] with the WHOLE section, never a delta.
// Ranges are the P20 layer_2.xml values; sections the device XML does not support are not offered.
const SECTIONS = { opacity: 'Opacity', flip: 'FlipType', mono: 'IsMonochrome', inverse: 'IsInverse', mask: 'Mask', shadow: 'Shadow', border: 'Borders', quality: 'ImageQuality', crop: 'Crop', key: 'CutoutGeneral', cutFill: 'CutFill' };
const BORDER_STYLES = [[1, 'Outer'], [3, 'Soft'], [4, 'Halo'], [5, 'Halo in'], [6, 'Halo out']];
const RATIO = 100000;
// Keying (layers/cutout): flat Studio key → [device path, min, max]. Type 0 luma, 1 chroma, 2 smart (layer_2.xml CutoutGeneral).
const KEY_FIELDS = { threshold: ['brightness.threshold', 0, 100], gain: ['brightness.gain', 0, 100], hueClip: ['hue.hueClip', 5, 180], hueRamp: ['hue.hueRamp', 5, 180],
  satClip: ['hue.saturationClip', 0, 100], softness: ['hue.saturationGain', 1, 100], spill: ['hue.spill', 0, 100], shadow: ['hue.shadow', 0, 100], highlight: ['hue.highLigh', 0, 100],
  strength: ['intelligence.mattingStrength', 0, 100], gainAdjust: ['intelligence.gainAdjust', 0, 100] };
const at = (object, path) => path.split('.').reduce((o, k) => o?.[k], object);
function keyValues(c) {
  return { enable: c.enable === 1, type: c.type, ...Object.fromEntries(Object.entries(KEY_FIELDS).map(([key, [path]]) => [key, at(c, path) ?? 0])),
    edgeSmooth: c.hue?.edgeSmooth === 1, color: hex(c.hue?.color), smartColor: hex(c.intelligence?.color), fill: c.brightness?.foregroundColor?.enable === 1, fillColor: hex(c.brightness?.foregroundColor) };
}
const hex = c => `#${[c?.R, c?.G, c?.B].map(v => Number(v || 0).toString(16).padStart(2, '0')).join('')}`;
function rgb(value, label) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw fail(`${label} must be a #rrggbb colour.`);
  return { R: parseInt(value.slice(1, 3), 16), G: parseInt(value.slice(3, 5), 16), B: parseInt(value.slice(5, 7), 16) };
}
const findLayer = node => node.name === 'Layer' && node.attributes.Type === '2' ? node : node.children.map(findLayer).find(Boolean);
export async function effectSupport(client) {
  await configuration(client);
  if (client.effectSupportXml !== client.configurationXml || !client.effectSupport) {
    const layer = findLayer(xmlTree(xmlFile(client.configurationXml, 'deviceconfig/device/layer_2.xml')));
    const on = name => { const node = child(layer, name); return Boolean(node) && node.attributes.Support === '1' && node.attributes.Editable !== '0'; };
    client.effectSupport = Object.fromEntries(Object.entries(SECTIONS).map(([key, name]) => [key, on(name)]));
    client.effectSupport.borderStyles = BORDER_STYLES; client.effectSupportXml = client.configurationXml;
  }
  return client.effectSupport;
}
// Cut & Fill: the selected (fill) layer links to a cut layer through cutId; the cut layer carries source, curve, position and invert.
function cutFillValues(l, cut) {
  const c = cut?.cutFill || l.cutFill, on = l.cutFill.enable === 1 && Boolean(cut);
  return { enable: on, x: c.relative?.x ?? 0, y: c.relative?.y ?? 0, width: c.relative?.width ?? 100, height: c.relative?.height ?? 100,
    startX: c.curve?.start?.x ?? 0, startY: c.curve?.start?.y ?? 0, endX: c.curve?.end?.x ?? 255, endY: c.curve?.end?.y ?? 255,
    inverse: cut?.general?.isInverse === 1, sourceId: cut?.source?.general?.sourceId ?? 0, sourceType: cut?.source?.general?.sourceType ?? 0 };
}
export function effectValues(l, cut) {
  const flip = l.general?.flipType ?? 0, iq = l.imageQuality;
  return { opacity: l.opacity ?? null, flipH: Boolean(flip & 1), flipV: Boolean(flip & 2), mono: l.general?.isMonochrome === 1, inverse: l.general?.isInverse === 1, locked: l.isLock === 1,
    border: l.border ? { enable: l.border.enable === 1, style: l.border.type, h: l.border.size?.hWidth ?? 0, v: l.border.size?.vWidth ?? 0, color: hex(l.border.color), opacity: l.border.color?.opacity ?? 100 } : null,
    mask: l.mask ? { enable: l.mask.enable === 1, left: l.mask.left, right: l.mask.right, top: l.mask.top, bottom: l.mask.buttom } : null,
    shadow: l.shadow ? { enable: l.shadow.general?.enable === 1, feather: l.shadow.general?.feather ?? 0, ...l.shadow.window, color: hex(l.shadow.color), opacity: l.shadow.color?.opacity ?? 100 } : null,
    quality: iq ? { brightness: iq.brightness?.coefficient ?? 100, contrast: iq.contrast?.coefficient ?? 100, hue: iq.hue ?? 0, saturation: iq.saturation ?? 100 } : null,
    crop: l.crop ? { enable: l.crop.enable === 1, x: l.crop.xRatio, y: l.crop.yRatio, width: l.crop.widthRatio, height: l.crop.heightRatio } : null,
    key: l.cutout?.brightness && l.cutout.hue ? keyValues(l.cutout) : null,
    cutFill: l.cutFill ? cutFillValues(l, cut) : null };
}
const flag = (value, label) => choice(value, [true, false], label) ? 1 : 0;
function keys(object, allowed, label) {
  if (!object || typeof object !== 'object' || !Object.keys(object).length || Object.keys(object).some(key => !allowed.includes(key))) throw fail(`Unsupported ${label} setting.`);
  return object;
}
// Builds every write before the first one is sent; throws on anything invalid.
export function planEffects(raw, changes, support, cut) {
  keys(changes, ['opacity', 'flipH', 'flipV', 'mono', 'inverse', 'locked', 'border', 'mask', 'shadow', 'quality', 'crop', 'key', 'cutFill'], 'layer effect');
  const type = raw.layerIdObj?.type === 256 ? 2 : raw.layerIdObj?.type, id = raw.layerId, writes = [], need = (key, label) => { if (!support[key]) throw fail(`${label} is unavailable on this device.`); };
  if (raw.isLock === 1 && !(Object.keys(changes).length === 1 && changes.locked === false)) throw fail('This layer is locked on the device. Unlock it first.', 409);
  if (changes.locked !== undefined) writes.push(['layers/lock', { layerId: id, isLock: flag(changes.locked, 'layer lock') }]);
  if (changes.opacity !== undefined) { need('opacity', 'Opacity'); writes.push(['layers/opacity', { layerId: id, opacity: integer(changes.opacity, 'Opacity', 0, 100) }]); }
  const general = {};
  if (changes.flipH !== undefined || changes.flipV !== undefined) {
    need('flip', 'Flip'); const now = raw.general?.flipType ?? 0;
    general.flipType = (flag(changes.flipH ?? Boolean(now & 1), 'flip') ? 1 : 0) | (flag(changes.flipV ?? Boolean(now & 2), 'flip') ? 2 : 0);
  }
  if (changes.mono !== undefined) { need('mono', 'Monochrome'); general.isMonochrome = flag(changes.mono, 'monochrome'); }
  if (changes.inverse !== undefined) { need('inverse', 'Invert'); general.isInverse = flag(changes.inverse, 'invert'); }
  if (Object.keys(general).length) writes.push(['layers/general', { layerId: id, general: { ...raw.general, ...general } }]);
  if (changes.border !== undefined) {
    need('border', 'Border'); if (type !== 2 || !raw.border) throw fail('Borders are available on normal layers only.');
    const c = keys(changes.border, ['enable', 'style', 'h', 'v', 'color', 'opacity'], 'border'), old = raw.border;
    writes.push(['layers/border', { layerId: id, border: { ...old, enable: c.enable === undefined ? old.enable : flag(c.enable, 'border'),
      type: c.style === undefined ? old.type : choice(c.style, BORDER_STYLES.map(s => s[0]), 'border style'),
      size: { ...old.size, ...(c.h === undefined ? {} : { hWidth: integer(c.h, 'Border width', 0, 512) }), ...(c.v === undefined ? {} : { vWidth: integer(c.v, 'Border height', 0, 512) }) },
      color: { ...old.color, ...(c.color === undefined ? {} : rgb(c.color, 'Border colour')), ...(c.opacity === undefined ? {} : { opacity: integer(c.opacity, 'Border opacity', 0, 100) }) } } }]);
  }
  if (changes.mask !== undefined) {
    need('mask', 'Mask'); if (![2, 4].includes(type) || !raw.mask) throw fail('Masks are unavailable on this layer.');
    const c = keys(changes.mask, ['enable', 'left', 'right', 'top', 'bottom'], 'mask'), old = raw.mask, { width, height } = raw.window;
    const px = { left: c.left ?? old.left, right: c.right ?? old.right, top: c.top ?? old.top, bottom: c.bottom ?? old.buttom };
    for (const [key, value] of Object.entries(px)) integer(value, `Mask ${key}`, 0, ['left', 'right'].includes(key) ? width : height);
    if (px.left + px.right >= width || px.top + px.bottom >= height) throw fail('The mask would hide the whole layer.');
    const ratio = (value, size) => Math.round(value / size * RATIO); // dataUtils.ts getMaskRatio; "buttom" is the device spelling
    writes.push(['layers/mask', { layerId: id, mask: { ...old, enable: c.enable === undefined ? old.enable : flag(c.enable, 'mask'),
      left: px.left, leftRatio: ratio(px.left, width), right: px.right, rightRatio: ratio(px.right, width),
      top: px.top, topRatio: ratio(px.top, height), buttom: px.bottom, buttomRatio: ratio(px.bottom, height) } }]);
  }
  if (changes.shadow !== undefined) {
    need('shadow', 'Shadow'); if (type !== 2 || !raw.shadow) throw fail('Shadows are available on normal layers only.');
    const c = keys(changes.shadow, ['enable', 'feather', 'width', 'height', 'x', 'y', 'color', 'opacity'], 'shadow'), old = raw.shadow, window = { ...old.window };
    for (const [key, min, max] of [['width', 5, 200], ['height', 5, 200], ['x', -100, 100], ['y', -100, 100]]) if (c[key] !== undefined) window[key] = integer(c[key], `Shadow ${key}`, min, max);
    writes.push(['layers/shadow', { layerId: id, shadow: { ...old, general: { ...old.general, ...(c.enable === undefined ? {} : { enable: flag(c.enable, 'shadow') }), ...(c.feather === undefined ? {} : { feather: integer(c.feather, 'Shadow feather', 0, 100) }) },
      window, color: { ...old.color, ...(c.color === undefined ? {} : rgb(c.color, 'Shadow colour')), ...(c.opacity === undefined ? {} : { opacity: integer(c.opacity, 'Shadow opacity', 0, 100) }) } } }]);
  }
  if (changes.quality !== undefined) {
    need('quality', 'Colour adjustment'); if (!raw.imageQuality) throw fail('Colour adjustment is unavailable on this layer.');
    const c = keys(changes.quality, ['brightness', 'contrast', 'hue', 'saturation'], 'colour'), old = raw.imageQuality, next = { ...old };
    if (c.brightness !== undefined) next.brightness = { ...old.brightness, coefficient: integer(c.brightness, 'Brightness', 0, 200) };
    if (c.contrast !== undefined) next.contrast = { ...old.contrast, coefficient: integer(c.contrast, 'Contrast', 0, 200) };
    if (c.hue !== undefined) next.hue = integer(c.hue, 'Hue', -180, 180);
    if (c.saturation !== undefined) next.saturation = integer(c.saturation, 'Saturation', 0, 200);
    writes.push(['layers/image-quality', { layerId: id, imageQuality: next }]);
  }
  if (changes.crop !== undefined) {
    need('crop', 'Source crop'); if (![2, 4].includes(type) || raw.source?.general?.sourceType !== 2 || !raw.crop) throw fail('Source crop needs a layer showing an input.');
    const c = keys(changes.crop, ['enable', 'x', 'y', 'width', 'height'], 'crop'), old = raw.crop;
    const next = { x: c.x ?? old.xRatio, y: c.y ?? old.yRatio, width: c.width ?? old.widthRatio, height: c.height ?? old.heightRatio };
    integer(next.x, 'Crop X', 0, RATIO - 1); integer(next.y, 'Crop Y', 0, RATIO - 1);
    integer(next.width, 'Crop width', 1, RATIO - next.x); integer(next.height, 'Crop height', 1, RATIO - next.y);
    writes.push(['layers/crop', { layerId: id, crop: { ...old, enable: c.enable === undefined ? old.enable : flag(c.enable, 'crop'), xRatio: next.x, yRatio: next.y, widthRatio: next.width, heightRatio: next.height } }]);
  }
  if (changes.key !== undefined) {
    need('key', 'Keying'); if (type !== 2 || raw.source?.general?.sourceType !== 2 || !raw.cutout?.brightness || !raw.cutout.hue) throw fail('Keying needs a normal layer showing an input.');
    const c = keys(changes.key, ['enable', 'type', 'edgeSmooth', 'color', 'smartColor', 'fill', 'fillColor', ...Object.keys(KEY_FIELDS)], 'keying'), next = structuredClone(raw.cutout);
    if (c.type !== undefined) next.type = choice(c.type, [0, 1, 2], 'key type');
    for (const [key, [path, min, max]] of Object.entries(KEY_FIELDS)) if (c[key] !== undefined) { const [group, field] = path.split('.'); next[group] = { ...next[group], [field]: integer(c[key], `Key ${key}`, min, max) }; }
    if (c.edgeSmooth !== undefined) next.hue.edgeSmooth = flag(c.edgeSmooth, 'edge smoothing');
    if (c.color !== undefined) next.hue.color = { ...next.hue.color, ...rgb(c.color, 'Key colour') };
    if (c.smartColor !== undefined) next.intelligence = { ...next.intelligence, color: { ...next.intelligence?.color, ...rgb(c.smartColor, 'Key colour') } };
    if (c.fillColor !== undefined) next.brightness.foregroundColor = { ...next.brightness.foregroundColor, ...rgb(c.fillColor, 'Fill colour') };
    if (c.fill !== undefined) next.brightness.foregroundColor = { ...next.brightness.foregroundColor, enable: flag(c.fill, 'key fill') };
    if (c.enable !== undefined) {
      next.enable = flag(c.enable, 'keying');
      // PixelFlow layerCutoutEnableHandle: a Cut & Fill layer cannot be keyed; switching off also drops the picker cursor and the luma fill colour.
      if (next.enable && raw.cutFill?.enable === 1) throw fail('Keying cannot be combined with Cut & Fill on this layer.', 409);
      if (!next.enable) { next.cursor = { ...next.cursor, enable: 0 }; next.brightness.foregroundColor = { ...next.brightness.foregroundColor, enable: 0 }; }
    }
    writes.push(['layers/cutout', { layerId: id, cutout: next }]);
  }
  if (changes.cutFill !== undefined) {
    need('cutFill', 'Cut & Fill'); if (type !== 2 || !raw.cutFill) throw fail('Cut & Fill is available on normal layers only.');
    const c = keys(changes.cutFill, ['enable', 'x', 'y', 'width', 'height', 'startX', 'startY', 'endX', 'endY', 'inverse', 'source', 'reset'], 'Cut & Fill');
    if (c.enable !== undefined) {
      if (Object.keys(c).length > 1) throw fail('Switch Cut & Fill on or off separately from its settings.');
      // Device code 8298 in PixelFlow: not together with keying.
      if (flag(c.enable, 'Cut & Fill') && raw.cutout?.enable === 1) throw fail('Cut & Fill cannot be combined with keying on this layer.', 409);
      writes.push(['layers/cut-fill-switch', { layerId: id, enable: c.enable ? 1 : 0 }]);
    } else {
      if (raw.cutFill.enable !== 1 || !cut) throw fail('Turn Cut & Fill on first.', 409);
      const old = cut.cutFill || raw.cutFill, relative = { ...old.relative }, curve = { start: { ...old.curve?.start }, end: { ...old.curve?.end } };
      if (c.reset !== undefined) {
        if (c.reset !== true || Object.keys(c).length > 1) throw fail('Reset Cut & Fill on its own.');
        // disLayerCutFillResetAction: XML defaults, no source (type 1), not inverted.
        writes.push(['layers/reset-cut', { layerId: cut.layerId, isInverse: 0, source: { sourceId: 0, sourceType: 1 }, curve: { start: { x: 0, y: 0 }, end: { x: 255, y: 255 } }, relative: { x: 0, y: 0, width: 100, height: 100 } }]);
      }
      for (const [key, min, max] of [['x', -100, 100], ['y', -100, 100], ['width', 5, 200], ['height', 5, 200]]) if (c[key] !== undefined) relative[key] = integer(c[key], `Cut ${key}`, min, max);
      if (['x', 'y', 'width', 'height'].some(key => c[key] !== undefined)) writes.push(['layers/relative', { layerId: cut.layerId, relative }]);
      for (const [key, end, axis] of [['startX', 'start', 'x'], ['startY', 'start', 'y'], ['endX', 'end', 'x'], ['endY', 'end', 'y']]) if (c[key] !== undefined) curve[end][axis] = integer(c[key], 'Cut curve', 0, 255);
      if (['startX', 'startY', 'endX', 'endY'].some(key => c[key] !== undefined)) writes.push(['layers/curve', { layerId: cut.layerId, curve }]);
      if (c.inverse !== undefined) writes.push(['layers/general', { layerId: cut.layerId, general: { ...cut.general, isInverse: flag(c.inverse, 'cut invert') } }]);
      if (c.source !== undefined) {
        if (!Number.isSafeInteger(c.source?.id) || ![2, 5].includes(c.source.type)) throw fail('Choose an input or a gallery image as the cut source.');
        writes.push(['layers/source', { layerId: cut.layerId, source: { general: { sourceId: c.source.id, sourceType: c.source.type } } }]);
      }
    }
  }
  return writes;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export async function applyEffect(client, layer, changes, read) {
  const list = (await client.call('layers/list-detail')).data?.list, raw = list?.find(l => l.layerId === layer.id);
  if (!raw) throw fail('Programming layer no longer exists. Refresh.', 409);
  const writes = planEffects(raw, changes, await effectSupport(client), list.find(l => raw.cutId && l.layerId === raw.cutId));
  for (const [path, item] of writes) await client.call(path, [item], { timeoutMs: 20000 }).catch(error => {
    if (/resource/i.test(error.message)) throw fail('The device has no free layer resources for this effect on this layer.', 409);
    if (/code (8297|8298|8310)/.test(error.message)) throw fail('The device refused this: Cut & Fill, keying and source backup cannot share a source or layer.', 409);
    if (/code 8341/.test(error.message)) throw fail('The device refused this gallery image as a cut source.', 409);
    throw error;
  });
  // Cut & Fill source and reset are compared through the fields they change.
  const expected = structuredClone(changes), cf = expected.cutFill;
  if (cf?.source) { cf.sourceId = cf.source.id; cf.sourceType = cf.source.type; delete cf.source; }
  if (cf?.reset) expected.cutFill = { x: 0, y: 0, width: 100, height: 100, startX: 0, startY: 0, endX: 255, endY: 255, inverse: false };
  return verified(() => read(client), next => {
    const fx = next.layers.find(l => l.id === layer.id)?.fx;
    return fx && Object.entries(expected).every(([key, value]) => value !== null && typeof value === 'object' ? Object.entries(value).every(([k, v]) => same(fx[key]?.[k], v)) : same(fx[key], value));
  }, 'the layer effect');
}

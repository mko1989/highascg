import { configuration, child } from './configuration.js';
import { fail } from './pixelhue.js';
import { name as validName, verified } from './studio-common.js';

// Layer presets (WO-037). PixelFlow LayerPreset/presenter/handle/*: every part is always stored, each with its own enable.
const PARTS = { source: 'Source', pos: 'Position', size: 'Size', border: 'Border', effect: 'Colour & opacity', shadow: 'Shadow', flip: 'Flip', mask: 'Mask', cutFill: 'Cut & Fill', crop: 'Crop', freeze: 'Freeze' };
const CUT_DEFAULT = { source: { general: { connectCapacityNum: 0, connectorType: 0, sourceId: 0, sourceName: '', sourceType: 1 } }, isInverse: 0,
  cutFill: { enable: 0, relative: { x: 0, y: 0, width: 100, height: 100 }, curve: { start: { x: 0, y: 0 }, end: { x: 255, y: 255 } } } };
const hex = c => `#${[c?.R, c?.G, c?.B].map(v => Number(v || 0).toString(16).padStart(2, '0')).join('')}`;
async function feature(client) {
  const node = child(child(child(await configuration(client), 'Features'), 'Layer'), 'LayerPreset');
  if (node?.attributes.Support !== '1') return null;
  const colors = (child(node, 'LabelColors')?.children || []).filter(n => n.name === 'LabelColor' && n.attributes.Support !== '0').map(n => ({ R: Number(n.attributes.R), G: Number(n.attributes.G), B: Number(n.attributes.B) }));
  return { colors, max: Number(node.attributes.maxCount) || 1024 };
}
const rawList = async client => { const response = await client.call('layers/layer-preset/list-detail'); return Array.isArray(response.data?.list) ? response.data.list : []; };
export async function readLayerPresets(client) {
  const info = await feature(client).catch(() => null);
  if (!info) return { supported: false, list: [], colors: [], max: 0, parts: [] };
  // A firmware that advertises the feature but not the list route simply shows none.
  const list = await rawList(client).catch(() => []);
  return { supported: true, colors: info.colors.map(hex), max: info.max, parts: Object.entries(PARTS),
    list: list.map(p => ({ id: p.layerPresetId, name: p.general?.name || `Layer preset ${p.layerPresetId}`, color: hex(p.general?.labelColor),
      parts: Object.keys(PARTS).filter(key => p[`${key}Preset`]?.enable === 1) })) };
}
export function buildLayerPreset(raw, cut, screen, { name, color, parts }) {
  const on = key => parts.includes(key) ? 1 : 0, source = structuredClone(raw.source || {});
  // handleLayerPresetCreate: the primary source ids win and "primary" is not stored.
  if (source.general && source.primary) { source.general.sourceId = source.primary.sourceId ?? source.general.sourceId; source.general.sourceType = source.primary.sourceType || source.general.sourceType; }
  delete source.primary;
  const cutPart = cut ? { isInverse: cut.general?.isInverse ?? 0, cutFill: cut.cutFill, source: cut.source } : CUT_DEFAULT;
  return { general: { name, labelColor: color },
    sourcePreset: { enable: on('source'), source }, posPreset: { enable: on('pos'), x: raw.window.x - screen.x, y: raw.window.y - screen.y },
    sizePreset: { enable: on('size'), width: raw.window.width, height: raw.window.height }, borderPreset: { enable: on('border'), border: raw.border },
    effectPreset: { enable: on('effect'), isMonochrome: raw.general?.isMonochrome ?? 0, isInverse: raw.general?.isInverse ?? 0, imageQuality: raw.imageQuality, opacity: raw.opacity },
    shadowPreset: { enable: on('shadow'), shadow: raw.shadow }, flipPreset: { enable: on('flip'), flipType: raw.general?.flipType ?? 0 }, maskPreset: { enable: on('mask'), mask: raw.mask },
    cutFillPreset: { enable: cut ? on('cutFill') : 0, ...structuredClone(cutPart) }, cropPreset: { enable: on('crop'), crop: raw.crop }, freezePreset: { enable: on('freeze'), isFreeze: raw.general?.isFreeze ?? 0 } };
}
const duplicate = error => { if (/code 8311/.test(error.message)) throw fail('A layer preset with this name already exists.', 409); throw error; };
export async function applyLayerPresetAction(client, request, { state, screen, read }) {
  const info = await feature(client);
  if (!info) throw fail('This device does not advertise layer presets.', 403);
  const list = await rawList(client), stored = () => { const preset = list.find(p => p.layerPresetId === request.presetId); if (!preset) throw fail('Layer preset no longer exists. Refresh.', 409); return preset; };
  const colour = value => { const match = info.colors.find(c => hex(c) === value); if (!match) throw fail('Choose one of the device label colours.'); return match; };
  if (request.action === 'layerpreset-save') {
    const layer = state.layers.find(l => l.id === request.id && l.screenId === screen?.id);
    if (!layer) throw fail('Programming layer no longer exists. Refresh.', 409);
    const parts = request.parts;
    if (!Array.isArray(parts) || !parts.length || parts.some(key => !PARTS[key]) || new Set(parts).size !== parts.length) throw fail('Choose what the layer preset stores.');
    if (list.length >= info.max) throw fail(`The device stores at most ${info.max} layer presets.`);
    const presetName = validName(request.name, 'Layer preset name');
    if (list.some(p => p.general?.name === presetName)) throw fail('A layer preset with this name already exists.', 409);
    const layers = (await client.call('layers/list-detail')).data?.list || [], raw = layers.find(l => l.layerId === layer.id);
    if (!raw) throw fail('Programming layer no longer exists. Refresh.', 409);
    const body = buildLayerPreset(raw, layers.find(l => raw.cutId && l.layerId === raw.cutId), screen, { name: presetName, color: colour(request.color ?? hex(info.colors[0])), parts });
    await client.call('layers/layer-preset/create', [body]).catch(duplicate);
    return verified(() => read(client), next => next.layerPresets.list.some(p => p.name === presetName), 'the layer preset');
  }
  if (request.action === 'layerpreset-apply') {
    const layer = state.layers.find(l => l.id === request.id && l.screenId === screen?.id);
    if (!layer) throw fail('Programming layer no longer exists. Refresh.', 409);
    const body = [{ layerPreset: stored(), layerIds: [{ layerId: layer.id }] }];
    // PixelFlow assesses first and does not apply when the device reports failures.
    const assess = await client.call('layers/layer-preset/apply-access', body);
    const reasons = [...new Set((assess.data?.fails || []).flatMap(f => f?.results || []))];
    if (assess.data?.fails?.length) throw fail(`The device cannot apply this layer preset to ${layer.name}${reasons.length ? ` (reason ${reasons.join(', ')})` : ''}: not enough layer resources or an unsupported part.`, 409);
    await client.call('layers/layer-preset/apply', body, { timeoutMs: 8000 });
    return { ...await read(client), appliedLayerPreset: request.presetId };
  }
  if (request.action === 'layerpreset-update') {
    const preset = stored(), general = { ...preset.general };
    if (request.name === undefined && request.color === undefined) throw fail('No layer preset change supplied.');
    if (request.name !== undefined) { general.name = validName(request.name, 'Layer preset name'); if (list.some(p => p !== preset && p.general?.name === general.name)) throw fail('A layer preset with this name already exists.', 409); }
    if (request.color !== undefined) general.labelColor = colour(request.color);
    await client.call('layers/layer-preset/apply-modify', [{ ...preset, general }]).catch(duplicate);
    return verified(() => read(client), next => { const p = next.layerPresets.list.find(x => x.id === preset.layerPresetId); return p && p.name === general.name && p.color === hex(general.labelColor); }, 'the layer preset name or colour');
  }
  if (request.action === 'layerpreset-delete') {
    const preset = stored(), response = await client.call('layers/layer-preset/delete', [{ layerPresetId: preset.layerPresetId }], { method: 'DELETE' });
    if (response.data?.fails?.length) throw fail('The device could not delete this layer preset.', 409);
    return verified(() => read(client), next => !next.layerPresets.list.some(p => p.id === preset.layerPresetId), 'layer preset deletion');
  }
  throw fail('Unsupported layer preset action.');
}

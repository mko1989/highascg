import { fail } from './pixelhue.js';
import { choice, verified, integer } from './studio-common.js';
import { autoTake } from './preset-autotake.js';

// Presets use the documented v2 family (manual §6.2): GET preset, POST preset/create|apply|update-name|delete.
// preset/list-detail returns 404 on P20 V2.0.0 firmware (WO-016).
export async function readPresets(client) {
  const list = [];
  for (let page = 1; page <= 20; page++) {
    let data;
    try { data = (await client.call(`preset?limit=200&page=${page}`)).data; } catch { return null; }
    list.push(...(data?.list || []));
    if (!data?.totalPage || page >= data.totalPage) break;
  }
  return list.filter(p => p?.guid).map(p => ({ guid: p.guid, serial: p.serial, name: p.name || `Preset ${p.serial}`,
    sourceRegion: p.sourceRegion, loadType: p.loadType ?? 1, params: p.params || [],
    screens: (p.screens || []).map(s => s.name).filter(Boolean),
    // Stored layer windows (global) per screen guid: auto-take compares them with PVW before taking (WO-024).
    content: (p.screens || []).map(s => ({ guid: s.guid, layers: (s.layers || []).map(l => ({ serial: l.serial, type: l.type, window: l.window, enable: l.enable })) })) }))
    .sort((a, b) => a.serial - b.serial);
}

// preset_param.xml layer groups a relative preset may carry (WO-024).
export const RELATIVE_PARAMS = ['3-2', '3-3', '3-4', '3-5', '3-6', '3-7', '3-8', '3-9', '3-10', '3-11', '3-12', '3-13'];
// PixelFlow loadScene: keyFrame.enable 0 = execute keyframes (only together with the take effect);
// effect.enable 0 = run the take transition when loading to PGM. Studio used 1/1 before WO-024.
export function applyBody(preset, targetRegion, { keyframes = false, effect = false, time = 0, swap = true } = {}) {
  integer(time, 'Transition duration', 0, 10000);
  return { serial: preset.serial, presetId: preset.guid, targetRegion,
    auxiliary: { keyFrame: { enable: keyframes && effect ? 0 : 1 }, switchEffect: { type: 1, time }, swapEnable: swap ? 1 : 0, effect: { enable: effect ? 0 : 1 } } };
}

const presetName = value => {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > 64 || /[\x00-\x1f]/.test(value)) throw fail('Preset name must contain 1–64 UTF-8 bytes.');
  return value.trim();
};

export async function applyPreset(client, request, state, read, takePayload) {
  const presets = state.presets;
  if (!presets) throw fail('Presets are unavailable on this device.', 409);
  const find = () => { const p = presets.find(item => item.guid === request.guid); if (!p) throw fail('Preset no longer exists. Refresh.', 409); return p; };
  if (request.action === 'preset-load') {
    const preset = find(), targetRegion = choice(request.target, [2, 4], 'preset target');
    await client.call('preset/apply', applyBody(preset, targetRegion, request), { method: 'POST', timeoutMs: 30000 });
    return { ...await read(client), loaded: { guid: preset.guid, target: targetRegion } };
  }
  if (request.action === 'preset-autotake') return autoTake(client, find(), state, request, { read, applyBody, takePayload });
  if (request.action === 'preset-save') {
    const name = presetName(request.name), scene = choice(request.scene, [2, 4], 'preset source');
    const ids = Array.isArray(request.screenIds) ? request.screenIds : [];
    const requested = ids.map(id => state.screens.find(s => s.id === id));
    if (!requested.length || requested.some(s => !s)) throw fail('Choose the screens to save.');
    // The device rejects presets naming a screen with enable 0 ("check screen faild: screen N is not
    // enabled", code 8210). PixelFlow never offers such screens; skip them (WO-018).
    const screens = requested.filter(s => s.enabled), skipped = requested.filter(s => !s.enabled).map(s => s.name);
    if (!screens.length) throw fail(`${skipped.join(', ')} ${skipped.length > 1 ? 'are' : 'is'} disabled on the device, so no preset can be saved from ${skipped.length > 1 ? 'them' : 'it'}. Show an enabled screen.`, 409);
    const raw = (await client.call('layers/list-detail')).data?.list || [];
    const relative = request.relative === true;
    let params = ['3'], pick = () => true;
    if (relative) {
      // Relative (loadType 2): only the chosen layers and parameter groups are stored (PixelFlow PresetAdd).
      params = Array.isArray(request.params) ? [...new Set(request.params)] : [];
      if (!params.length || params.some(p => !RELATIVE_PARAMS.includes(p))) throw fail('Choose the layer settings a relative preset stores.');
      const ids = new Set(Array.isArray(request.layerIds) ? request.layerIds : []);
      if (!ids.size) throw fail('Choose the layers a relative preset stores.');
      pick = l => ids.has(l.layerId);
    }
    const payload = screens.map(screen => ({ guid: screen.guid, layers: raw
      .filter(l => l.layerIdObj?.attachScreenId === screen.id && l.layerIdObj.sceneType === scene && l.serial != null && pick(l))
      .map(l => ({ serial: l.serial, type: l.layerIdObj.type })) })).filter(s => !relative || s.layers.length);
    if (!payload.length) throw fail('None of the chosen layers is on the shown screens.');
    // Slot choice and overwrite (WO-022): the P20 replaces an existing serial on create; PresetCount Max 128.
    const used = new Set(presets.map(p => p.serial)); let serial = 1; while (used.has(serial)) serial++;
    if (request.serial !== undefined) {
      if (!Number.isSafeInteger(request.serial) || request.serial < 1 || request.serial > 128) throw fail('Preset slot must be 1–128.');
      serial = request.serial;
    }
    const occupant = presets.find(p => p.serial === serial);
    if (occupant && request.overwrite !== true) throw fail(`Slot ${serial} holds ${occupant.name}. Confirm the overwrite.`, 409);
    if (presets.some(p => p.name === name && p.serial !== serial)) throw fail(`Another preset is already named ${name}.`, 409);
    await client.call('preset/create', { serial, name, loadType: relative ? 2 : 1, type: 1, sourceRegion: scene,
      switchEffect: { time: 0, type: 0 }, params, screens: payload, interfaces: [] }, { method: 'POST', timeoutMs: 30000 });
    const saved = await verified(() => read(client), next => next.presets?.some(p => p.serial === serial && p.name === name && p.sourceRegion === scene && p.loadType === (relative ? 2 : 1)), 'the preset');
    return skipped.length ? { ...saved, skipped } : saved;
  }
  if (request.action === 'preset-rename') {
    const preset = find(), name = presetName(request.name);
    await client.call('preset/update-name', [{ guid: preset.guid, oldName: preset.name, name }], { method: 'POST' });
    return verified(() => read(client), next => next.presets?.some(p => p.guid === preset.guid && p.name === name), 'the preset name');
  }
  if (request.action === 'preset-delete') {
    const preset = find();
    await client.call('preset/delete', [preset.guid], { method: 'POST' });
    return verified(() => read(client), next => !next.presets?.some(p => p.guid === preset.guid), 'preset deletion');
  }
  throw fail('Unsupported preset action.');
}

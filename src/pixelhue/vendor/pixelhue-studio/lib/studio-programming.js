import { programInputSources } from './program-sources.js';
import { fail } from './pixelhue.js';
import { normaliseScreens } from './studio-screens.js';
import { integer, name, choice, verified } from './studio-common.js';
import { layerRoam, geometry, programmingLayers } from './program-geometry.js';
import { readPresets, applyPreset } from './studio-presets.js';
import { applyGroup } from './layer-groups.js';
import { readBackgrounds, applyBkg, applyLogo } from './bkg-logo.js';
import { readGroupSources, saveGroupSource, deleteGroupSource } from './group-sources.js';
import { effectSupport, applyEffect } from './layer-effects.js';
import { readLayerPresets, applyLayerPresetAction } from './layer-presets.js';
import { fitSourceWindow, fitSourceReplacement, sourceAspectMatches } from './source-aspect.js';

export async function readProgramming(client) {
  const [screenResponse, layerResponse, interfaceResponse, presets, roam, effects, layerPresets] = await Promise.all([
    client.call('screen/list-detail'), client.call('layers/list-detail'), client.call('interface/list-detail'), readPresets(client), layerRoam(client), effectSupport(client), readLayerPresets(client)]);
  const screens = normaliseScreens(screenResponse.data?.list);
  if (!Array.isArray(layerResponse.data?.list) || !Array.isArray(interfaceResponse.data?.list)) throw fail('Programming data was not returned.', 502);
  // Normal (2), AUX (4) and LOGO (32, WO-027) layers are editable program layers; BKG (16) is listed separately.
  const layers = programmingLayers(layerResponse.data.list, screens);
  const sources = programInputSources(client, interfaceResponse.data.list);
  for (const screen of screens) for (const type of [3, 4]) sources.push({ id: screen.id, type, name: `${screen.name} ${type === 3 ? 'PGM' : 'PVW'}`,
    width: screen.width, height: screen.height, connected: true });
  const backgrounds = readBackgrounds(layerResponse.data.list, screens);
  const groupSources = await readGroupSources(client, layers, sources);
  return { session: client.session, device: client.deviceInfo(), screens, layers, sources, presets, roam, backgrounds, groupSources, effects, layerPresets };
}
// Code 8212 "resource not enough": the layer profile has no free capacity for this source/size (WO-023).
function resourceHint(error) {
  if (/resource not enough/i.test(error.message)) throw fail('The device has no free layer resources for this source at this size (limited by the layer profile, e.g. 4 × MAIN + 4 × PIP). Remove a layer, use a smaller layer or a lower-resolution source, or change the layer profile on the Device tab.', 409);
  throw error;
}
function sourcePayload(state, request, screen) {
  const source = state.sources.find(s => s.id === request.id && s.type === request.type);
  if (!source || ([3, 4].includes(source.type) && source.id === screen.id)) throw fail('Choose an input or another screen as the source.');
  return { general: { sourceId: source.id, sourceType: source.type, ...(source.connectorType ? { connectorType: source.connectorType } : {}) },
    primary: { sourceId: source.id, sourceType: source.type } };
}
export const transitionPayload = (screens, action, swapEnable, time) => screens.map(screen => ({ screenId: screen.id, direction: 0, swapEnable,
  ...(action === 'take' ? { effectSelect: 1, screenGuid: screen.guid, switchEffect: { type: 1, time } } : {}) }));
const ASPECT_MODES = [0, 1, 2, 3, 4, 5, 7, 8]; // layer_2.xml AspectRatioType
const KEYFRAME = { enable: [0, 1], speedType: [0, 3], startTime: [0, 999], animationTime: [1, 1000] }; // layer_2.xml KeyFrame
export async function applyProgramming(client, request) {
  const state = await readProgramming(client);
  if (String(request.action).startsWith('preset-')) return applyPreset(client, request, state, readProgramming, transitionPayload);
  if (request.action === 'groupsource-save') { const def = await saveGroupSource(client, request, state.sources); return { ...await readProgramming(client), savedGroupSource: def.id }; }
  if (request.action === 'groupsource-delete') { await deleteGroupSource(client, request.id); return readProgramming(client); }
  if (['take', 'cut'].includes(request.action)) {
    const swapEnable = request.swap === false ? 0 : 1;
    const time = request.time ?? 500; integer(time, 'Transition duration', 0, 10000);
    const ids = Array.isArray(request.screenIds) ? request.screenIds : [request.screenId];
    const requested = ids.map(id => state.screens.find(s => s.id === id));
    if (!requested.length || requested.some(s => !s) || new Set(ids).size !== ids.length) throw fail('Choose current screens.', 409);
    const targets = requested.filter(s => s.enabled); // disabled screens (enable 0) are not switchable, as in PixelFlow
    if (!targets.length) throw fail('The shown screens are disabled on the device. Show an enabled screen.', 409);
    await client.call(`screen/${request.action}`, transitionPayload(targets, request.action, swapEnable, time), { timeoutMs: 20000 });
    return { ...await readProgramming(client), transition: { action: request.action, time } };
  }
  const screen = state.screens.find(s => s.id === request.screenId);
  if (['layerpreset-save', 'layerpreset-update', 'layerpreset-delete'].includes(request.action)) return applyLayerPresetAction(client, request, { state, screen, read: readProgramming });
  if (!screen) throw fail('Choose a current screen.', 409);
  if (request.action === 'pgm-lock') {
    // pgmEdit 0 = PGM editing forbidden. The device stores it but does not enforce it (WO-022), so Studio does.
    const locked = choice(request.locked, [true, false], 'PGM lock');
    await client.call('screen/pgm-edit', [{ screenId: screen.id, pgmEdit: locked ? 0 : 1 }]);
    return verified(() => readProgramming(client), next => next.screens.find(s => s.id === screen.id)?.pgmLocked === locked, 'the PGM lock');
  }
  const pgmTarget = ['create', 'group-create', 'bkg', 'logo'].includes(request.action) ? request.scene === 2 : state.layers.find(l => l.id === request.id && l.screenId === screen.id)?.scene === 2;
  if (pgmTarget && screen.pgmLocked) throw fail(`PGM of ${screen.name} is locked. Unlock it to edit PGM layers.`, 409);
  if (request.action === 'layerpreset-apply') return applyLayerPresetAction(client, request, { state, screen, read: readProgramming });
  if (request.action === 'bkg') return applyBkg(client, request, state, { read: readProgramming, screen });
  if (request.action === 'logo') return applyLogo(client, request, state, { read: readProgramming, screen, geometry });
  if (String(request.action).startsWith('group-')) return applyGroup(client, request, state, { read: readProgramming, screen,
    geometry, resourceHint, create: body => applyProgramming(client, body) });
  if (request.action === 'create') {
    const scene = choice(request.scene, [2, 4], 'programming scene');
    const source = sourcePayload(state, request.source || {}, screen);
    const sourceInfo = state.sources.find(s => s.type === request.source.type && s.id === request.source.id);
    const window = geometry(fitSourceWindow(request.window || { x: 0, y: 0, width: Math.min(640, screen.width), height: Math.min(360, screen.height) }, sourceInfo), screen, state.roam);
    const layerName = name(request.name || 'Layer', 'Layer name');
    await client.call('layers/create', { layerIdObj: { attachScreenId: screen.id, attachScreenType: 0, screenGuid: screen.guid,
      sceneType: scene, type: screen.type === 4 ? 4 : 2 },
      general: { name: layerName }, namePrefix: layerName + ' ', source, window, enable: 1,
      // WO-023: new layers keep the source's own ratio (OriginalRatio 8) and are locked until unlocked.
      locked: 1, aspectRatio: { aspectRatio: 8, locked: 1 } }, { timeoutMs: 80000 }).catch(resourceHint);
    return verified(() => readProgramming(client), next => next.layers.some(l => l.screenId === screen.id && l.scene === scene && !state.layers.some(old => old.id === l.id) && sourceAspectMatches(l, sourceInfo)), 'the new layer and source aspect lock');
  }
  const layer = state.layers.find(l => l.id === request.id && l.screenId === screen.id);
  if (!layer) throw fail('Programming layer no longer exists. Refresh.', 409);
  if (request.action === 'window') {
    const window = geometry(request.window, screen, state.roam);
    await client.call('layers/window', [{ layerId: layer.id, window }]);
    return verified(() => readProgramming(client), next => {
      const actual = next.layers.find(l => l.id === layer.id)?.window;
      return actual && ['x', 'y', 'width', 'height'].every(key => actual[key] === request.window[key]);
    }, 'the layer position');
  }
  if (request.action === 'source') {
    const source = sourcePayload(state, request.source || {}, screen);
    const sourceInfo = state.sources.find(s => s.type === request.source.type && s.id === request.source.id);
    const local = fitSourceReplacement(layer.window, sourceInfo), fitted = geometry(local, screen, state.roam);
    // Neutralize an old Original lock so routing cannot expand the old rectangle.
    await client.call('layers/aspect-ratio', [{ layerId: layer.id, aspectRatio: 5, locked: 1 }]);
    await client.call('layers/source', [{ layerId: layer.id, source }]).catch(resourceHint);
    await client.call('layers/window', [{ layerId: layer.id, window: fitted }]).catch(resourceHint);
    await client.call('layers/aspect-ratio', [{ layerId: layer.id, aspectRatio: 8, locked: 1 }]);
    return verified(() => readProgramming(client), next => next.layers.some(l => l.id === layer.id && l.sourceId === request.source.id && l.sourceType === request.source.type && sourceAspectMatches(l, sourceInfo) && ['x', 'y', 'width', 'height'].every(key => l.window[key] === local[key])), 'the layer source, fitted position/size and aspect lock');
  }
  if (request.action === 'aspect') {
    const locked = choice(request.locked ?? true, [true, false], 'aspect lock');
    // Locking defaults to OriginalRatio (8): the device refits the window to the source ratio (seen live, WO-023).
    // A preset ratio (WO-024) is applied with the lock on, as PixelFlow's aspect select does.
    const mode = request.mode === undefined ? (locked ? 8 : layer.aspectMode) : choice(request.mode, ASPECT_MODES, 'aspect ratio');
    // Optional window: resize to the chosen ratio first, in the same request (one UI action, WO-024).
    if (request.window) await client.call('layers/window', [{ layerId: layer.id, window: geometry(request.window, screen, state.roam) }]);
    await client.call('layers/aspect-ratio', [{ layerId: layer.id, aspectRatio: mode, locked: locked ? 1 : 0 }]);
    return verified(() => readProgramming(client), next => { const l = next.layers.find(x => x.id === layer.id); return l?.aspectLocked === locked && l.aspectMode === mode; }, 'the aspect ratio');
  }
  if (request.action === 'keyframe') {
    const changes = request.keyFrame || {};
    if (!Object.keys(changes).length || Object.keys(changes).some(key => !KEYFRAME[key])) throw fail('Unsupported keyframe setting.');
    for (const [key, value] of Object.entries(changes)) integer(value, `Keyframe ${key}`, ...KEYFRAME[key]);
    const keyFrame = { ...layer.keyFrame, ...changes };
    await client.call('layers/key-frame', [{ layerId: layer.id, keyFrame }]);
    return verified(() => readProgramming(client), next => Object.entries(changes).every(([key, value]) => next.layers.find(l => l.id === layer.id)?.keyFrame[key] === value), 'the keyframe settings');
  }
  if (request.action === 'copy') {
    // PixelFlow layerCopyHandle/handleCopyParams: PUT layers/copy [{ layerId, flipType, window, namePrefix }].
    // Mirror = PixelFlow's copy (opposite side of the screen, flipped horizontally); otherwise a plain duplicate, offset so it is visible.
    const mirror = choice(request.mirror ?? false, [true, false], 'copy mode'), list = (await client.call('layers/list-detail')).data?.list || [];
    const raw = list.find(l => l.layerId === layer.id); if (!raw) throw fail('Programming layer no longer exists. Refresh.', 409);
    const local = mirror ? { ...layer.window, x: screen.width - layer.window.width - layer.window.x } : { ...layer.window, x: layer.window.x + 40, y: layer.window.y + 40 };
    const window = geometry(local, screen, state.roam), item = { layerId: layer.id, flipType: (raw.general?.flipType ?? 0) ^ (mirror ? 1 : 0), window, namePrefix: 'Layer ' };
    const cut = list.find(l => raw.cutId && l.layerId === raw.cutId), relative = cut?.cutFill?.relative, body = [item];
    // A Cut & Fill layer is copied together with its cut layer, placed by its relative rectangle (handleCutLayerPosition).
    if (cut && relative) body.push({ ...item, layerId: cut.layerId, window: { x: Math.round(window.width * relative.x / 100) + window.x, y: Math.round(window.height * relative.y / 100) + window.y,
      width: Math.max(Math.round(window.width * relative.width / 100), 64), height: Math.max(Math.round(window.height * relative.height / 100), 64) } });
    await client.call('layers/copy', body, { timeoutMs: 80000 }).catch(resourceHint);
    return verified(() => readProgramming(client), next => next.layers.some(l => l.screenId === screen.id && l.scene === layer.scene && !state.layers.some(old => old.id === l.id) && ['x', 'y', 'width', 'height'].every(key => l.window[key] === local[key])), 'the copied layer');
  }
  if (request.action === 'effect') return applyEffect(client, layer, request.effect, readProgramming);
  if (request.action === 'delete') {
    await client.call('layers', [{ layerId: layer.id, sn: client.serial }], { method: 'DELETE' });
    return verified(() => readProgramming(client), next => !next.layers.some(l => l.id === layer.id), 'layer deletion');
  }
  if (request.action === 'zorder') {
    const para = choice(request.to, [1, 2, 3, 4], 'stack order');
    await client.call('layers/zorder', [{ layerId: layer.id, zorder: { type: 1, para } }]);
    return readProgramming(client);
  }
  throw fail('Unsupported programming action.');
}

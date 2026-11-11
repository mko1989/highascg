import { randomUUID } from 'node:crypto';
import { fail } from './pixelhue.js';
import { overlaps, windowLimit, withinLimit } from '../public/mvr-geometry.js';
import { fitMvrSource, finishMvrDrop } from './mvr-drop.js';
import { umdHeight } from './mvr-umd.js';

// MVR window structure (WO-020): contracts from PixelFlow src/pages/mvr/presenter/sourceListPresenter
// (handleDragEnd.ts, utils.ts buildMVRLayerParams). One window per source unless layer_8.xml
// advertises SameSourceCountLimit (not on P20 V2.0.0).
export function mvrSources(screens, interfaces, layers, model, umdConfig) {
  const used = new Map(), mvrIds = new Set(screens.filter(s => s.screenIdObj?.type === 8).map(s => s.screenId));
  for (const l of layers) if (mvrIds.has(l.layerIdObj?.attachScreenId)) used.set(`${l.source?.general?.sourceType}:${l.source?.general?.sourceId}`, l.layerId);
  const inputs = interfaces.filter(i => i.auxiliaryInfo?.connectorInfo?.interfaceType === 2 && i.auxiliaryInfo.connectorInfo.workMode !== 2)
    .map(i => ({ type: 2, id: i.interfaceId, name: i.general?.name || `Input ${i.interfaceId}`,
      width: i.actualTiming?.horizontal?.addTime || null, height: i.actualTiming?.vertical?.addTime || null }));
  // PixelFlow hides Main screens with enable 0 (WO-018/019); those cannot be MVR sources either.
  // Owner-verified on hardware (2026-11-09): P10/P20 cannot show AUX screens in the MVR; attempts fail (WO-021).
  const types = ['P10', 'P20'].includes(model) ? [2] : [2, 4];
  const outputs = screens.filter(s => types.includes(s.screenIdObj?.type) && !(s.screenIdObj.type === 2 && s.enable === 0))
    .flatMap(s => [3, 4].map(type => ({ type, id: s.screenId, name: `${s.general?.name || `Screen ${s.screenId}`} ${type === 3 ? 'PGM' : 'PVW'}`,
      width: s.mosaic?.window?.width || null, height: s.mosaic?.window?.height || null })));
  return [...outputs, ...inputs].map(s => ({ ...s, umdHeight: umdConfig?.bySourceType?.[s.type] ?? umdConfig?.height ?? null, usedBy: used.get(`${s.type}:${s.id}`) ?? null }));
}

function window(value, screen) {
  const w = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, value?.[key]]));
  if (!Object.values(w).every(Number.isSafeInteger) || w.x < 0 || w.y < 0 || w.width < 64 || w.height < 64 ||
    w.x + w.width > screen.width || w.y + w.height > screen.height) throw fail(`MVR windows must fit within ${screen.width} × ${screen.height}, minimum 64 × 64.`);
  return w;
}

export async function applyMvrLayer(client, request) {
  if (!['P20', 'Q8'].includes(client.model)) throw fail('Multiviewer editing is available for P20 and Q8.', 403);
  const [screenList, layerList, interfaceList] = await Promise.all([client.call('screen/list-detail'), client.call('layers/list-detail'), client.call('interface/list-detail')]);
  const state = await client.read();
  const screen = state.screens.find(s => s.id === request.screenId);
  if (!screen) throw fail('Choose a current MVR output.', 409);
  const sources = mvrSources(screenList.data?.list || [], interfaceList.data?.list || [], layerList.data?.list || [], client.model, client.umdConfig);
  const mine = state.layers.filter(l => l.screenId === screen.id);
  const pick = (exceptLayer) => {
    const source = sources.find(s => s.type === request.source?.type && s.id === request.source?.id);
    if (!source) throw fail('Choose a current input or screen PGM/PVW.');
    if (source.usedBy && source.usedBy !== exceptLayer) throw fail(`${source.name} is already in the MVR; each source can appear once.`, 409);
    return source;
  };
  if (request.action === 'create') {
    const source = pick(), reserved = window(request.window, screen), limit = windowLimit(client.model, source.type);
    if (!withinLimit(reserved, limit)) throw fail(`Input windows are limited to ${limit.width} × ${limit.height} on ${client.model}.`);
    if (mine.some(l => overlaps(reserved, l.window))) throw fail('MVR windows cannot overlap. Drop the source into empty space.', 409);
    const w = fitMvrSource(reserved, source, source.umdHeight, client.model);
    const guid = (screenList.data.list.find(s => s.screenId === screen.id) || {}).guid;
    await client.call('layers/create', { window: w, locked: 1, aspectRatio: { aspectRatio: source.umdHeight ? 5 : 8, locked: 1 },
      layerIdObj: { type: 8, sceneType: 2, attachScreenType: 0, attachScreenId: screen.id, screenGuid: guid },
      general: { name: `MVR-${source.id}-${randomUUID().slice(0, 8)}` }, namePrefix: 'Layer',
      source: { general: { sourceId: source.id, sourceType: source.type }, primary: { sourceId: source.id, sourceType: source.type } } }, { timeoutMs: 30000 });
    const next = await verify(client, next => next.layers.find(l => l.screenId === screen.id && !mine.some(o => o.id === l.id) && l.sourceId === source.id && l.sourceType === source.type), 'the new MVR window');
    return finishMvrDrop(client, next, next.changedId, source, w, verify);
  }
  const layer = mine.find(l => l.id === request.layerId);
  if (!layer) throw fail('MVR window no longer exists. Refresh.', 409);
  if (request.action === 'source') {
    const source = pick(layer.id), raw = layerList.data.list.find(l => l.layerId === layer.id);
    const offset = umdHeight({ ...raw, source: { general: { sourceType: source.type } } }, client.umdConfig);
    const w = fitMvrSource(layer.window, source, offset, client.model, true);
    // Custom protects the reserved rectangle from an old Original lock refitting during the swap.
    await client.call('layers/aspect-ratio', [{ layerId: layer.id, aspectRatio: 5, locked: 1 }]);
    if (JSON.stringify(w) !== JSON.stringify(layer.window)) await client.call('layers/window', [{ layerId: layer.id, window: w }]);
    await client.call('layers/source', [{ layerId: layer.id, source: { general: { sourceId: source.id, sourceType: source.type } } }]);
    const next = await verify(client, next => next.layers.find(l => l.id === layer.id && l.sourceId === source.id && l.sourceType === source.type), 'the MVR window source');
    return finishMvrDrop(client, next, layer.id, source, layer.window, verify, true);
  }
  if (request.action === 'delete') {
    await client.call('layers', [{ layerId: layer.id, sn: client.serial }], { method: 'DELETE' });
    return verify(client, next => !next.layers.some(l => l.id === layer.id), 'MVR window deletion');
  }
  throw fail('Unsupported MVR action.');
}

async function verify(client, matches, label) {
  let state;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 200));
    state = await client.read();
    const hit = matches(state);
    if (hit) return { ...state, changedId: typeof hit === 'object' ? hit.id : null };
  }
  throw Object.assign(fail(`The device did not retain ${label}. Refresh to inspect the MVR.`, 409), { snapshot: state });
}

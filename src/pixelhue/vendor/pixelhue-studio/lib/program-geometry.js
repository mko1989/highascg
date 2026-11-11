import { fail } from './pixelhue.js';
import { normaliseScreens } from './studio-screens.js';
import { integer, batch, verified } from './studio-common.js';
import { configuration, xmlFile } from './configuration.js';
import { groupOf, splitWindow } from '../public/group-geometry.js';
import { effectValues } from './layer-effects.js';

// layer_2.xml <Window Roam="0">: 0 = layers may roam anywhere (PixelFlow behaviour), 1 = inside the screen only.
export async function layerRoam(client) {
  await configuration(client);
  return xmlFile(client.configurationXml, 'deviceconfig/device/layer_2.xml').match(/<Window\b[^>]*\bRoam="(\d)"/)?.[1] !== '1';
}

export function programmingLayers(raw, screens) {
  if (!Array.isArray(raw)) throw fail('Programming layers were not returned.', 502);
  // A Cut & Fill "fill" layer (type 256) is a normal layer with a linked cut layer (type 128, WO-037); it stays editable.
  return raw.filter(l => [2, 4, 32, 256].includes(l.layerIdObj?.type) && screens.some(s => s.id === l.layerIdObj.attachScreenId))
    .map(l => {
      const screen = screens.find(s => s.id === l.layerIdObj.attachScreenId);
      return { id: l.layerId, screenId: screen.id, scene: l.layerIdObj.sceneType, type: l.layerIdObj.type === 256 ? 2 : l.layerIdObj.type,
        name: l.general?.name || `Layer ${l.serial ?? l.layerId}`, sourceType: l.source?.general?.sourceType,
        sourceId: l.source?.general?.sourceId, sourceName: l.source?.general?.sourceName || '',
        window: { ...l.window, x: l.window.x - screen.x, y: l.window.y - screen.y },
        zorder: l.zorder ?? 0, enabled: l.enable !== 0,
        aspectLocked: l.aspectRatio?.locked === 1 || l.aspectRatio?.locked === true, aspectMode: l.aspectRatio?.aspectRatio ?? 5,
        serial: l.serial ?? null, keyFrame: { enable: 0, speedType: 3, startTime: 0, animationTime: 1000, ...(l.keyFrame || {}) }, fx: effectValues(l, raw.find(c => l.cutId && c.layerId === l.cutId)) };
    });
}

// Device limits from layer_2.xml: X/Y ±500000 (global), width/height 64–131070.
export function geometry(window, screen, roam) {
  if (!window) throw fail('Layer dimensions required.');
  if (!roam) {
    integer(window.x, 'Layer X', 0, screen.width - 64); integer(window.y, 'Layer Y', 0, screen.height - 64);
    integer(window.width, 'Layer width', 64, screen.width - window.x); integer(window.height, 'Layer height', 64, screen.height - window.y);
  } else {
    integer(window.width, 'Layer width', 64, 131070); integer(window.height, 'Layer height', 64, 131070);
    integer(window.x + screen.x, 'Layer X', -500000, 500000); integer(window.y + screen.y, 'Layer Y', -500000, 500000);
  }
  return { width: window.width, height: window.height, x: window.x + screen.x, y: window.y + screen.y };
}

// Geometry-only requests do not load inputs, presets, backgrounds or stored group definitions.
export async function readProgramGeometry(client) {
  const [screenResponse, layerResponse, roam] = await Promise.all([
    client.call('screen/list-detail'), client.call('layers/list-detail'), layerRoam(client)]);
  const screens = normaliseScreens(screenResponse.data?.list);
  return { session: client.session, screens, layers: programmingLayers(layerResponse.data?.list, screens), roam };
}
export async function applyProgramGeometry(client, request) {
  const changes = batch(request.changes, 128), state = await readProgramGeometry(client), plan = new Map();
  const add = (layer, window, screen) => {
    if (plan.has(layer.id)) throw fail('Duplicate layer geometry in one update.');
    plan.set(layer.id, { layer, window: geometry(window, screen, state.roam), local: window, screen });
  };
  for (const change of changes) {
    if (!change || !['window', 'group-window'].includes(change.action)) throw fail('Supply layer position/size changes.');
    const screen = state.screens.find(s => s.id === change.screenId);
    const layer = state.layers.find(l => l.id === change.id && l.screenId === change.screenId);
    if (!screen || !layer) throw fail('Programming layer no longer exists. Refresh.', 409);
    if (layer.scene === 2 && screen.pgmLocked) throw fail(`PGM of ${screen.name} is locked. Unlock it to edit PGM layers.`, 409);
    geometry(change.window, screen, state.roam);
    if (change.action === 'window') add(layer, change.window, screen);
    else {
      const group = groupOf(state.layers, layer);
      if (!group) throw fail('This layer is not part of a complete group. Refresh.', 409);
      const share = group.orient === 'H' ? group.a.window.width / (group.a.window.width + group.b.window.width)
        : group.a.window.height / (group.a.window.height + group.b.window.height);
      const [a, b] = splitWindow(change.window, group.orient, share);
      add(group.a, a, screen); add(group.b, b, screen);
    }
  }
  await client.call('layers/window', [...plan].map(([layerId, { window }]) => ({ layerId, window })));
  return verified(async () => {
    const response = await client.call('layers/list-detail');
    return { session: client.session, layers: programmingLayers(response.data?.list, state.screens).filter(l => plan.has(l.id)) };
  }, next => [...plan].every(([id, { local }]) => {
    const actual = next.layers.find(l => l.id === id)?.window;
    return actual && ['x', 'y', 'width', 'height'].every(key => actual[key] === local[key]);
  }), 'the layer position');
}

import { fail } from './pixelhue.js';
import { choice, verified, integer } from './studio-common.js';
import { readGallery, PICTURE } from './gallery.js';
import { fitSourceWindow } from './source-aspect.js';

// Backgrounds and logos (WO-027). Each screen scene has one BKG layer (type 16); PixelFlow sets its source
// to a gallery picture with layers/source {sourceType 5} and switches it on/off. A LOGO layer (type 32) is
// created per scene with sourceType 6; an existing logo in that scene is replaced (layerCreateHandle.ts:140).
export function readBackgrounds(raw, screens) {
  return raw.filter(l => l.layerIdObj?.type === 16 && screens.some(s => s.id === l.layerIdObj.attachScreenId)).map(l => ({
    screenId: l.layerIdObj.attachScreenId, scene: l.layerIdObj.sceneType, layerId: l.layerId, enabled: l.enable === 1,
    pictureId: l.source?.general?.sourceType === 5 ? l.source.general.sourceId : null, name: l.source?.general?.sourceName || '',
    aspectLocked: l.aspectRatio?.locked === 1 || l.aspectRatio?.locked === true, aspectMode: l.aspectRatio?.aspectRatio ?? 5 }));
}

// Device route for the layer on/off switch. PixelFlow calls /ucenter/layers/switch (desktop service); its
// commented-out device call is layers/switch with the same body.
const SWITCH = 'layers/switch';

export async function applyBkg(client, request, state, { read, screen }) {
  const scene = choice(request.scene, [2, 4], 'background scene');
  const raw = (await client.call('layers/list-detail')).data?.list || [];
  const bkg = raw.find(l => l.layerIdObj?.type === 16 && l.layerIdObj.attachScreenId === screen.id && l.layerIdObj.sceneType === scene);
  if (!bkg) throw fail(`${screen.name} has no background layer in ${scene === 2 ? 'PGM' : 'PVW'}.`, 409);
  const enable = choice(request.enable ?? true, [true, false], 'background switch');
  if (request.pictureId !== undefined && request.pictureId !== null) {
    const picture = (await readGallery(client)).pictures.find(p => p.id === request.pictureId && p.type === PICTURE.BKG);
    if (!picture) throw fail('Choose a background picture from the gallery.', 409);
    await client.call('layers/source', [{ layerId: bkg.layerId, source: { general: { sourceId: picture.id, sourceType: 5 } } }]);
    await client.call('layers/aspect-ratio', [{ layerId: bkg.layerId, aspectRatio: 8, locked: 1 }]);
  } else if (enable && bkg.source?.general?.sourceType !== 5) throw fail('Choose a background picture first.');
  await client.call(SWITCH, [{ layerId: bkg.layerId, enable: enable ? 1 : 0, sn: client.serial }]);
  return verified(() => read(client), next => {
    const b = next.backgrounds.find(x => x.layerId === bkg.layerId);
    return b && b.enabled === enable && (request.pictureId == null || (b.pictureId === request.pictureId && b.aspectLocked && b.aspectMode === 8));
  }, 'the background');
}

export async function applyLogo(client, request, state, { read, screen, geometry }) {
  const scene = choice(request.scene, [2, 4], 'logo scene');
  const picture = (await readGallery(client)).pictures.find(p => p.id === request.pictureId && p.type === PICTURE.LOGO);
  if (!picture) throw fail('Choose a logo from the gallery.', 409);
  const width = picture.width || 256, height = picture.height || 256;
  const at = request.point || { x: screen.width / 2, y: screen.height / 2 };
  integer(Math.round(at.x), 'Logo X', -500000, 500000); integer(Math.round(at.y), 'Logo Y', -500000, 500000);
  const window = geometry(fitSourceWindow({ x: Math.round(at.x - width / 2), y: Math.round(at.y - height / 2), width: Math.max(64, width), height: Math.max(64, height) }, picture), screen, state.roam);
  const raw = (await client.call('layers/list-detail')).data?.list || [];
  const old = raw.filter(l => l.layerIdObj?.type === 32 && l.layerIdObj.attachScreenId === screen.id && l.layerIdObj.sceneType === scene);
  if (old.length) await client.call('layers', old.map(l => ({ layerId: l.layerId, sn: client.serial })), { method: 'DELETE' });
  const source = { general: { sourceId: picture.id, sourceType: 6 }, primary: { sourceId: picture.id, sourceType: 6 } };
  await client.call('layers/create', { layerIdObj: { attachScreenId: screen.id, attachScreenType: 0, screenGuid: screen.guid, sceneType: scene, type: 32 },
    general: { name: 'Logo' }, namePrefix: 'Logo ', source, window, enable: 1, locked: 1, aspectRatio: { aspectRatio: 8, locked: 1 } }, { timeoutMs: 80000 });
  return verified(() => read(client), next => next.layers.some(l => l.screenId === screen.id && l.scene === scene && l.type === 32 && l.sourceId === picture.id), 'the logo');
}

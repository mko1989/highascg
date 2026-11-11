import { fail } from './pixelhue.js';
import { readGallery } from './gallery.js';

// Gallery management (WO-037): delete, rename and capture. PixelFlow api/picture/picture.ts, GallerySourceListPanel.tsx
// and editor1/components/CaptureModal. Progress status: 1 ongoing, 2 complete, 255 failure.
const COMPLETE = 2, FAILED = 255;
const pictureName = value => { if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > 64 || /[\x00-\x1f]/.test(value)) throw fail('Picture name must contain 1–64 UTF-8 bytes.'); return value.trim(); };
export async function manageGallery(client, body) {
  const gallery = await readGallery(client), find = id => { const picture = gallery.pictures.find(p => p.id === id); if (!picture) throw fail('Picture is no longer in the gallery. Refresh.', 409); return picture; };
  if (body.action === 'delete') {
    if (!Array.isArray(body.ids) || !body.ids.length || new Set(body.ids).size !== body.ids.length) throw fail('Choose pictures to delete.');
    const pictures = body.ids.map(find), inUse = pictures.filter(p => p.used);
    if (inUse.length) throw fail(`${inUse.map(p => p.name).join(', ')} ${inUse.length === 1 ? 'is' : 'are'} in use on a screen. Remove it there first.`, 409);
    const response = await client.call('picture', { pictureIds: body.ids }, { method: 'DELETE', timeoutMs: 20000 });
    // The device answers with the ids it could not delete.
    const failed = Array.isArray(response.data) ? response.data : [];
    const next = await readGallery(client), left = body.ids.filter(id => failed.includes(id) || next.pictures.some(p => p.id === id));
    if (left.length) throw Object.assign(fail(`The device did not delete ${pictures.filter(p => left.includes(p.id)).map(p => p.name).join(', ')}.`, 409), { snapshot: next });
    return next;
  }
  if (body.action === 'rename') {
    const picture = find(body.id), name = pictureName(body.name);
    await client.call('picture/general', { pictureId: picture.id, name });
    const next = await readGallery(client);
    if (next.pictures.find(p => p.id === picture.id)?.name !== name) throw fail('The device did not retain the picture name. Refresh to inspect the gallery.', 409);
    return next;
  }
  if (body.action === 'capture') {
    if (!gallery.support.bkg) throw fail('This device does not store captured pictures.', 403);
    const source = body.source === 'pgm' ? { type: 0, id: body.id } : body.source === 'input' ? { type: 1, id: body.id } : null;
    if (!source || !Number.isSafeInteger(source.id)) throw fail('Choose a screen PGM or an input to capture.');
    const name = pictureName(body.name);
    if (gallery.pictures.some(p => p.name === name)) throw fail('A picture with this name already exists.', 409);
    const node = await client.call('node/detail?nodeId=1');
    if (node.data?.status !== undefined && node.data.status !== 1) throw fail('The device is busy. Capture when it is idle.', 409);
    const captured = await client.call('picture/capture', { source }, { method: 'POST', timeoutMs: 20000 }), pictureId = captured.data?.pictureId;
    if (!Number.isSafeInteger(pictureId)) throw fail('The device did not return the captured picture.', 502);
    const interval = client.capturePollMs ?? 500; let done = false;
    for (let attempt = 0; attempt < 120 && !done; attempt++) {
      await new Promise(resolve => setTimeout(resolve, interval));
      const response = await client.call('picture/progress'), progress = response.data?.pictureProgress ?? response.data ?? {};
      if (progress.status === FAILED) { await client.call('picture', { pictureIds: [pictureId] }, { method: 'DELETE' }).catch(() => {}); throw fail('The device could not capture this source.', 502); }
      done = progress.status === COMPLETE || progress.status === 0; // complete, or already back to idle
    }
    if (!done) throw fail('The capture did not finish within 60 s. Refresh the gallery to check.', 504);
    await client.call('picture/capture/save', { pictureId, name, type: 1 }, { timeoutMs: 60000 });
    for (let attempt = 0; attempt < 60; attempt++) {
      const next = await readGallery(client), saved = next.pictures.find(p => p.id === pictureId || (p.name === name && !gallery.pictures.some(old => old.id === p.id)));
      if (saved) return { ...next, captured: saved };
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw fail('The capture was saved but did not appear in the gallery. Refresh to check.', 504);
  }
  throw fail('Unsupported gallery action.');
}

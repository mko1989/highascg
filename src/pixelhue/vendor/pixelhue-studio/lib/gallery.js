import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { fail } from './pixelhue.js';
import { configuration, xmlFile } from './configuration.js';
import { integer } from './studio-common.js';

// Device gallery (WO-027): BKG (type 1) and LOGO (type 2) pictures, upload and thumbnails.
// Contracts: PixelFlow src/api/picture/picture.ts and gallery-source-list-panel/gallery.ts; live P20 probes.
export const PICTURE = { BKG: 1, LOGO: 2 };

export async function gallerySupport(client) {
  await configuration(client);
  const feature = xmlFile(client.configurationXml, 'deviceconfig/device/feature.xml');
  const pictures = feature.match(/<Pictures\b[^>]*Support="1"[\s\S]*?<\/Pictures>/)?.[0] || '';
  const type = t => { const m = pictures.match(new RegExp(`<Picture type="${t}" Support="1">[\\s\\S]*?<Width[^>]*Max="(\\d+)"[\\s\\S]*?<Height[^>]*Max="(\\d+)"`)); return m ? { maxWidth: Number(m[1]), maxHeight: Number(m[2]) } : null; };
  return { bkg: type(1), logo: type(2) };
}

const normalise = p => ({ id: p.pictureId, type: p.pictureObj?.type, name: p.general?.name || `Picture ${p.pictureId}`,
  width: p.general?.width || null, height: p.general?.height || null, used: p.isUsed === 1,
  thumb: (p.path || []).find(x => x.type === 0)?.url || null });

export async function readGallery(client) {
  const support = await gallerySupport(client);
  const list = async type => { try { return ((await client.call(`picture/list?type=${type}`)).data?.list || []).map(normalise); } catch { return []; } };
  const [bkg, logo, capacity] = await Promise.all([support.bkg ? list(1) : [], support.logo ? list(2) : [], client.call('picture/capacity').then(r => r.data).catch(() => null)]);
  return { session: client.session, support, pictures: [...bkg, ...logo], capacity };
}

// multipart/form-data body for PUT picture/import (fields pictureFile + description).
export function multipart(fields, file, fileField = 'pictureFile') {
  const boundary = `----pixelhue${randomUUID().replace(/-/g, '')}`, parts = [];
  for (const [name, value] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${file.filename.replace(/["\r\n]/g, '_')}"\r\nContent-Type: ${file.mime}\r\n\r\n`), file.buffer, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

const MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/bmp': 'bmp' };
export async function uploadPicture(client, { type, name, width, height, mime, buffer }) {
  const support = await gallerySupport(client), kind = type === PICTURE.LOGO ? support.logo : type === PICTURE.BKG ? support.bkg : null;
  if (!kind) throw fail('This device does not accept that picture type.', 409);
  if (!MIME[mime]) throw fail('Upload a PNG, JPEG or BMP image.', 415);
  if (typeof name !== 'string' || !name.trim() || Buffer.byteLength(name, 'utf8') > 64) throw fail('Picture name must contain 1–64 UTF-8 bytes.');
  integer(width, 'Picture width', 1, 16384); integer(height, 'Picture height', 1, 16384);
  if (!buffer?.length) throw fail('The file is empty.');
  const before = new Set((await readGallery(client)).pictures.map(p => p.id));
  // LOGO dimensions are clamped to the advertised maximum (PixelFlow gallery.ts, logoSizeMax).
  const description = { type: 1, pictureObj: { type }, general: { name: name.trim(), width: Math.min(width, kind.maxWidth), height: Math.min(height, kind.maxHeight) } };
  const { body, contentType } = multipart({ description: JSON.stringify(description) }, { filename: `${name.trim()}.${MIME[mime]}`, mime, buffer });
  await client.call('picture/import', body, { method: 'PUT', contentType, timeoutMs: 300000 });
  for (let i = 0; i < 120; i++) { // the device converts the picture after the upload
    const gallery = await readGallery(client), added = gallery.pictures.find(p => !before.has(p.id) && p.type === type);
    if (added) return { ...gallery, uploaded: added };
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw fail('The upload finished but the picture did not appear in the gallery within 60 s. Refresh to check.', 504);
}

// Stream a gallery thumbnail from the device web root (e.g. /picture/bkg/<file>.jpg).
export async function streamThumb(client, id, response) {
  const picture = (await readGallery(client)).pictures.find(p => p.id === id);
  if (!picture?.thumb || !/^\/picture\/[\w/.-]+$/.test(picture.thumb)) throw fail('Thumbnail not found.', 404);
  await new Promise((resolve, reject) => {
    const req = http.get({ host: client.host, port: client.port, path: picture.thumb, headers: { Authorization: client.token }, timeout: 15000 }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(fail(`Device HTTP ${res.statusCode} for the thumbnail.`, 502)); return; }
      response.writeHead(200, { 'Content-Type': res.headers['content-type'] || 'image/jpeg', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
      res.pipe(response); res.on('end', resolve); res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(fail('Thumbnail request timed out.', 504)));
    req.on('error', reject);
  });
}

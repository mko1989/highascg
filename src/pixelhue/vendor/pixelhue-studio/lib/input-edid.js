import http from 'node:http';
import { fail } from './pixelhue.js';
import { integer, choice, verified } from './studio-common.js';
import { multipart } from './gallery.js';
import { supportsEdid } from './input-models.js';

// Detailed input timing and EDID files (WO-037). PixelFlow: PUT interface/preset-timing [{ interfaceId, presetTiming }],
// PUT interface/edid-file (multipart: interfaceIds + file), GET interface/edid-file?interfaceId=&respondsType=0.
const AXES = ['horizontal', 'vertical'];
export function detailedTiming(raw) {
  const t = raw.presetTiming;
  if (!supportsEdid(raw.auxiliaryInfo?.connectorInfo?.type) || !t?.horizontal || !t.vertical) return null;
  const axis = a => ({ active: a.addTime, front: a.frontPorch, sync: a.sync, total: a.totalTime, polarity: a.syncPolarity });
  return { refresh: t.refresh, horizontal: axis(t.horizontal), vertical: axis(t.vertical) };
}
function input(raw, id) {
  const port = raw.find(i => i.interfaceId === id && i.auxiliaryInfo?.connectorInfo?.interfaceType === 2);
  if (!port || !supportsEdid(port.auxiliaryInfo.connectorInfo.type)) throw fail('Choose a current HDMI or DisplayPort input.', 409);
  return port;
}
export async function applyInputTiming(client, body, read) {
  const raw = (await client.call('interface/list-detail')).data?.list || [], port = input(raw, body.id), t = body.timing;
  if (!port.presetTiming) throw fail('This input does not report a detailed timing.');
  if (!t || typeof t !== 'object') throw fail('Supply the detailed timing.');
  if (!Number.isFinite(t.refresh) || t.refresh < 1 || t.refresh > 240 || Math.abs(t.refresh * 100 - Math.round(t.refresh * 100)) > 1e-6) throw fail('Refresh rate must be 1–240 Hz with at most two decimals.');
  const presetTiming = { interlaced: 0, refresh: t.refresh, standardType: 0, edidName: port.presetTiming.edidName ?? '' };
  for (const name of AXES) {
    const a = t[name], label = name === 'horizontal' ? 'Horizontal' : 'Vertical';
    if (!a || typeof a !== 'object') throw fail(`${label} timing is required.`);
    integer(a.active, `${label} active`, 64, 16384); integer(a.front, `${label} front porch`, 0, 8192); integer(a.sync, `${label} sync`, 1, 8192);
    integer(a.total, `${label} total`, a.active + a.front + a.sync, 32768); // back porch = total − active − front − sync, never negative
    presetTiming[name] = { totalTime: a.total, addTime: a.active, frontPorch: a.front, sync: a.sync, syncPolarity: choice(a.polarity, [0, 1], `${label.toLowerCase()} sync polarity`) };
  }
  await client.call('interface/preset-timing', [{ interfaceId: port.interfaceId, presetTiming }], { timeoutMs: 20000 });
  return verified(() => read(client), next => { const actual = next.inputs.find(i => i.id === port.interfaceId)?.timing;
    return actual && Math.abs(actual.refresh - t.refresh) < 0.006 && AXES.every(name => ['active', 'front', 'sync', 'total', 'polarity'].every(key => actual[name][key] === t[name][key])); }, 'the detailed timing');
}
// EDID structure checks (VESA E-EDID): 128-byte blocks, fixed header, per-block checksum, extension count in byte 126.
export function validateEdid(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 128 || buffer.length % 128 || buffer.length > 128 * 256) throw fail('An EDID file is made of 128-byte blocks.', 415);
  if (!buffer.subarray(0, 8).equals(Buffer.from([0, 255, 255, 255, 255, 255, 255, 0]))) throw fail('This file does not start with the EDID header.', 415);
  if (buffer[126] + 1 !== buffer.length / 128) throw fail(`The EDID declares ${buffer[126]} extension block(s) but the file has ${buffer.length / 128 - 1}.`, 415);
  for (let block = 0; block < buffer.length / 128; block++) if (buffer.subarray(block * 128, block * 128 + 128).reduce((sum, byte) => (sum + byte) & 255, 0)) throw fail(`EDID block ${block} has a wrong checksum.`, 415);
  return buffer;
}
export async function importEdid(client, id, buffer, read) {
  const port = input((await client.call('interface/list-detail')).data?.list || [], id); validateEdid(buffer);
  const { body, contentType } = multipart({ interfaceIds: JSON.stringify([{ interfaceId: port.interfaceId }]) }, { filename: 'edid.bin', mime: 'application/octet-stream', buffer }, 'file');
  await client.call('interface/edid-file', body, { method: 'PUT', contentType, timeoutMs: 60000 });
  return { ...await read(client), importedEdid: port.interfaceId };
}
export async function exportEdid(client, id, response) {
  const port = input((await client.call('interface/list-detail')).data?.list || [], id);
  const data = await new Promise((resolve, reject) => {
    const req = http.get({ host: client.host, port: client.port, path: `/unico/v1/interface/edid-file?interfaceId=${port.interfaceId}&respondsType=0`, headers: { Authorization: client.token }, timeout: 20000 }, res => {
      const chunks = []; res.on('data', chunk => { chunks.push(chunk); if (chunks.reduce((n, c) => n + c.length, 0) > 1_000_000) req.destroy(fail('Device EDID response is too large.', 502)); });
      res.on('error', reject); res.on('end', () => res.statusCode === 200 ? resolve(Buffer.concat(chunks)) : reject(fail(`Device HTTP ${res.statusCode} for the EDID file.`, 502)));
    });
    req.on('timeout', () => req.destroy(fail('EDID request timed out.', 504))); req.on('error', error => reject(error.status ? error : fail(`Cannot reach the device: ${error.message}`, 502)));
  });
  // A refusal comes back as JSON with a code instead of the binary file.
  if (data[0] === 0x7b) { let message = 'unexpected response'; try { const json = JSON.parse(data.toString('utf8')); message = `${json.message || message} (code ${json.code})`; } catch {} throw fail(`Device refused the EDID export: ${message}.`, 502); }
  validateEdid(data);
  const name = (port.general?.name || `input-${port.interfaceId}`).replace(/[^\w.-]+/g, '_');
  response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}.bin"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(data);
}

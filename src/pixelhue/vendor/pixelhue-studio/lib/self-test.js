import { configuration, child } from './configuration.js';
import { fail } from './pixelhue.js';

// Device self-test (WO-037). PixelFlow deviceList.ts: POST node/selfcheck { nodeId }, results from
// GET node/selfcheck?nodeId=1&checkType=0 (power-on check) | 1 (device test). Node status 10 = self-checking,
// 1 = free (enum/common.ts ENodeStatus); PixelFlow only starts a test on a free device.
const FREE = 1, CHECKING = 10;
const supported = async client => child(await configuration(client), 'DeviceSelfTest')?.attributes.Support === '1';
function results(data, checkType) {
  const parts = (Array.isArray(data?.parts) ? data.parts : []).map(part => {
    const items = (Array.isArray(part.section) ? part.section : []).map(s => ({ type: s.type, index: s.index, name: s.name || `Check ${s.type}`, value: s.value ?? '', ok: s.state === 0 }));
    return { slotId: part.slotId, modelId: part.modelId, items, ok: items.every(i => i.ok) };
  });
  const all = parts.flatMap(p => p.items);
  return { checkType, parts, total: all.length, abnormal: all.filter(i => !i.ok).length };
}
export async function readSelfTest(client, checkType = 0) {
  const base = { session: client.session, device: client.deviceInfo() };
  if (!await supported(client)) return { ...base, supported: false, parts: [], total: 0, abnormal: 0 };
  const response = await client.call(`node/selfcheck?nodeId=1&checkType=${checkType}`);
  return { ...base, supported: true, ...results(response.data, checkType) };
}
export async function runSelfTest(client, body) {
  if (body.action !== 'run') throw fail('Unsupported self-test action.');
  if (!await supported(client)) throw fail('This device does not advertise a self-test.', 403);
  const status = async () => (await client.call('node/detail?nodeId=1')).data?.status;
  if (await status() !== FREE) throw fail('The device is busy. Run the self-test when it is idle.', 409);
  await client.call('node/selfcheck', { nodeId: 1 }, { method: 'POST', timeoutMs: 5000 });
  const interval = client.selfTestPollMs ?? 1000;
  for (let attempt = 0; attempt < 90; attempt++) {
    await new Promise(resolve => setTimeout(resolve, interval));
    if (await status() !== CHECKING) return { ...await readSelfTest(client, 1), ran: true };
  }
  throw fail('The self-test did not finish within 90 seconds. Refresh the Device tab to read its result.', 504);
}

import { fail } from './pixelhue.js';
import { readOutputs } from './studio-outputs.js';
import { verified } from './studio-common.js';
const over = data => Array.isArray(data) ? data.some(over) : data && typeof data === 'object' ?
  (typeof data.state === 'number' && data.state !== 0) || Object.values(data).some(v => typeof v === 'object' && over(v)) : false;
export async function applyOutputCapacity(client, body) {
  if (Object.keys(body).some(k => !['session', 'slotId', 'capacity', 'confirmReset'].includes(k))) throw fail('Unsupported output capacity action.');
  const state = await readOutputs(client, true), group = state.capacityGroups.find(g => g.slotId === body.slotId);
  const option = group?.options.find(o => o.value === body.capacity);
  if (!option) throw fail('This installed output card/working mode does not support that capacity.', 409);
  if (group.capacity === body.capacity) return readOutputs(client);
  if (body.confirmReset !== true) throw fail('Confirm the output capacity change: normal screen configuration may reset.', 409);
  const physical = p => state.raw.find(i => i.interfaceIdObj?.slotId === group.slotId && i.interfaceIdObj.connectorId === p && i.auxiliaryInfo.connectorInfo.interfaceType === 4 && i.auxiliaryInfo.connectorInfo.type === 6);
  const card = state.cards.find(c => c.slotId === group.slotId);
  const connectors = option.ports.map(p => {
    const raw = physical(p.index), primary = physical(p.backupPos);
    if (!raw || (p.workMode === 1 && !primary)) throw fail('Output topology changed. Refresh Outputs.', 409);
    return { index: p.index, type: 6, capacityMode: p.capacity, workMode: p.workMode,
      copyInfo: { type: 0, id: p.workMode === 1 ? primary.interfaceId : 0 } };
  });
  const assessment = await client.call('system/auxiliary/assess/switch-capacity', { capacity: body.capacity });
  if (!Array.isArray(assessment.data) || over(assessment.data)) throw fail('The device reports insufficient layer/output resources for this capacity. No settings were changed.', 409);
  await client.call('node/subcard/mode', { nodeId: 1, subcards: [{ slotId: card.slotId, modelId: card.modelId, cardType: card.cardType, connectors }] }, { timeoutMs: 120000 });
  return verified(() => readOutputs(client), next => option.ports.every(p => {
    const actual = next.outputs.find(o => o.slotId === group.slotId && o.port === p.index + 1 && o.type === 6);
    const primary = next.outputs.find(o => o.slotId === group.slotId && o.port === p.backupPos + 1 && o.type === 6);
    return actual?.capacity === p.capacity && actual.workMode === p.workMode && (p.workMode !== 1 || actual.copyFrom === primary?.id);
  }), 'the output capacity and copy relationships');
}
export async function checkOutputTimings(client, plan, state) {
  const items = plan.filter(c => (c.timing || c.colorDepth !== undefined) && state.outputs.find(o => o.id === c.id)?.timingCheck);
  if (!items.length) return;
  const response = await client.call('interface/thumbtiming-check', items.map(c => {
    const o = state.outputs.find(o => o.id === c.id);
    return { interfaceId: c.id, tagName: 3, thumbTiming: c.timing || o.timing, colorSpace: o.colorSpace === 255 || o.colorSpace === null ? o.colorSpaceActual ?? 0 : o.colorSpace, colorDepth: c.colorDepth ?? (o.colorDepth === 255 || o.colorDepth === null ? o.colorDepthActual ?? 8 : o.colorDepth) };
  }), { method: 'POST' });
  if (!Array.isArray(response.data)) throw fail('The device did not return output timing assessment.', 502);
  for (const c of items) {
    const r = response.data.find(r => Number(r.interfaceId) === c.id), t = c.timing || state.outputs.find(o => o.id === c.id).timing;
    // ETimingState is a standard/nonstandard classification, not an error code.
    // PixelFlow uses bandwidth and available frame range to decide support.
    if (!r || !Number.isFinite(r.currentBandwidth) || !(r.maxBandwidth > 0) || r.frame?.max === 0 || r.currentBandwidth > r.maxBandwidth ||
      (r.frame?.max > 0 && t.frame > r.frame.max / 100)) throw fail('Output timing exceeds the connector capacity/bandwidth or is unsupported. Choose a lower resolution, frame rate or bit depth.', 409);
  }
}

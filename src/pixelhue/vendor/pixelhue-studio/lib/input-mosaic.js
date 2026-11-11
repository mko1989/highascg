import { fail } from './pixelhue.js';
import { integer, choice } from './studio-common.js';

export function mosaicValue(raw) {
  const m = raw.interfaceMacMosaic;
  return m?.enable ? { group: m.mosaicGroup, side: m.index === 1 || m.position?.x > 0 ? 'right' : 'left' } : { group: 0, side: 'none' };
}
function sameTiming(a, b) {
  if (Boolean(a.presetTiming) !== Boolean(b.presetTiming)) return false;
  const aa = a.presetTiming, bb = b.presetTiming;
  const keys = ['addTime', 'frontPorch', 'sync', 'syncPolarity', 'totalTime'];
  return ['width', 'height', 'frame', 'interlaced'].every(k => a.presetThumbTiming?.[k] === b.presetThumbTiming?.[k]) &&
    (!aa || (['horizontal', 'vertical'].every(axis => keys.every(k => aa[axis]?.[k] === bb[axis]?.[k])) && aa.hBlank === bb.hBlank));
}
export function planMosaics(plan, state) {
  const final = new Map(state.inputs.map(i => [i.id, { ...i.mosaic }]));
  const writes = [], affected = new Set();
  for (const item of plan) {
    if (item.change.mosaic === undefined) continue;
    if (!item.input.mosaicSupported) throw fail(`${item.input.name}: Mac tiled groups are unavailable on this connector.`);
    const m = item.change.mosaic;
    if (!m || Object.keys(m).some(k => !['group', 'side'].includes(k))) throw fail('Choose a Mac tile group and position.');
    choice(m.side, ['none', 'left', 'right'], 'Mac tile position'); integer(m.group, 'Mac tile group', m.side === 'none' ? 0 : 1, m.side === 'none' ? 0 : 16);
    final.set(item.input.id, m);
    affected.add(m.group); affected.add(item.input.mosaic.group);
    const raw = item.raw, timing = raw.presetThumbTiming;
    if (!(timing?.width > 0 && timing.height > 0)) throw fail('Set a valid EDID resolution before configuring a Mac tile group.');
    writes.push({ interfaceId: raw.interfaceId, row: 1, column: 2, index: m.side === 'right' ? 1 : 0, enable: m.side === 'none' ? 0 : 1,
      position: { x: m.side === 'right' ? timing.width : 0, y: 0, width: timing.width, height: timing.height }, mosaicGroup: m.group });
  }
  for (const group of affected) {
    if (!group) continue;
    const members = [...final].filter(([, m]) => m.group === group && m.side !== 'none');
    if (members.length > 2 || (members.length === 2 && members[0][1].side === members[1][1].side)) throw fail(`Mac tile group ${group} needs at most one left and one right input.`);
    if (members.length === 2) {
      const [a, b] = members.map(([id]) => state.raw.find(i => i.interfaceId === id));
      if (a.auxiliaryInfo.connectorInfo.type !== b.auxiliaryInfo.connectorInfo.type || !sameTiming(a, b)) throw fail(`Mac tile group ${group} requires matching connector types and detailed EDID timings.`);
    }
  }
  // Remove old memberships before joining new groups so group swaps cannot temporarily exceed two.
  const removals = writes.filter(w => w.enable).filter(w => { const before = final.get(w.interfaceId), old = mosaicValue(state.raw.find(i => i.interfaceId === w.interfaceId)); return old.group && (old.group !== before.group || old.side !== before.side); })
    .map(w => ({ ...w, enable: 0, mosaicGroup: 0, index: 0, position: { ...w.position, x: 0 } }));
  return [...removals, ...writes];
}

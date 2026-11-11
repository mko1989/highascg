import { configuration } from './configuration.js';
import { outputTimingOptions, outputCapacityGroups } from './output-options.js';
import { checkOutputTimings } from './output-capacity.js';
import { fail } from './pixelhue.js';
import { connectorLabel } from './input-models.js';
import { name, timing, batch, choice, verified, sameTiming } from './studio-common.js';

export function normaliseOutputs(interfaces) {
  if (!Array.isArray(interfaces)) throw fail('No output interface list returned.', 502);
  return interfaces.filter(i => [4, 8, 16].includes(i.auxiliaryInfo?.connectorInfo?.interfaceType))
    .sort((a, b) => (a.interfaceIdObj?.slotId ?? 0) - (b.interfaceIdObj?.slotId ?? 0) || (a.interfaceIdObj?.connectorId ?? 0) - (b.interfaceIdObj?.connectorId ?? 0))
    .map((i, index) => {
      const info = i.auxiliaryInfo.connectorInfo, preset = i.presetThumbTiming;
      return { id: i.interfaceId, number: index + 1, name: i.general?.name || `Output ${index + 1}`,
        slotId: i.interfaceIdObj?.slotId, port: (i.interfaceIdObj?.connectorId ?? 0) + 1, type: info.type,
        connector: connectorLabel(info.type), role: info.interfaceType === 16 ? 'MVR' : info.interfaceType === 8 ? 'AUX' : 'Output',
        capacity: info.capacity, workMode: info.workMode, copyFrom: info.copyInfo?.id || null,
        screen: i.auxiliaryInfo.screenInfo?.name || '', online: i.auxiliaryInfo.online !== 0,
        timingEditable: info.workMode === 0 && ![24, 25, 33, 52, 53].includes(info.type),
        timing: preset ? { width: preset.width, height: preset.height, frame: preset.frame,
          standardType: preset.standardType ?? 0, interlaced: preset.interlaced ?? 0 } : null,
        timingMode: i.timingSelect?.select ?? preset?.timingSelect,
        colorDepth: i.colorDepth?.preset ?? null, colorSpace: i.colorSpace?.preset ?? null,
        colorDepthActual: i.colorDepth?.actual, colorSpaceActual: i.colorSpace?.actual,
        hdcp: i.hdcp?.enable ?? null, testPattern: i.testPattern?.enable ?? null,
        hdcpPreset: i.hdcp?.preset, patternConfig: i.testPattern || {} };
    });
}
export async function readOutputs(client, internal = false) {
  const [response, node, modes] = await Promise.all([client.call('interface/list-detail'), client.call('node/detail?nodeId=1'),
    client.model === 'P20' ? client.call('node/subcard/mode?nodeId=1&startSlotId=0&endSlotId=100') : {}, configuration(client)]);
  const raw = response.data?.list, cards = (modes.data?.find?.(n => n.nodeId === 1) || modes.data?.[0])?.subcards || [];
  const outputs = normaliseOutputs(raw).map(o => { const options = outputTimingOptions(client, raw.find(i => i.interfaceId === o.id), node.data?.mode?.workMode);
    return { ...o, ...options, timingEditable: o.timingEditable && options.timingAllowed }; });
  for (const output of outputs) {
    const primary = output.workMode === 1 && output.copyFrom !== output.id && outputs.find(o => o.id === output.copyFrom);
    if (primary?.timing) { output.timing = { ...primary.timing }; output.timingMode = primary.timingMode; }
  }
  return { session: client.session, device: client.deviceInfo(), outputs, syncActive: Number(node.data?.genlock?.type) > 0, capacityGroups: outputCapacityGroups(client, raw, node.data || {}, cards), ...(internal ? { raw, cards } : {}) };
}
export async function applyOutputs(client, changes) {
  const state = await readOutputs(client), seen = new Set();
  const plan = batch(changes, state.outputs.length).map(change => {
    const output = state.outputs.find(o => o.id === change.id);
    if (!output || seen.has(change.id)) throw fail('Unknown or duplicate output. Refresh outputs.', 409);
    if (Object.keys(change).some(key => !['id', 'name', 'timing', 'timingMode', 'confirmTimingReset', 'colorDepth', 'hdcp', 'testPattern'].includes(key))) throw fail('Unsupported output setting.');
    seen.add(change.id);
    if (change.name !== undefined) name(change.name, 'Output name');
    if (change.timingMode !== undefined) { choice(change.timingMode, [0, 3], 'output timing mode'); if (!change.timing) throw fail('Timing is required when selecting standard/custom mode.'); }
    if (change.timing !== undefined) {
      if (!output.timingEditable) throw fail(`${output.name} uses fixed/copy timing. Set the primary output instead.`);
      if ((output.screen || state.syncActive) && change.confirmTimingReset !== true) throw fail('Confirm the output timing change: screen configuration or synchronization may change.', 409);
      change = { ...change, timing: timing(change.timing), timingMode: change.timingMode ?? 3 };
      if (!output.interlacedAllowed && change.timing.interlaced) throw fail('This output does not support interlaced timing.');
      if (change.timingMode === 0 && !output.presets.some(p => sameTiming(p, change.timing))) throw fail('Choose a standard resolution supported by this output capacity.');
      for (const [key, rule] of Object.entries(output.limits)) if (change.timing[key] < rule.min || change.timing[key] > rule.max || (change.timing[key] - rule.min) % rule.step !== 0) throw fail(`Output ${key} is outside the connector timing limits.`);
    }
    if (change.colorDepth !== undefined) {
      if (output.colorDepth === null) throw fail('Color depth is unavailable on this connector.');
      choice(change.colorDepth, [8, 10, 12], 'output color depth');
    }
    for (const key of ['hdcp', 'testPattern']) if (change[key] !== undefined) {
      if (output[key] === null) throw fail(`${key} is unavailable on this connector.`);
      choice(change[key], [0, 1], key);
    }
    return change;
  });
  await checkOutputTimings(client, plan, state);
  const writes = [
    ['name', 'interface/general', c => ({ interfaceId: c.id, general: { name: c.name } })],
    ['timing', 'interface/preset-thumb-timing', c => ({ interfaceId: c.id, presetThumbTiming: { ...c.timing, timingSelect: c.timingMode ?? 3 } })],
    ['colorDepth', 'interface/color-depth', c => ({ interfaceId: c.id, colorDepth: { preset: c.colorDepth } })],
    ['hdcp', 'interface/hdcp', c => ({ interfaceId: c.id, hdcp: { enable: c.hdcp, ...(state.outputs.find(o => o.id === c.id).hdcpPreset !== undefined ? { preset: state.outputs.find(o => o.id === c.id).hdcpPreset } : {}) } })],
    ['testPattern', 'interface/test-pattern', c => ({ interfaceId: c.id, testPattern: { ...state.outputs.find(o => o.id === c.id).patternConfig, enable: c.testPattern } })],
  ];
  for (const [key, path, payload] of writes) {
    const items = plan.filter(c => c[key] !== undefined && (key === 'timing' ? (!sameTiming(c.timing, state.outputs.find(o => o.id === c.id).timing) || c.timingMode !== state.outputs.find(o => o.id === c.id).timingMode) : c[key] !== state.outputs.find(o => o.id === c.id)[key]));
    if (items.length) await client.call(path, items.map(payload), { timeoutMs: 20000 });
  }
  return verified(() => readOutputs(client), next => plan.every(change => {
    const actual = next.outputs.find(o => o.id === change.id);
    return actual && Object.keys(change).filter(key => !['id', 'confirmTimingReset'].includes(key)).every(key => key === 'timing' ? sameTiming(actual.timing, change.timing) : key === 'timingMode' ? actual.timingMode === change.timingMode : actual[key] === change[key]);
  }), 'the output settings');
}

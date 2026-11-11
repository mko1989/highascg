import { fail } from './pixelhue.js';
import { batch, verified } from './studio-common.js';
import { interfaceConfiguration, allowed } from './interface-config.js';
import { child } from './configuration.js';
import { supportsEdid, connectorLabel } from './input-models.js';
import { inputAdvancedFields } from './input-advanced-fields.js';
import { mosaicValue, planMosaics } from './input-mosaic.js';
import { detailedTiming } from './input-edid.js';

const routes = { compatibilityMode: 'compatibility-mode', hdcp: 'hdcp', colorSpace: 'color-space', colorDepth: 'color-depth',
  colorRange: 'color-range', colorGamut: 'color-gamut', colorDynamicRange: 'color-dynamic-range', imageQuality: 'image-quality' };
export async function readInputAdvanced(client, internal = false) {
  const [interfaces, response] = await Promise.all([client.call('interface/list-detail'), client.call('node/detail?nodeId=1')]);
  if (!Array.isArray(interfaces.data?.list)) throw fail('Input interfaces were not returned.', 502);
  const raw = interfaces.data.list.filter(i => i.auxiliaryInfo?.connectorInfo?.interfaceType === 2 && i.auxiliaryInfo.connectorInfo.workMode !== 2);
  const inputs = [];
  for (const input of raw) {
    const config = await interfaceConfiguration(client, input, response.data), advanced = inputAdvancedFields(input, config);
    const mosaicSupported = supportsEdid(input.auxiliaryInfo.connectorInfo.type) && allowed(child(child(config.feature, 'Features'), 'MacMosaic')) && advanced.fields.some(f => f.key === 'compatibilityMode');
    inputs.push({ id: input.interfaceId, name: input.general?.name || `Input ${input.interfaceId}`, type: input.auxiliaryInfo.connectorInfo.type,
      connector: connectorLabel(input.auxiliaryInfo.connectorInfo.type), slot: input.interfaceIdObj?.slotId, port: (input.interfaceIdObj?.connectorId ?? 0) + 1,
      fields: advanced.fields, values: advanced.values, mosaicSupported, mosaic: mosaicValue(input),
      timing: detailedTiming(input), edid: supportsEdid(input.auxiliaryInfo.connectorInfo.type), edidFile: input.timingSelect?.edidFileName || '' });
  }
  return { session: client.session, device: client.deviceInfo(), inputs, ...(internal ? { raw } : {}) };
}
function setPath(object, path, value) {
  const keys = path.split('.'), last = keys.pop(); let node = object;
  for (const key of keys) node = node[key] ||= {};
  node[last] = value;
}
export async function applyInputAdvanced(client, body) {
  const state = await readInputAdvanced(client, true), seen = new Set();
  const plan = batch(body.changes, state.inputs.length).map(change => {
    const input = state.inputs.find(i => i.id === change?.id);
    if (!input || seen.has(change.id)) throw fail('Input changed or duplicate interface. Refresh Advanced.', 409);
    seen.add(change.id);
    if (Object.keys(change).some(k => !['id', 'settings', 'mosaic'].includes(k))) throw fail('Unsupported advanced input action.');
    const settings = change.settings || {};
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw fail('Supply advanced input settings.');
    if (!Object.keys(settings).length && change.mosaic === undefined) throw fail('Supply advanced input changes.');
    const raw = state.raw.find(i => i.interfaceId === change.id), writes = new Map();
    for (const [key, value] of Object.entries(settings)) {
      const field = input.fields.find(f => f.key === key);
      if (!field) throw fail(`${input.name}: this setting is not editable on the current connector.`);
      if (!Number.isFinite(value) || (field.options ? !field.options.some(([v]) => v === value) : value < field.min || value > field.max || (field.step === 1 && !Number.isInteger(value)))) throw fail(`${field.label}: choose a supported value.`);
      if (!field.options && Math.abs((value - field.min) / field.step - Math.round((value - field.min) / field.step)) > 1e-7) throw fail(`${field.label}: use steps of ${field.step}.`);
      const [parent] = key.split('.');
      if (!writes.has(parent)) writes.set(parent, parent === 'compatibilityMode' ? {} : structuredClone(raw[parent] || {}));
      if (parent === 'compatibilityMode') writes.set(parent, value);
      else setPath(writes.get(parent), key.split('.').slice(1).join('.'), field.scale ? Math.round(value * field.scale) : value);
    }
    return { change, input, raw, settings, writes };
  });
  const mosaics = planMosaics(plan, state); // Complete validation before any write.
  for (const [key, route] of Object.entries(routes)) {
    const updates = plan.filter(p => p.writes.has(key)).map(p => ({ interfaceId: p.input.id, [key]: key === 'hdcp' ? { enable: p.writes.get(key).enable, preset: p.writes.get(key).preset }
      : key.startsWith('color') ? { preset: p.writes.get(key).preset } : p.writes.get(key) }));
    if (updates.length) await client.call(`interface/${route}`, updates);
  }
  for (const mosaic of mosaics) await client.call('interface/mosaic', mosaic, { method: 'POST' });
  return verified(() => readInputAdvanced(client), next => plan.every(p => {
    const input = next.inputs.find(i => i.id === p.input.id);
    return input && Object.entries(p.settings).every(([k, v]) => Math.abs(input.values[k] - v) < 1e-9) &&
      (p.change.mosaic === undefined || (input.mosaic.group === p.change.mosaic.group && input.mosaic.side === p.change.mosaic.side));
  }), 'the advanced input settings');
}

import { fail } from './pixelhue.js';
import { batch, verified } from './studio-common.js';
import { interfaceConfiguration } from './interface-config.js';
import { inputAdvancedFields } from './input-advanced-fields.js';
import { connectorLabel } from './input-models.js';

// Output format and colour correction (WO-037, OUTPUTS-03/05). Same per-connector XML inheritance as the input
// Advanced panel, read for the output's own role. PixelFlow: PUT interface/color-space|color-range|color-gamut
// [{ interfaceId, <key>: { preset } }] and PUT interface/image-quality with the whole imageQuality object.
// Bit depth and HDCP stay in the main Outputs table; dynamic range/HDR parameters are not offered here.
const ROUTES = { colorSpace: 'color-space', colorRange: 'color-range', colorGamut: 'color-gamut', imageQuality: 'image-quality' };
const offered = key => Object.keys(ROUTES).includes(key.split('.')[0]);
export async function readOutputAdvanced(client, internal = false) {
  const [interfaces, node] = await Promise.all([client.call('interface/list-detail'), client.call('node/detail?nodeId=1')]);
  if (!Array.isArray(interfaces.data?.list)) throw fail('Output interfaces were not returned.', 502);
  // Copy ports follow their primary, as in the Outputs table.
  const raw = interfaces.data.list.filter(i => [4, 8, 16].includes(i.auxiliaryInfo?.connectorInfo?.interfaceType) && i.auxiliaryInfo.connectorInfo.workMode === 0);
  const outputs = [];
  for (const port of raw) {
    const info = port.auxiliaryInfo.connectorInfo, advanced = inputAdvancedFields(port, await interfaceConfiguration(client, port, node.data || {}));
    const fields = advanced.fields.filter(f => offered(f.key)).map(f => f.section === 'Signal overrides' ? { ...f, section: 'Format' } : { ...f, section: 'Colour correction' });
    if (fields.length) outputs.push({ id: port.interfaceId, name: port.general?.name || `Output ${port.interfaceId}`, role: info.interfaceType === 16 ? 'MVR' : info.interfaceType === 8 ? 'AUX' : 'Output',
      connector: connectorLabel(info.type), fields, values: Object.fromEntries(fields.map(f => [f.key, advanced.values[f.key]])) });
  }
  return { session: client.session, device: client.deviceInfo(), outputs, ...(internal ? { raw } : {}) };
}
function setPath(object, path, value) { const keys = path.split('.'), last = keys.pop(); let node = object; for (const key of keys) node = node[key] ||= {}; node[last] = value; }
export async function applyOutputAdvanced(client, body) {
  const state = await readOutputAdvanced(client, true), seen = new Set();
  const plan = batch(body.changes, state.outputs.length || 1).map(change => {
    const output = state.outputs.find(o => o.id === change?.id);
    if (!output || seen.has(change.id)) throw fail('Output changed or duplicate interface. Refresh Advanced.', 409);
    seen.add(change.id);
    const settings = change.settings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || !Object.keys(settings).length || Object.keys(change).some(k => !['id', 'settings'].includes(k))) throw fail('Supply advanced output settings.');
    const raw = state.raw.find(i => i.interfaceId === change.id), writes = new Map();
    for (const [key, value] of Object.entries(settings)) {
      const field = output.fields.find(f => f.key === key);
      if (!field) throw fail(`${output.name}: this setting is not editable on the current connector.`);
      if (!Number.isFinite(value) || (field.options ? !field.options.some(([v]) => v === value) : value < field.min || value > field.max || (field.step === 1 && !Number.isInteger(value)))) throw fail(`${field.label}: choose a supported value.`);
      const [parent, ...rest] = key.split('.');
      if (!writes.has(parent)) writes.set(parent, structuredClone(raw[parent] || {}));
      setPath(writes.get(parent), rest.join('.'), field.scale ? Math.round(value * field.scale) : value);
    }
    // PixelFlow greys out the YCbCr samplings while the gamut is DCI-P3 (2).
    const space = settings['colorSpace.preset'] ?? output.values['colorSpace.preset'], gamut = settings['colorGamut.preset'] ?? output.values['colorGamut.preset'];
    if (gamut === 2 && space !== undefined && space !== 0 && (settings['colorSpace.preset'] !== undefined || settings['colorGamut.preset'] !== undefined)) throw fail(`${output.name}: DCI-P3 needs RGB 4:4:4 sampling.`);
    return { output, settings, writes };
  });
  for (const [key, route] of Object.entries(ROUTES)) {
    const updates = plan.filter(p => p.writes.has(key)).map(p => ({ interfaceId: p.output.id, [key]: key === 'imageQuality' ? p.writes.get(key) : { preset: p.writes.get(key).preset } }));
    if (updates.length) await client.call(`interface/${route}`, updates, { timeoutMs: 25000 });
  }
  return verified(() => readOutputAdvanced(client), next => plan.every(p => {
    const output = next.outputs.find(o => o.id === p.output.id);
    return output && Object.entries(p.settings).every(([k, v]) => Math.abs(output.values[k] - v) < 1e-9);
  }), 'the output format or colour settings');
}

import { configuration, child, supported, enumValues } from './configuration.js';
import { name, choice, verified } from './studio-common.js';
import { fail } from './pixelhue.js';
import { extraOptions, readExtras, planExtras, extrasRetained } from './device-extras.js';
import { layerModeOptions, powerOptions, cardCatalog, labelCards, readNetwork } from './studio-maintenance.js';

const modeNames = { 1: 'Converter', 2: 'Controller', 4: 'Switcher', 6: 'Switcher / controller', 8: 'Splicer', 10: 'Video controller', 16: 'Player', 32: 'Decoder', 64: 'Bypass' };
export async function readDevice(client) {
  const [response, config, network] = await Promise.all([client.call('node/detail?nodeId=1'), configuration(client), readNetwork(client)]);
  const node = response.data;
  if (!node || typeof node !== 'object') throw fail('Device information was not returned.', 502);
  const features = child(config, 'Features'), deviceFeatures = child(features, 'Device');
  const modes = child(features, 'DeviceModes'), layerModes = child(deviceFeatures, 'LayerModes');
  const genlock = child(features, 'Genlock');
  const modeValues = supported(modes) ? (modes.children || []).filter(n => n.name === 'DeviceMode').map(n => Number(n.attributes.Value)) : [];
  const inputs = supported(genlock) && enumValues(child(genlock, 'Type')).includes(2) ?
    ((await client.call('interface/list-detail')).data?.list || []).filter(i => i.auxiliaryInfo?.connectorInfo?.interfaceType === 2 && i.auxiliaryInfo.connectorInfo.workMode !== 2)
      .map(i => ({ id: i.interfaceId, name: i.general?.name || `Input ${i.interfaceId}` })) : [];
  const subcards = (node.subcards || []).map(c => ({ slotId: c.slotId, modelId: c.modelId, online: c.online, cardType: c.cardType }));
  const extra = extraOptions(config), extras = await readExtras(client, node, extra);
  if (!client.cardCatalog && client.configurationXml) client.cardCatalog = cardCatalog(client.configurationXml);
  return { session: client.session, device: client.deviceInfo(),
    node: { nodeId: node.nodeId ?? 1, name: node.general?.name || client.model, firmware: node.version || '', online: node.online,
      mode: node.mode, layerMode: node.layerMode, fanMode: node.fanMode, beacon: node.deviceBeacon,
      genlock: node.genlock, genlockStatus: node.genlockStatus, stateInfo: node.stateInfo,
      subcards: labelCards(subcards, client.cardCatalog || cardCatalog()), powerState: node.powerState, ...extras },
    network,
    options: { workModes: modeValues.map(value => ({ value, label: modeNames[value] || `Mode ${value}` })),
      layerModes: supported(layerModes) ? layerModeOptions(enumValues(layerModes), features, subcards) : [],
      power: powerOptions(config),
      fanModes: supported(child(deviceFeatures, 'FanMode')) ? enumValues(child(deviceFeatures, 'FanMode')) : [],
      genlockTypes: supported(genlock) ? enumValues(child(genlock, 'Type')) : [],
      beacon: supported(child(features, 'DeviceBeacon'), node.deviceBeacon !== undefined), ...extra },
    inputs, configurationAvailable: Boolean(config) };
}

export async function applyDevice(client, changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw fail('Device settings required.');
  const allowed = ['name', 'beacon', 'fanMode', 'layerMode', 'workMode', 'confirmModeChange', 'genlock', 'time', 'antiStatic'];
  if (Object.keys(changes).some(key => !allowed.includes(key))) throw fail('Unsupported device setting.');
  const before = await readDevice(client), plan = [];
  if (changes.name !== undefined) plan.push(['node/general', { nodeId: 1, general: { name: name(changes.name, 'Device name') } }]);
  if (changes.beacon !== undefined) {
    if (!before.options.beacon) throw fail('Device identification is unavailable.');
    plan.push(['node/beacon', { enable: choice(changes.beacon, [0, 1], 'beacon') }]);
  }
  if (changes.fanMode !== undefined) plan.push(['node/fan/mode', { nodeId: 1, mode: choice(changes.fanMode, before.options.fanModes, 'fan mode') }, 'POST']);
  if (changes.layerMode !== undefined) plan.push(['node/layer-mode', { nodeId: 1, layerMode: choice(changes.layerMode, before.options.layerModes.map(m => m.value), 'layer profile') }]);
  if (changes.genlock !== undefined) {
    const type = choice(changes.genlock.type, before.options.genlockTypes, 'genlock source');
    let sourceId = 0;
    if (type === 2) {
      const inputs = (await client.call('interface/list-detail')).data?.list || [];
      if (!inputs.some(i => i.interfaceId === changes.genlock.sourceId && i.auxiliaryInfo?.connectorInfo?.interfaceType === 2)) throw fail('Choose a current input for genlock.');
      sourceId = changes.genlock.sourceId;
    }
    plan.push(['node/genlock', { nodeId: 1, genlock: { ...before.node.genlock, type, sourceId } }]);
  }
  if (changes.workMode !== undefined) {
    choice(changes.workMode, before.options.workModes.map(m => m.value), 'device mode');
    if (changes.workMode !== before.node.mode?.workMode) {
      if (changes.confirmModeChange !== true) throw fail('Changing device mode can reset screen configuration. Confirm the mode change.', 409);
      plan.push(['node/mode', { nodeId: 1, mode: { ...before.node.mode, workMode: changes.workMode } }]);
    }
  }
  plan.push(...planExtras(changes, before));
  if (!plan.length) throw fail('No device changes supplied.');
  for (const [path, body, method] of plan) await client.call(path, body, { ...(method ? { method } : {}), timeoutMs: 120000 });
  if (plan.some(([path]) => ['node/mode', 'node/layer-mode'].includes(path))) {
    client.configurationPromise = undefined; client.configurationXml = undefined; client.umdConfig = undefined; client.cardCatalog = undefined;
  }
  return verified(() => readDevice(client), state => extrasRetained(changes, state) &&
    (changes.name === undefined || state.node.name === changes.name) &&
    (changes.beacon === undefined || state.node.beacon === changes.beacon) &&
    (changes.fanMode === undefined || state.node.fanMode === changes.fanMode) &&
    (changes.layerMode === undefined || state.node.layerMode === changes.layerMode) &&
    (changes.workMode === undefined || state.node.mode?.workMode === changes.workMode) &&
    (changes.genlock === undefined || (state.node.genlock?.type === changes.genlock.type &&
      (changes.genlock.type !== 2 || state.node.genlock?.sourceId === changes.genlock.sourceId))), 'the device settings');
}

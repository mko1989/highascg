import { xmlFile, xmlTree, child, supported, enumValues } from './configuration.js';
import { choice, verified } from './studio-common.js';
import { fail } from './pixelhue.js';

// PixelFlow LayerModeVideoName (pages/devices/const.ts): 0 = 2xMAIN+10xPIP, 1 = 4xMAIN+4xPIP.
const LAYER_MODES = { 0: { main: 2, pip: 10 }, 1: { main: 4, pip: 4 } };
const DS_CARD = 15728933; // PixelFlow haveDSSubcard: P20-DS feature rows use Type 0, plain P20 Type 1.
const CARD_KINDS = { inputcard: 'Input', outputcard: 'Output', mixcard: 'Mixed', maincontrolcard: 'Main' };
// Manual §2.2 restore types: 0 restart, 1 IP, 2 EDID, 3 gallery, 4 language, 5 project files, 8 user files.
// Presets match PixelFlow pages/maintain/const.ts RESTORE_REQ_PARAMS.
export const RESET_PRESETS = { 'user-data': [0, 1, 2, 3, 4, 5, 8], network: [0, 1], nothing: [0] };
const POWER = { restart: 0, shutdown: 1 }; // PixelFlow DeviceOptionE.restart / hardShutdown

function find(node, name) {
  if (!node) return undefined;
  if (node.name === name) return node;
  for (const next of node.children) { const hit = find(next, name); if (hit) return hit; }
  return undefined;
}

export function layerModeOptions(values, features, subcards) {
  const type = subcards.some(card => card.modelId === DS_CARD) ? 0 : 1;
  const hdr = (child(child(features, 'DynamicRangConversion'), 'LayerModes')?.children || []).filter(n => n.name === 'LayerMode');
  return values.map(value => {
    const counts = LAYER_MODES[value], rows = hdr.filter(n => Number(n.attributes.Value) === value);
    const row = rows.find(n => Number(n.attributes.Type) === type) || rows.find(n => n.attributes.Type === undefined);
    return { value, label: counts ? `${counts.main} × MAIN + ${counts.pip} × PIP` : `Profile ${value + 1}`,
      main: counts?.main ?? null, pip: counts?.pip ?? null, hdr: row ? row.attributes.HDRSupport === '1' : null };
  });
}

export function powerOptions(config) {
  const node = find(config, 'PowerCtrl');
  const values = node && supported(node) ? enumValues(child(node, 'Type')) : [0];
  return Object.keys(POWER).filter(key => values.includes(POWER[key]));
}

function compact(groups) {
  const out = [];
  for (const group of groups) {
    const match = group.match(/^(.*?)(\d+)$/), last = out.at(-1);
    if (match && last?.prefix === match[1] && last.to + 1 === Number(match[2])) { last.to++; continue; }
    out.push(match ? { prefix: match[1], from: Number(match[2]), to: Number(match[2]) } : { text: group });
  }
  return out.map(item => item.text ?? (item.from === item.to ? `${item.prefix}${item.from}` : `${item.prefix}${item.from}–${item.to}`)).join(', ');
}

// Card catalog: names come from deviceconfig/subcard/<kind>/<modelId>.xml, rear-panel port
// labels from deviceconfig/device/slot.xml ConnectorGroup GroupName (silkscreen).
export function cardCatalog(xml) {
  const names = {}, groups = {};
  if (typeof xml !== 'string') return { names, groups };
  for (const file of xml.matchAll(/<File\b[^>]*>\s*<path>\s*deviceconfig\/subcard\/(\w+)\/(\d+)\.xml\s*<\/path>[\s\S]{0,4000}?<en>\s*([^<]*?)\s*<\/en>/g)) {
    names[file[2]] = { kind: CARD_KINDS[file[1]] || 'Card', name: file[3] };
  }
  const slots = xmlTree(xmlFile(xml, 'deviceconfig/device/slot.xml'));
  (function walk(node) {
    if (node.name === 'Slot') for (const card of child(node, 'Subcards')?.children || []) {
      const list = (child(card, 'ConnectorGroups')?.children || []).map(g => g.attributes.GroupName).filter(Boolean);
      if (list.length) groups[`${node.attributes.Index}:${card.attributes.ModuleId}`] = list;
    }
    for (const next of node.children) walk(next);
  })(slots);
  return { names, groups };
}

const prettyName = name => name.replace(/复制/g, ' copy').replace(/[^\x20-\x7e]/g, '').replace(/_/g, ' + ').replace(/\s+/g, ' ').trim();
export function labelCards(subcards, catalog) {
  return subcards.map(card => {
    const known = catalog.names[card.modelId], main = card.slotId === 100;
    return { ...card, slot: main ? 'Main' : `Slot ${card.slotId}`,
      kind: main ? 'Main board' : known ? `${known.kind} card` : 'Card',
      name: known ? (known.name === 'main card' ? 'Main board' : prettyName(known.name)) : `Model ${card.modelId}`,
      ports: compact(catalog.groups[`${card.slotId}:${card.modelId}`] || []) };
  });
}

export async function readNetwork(client) {
  try {
    const data = (await client.call('node/ethernet?nodeId=1')).data, info = data?.ethernet?.infos?.[0];
    if (!info) return null;
    return { mode: data.ethernet.mode ?? 0, index: info.index ?? 0, mac: info.mac || '', dhcp: info.dhcp === 1 ? 1 : 0,
      ip: info.ip || '', netmask: info.netmask || '', gateway: info.gateway || '', autoDNS: info.autoDNS ?? 0, dns: info.dns ?? [],
      port: info.interfaceType === 33 ? '10G fiber' : 'Ethernet' };
  } catch { return null; }
}

const octets = (value, label) => {
  const parts = typeof value === 'string' ? value.trim().split('.') : [];
  if (parts.length !== 4 || !parts.every(p => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255)) throw fail(`${label} must be an IPv4 address.`);
  return parts.reduce((sum, p) => sum * 256 + Number(p), 0);
};
export function validateNetwork(change) {
  const dhcp = choice(change?.dhcp, [0, 1], 'address mode');
  if (dhcp === 1) return { dhcp, ip: '', netmask: '', gateway: '' };
  const ip = octets(change.ip, 'IP address'), mask = octets(change.netmask, 'Subnet mask'), gateway = octets(change.gateway, 'Gateway');
  const inverse = (~mask) >>> 0;
  if (mask === 0 || ((inverse + 1) & inverse) !== 0) throw fail('Subnet mask must be contiguous, e.g. 255.255.255.0.');
  const host = (ip & inverse) >>> 0;
  if (host === 0 || host === inverse) throw fail('IP address cannot be the network or broadcast address.');
  if (((ip ^ gateway) & mask) !== 0) throw fail('Gateway must be in the same subnet as the IP address.');
  if (ip === gateway) throw fail('IP address and gateway must differ.');
  return { dhcp, ip: change.ip.trim(), netmask: change.netmask.trim(), gateway: change.gateway.trim() };
}

async function applyNetwork(client, change, readDevice) {
  const current = await readNetwork(client);
  if (!current) throw fail('Network settings are unavailable on this device.');
  const next = validateNetwork(change);
  if (['dhcp', 'ip', 'netmask', 'gateway'].every(key => next[key] === current[key]) || (next.dhcp === 1 && current.dhcp === 1)) throw fail('No network changes supplied.');
  const moves = next.dhcp === 1 || next.ip !== current.ip;
  const body = { nodeId: 1, ethernet: { mode: current.mode, infos: [{ index: current.index, ...next, autoDNS: current.autoDNS, dns: current.dns }] } };
  try { await client.call('node/ethernet', body, { timeoutMs: 15000 }); }
  catch (error) { if (!moves) throw error; } // The device may drop this connection as soon as it re-addresses.
  if (moves) return { reconnect: true, host: next.dhcp === 1 ? null : next.ip,
    message: next.dhcp === 1 ? 'Network set to DHCP. Find the device again once it has a new address.' : `Network saved. Reconnect at ${next.ip}.` };
  return verified(() => readDevice(client), state => ['netmask', 'gateway'].every(key => state.network?.[key] === next[key]), 'the network settings');
}

export async function runDeviceAction(client, body, readDevice) {
  const action = choice(body?.action, ['network', 'restart', 'shutdown', 'factory-reset'], 'device action');
  if (action === 'network') {
    if (body.confirm !== true) throw fail('Changing network settings can disconnect this app. Confirm the change.', 409);
    return applyNetwork(client, body.network, readDevice);
  }
  const state = await readDevice(client);
  if (action === 'factory-reset') {
    const keep = choice(body.keep, Object.keys(RESET_PRESETS), 'reset option');
    if (body.confirm !== 'RESET') throw fail('Type RESET to confirm the factory reset.', 409);
    await client.call('system/restore-factory', { restoreFactory: RESET_PRESETS[keep].map(type => ({ type, para: 0 })) }, { timeoutMs: 30000 });
    return { reconnect: true, host: keep === 'nothing' ? null : client.host,
      message: keep === 'nothing' ? 'Factory reset started. The device returns to its default address; find it again after it restarts.' : 'Factory reset started. Reconnect after the device restarts.' };
  }
  if (!state.options.power.includes(action)) throw fail(`This device does not support ${action}.`);
  if (body.confirm !== true) throw fail(`Confirm the ${action}.`, 409);
  await client.call('node/power', { nodeId: 1, option: POWER[action] }, { timeoutMs: 15000 });
  return { reconnect: true, host: action === 'restart' ? client.host : null,
    message: action === 'restart' ? 'Device restarting. Reconnect when it is back online.' : 'Device shutting down. It must be powered on at the unit.' };
}

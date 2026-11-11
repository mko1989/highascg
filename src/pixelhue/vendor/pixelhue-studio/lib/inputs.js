import { fail } from './pixelhue.js';
import { inputGroups, interfaceFor, connectorLabel, supportsEdid, isSdi, capacityChoices } from './input-models.js';
export const sameEdid = (a, b) => a && b && ['width', 'height', 'frame', 'standardType', 'interlaced'].every((key) => a[key] === b[key]);

function edidOf(input) {
  const mode = input?.timingSelect?.select ?? 0;
  const timing = mode === 1 ? input.presetTiming : input?.presetThumbTiming;
  return {
    width: timing?.width ?? timing?.horizontal?.addTime ?? null,
    height: timing?.height ?? timing?.vertical?.addTime ?? null,
    frame: timing?.frame ?? timing?.refresh ?? null,
    standardType: timing?.standardType ?? 0, interlaced: timing?.interlaced ?? 0,
    mode, fileName: input?.timingSelect?.edidFileName || input?.fileInfo?.edidFileName || '',
  };
}

export function normaliseInputs(interfaces, cards, model = 'P20') {
  if (!Array.isArray(interfaces) || !Array.isArray(cards)) throw fail('Device did not return input interfaces and card modes.', 502);
  const rows = [];
  for (const group of inputGroups(interfaces, cards, model)) {
    const { card } = group;
    const ports = group.connectors.map((mode) => {
      const { index, type } = mode;
      const input = interfaceFor(interfaces, card.slotId, index, type);
      return { key: `${type}:${index}`, index, type, label: connectorLabel(type),
        id: input?.interfaceId ?? null, name: input?.general?.name ?? '',
        workMode: mode.workMode, capacity: mode.capacityMode,
        state: input?.state ?? null, edid: edidOf(input),
        signal: input?.actualTiming ? `${input.actualTiming.horizontal?.addTime ?? '?'} × ${input.actualTiming.vertical?.addTime ?? '?'} @ ${input.actualTiming.refresh ?? '?'} Hz` : 'No signal data' };
    }).filter(Boolean);
    if (!ports.length) continue;
    const active = ports.find((port) => port.workMode === 0);
    const capacity = active?.capacity ?? ports[0].capacity;
    rows.push({ key: group.key, label: `Input ${group.number}`, number: group.number,
      slotId: card.slotId, modelId: card.modelId, cardType: card.cardType, location: group.location,
      supportsEdid: ports.every((port) => supportsEdid(port.type)), fixedPort: group.fixedPort,
      family: ports.every((port) => isSdi(port.type)) ? 'SDI' : ports.every((port) => supportsEdid(port.type)) ? 'HDMI/DP' : 'Other',
      capacityEditable: model !== 'Q8' && [0, 1, 2].includes(capacity),
      capacityChoices: capacityChoices(model),
      portKey: active?.key ?? (group.fixedPort ? ports[0].key : ''), capacity,
      ports });
  }
  return rows.sort((a, b) => a.number - b.number);
}

export async function readInputs(client) {
  const [interfaces, modes] = await Promise.all([
    client.call('interface/list-detail'),
    client.call('node/subcard/mode?nodeId=1&startSlotId=0&endSlotId=100'),
  ]);
  const cards = modes.data?.find?.((node) => node.nodeId === 1)?.subcards ?? modes.data?.[0]?.subcards;
  return { session: client.session, device: client.deviceInfo(),
    capacityChoices: capacityChoices(client.model),
    inputs: normaliseInputs(interfaces.data?.list, cards, client.model), cards };
}

export function planInputs(changes, state) {
  const limit = Math.min(state.inputs.length, 512);
  if (!Array.isArray(changes) || !changes.length || changes.length > limit) throw fail(`Supply 1–${limit} input changes.`);
  const seen = new Set();
  return changes.map((change) => {
    if (!change || seen.has(change.key)) throw fail('Invalid or duplicate input.');
    seen.add(change.key);
    const row = state.inputs.find((item) => item.key === change.key);
    const port = row?.ports.find((item) => item.key === change.portKey);
    if (!port) throw fail('Input or physical port no longer exists. Refresh inputs.', 409);
    if (row.fixedPort && change.portKey !== row.portKey) throw fail(`${row.label}: physical port routing is fixed; only its supported settings can be changed.`);
    if (row.capacityEditable === false ? change.capacity !== row.capacity : ![0, 1, 2].includes(change.capacity)) throw fail('Choose a supported capacity or keep the device-managed value.');
    if ((change.capacity !== row.capacity || change.portKey !== row.portKey) && !row.capacityChoices.includes(change.capacity)) {
      throw fail(`${row.label}: this device supports ${row.capacityChoices.map((value) => ['SL', 'DL', '4K'][value]).join(' or ')} capacity.`);
    }
    const name = change.name;
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || Buffer.byteLength(name, 'utf8') > 32 || /[\x00-\x1f]/.test(name))) {
      throw fail(`${row.label}: name must contain 1–32 UTF-8 bytes, without control characters.`);
    }
    const edid = change.edid;
    if (edid !== undefined && !row.supportsEdid) throw fail(`${row.label}: ${row.family === 'SDI' ? 'SDI' : 'this connector'} does not support EDID settings.`);
    if (edid !== undefined && (!edid || ![edid.width, edid.height].every((n) => Number.isInteger(n) && n >= 64 && n <= 8192) ||
      typeof edid.frame !== 'number' || !Number.isFinite(edid.frame) || edid.frame < 1 || edid.frame > 240 ||
      !Number.isInteger(edid.standardType) || edid.standardType < 0 || edid.standardType > 7 || ![0, 1].includes(edid.interlaced))) {
      throw fail(`${row.label}: enter a valid EDID resolution, frame rate (1–240 Hz), and timing standard.`);
    }
    return { row, port, capacity: change.capacity, name, edid };
  });
}

export function modePayload(plan, state) {
  const subcards = new Map();
  for (const item of plan) {
    if (item.row.portKey === item.port.key && item.row.capacity === item.capacity) continue;
    const card = state.cards.find((card) => card.slotId === item.row.slotId);
    if (!subcards.has(card.slotId)) subcards.set(card.slotId, { slotId: card.slotId, modelId: card.modelId, cardType: card.cardType, connectors: [] });
    for (const port of item.row.ports) {
      const current = card.connectors.find((connector) => connector.index === port.index && connector.type === port.type);
      subcards.get(card.slotId).connectors.push({ index: port.index, type: port.type, capacityMode: item.capacity,
        workMode: item.row.fixedPort ? current.workMode : port.key === item.port.key ? 0 : 2,
        ...(current.copyInfo ? { copyInfo: current.copyInfo } : {}) });
    }
  }
  return { nodeId: 1, subcards: [...subcards.values()] };
}

function assessmentFailed(data) {
  if (Array.isArray(data)) return data.some(assessmentFailed);
  if (!data || typeof data !== 'object') return false;
  return (typeof data.state === 'number' && data.state !== 0) || Object.values(data).some((value) => typeof value === 'object' && assessmentFailed(value));
}

async function waitFor(client, matches) {
  let state;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 300));
    state = await readInputs(client);
    if (matches(state)) return state;
  }
  throw Object.assign(fail('The device did not retain all requested input settings. Some settings may have changed. Refresh inputs to inspect the actual state.', 409), { snapshot: state });
}

export async function applyInputs(client, changes) {
  const initial = await readInputs(client);
  const plan = planInputs(changes, initial);
  const payload = modePayload(plan, initial);
  let current = initial;
  if (payload.subcards.length) {
    const assessment = await client.call('system/auxiliary/assess/subcard-mode', payload);
    if (assessmentFailed(assessment.data)) throw fail('The device reports insufficient resources for this input port/capacity configuration. No settings were written.', 409);
    await client.call('node/subcard/mode', payload, { timeoutMs: 120000 });
    current = await waitFor(client, (state) => plan.every(({ row, port, capacity }) => {
      const actual = state.inputs.find((item) => item.key === row.key);
      return actual?.portKey === port.key && actual.capacity === capacity && Number.isSafeInteger(actual.ports.find((item) => item.key === port.key)?.id);
    }));
  }
  const names = [], timings = [];
  for (const item of plan) {
    // Mode changes can regenerate interface IDs; resolve them again before names/EDIDs.
    const port = current.inputs.find((row) => row.key === item.row.key)?.ports.find((port) => port.key === item.port.key);
    if (!Number.isSafeInteger(port?.id)) throw fail('The selected input has no interface ID yet. Refresh inputs before setting its name or EDID.', 409);
    if (item.name !== undefined && port.name !== item.name) names.push({ interfaceId: port.id, general: { name: item.name } });
    if (item.edid !== undefined && (!sameEdid(port.edid, item.edid) || port.edid.mode !== 0)) {
      const { width, height, frame, standardType, interlaced } = item.edid;
      timings.push({ interfaceId: port.id, presetThumbTiming: { width, height, frame, standardType, interlaced, timingSelect: 0 } });
    }
  }
  if (names.length) await client.call('interface/general', names);
  if (timings.length) await client.call('interface/preset-thumb-timing', timings, { timeoutMs: 15000 });
  return waitFor(client, (state) => plan.every((item) => {
    const row = state.inputs.find((row) => row.key === item.row.key);
    const port = row?.ports.find((port) => port.key === item.port.key);
    return row?.portKey === item.port.key && row.capacity === item.capacity &&
      (item.name === undefined || port?.name === item.name) &&
      (item.edid === undefined || (sameEdid(port?.edid, item.edid) && port.edid.mode === 0));
  }));
}

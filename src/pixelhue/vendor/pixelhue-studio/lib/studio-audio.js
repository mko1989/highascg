import { configuration, child } from './configuration.js';
import { fail } from './pixelhue.js';
import { batch, choice, verified } from './studio-common.js';

// PixelFlow src/pages/audio-matrix (WO-036). Matrix headers are "slot,connector,channel,interfaceId,isValid";
// rows are input (RX = 1) channels, columns are output (TX = 2) channels, one input per output.
const RX = 1, TX = 2, DS_CARD = 15728933;
export function parseHeader(key) {
  const [slot, connector, channel, interfaceId, valid] = String(key).split(',').map(Number);
  return { slot, connector, channel, interfaceId, valid: valid === 1 };
}
const on = node => node?.attributes.Support === '1';
// utils/device.ts judgeSupportAudioMatrix: feature Audio + AudioMatrix, or a P20 DS card.
export async function audioSupported(client) {
  const audio = child(await configuration(client), 'Audio');
  if (on(audio) && on(child(audio, 'AudioMatrix'))) return true;
  if (client.model !== 'P20') return false;
  const node = await client.call('node/detail?nodeId=1').catch(() => null);
  return Boolean(node?.data?.subcards?.some(card => card.modelId === DS_CARD));
}
function channels(headers, type, interfaces) {
  return (Array.isArray(headers) ? headers : []).flatMap((key, index) => {
    const header = parseHeader(key), port = interfaces.find(i => i.interfaceId === header.interfaceId);
    const info = port?.audio?.channelInfo?.find(c => c.channelType === type && c.channelIndex === header.channel);
    if (!header.valid || !info) return [];
    const connector = port.auxiliaryInfo?.connectorInfo || {};
    const kind = connector.type === 25 ? 'Dante' : connector.interfaceType === 256 ? 'Analog' : type === RX ? 'Input' : 'Output';
    return [{ key, index, interfaceId: header.interfaceId, slot: header.slot, channel: header.channel, type, kind,
      port: port.general?.name || `${kind} ${header.interfaceId}`, name: info.channelLabel || `Channel ${header.channel + 1}`,
      mute: info.isMute ? 1 : 0, tone: info.testAudioEnable ? 1 : 0,
      // Analog cards and outputs report no signal state (audio-matrix/utils.ts hasStatus).
      signal: type === RX && kind !== 'Analog' ? (info.state === 1 ? 1 : 0) : null }];
  });
}
export async function readAudio(client) {
  const base = { session: client.session, device: client.deviceInfo() };
  if (!await audioSupported(client)) return { ...base, supported: false, inputs: [], outputs: [], routes: {} };
  const [matrix, list] = await Promise.all([client.call('audio/matrix-detail?nodeId=1'), client.call('interface/list-detail')]);
  const interfaces = list.data?.list, data = matrix.data;
  if (!Array.isArray(interfaces) || !data || !Array.isArray(data.matrixData)) throw fail('Device did not return its audio matrix.', 502);
  const inputs = channels(data.rowHeader, RX, interfaces), outputs = channels(data.columnHeader, TX, interfaces);
  const routes = Object.fromEntries(outputs.map(output => [output.key,
    inputs.find(input => data.matrixData[input.index]?.[output.index] === 1)?.key ?? null]));
  // A crosspoint held by a hidden (invalid) row still occupies its output; keep it visible as "other".
  for (const output of outputs) if (!routes[output.key] && data.matrixData.some(row => row?.[output.index] === 1)) {
    routes[output.key] = data.rowHeader[data.matrixData.findIndex(row => row?.[output.index] === 1)];
  }
  return { ...base, supported: true, inputs, outputs, routes };
}
export async function applyAudio(client, body) {
  const state = await readAudio(client);
  if (!state.supported) throw fail('This device does not advertise an audio matrix.', 403);
  if (Object.keys(body).some(key => !['session', 'routes', 'clear', 'channels'].includes(key))) throw fail('Unsupported audio setting.');
  const mapping = [], base = [], expected = { ...state.routes }, flags = new Map();
  if (body.clear === true) for (const [output, input] of Object.entries(state.routes)) if (input) {
    mapping.push({ columnHeader: output, rowHeader: input, mappingEnable: 0 }); expected[output] = null;
  }
  if (body.routes !== undefined) {
    const seen = new Set();
    for (const route of batch(body.routes, state.outputs.length)) {
      const output = state.outputs.find(o => o.key === route?.output);
      if (!output || seen.has(output.key)) throw fail('Unknown or duplicate audio output channel. Refresh audio.', 409);
      seen.add(output.key);
      if (route.input === null) {
        if (expected[output.key]) mapping.push({ columnHeader: output.key, rowHeader: expected[output.key], mappingEnable: 0 });
      } else {
        if (!state.inputs.some(i => i.key === route.input)) throw fail('Unknown audio input channel. Refresh audio.', 409);
        // The device replaces the output's previous input (PixelFlow sends only the new crosspoint).
        if (expected[output.key] !== route.input) mapping.push({ columnHeader: output.key, rowHeader: route.input, mappingEnable: 1 });
      }
      expected[output.key] = route.input;
    }
  }
  if (body.channels !== undefined) {
    const all = [...state.inputs, ...state.outputs];
    for (const change of batch(body.channels, all.length)) {
      const channel = all.find(c => c.key === change?.key && c.type === change.type);
      if (!channel || flags.has(`${channel.type}:${channel.key}`)) throw fail('Unknown or duplicate audio channel. Refresh audio.', 409);
      if (Object.keys(change).some(key => !['key', 'type', 'mute', 'tone'].includes(key)) || (change.mute === undefined && change.tone === undefined)) throw fail('Choose mute or test tone for the audio channel.');
      const next = { mute: choice(change.mute ?? channel.mute, [0, 1], 'mute state'), tone: choice(change.tone ?? channel.tone, [0, 1], 'test tone state') };
      flags.set(`${channel.type}:${channel.key}`, next);
      if (next.mute !== channel.mute || next.tone !== channel.tone) base.push({ interfaceId: channel.interfaceId, channelIndex: channel.channel,
        isMute: next.mute, testAudioEnable: next.tone, channelType: channel.type });
    }
  }
  if (body.clear !== true && body.routes === undefined && body.channels === undefined) throw fail('No audio change supplied.');
  if (mapping.length) await client.call('audio/matrix-mapping', mapping, { method: 'POST' });
  if (base.length) await client.call('audio/matrix-base', base, { method: 'POST' });
  return verified(() => readAudio(client), next => Object.entries(expected).every(([output, input]) => (next.routes[output] ?? null) === input) &&
    [...flags].every(([id, want]) => { const actual = [...next.inputs, ...next.outputs].find(c => `${c.type}:${c.key}` === id);
      return actual && actual.mute === want.mute && actual.tone === want.tone; }), 'the audio routing');
}

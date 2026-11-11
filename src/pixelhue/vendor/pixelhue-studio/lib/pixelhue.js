import http from 'node:http';
import { mvrSources } from './mvr-layers.js';
import https from 'node:https';
import { createHmac, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { inputSignals, screenSignals, layerAspect } from './mvr-signals.js';
import { parseUmdConfig } from './mvr-umd.js';
import { configuration } from './configuration.js';
import { audioSupported } from './studio-audio.js';
import { hasOverlap, orderGeometryChanges, sourceSignal, matchesRatio, windowLimit, growsPastLimit } from '../public/mvr-geometry.js';

export const MODELS = { 28944: 'P20', 28945: 'P10', 30006: 'P80', 29974: 'Q8' };

export function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function makeToken(sn, startTime) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ SN: sn })}`;
  return `${input}.${createHmac('sha256', String(startTime)).update(input).digest('base64url')}`;
}

export function validateHost(value) {
  const host = typeof value === 'string' ? value.trim() : '';
  if (!host || host.length > 253 || (!isIP(host) && !/^(?=.{1,253}$)[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/i.test(host))) {
    throw fail('Enter a device IP address or hostname, without a URL or port.');
  }
  return host;
}

export function validatePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail('Port must be between 1 and 65535.');
  return port;
}

export function requestJson({ host, port, path, secure = false, token, method = 'GET', body, timeoutMs = 8000, responseType = 'json', contentType }) {
  return new Promise((resolve, reject) => {
    // Buffers (multipart uploads, WO-027) are sent as-is with their own content type.
    const data = body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body);
    const request = (secure ? https : http).request({
      hostname: host, port, path, method,
      // The device discovery service uses a self-signed certificate, as in Companion.
      ...(secure ? { rejectUnauthorized: false } : {}),
      headers: { Accept: responseType === 'text' ? 'application/xml,text/xml,text/plain' : 'application/json', ...(token ? { Authorization: token } : {}),
        ...(data ? { 'Content-Type': contentType || 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        text += chunk;
        if (text.length > (responseType === 'text' ? 32_000_000 : 8_000_000)) response.destroy(fail('Device response is too large.', 502));
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            throw fail(`Device HTTP ${response.statusCode} at ${path}.`, 502);
          }
          if (responseType === 'text') { resolve(text); return; }
          const json = JSON.parse(text);
          if (!json || typeof json !== 'object' || Array.isArray(json) || ![0, 200].includes(json.code)) {
            throw fail(`Device rejected ${path}: ${json?.message || 'unexpected response'} (code ${json?.code ?? 'missing'}).`, 502);
          }
          resolve(json);
        } catch (error) {
          reject(error instanceof SyntaxError ? fail(`Device returned invalid JSON at ${path}.`, 502) : error);
        }
      });
    });
    const timeout = setTimeout(() => request.destroy(fail(`Device request timed out at ${path}.`, 504)), timeoutMs);
    request.on('close', () => clearTimeout(timeout));
    request.on('error', (error) => reject(error.status ? error : fail(`Cannot reach ${host}:${port}: ${error.message}`, 502)));
    request.end(data);
  });
}

export function normalise(screens, layers, interfaces = [], umdConfig = null) {
  if (!Array.isArray(screens) || !Array.isArray(layers)) throw fail('Device list-detail response is missing its list.', 502);
  const mvr = screens.filter((screen) => screen.screenIdObj?.type === 8).map((screen) => {
    const width = Number(screen.timing?.horizontal?.addTime || screen.mosaic?.window?.width || 1920);
    const height = Number(screen.timing?.vertical?.addTime || screen.mosaic?.window?.height || 1080);
    if (![width, height].every((n) => Number.isInteger(n) && n >= 64 && n <= 16384)) {
      throw fail('Device reported invalid MVR output dimensions.', 502);
    }
    return { id: screen.screenId, name: screen.general?.name || 'Multiviewer', width, height,
      dimensionsAssumed: !screen.timing?.horizontal?.addTime && !screen.mosaic?.window?.width };
  });
  const ids = new Set(mvr.map((screen) => screen.id));
  const signals = [...inputSignals(interfaces), ...screenSignals(screens)];
  return { screens: mvr, signals, layers: layers.filter((layer) => ids.has(layer.layerIdObj?.attachScreenId)).map((layer) => ({
    id: layer.layerId, screenId: layer.layerIdObj.attachScreenId,
    name: layer.general?.name || `Window ${layer.serial ?? layer.layerId}`,
    source: layer.source?.general?.sourceName || '', window: layer.window, ...layerAspect(layer, signals, umdConfig),
  })) };
}

export function validateChanges(changes, state) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 128) throw fail('Supply 1–128 window changes.');
  const seen = new Set();
  const validated = changes.map((change) => {
    if (!change || !Number.isSafeInteger(change.id) || seen.has(change.id)) throw fail('Invalid or duplicate window ID.');
    seen.add(change.id);
    const layer = state.layers.find((item) => item.id === change.id);
    if (!layer) throw fail(`Window ${change.id} is no longer on an MVR screen. Refresh the layout.`, 409);
    const screen = state.screens.find((item) => item.id === layer.screenId);
    const window = Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, change.window?.[key]]));
    if (!Object.values(window).every(Number.isSafeInteger) || window.x < 0 || window.y < 0 ||
      window.width < 64 || window.height < 64 || window.x + window.width > screen.width || window.y + window.height > screen.height) {
      throw fail(`Window ${layer.name} must fit within ${screen.width} × ${screen.height}, with a minimum size of 64 × 64.`);
    }
    const aspect = {};
    if (Object.hasOwn(change, 'aspectLock')) {
      if (change.aspectLock !== null && (typeof change.aspectLock !== 'number' || !Number.isFinite(change.aspectLock) || change.aspectLock < 1 / 256 || change.aspectLock > 256)) throw fail('Invalid aspect ratio lock.');
      if (![5, 8].includes(change.aspectMode)) throw fail('Invalid aspect ratio mode.');
      const existingLock = Boolean(layer.aspectLock) && change.aspectMode === layer.aspectMode;
      const sameSize = window.width === layer.window.width && window.height === layer.window.height;
      // Moving an existing rectangle must remain possible even if its signal has
      // changed since the native lock was established. Resizes still enforce ratio.
      if (change.aspectLock && !(existingLock && sameSize) && !matchesRatio(window, change.aspectLock, layer.umdHeight)) throw fail('Window size does not match its locked aspect ratio including UMD.');
      if (change.aspectLock && change.aspectMode === 8) {
        const candidate = sourceSignal(layer, state.signals || []);
        const signal = candidate?.connected ? candidate : null;
        const retainsRectangleRatio = matchesRatio(layer.window, change.aspectLock, layer.umdHeight);
        const preservesExisting = existingLock && (sameSize || (!signal && retainsRectangleRatio));
        if (!preservesExisting && (!signal || Math.abs(signal.width / signal.height - change.aspectLock) > 1e-9)) {
          throw fail(`The source connection or resolution changed for ${layer.name}. Fix aspect ratios again before resizing, or turn off Keep aspect ratio.`, 409);
        }
      }
      aspect.aspectLock = change.aspectLock; aspect.aspectMode = change.aspectMode;
    }
    return { layerId: change.id, window, ...aspect };
  });
  const changedScreens = new Set(validated.map((item) => state.layers.find((layer) => layer.id === item.layerId).screenId));
  const final = state.layers.filter((layer) => changedScreens.has(layer.screenId)).map((layer) => ({ ...layer,
    window: validated.find((item) => item.layerId === layer.id)?.window || layer.window }));
  if (hasOverlap(final)) throw fail('MVR windows cannot overlap. Move or resize the pending windows first.');
  for (const item of validated) { // WO-028 input window limit (P10/P20), checked after overlap
    const layer = state.layers.find(l => l.id === item.layerId), limit = windowLimit(state.device?.model, layer.sourceType);
    if (growsPastLimit(item.window, layer.window, limit)) throw fail(`${layer.name}: input windows are limited to ${limit.width} × ${limit.height} on ${state.device.model} (glitch-free size).`);
  }
  return validated;
}

export class PixelhueClient {
  constructor(transport = requestJson) { this.transport = transport; }

  async connect(options) {
    this.umdConfig = undefined; this.audioSupport = undefined;
    this.configurationPromise = undefined;
    this.configurationXml = undefined;
    this.host = validateHost(options.host);
    this.port = options.apiPort ? validatePort(options.apiPort) : null;
    let detail, discoveredModelId;
    if (!this.port) {
      const discovery = await this.transport({ host: this.host, port: 19998, secure: true, path: '/unico/v1/ucenter/device-list' });
      const devices = discovery.data?.list;
      if (!Array.isArray(devices) || !devices.length) throw fail('No device returned by discovery. Try an explicit API port.', 502);
      let addresses = [this.host.toLowerCase()];
      if (!isIP(this.host) && devices.some((device) => device.ip)) {
        const resolved = await lookup(this.host, { all: true }).catch(() => []);
        addresses.push(...resolved.map((entry) => entry.address.toLowerCase()));
      }
      const matching = devices.filter((device) => typeof device.ip === 'string' && addresses.includes(device.ip.toLowerCase()));
      const candidates = options.serial ? devices.filter((device) => device.SN === options.serial) : matching.length ? matching : devices;
      const ports = [...new Set(candidates.map((device) => device.protocols?.find((p) => p.linkType === 'http')?.port)
        .filter((port) => Number.isInteger(Number(port)) && Number(port) > 0 && Number(port) <= 65535).map(Number))];
      for (const port of ports) {
        try {
          // Probe only the entered address, never a different discovered IP.
          const result = await this.transport({ host: this.host, port, path: '/unico/v1/node/open-detail' });
          const record = candidates.find((device) => device.SN === result.data?.sn);
          if (!record || !result.data?.sn || result.data.startTime == null) continue;
          this.port = port; detail = result; discoveredModelId = record.modelId; break;
        } catch { /* Other advertised API ports may not exist at this address. */ }
      }
      if (!detail) throw fail(`Could not identify the device at ${this.host}. Check its address or specify its API port in Connection options.`, 502);
    }
    detail ??= await this.transport({ host: this.host, port: this.port, path: '/unico/v1/node/open-detail' });
    if (!detail.data?.sn || detail.data.startTime == null) throw fail('Device did not return SN and startTime.', 502);
    if (options.serial && detail.data.sn !== options.serial) throw fail('Connected device serial does not match the requested serial.', 409);
    this.serial = detail.data.sn;
    this.token = makeToken(this.serial, detail.data.startTime);
    this.modelId = Number(detail.data.modelId ?? discoveredModelId);
    if (!MODELS[this.modelId]) {
      const node = await this.call('node/detail?nodeId=1');
      this.modelId = Number(node.data?.modelId ?? node.data?.modeId ?? node.data?.configInfo?.modeId);
    }
    this.model = MODELS[this.modelId];
    if (!this.model) throw fail(`Unsupported device model (${this.modelId || 'unknown'}). Supported devices: P10, P20, P80 and Q8.`, 400);
    this.session = randomUUID();
    return this.read();
  }

  async call(path, body, options = {}) {
    return this.transport({ host: this.host, port: this.port, token: this.token,
      path: `/unico/v1/${path}`, method: body ? 'PUT' : 'GET', body, ...options });
  }

  async read() {
    this.audioSupport ??= await audioSupported(this).catch(() => false);
    const metadata = { session: this.session, device: this.deviceInfo(), capabilities: { inputs: true, mvr: ['P20', 'Q8'].includes(this.model), audio: this.audioSupport } };
    if (!['P20', 'Q8'].includes(this.model)) return { screens: [], layers: [], ...metadata };
    const [screens, layers, interfaces] = await Promise.all([this.call('screen/list-detail'), this.call('layers/list-detail'), this.call('interface/list-detail')]);
    if (!Array.isArray(interfaces.data?.list)) throw fail('Device did not return its interface list.', 502);
    if (this.umdConfig === undefined) {
      await configuration(this);
      this.umdConfig = parseUmdConfig(this.configurationXml);
    }
    return { ...normalise(screens.data?.list, layers.data?.list, interfaces.data.list, this.umdConfig),
      sources: mvrSources(screens.data?.list || [], interfaces.data.list, layers.data?.list || [], this.model, this.umdConfig), ...metadata };
  }

  deviceInfo() {
    return { host: this.host, port: this.port, serial: this.serial, model: this.model, modelId: this.modelId };
  }

  async apply(changes) {
    if (!['P20', 'Q8'].includes(this.model)) throw fail('Multiviewer editing is available for P20 and Q8. This device supports inputs in this app.', 403);
    const before = await this.read(), body = validateChanges(changes, before);
    const changedGeometry = body.filter((item) => {
      const old = before.layers.find((layer) => layer.id === item.layerId).window;
      return Object.keys(item.window).some((key) => item.window[key] !== old[key]);
    }).map(({ layerId, window }) => ({ id: layerId, window }));
    let geometry;
    try { geometry = orderGeometryChanges(before.layers, changedGeometry).map(({ id, window }) => ({ layerId: id, window })); }
    catch (error) { throw fail(error.message); }
    const aspects = body.filter((item) => {
      const old = before.layers.find((layer) => layer.id === item.layerId);
      return Object.hasOwn(item, 'aspectLock') && (Boolean(item.aspectLock) !== Boolean(old.aspectLock) || item.aspectMode !== old.aspectMode);
    }).map((item) => ({ layerId: item.layerId, aspectRatio: item.aspectMode, locked: item.aspectLock ? 1 : 0 }));
    if (geometry.length) await this.call('layers/window', geometry);
    if (aspects.length) await this.call('layers/aspect-ratio', aspects);
    // Some firmware acknowledges writes while retaining template geometry.
    let state;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 200));
      state = await this.read();
      const matches = body.every((change) => {
        const layer = state.layers.find((layer) => layer.id === change.layerId), actual = layer?.window;
        return actual && Object.keys(change.window).every((key) => actual[key] === change.window[key]) &&
          (!Object.hasOwn(change, 'aspectLock') || (Boolean(layer.aspectLock) === Boolean(change.aspectLock) && layer.aspectMode === change.aspectMode));
      });
      if (matches && !hasOverlap(state.layers)) return state;
    }
    throw Object.assign(fail('The device did not retain the requested geometry or aspect locks. Device firmware may enforce template positions or input sizes. Refresh to inspect the actual layout.', 409), { snapshot: state });
  }
}

import { xmlFile, xmlTree, child } from './configuration.js';
import { find, allowed } from './interface-config.js';
const caches = new WeakMap();
export function outputConfig(client) {
  let cache = caches.get(client);
  if (cache?.xml !== client.configurationXml || !cache) { cache = { xml: client.configurationXml, files: new Map() }; caches.set(client, cache); }
  const tree = path => { if (!cache.files.has(path)) cache.files.set(path, xmlTree(xmlFile(client.configurationXml, path))); return cache.files.get(path); };
  return { card: id => find(tree(`deviceconfig/subcard/outputcard/${id}.xml`), n => n.name === 'Subcard'), connector: type => find(tree(`deviceconfig/connector/${type}.xml`), n => n.name === 'Connector'),
    resolutions: () => find(tree('deviceconfig/connector/resolutionratio.xml'), n => n.name === 'ResolutionRatios') };
}
const role = (n, type) => n?.children.find(c => c.name === 'Interface' && (Number(c.attributes.Type) & type) === type);
export function outputTimingOptions(client, raw, workMode) {
  const cfg = outputConfig(client), info = raw.auxiliaryInfo.connectorInfo, card = cfg.card(info.subCardModelId);
  const deviceMode = child(card, 'Connectors')?.children.find(n => n.name === 'DeviceMode' && Number(n.attributes.Value) === workMode);
  const specific = child(deviceMode, 'Timing')?.children.find(n => Number(n.attributes.Type) === info.type);
  const generic = child(cfg.connector(info.type), 'PresetThumbTiming');
  const parent = specific || generic, r = role(parent, info.interfaceType);
  const cap = r?.children.find(n => n.name === 'CapacityMode' && Number(n.attributes.Value) === info.capacity);
  const ratio = child(child(cap, 'ResolutionRatios'), 'ResolutionRatio');
  const ports = find(deviceMode, n => n.name === 'Capacity' && Number(n.attributes.Value) === info.capacity)?.children || [];
  const port = ports.find(n => n.name === 'Connector' && Number(n.attributes.Position) === raw.interfaceIdObj?.connectorId && Number(n.attributes.Type) === info.type);
  const interlacedAllowed = port?.attributes.InterlacedEnable !== '0';
  const limits = Object.fromEntries(['Width', 'Height'].flatMap(name => { const n = child(ratio, name); return n ? [[name.toLowerCase(), { min: Number(n.attributes.Min), max: Number(n.attributes.Max), step: Number(n.attributes.Step) || 1 }]] : []; }));
  const disabled = child(child(cap, 'ResolutionRatios'), 'Disables')?.children || [];
  const valid = t => (interlacedAllowed || t.interlaced === 0) && !disabled.some(n => Number(n.attributes.Width) === t.width && Number(n.attributes.Height) === t.height && Number(n.attributes.Interlaced) === t.interlaced && Number(n.attributes.StandardType) === t.standardType && (!n.children.length || n.children.some(e => Math.abs(Number(e.attributes.Value) * (Number(n.attributes.Coefficient) || 1) - t.frame) < 0.001))) && Object.entries(limits).every(([key, rule]) => t[key] >= rule.min && t[key] <= rule.max && (t[key] - rule.min) % rule.step === 0);
  const presets = [], seen = new Set(), root = cfg.resolutions();
  if (root) for (const capacity of root.children.filter(n => n.name === 'CapacityMode' && Number(n.attributes.Value) <= info.capacity)) {
    for (const item of capacity.children.filter(n => n.name === 'ResolutionRatio')) {
      const a = item.attributes;
      for (const frame of item.children.filter(n => n.name === 'Enum')) {
        const timing = { width: Number(a.Width), height: Number(a.Height), frame: Math.round(Number(frame.attributes.Value) * (Number(a.Coefficient) || 1) * 1000) / 1000,
          standardType: Number(a.StandardType) || 0, interlaced: Number(a.Interlaced) || 0 };
        const key = Object.values(timing).join(',');
        if (timing.width > 0 && timing.height > 0 && timing.frame > 0 && valid(timing) && !seen.has(key)) {
          seen.add(key); presets.push({ ...timing, key, label: `${timing.width} × ${timing.height}${timing.interlaced ? 'i' : 'p'} ${timing.frame} Hz · ${['Auto', 'DMT', 'CVT', 'CVT-RB', 'CVT-RB2', 'CVT-RB3', 'CEA', 'SMPTE'][timing.standardType]}` });
        }
      }
    }
  }
  // Existing firmware without a resolution table keeps basic CEA presets available.
  if (!root) for (const [w, h] of [[1280, 720], [1920, 1080], ...(info.capacity >= 2 ? [[3840, 2160], [4096, 2160]] : [])]) for (const f of [24, 25, 30, 50, 59.94, 60]) {
    const t = { width: w, height: h, frame: f, standardType: 6, interlaced: 0 };
    if (valid(t)) presets.push({ ...t, key: Object.values(t).join(','), label: `${w} × ${h}p ${f} Hz · CEA` });
  }
  return { presets, limits, interlacedAllowed, timingCheck: Boolean(find(card, n => n.name === 'TimingCheck')), timingAllowed: [0, 1, 2, 3].includes(info.capacity) && (!parent || allowed(parent)) && (!r || allowed(r)) && (!cap || allowed(cap)) };
}
export function outputCapacityGroups(client, raw, node, cards) {
  if (client.model !== 'P20') return [];
  const result = [];
  for (const card of cards || []) {
    const xml = outputConfig(client).card(card.modelId), groups = child(xml, 'CapacityGroups');
    if (!allowed(groups)) continue;
    const options = (groups?.children || []).filter(n => n.name === 'Capacity' && allowed(n) && n.attributes.Enable !== '0' && [1, 2].includes(Number(n.attributes.Value))).flatMap(cap => {
      const mode = child(cap, 'DeviceModes')?.children.find(n => Number(n.attributes.Value) === node.mode?.workMode);
      if (!allowed(mode)) return [];
      const ports = (mode?.children || []).filter(n => n.name === 'Connector').map(n => ({ index: Number(n.attributes.Position), workMode: Number(n.attributes.WorkMode), backupPos: Number(n.attributes.BackupPos), capacity: Number(n.attributes.CapacityMode) }));
      if (!ports.length) return [];
      const independent = ports.filter(p => p.workMode === 0).map(p => p.index + 1);
      return [{ value: Number(cap.attributes.Value), label: cap.attributes.Name, independent, ports }];
    });
    if (options.length < 2) continue;
    const ports = raw.filter(i => i.interfaceIdObj?.slotId === card.slotId && i.auxiliaryInfo.connectorInfo.interfaceType === 4 && i.auxiliaryInfo.connectorInfo.type === 6 && options[0].ports.some(p => p.index === i.interfaceIdObj.connectorId));
    if (ports.length !== options[0].ports.length) continue;
    const capacities = new Set(ports.map(i => i.auxiliaryInfo.connectorInfo.capacity));
    result.push({ slotId: card.slotId, modelId: card.modelId, capacity: capacities.size === 1 ? [...capacities][0] : null, options });
  }
  return result;
}

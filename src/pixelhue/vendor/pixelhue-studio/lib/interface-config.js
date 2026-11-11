import { xmlTree, xmlFile, child, configuration } from './configuration.js';

const caches = new WeakMap();
export const allowed = node => Boolean(node) && node.attributes.Support !== '0' && node.attributes.Editable !== '0';
export function find(node, predicate) {
  if (!node) return undefined;
  if (predicate(node)) return node;
  for (const item of node.children) { const hit = find(item, predicate); if (hit) return hit; }
}
// Card XML is sparse: inherit unspecified connector fields, but honour explicit
// Support/Editable=0 and replace enum sets rather than widening them.
function merge(base, override) {
  if (!override) return base;
  if (!base) return override;
  const result = { name: override.name, attributes: { ...base.attributes, ...override.attributes }, children: [...base.children] };
  if (override.children.some(n => n.name === 'Enum')) result.children = result.children.filter(n => n.name !== 'Enum');
  for (const node of override.children) {
    const key = n => `${n.name}:${n.attributes.Type ?? (n.name === 'Enum' ? n.attributes.Value : '') ?? ''}`;
    const index = result.children.findIndex(n => key(n) === key(node));
    if (index < 0) result.children.push(node); else result.children[index] = merge(result.children[index], node);
  }
  return result;
}
const role = (node, type = 2) => node?.children.find(n => n.name === 'Interface' && (Number(n.attributes.Type) & type) === type);
export const leaves = node => {
  if (!allowed(node)) return [];
  if (!node.children.length) return [node];
  return node.children.flatMap(leaves);
};

export async function interfaceConfiguration(client, raw, node) {
  const feature = await configuration(client), marker = client.configurationPromise;
  let cache = caches.get(client);
  if (!cache || cache.marker !== marker) { cache = { marker, files: new Map() }; caches.set(client, cache); }
  const tree = path => {
    if (!cache.files.has(path)) cache.files.set(path, xmlTree(xmlFile(client.configurationXml, path)));
    return cache.files.get(path);
  };
  const info = raw.auxiliaryInfo.connectorInfo, type = info.type, id = info.subCardModelId ?? raw.modelId;
  let card;
  for (const kind of ['inputcard', 'mixcard', 'outputcard']) {
    const hit = find(tree(`deviceconfig/subcard/${kind}/${id}.xml`), n => n.name === 'Subcard' && Number(n.attributes.ModelId) === id);
    if (hit) { card = hit; break; }
  }
  const connectors = child(card, 'Connectors'), types = child(connectors, 'Types');
  const specific = types?.children.find(n => n.name === 'Connector' && Number(n.attributes.Type) === type);
  const mode = connectors?.children.find(n => n.name === 'DeviceMode' && Number(n.attributes.Value) === node.mode?.workMode);
  const capacity = find(mode, n => n.name === 'Capacity' && Number(n.attributes.Value) === info.capacity);
  const port = find(capacity, n => n.name === 'Connector' && Number(n.attributes.Type) === type && Number(n.attributes.Position) === raw.interfaceIdObj?.connectorId);
  const generic = find(tree(`deviceconfig/connector/${type}.xml`), n => n.name === 'Connector' && Number(n.attributes.Type) === type);
  // Inputs are role 2; outputs match their own role bit (4 Main, 8 AUX, 16 MVR) in e.g. Interface Type="124" (WO-037).
  const kind = info.interfaceType || 2;
  function property(name, plural = name) {
    const genericParent = child(generic, plural), genericRole = role(genericParent, kind);
    const base = genericRole ? child(genericRole, name) || genericRole : genericParent;
    const typeParent = child(specific, name), typeRole = role(typeParent, kind);
    const fromType = typeRole || typeParent, override = child(port, name);
    if (genericParent && !allowed(genericParent) && !fromType && !override) return undefined;
    if (typeParent && !allowed(typeParent)) return undefined;
    const merged = merge(merge(base, fromType), override);
    return allowed(merged) ? merged : undefined;
  }
  return { feature, property, specific, port };
}

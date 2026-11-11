export function xmlFile(xml, path) {
  if (typeof xml !== 'string') return '';
  // feature.xml contains its own <File> feature element, so a file ends at the last
  // </File> before the next top-level <File><path>, not at the first </File> (WO-015).
  const starts = [...xml.matchAll(/<File\b[^>]*>\s*<path>\s*([^<]+?)\s*<\/path>/g)];
  const index = starts.findIndex(start => start[1] === path);
  if (index < 0) return '';
  const chunk = xml.slice(starts[index].index, starts[index + 1]?.index ?? xml.length);
  const end = chunk.lastIndexOf('</File>');
  return end < 0 ? chunk : chunk.slice(0, end + 7);
}

export function xmlTree(text) {
  const root = { name: 'root', attributes: {}, children: [] }, stack = [root];
  for (const match of text.matchAll(/<!--[\s\S]*?-->|<\/?([\w:-]+)\b([^>]*?)>/g)) {
    const raw = match[0];
    if (raw.startsWith('<!--')) continue;
    if (raw.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
    const attributes = Object.fromEntries([...match[2].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1], m[2]]));
    const node = { name: match[1], attributes, children: [] };
    stack.at(-1).children.push(node);
    if (!raw.endsWith('/>')) stack.push(node);
  }
  return root;
}
export const child = (node, name) => node?.children.find(n => n.name === name);
export const atPath = (node, ...names) => names.reduce(child, node);
export const supported = (node, fallback = false) => node ? node.attributes.Support === '1' && node.attributes.Editable !== '0' : fallback;
export const enumValues = (node) => (node?.children || []).filter(n => n.name === 'Enum')
  .map(n => Number(n.attributes.Value)).filter(Number.isFinite);

export async function configuration(client) {
  if (!client.configurationPromise) client.configurationPromise = client.call('node/config-file?nodeId=1&para=0', undefined,
    { responseType: 'text', timeoutMs: 15000 }).then(xml => {
      client.configurationXml = xml;
      const tree = xmlTree(xmlFile(xml, 'deviceconfig/device/feature.xml'));
      const file = child(tree, 'File'), data = child(file, 'data');
      const dcs = child(data, 'DCS'), device = child(dcs, 'Device');
      return device || data || tree;
    }).catch(() => null);
  return client.configurationPromise;
}

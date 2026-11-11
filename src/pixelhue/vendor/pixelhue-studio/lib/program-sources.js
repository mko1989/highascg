import { fail } from './pixelhue.js';
import { configuration, xmlFile, xmlTree, child } from './configuration.js';
import { fixedInputNumber } from './input-models.js';

const mappings = new WeakMap();
function physicalMapper(client) {
  let cached = mappings.get(client);
  if (cached && cached.xml === client.configurationXml) return cached.map;
  const cards = new Map();
  const groupsFor = id => {
    if (!cards.has(id)) {
      let groups = [];
      for (const kind of ['inputcard', 'mixcard']) {
        const tree = xmlTree(xmlFile(client.configurationXml, `deviceconfig/subcard/${kind}/${id}.xml`));
        const data = child(child(tree, 'File'), 'data'), subcard = child(child(child(data, 'DCS'), 'Subcards'), 'Subcard');
        const select = child(subcard, 'ConnectorSelect');
        groups = (select?.children || []).filter(n => n.name === 'Capacity').flatMap(n => n.children.filter(c => c.name === 'Group'));
        if (groups.length) break;
      }
      cards.set(id, groups);
    }
    return cards.get(id);
  };
  const map = raw => {
    const alias = raw.auxiliaryInfo?.alias?.trim();
    if (alias) return alias;
    const fixed = fixedInputNumber(raw, client.model);
    if (fixed !== null) return `IN ${fixed}`;
    const { slotId: slot, connectorId: index } = raw.interfaceIdObj || {}, info = raw.auxiliaryInfo.connectorInfo;
    if (!Number.isInteger(slot) || !Number.isInteger(index)) return null;
    let port = index + 1;
    if (client.model === 'Q8' && info.subCardModelId === 30983) {
      // PixelFlow's ST2110 100G card: optical subports vs logical stream inputs.
      if (info.type === 65) return `IN ${slot + 1}-1-${index + 1}`;
      port = index - 6;
    }
    if (client.model === 'P80') {
      const groups = groupsFor(info.subCardModelId), contains = group => group.children.filter(c => c.name === 'Connector');
      const own = groups.find(g => contains(g).some(c => Number(c.attributes.Position) === index));
      if (own?.attributes.PrintKeyNo) port = own.attributes.PrintKeyNo;
      else for (const group of groups) {
        const before = contains(group).filter(c => Number(c.attributes.Position) < index).length;
        port -= before; if (before && group.attributes.PrintKeyNo) port++;
      }
    }
    return `IN ${slot + 1}-${port}`;
  };
  mappings.set(client, { xml: client.configurationXml, map }); return map;
}
// Raw device LinkStateE (editor1/common/enum.ts:748), before PixelFlow's
// InterfaceStatusE display conversion. In particular raw 3/4 still have a signal.
const SIGNAL = {
  0: ['No signal', 'off'], 1: ['Live', 'live'], 2: ['Live · over capacity', 'warning'],
  3: ['Live · unstable', 'warning'], 4: ['Live · nonstandard', 'warning'],
  5: ['No signal · nonstandard', 'off'], 6: ['No signal · over capacity', 'off'],
  7: ['Live · backup', 'live'], 8: ['No signal · backup', 'off'],
};
export function programInputSources(client, interfaces) {
  const mapping = physicalMapper(client);
  const sources = interfaces.filter(i => i.auxiliaryInfo?.connectorInfo?.interfaceType === 2 && i.auxiliaryInfo.connectorInfo.workMode !== 2).map(i => {
    const [signalLabel, signalHealth] = i.auxiliaryInfo.online === 0 ? ['Offline', 'off'] : SIGNAL[i.state] || ['Signal unknown', 'off'];
    return { id: i.interfaceId, type: 2, connectorType: i.auxiliaryInfo.connectorInfo.type, mapping: mapping(i),
      slotId: i.interfaceIdObj?.slotId, connectorId: i.interfaceIdObj?.connectorId,
      name: i.general?.name || `Input ${i.interfaceId}`, connected: signalHealth !== 'off', signalLabel, signalHealth,
      width: i.actualTiming?.horizontal?.addTime, height: i.actualTiming?.vertical?.addTime };
  });
  return sources.sort((a, b) => Number(b.connected) - Number(a.connected) ||
    Number(!a.mapping) - Number(!b.mapping) || (a.mapping || '').localeCompare(b.mapping || '', 'en', { numeric: true, sensitivity: 'base' }) || a.id - b.id);
}
export async function readProgramSources(client) {
  const [response] = await Promise.all([client.call('interface/list-detail'), client.model === 'P80' ? configuration(client) : undefined]);
  if (!Array.isArray(response.data?.list)) throw fail('Input sources were not returned.', 502);
  return { session: client.session, sources: programInputSources(client, response.data.list) };
}

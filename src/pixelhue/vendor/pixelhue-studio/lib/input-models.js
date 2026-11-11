import { fail } from './pixelhue.js';

// Owner-specified supported capacity modes: SL=0, DL=1, 4K=2.
export const capacityChoices = (model) => ({ P10: [0, 2], P20: [1, 2], P80: [2] }[model] || []);

const BACKBOARDS = {
  P20: [
    { slotId: 100, modelId: 28944, first: 1, count: 4 },
    { slotId: 0, modelId: 15728896, first: 5, count: 2 },
    { slotId: 1, modelId: 15728896, first: 7, count: 2 },
    { slotId: 3, modelId: 15728898, first: 9, count: 4, sdi: true },
  ],
  P10: [
    { slotId: 100, modelId: 28945, first: 1, count: 4 },
    { slotId: 0, modelId: 15728900, first: 5, count: 2, sdi: true },
  ],
};
const LABELS = { 2: 'DVI SL', 3: 'DVI DL', 4: 'HDMI 1.3', 5: 'HDMI 1.4', 6: 'HDMI 2.0',
  7: 'DP 1.1 SL', 8: 'DP 1.2', 9: '3G-SDI', 13: '12G-SDI', 14: '6G-SDI',
  17: 'DP 1.1 DL', 19: 'DVI 1.4', 20: 'DVI 1.4 DL', 21: 'HDMI 1.4 DL', 34: 'HDMI 2.1', 35: 'DP 1.4', 56: 'USB-C' };
const EDID_TYPES = new Set([2, 3, 4, 5, 6, 7, 8, 17, 19, 20, 21, 34, 35]);
const SDI_TYPES = new Set([9, 13, 14]);
export const connectorLabel = (type) => LABELS[type] || `Connector ${type}`;
export const supportsEdid = (type) => EDID_TYPES.has(type);
export const isSdi = (type) => SDI_TYPES.has(type);
export function interfaceFor(interfaces, slotId, index, type) {
  return interfaces.find((item) => item.interfaceIdObj?.slotId === slotId &&
    (item.type ?? item.auxiliaryInfo?.connectorInfo?.type) === type &&
    (item.index ?? item.interfaceIdObj?.connectorId) === index && item.auxiliaryInfo?.connectorInfo?.interfaceType === 2);
}

export function inputGroups(interfaces, cards, model) {
  if (['P80', 'Q8'].includes(model)) {
    // The installed card layout is the source of truth on modular models.
    const groups = [], seen = new Set();
    for (const card of [...cards].sort((a, b) => a.slotId - b.slotId)) {
      for (const connector of [...(card.connectors || [])].sort((a, b) => a.index - b.index)) {
        const input = interfaceFor(interfaces, card.slotId, connector.index, connector.type);
        const reportedModel = input?.auxiliaryInfo?.connectorInfo?.subCardModelId;
        const key = `${card.slotId}:port:${connector.index}:${connector.type}`;
        if (!input || (reportedModel != null && reportedModel !== card.modelId) || seen.has(key)) continue;
        seen.add(key);
        groups.push({ key, number: groups.length + 1,
          card, connectors: [connector], fixedPort: true, location: `SLOT ${card.slotId} · PORT ${connector.index + 1}` });
      }
    }
    return groups;
  }
  if (!BACKBOARDS[model]) throw fail('Unsupported device model. Supported inputs: P10, P20, P80 and Q8.', 400);
  return BACKBOARDS[model].flatMap((spec) => {
    const card = cards.find((item) => item.slotId === spec.slotId && item.modelId === spec.modelId);
    if (!card || !Array.isArray(card.connectors)) return [];
    return Array.from({ length: spec.count }, (_, pair) => ({ key: `${spec.slotId}:${pair}`, number: spec.first + pair,
      card, fixedPort: Boolean(spec.sdi), location: `SLOT ${spec.slotId} · PAIR ${pair + 1}`,
      connectors: (spec.sdi ? [13, 13] : [8, 6]).map((type, offset) => card.connectors.find((item) => item.index === pair * 2 + offset && item.type === type)).filter(Boolean),
    })).filter((group) => group.connectors.length);
  });
}

// Fixed P10/P20 printed input numbers; HDMI/DP share a physical input pair.
export function fixedInputNumber(raw, model) {
  const slot = raw.interfaceIdObj?.slotId, port = raw.interfaceIdObj?.connectorId;
  const spec = BACKBOARDS[model]?.find(s => s.slotId === slot);
  return spec && Number.isInteger(port) && port >= 0 && Math.floor(port / 2) < spec.count ? spec.first + Math.floor(port / 2) : null;
}

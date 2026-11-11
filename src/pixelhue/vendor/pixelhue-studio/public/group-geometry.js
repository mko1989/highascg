// Grouped-input geometry shared by server and client (WO-025). See lib/layer-groups.js.
const NAME = /^GRP(\d+)-([HV])-([AB])$/;
export const parseGroup = name => { const m = NAME.exec(name || ''); return m ? { group: Number(m[1]), orient: m[2], part: m[3] } : null; };

export function groupOf(layers, layer) {
  const g = parseGroup(layer?.name); if (!g) return null;
  const members = layers.filter(l => l.screenId === layer.screenId && l.scene === layer.scene && parseGroup(l.name)?.group === g.group);
  const a = members.find(l => parseGroup(l.name).part === 'A'), b = members.find(l => parseGroup(l.name).part === 'B');
  return a && b ? { group: g.group, orient: g.orient, a, b } : null;
}

export const unionWindow = (a, b) => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};

// Split a combined rectangle between A and B, keeping A's share of the main axis.
export function splitWindow(rect, orient, share) {
  if (orient === 'H') {
    const wa = Math.max(64, Math.min(rect.width - 64, Math.round(rect.width * share)));
    return [{ x: rect.x, y: rect.y, width: wa, height: rect.height }, { x: rect.x + wa, y: rect.y, width: rect.width - wa, height: rect.height }];
  }
  const ha = Math.max(64, Math.min(rect.height - 64, Math.round(rect.height * share)));
  return [{ x: rect.x, y: rect.y, width: rect.width, height: ha }, { x: rect.x, y: rect.y + ha, width: rect.width, height: rect.height - ha }];
}

// Native combined size of two sources (fallback 1920 × 1080 each).
export function groupSize(a, b, orient) {
  const [wa, ha, wb, hb] = [a?.width || 1920, a?.height || 1080, b?.width || 1920, b?.height || 1080];
  return orient === 'H' ? { width: wa + wb, height: Math.max(ha, hb), share: wa / (wa + wb) } : { width: Math.max(wa, wb), height: ha + hb, share: ha / (ha + hb) };
}


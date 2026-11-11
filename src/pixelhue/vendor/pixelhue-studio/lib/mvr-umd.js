const attr = (text, key) => text?.match(new RegExp(`\\b${key}\\s*=\\s*["']([^"']*)["']`))?.[1];
const pixels = (tag) => {
  const value = attr(tag, 'Value');
  return value !== undefined && /^\d+$/.test(value) && Number(value) <= 512 ? Number(value) : null;
};

// Read only the device feature and MVR layer files; never execute/resolve XML entities.
export function parseUmdConfig(xml) {
  if (typeof xml !== 'string') return null;
  let height = null, disabled = false;
  const bySourceType = {};
  for (const file of xml.matchAll(/<File\b[^>]*>[\s\S]*?<\/File>/g)) {
    const path = file[0].match(/<path>\s*([^<]+)\s*<\/path>/)?.[1]?.trim();
    if (path === 'deviceconfig/device/feature.xml') {
      for (const umd of file[0].matchAll(/<UMD\b[^>]*>[\s\S]*?<\/UMD>/g)) {
        if (attr(umd[0].match(/^<UMD\b[^>]*>/)?.[0], 'Support') === '0') { disabled = true; height = 0; continue; }
        const tag = umd[0].match(/<OccupyHeight\b[^>]*\/>/)?.[0];
        if (attr(tag, 'Support') === '1') height = pixels(tag);
      }
    }
    if (path === 'deviceconfig/device/layer_8.xml') {
      const umd = file[0].match(/<UMD\b[^>]*>[\s\S]*?<\/UMD>/)?.[0] || '';
      for (const border of umd.matchAll(/<Border\b[^>]*>[\s\S]*?<\/Border>/g)) {
        const type = Number(attr(border[0].match(/^<Border\b[^>]*>/)?.[0], 'Type'));
        const value = pixels(border[0].match(/<VWidth\b[^>]*\/>/)?.[0]);
        if ([2, 3, 4].includes(type) && value !== null) bySourceType[type] = value;
      }
    }
  }
  return disabled ? { height: 0, bySourceType: {} } : height !== null || Object.keys(bySourceType).length ? { height, bySourceType } : null;
}

export function umdHeight(layer, config) {
  const enabled = layer.UMD?.[0]?.enable === 1 || layer.UMD?.[0]?.enable === true;
  if (!enabled) return 0;
  return config?.bySourceType?.[layer.source?.general?.sourceType] ?? config?.height ?? null;
}

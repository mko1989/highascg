import { networkInterfaces } from 'node:os';
import { MODELS, requestJson, validateHost } from './pixelhue.js';

export function lanTargets(interfaces = networkInterfaces()) {
  const targets = new Set();
  for (const rows of Object.values(interfaces)) for (const item of rows || []) {
    if (item.internal || !['IPv4', 4].includes(item.family) || item.netmask !== '255.255.255.0') continue;
    if (!/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address)) continue;
    const prefix = item.address.split('.').slice(0, 3).join('.');
    for (let n = 1; n < 255; n++) if (`${prefix}.${n}` !== item.address) targets.add(`${prefix}.${n}`);
  }
  return [...targets].slice(0, 508);
}

export async function discoverPixelhue({ seed, scan = false } = {}, transport = requestJson, interfaces) {
  const found = new Map(), errors = [];
  const inspect = async (host, timeoutMs) => {
    try {
      const response = await transport({ host, port: 19998, secure: true,
        path: '/unico/v1/ucenter/device-list?clientType=8', timeoutMs });
      for (const record of response.data?.list || []) {
        if (!MODELS[record.modelId] || record.online === 0) continue;
        const port = Number(record.protocols?.find(p => p.linkType === 'http')?.port);
        if (!record.SN || !Number.isInteger(port) || port < 1 || port > 65535) continue;
        let ip; try { ip = validateHost(record.ip || host); } catch { continue; }
        const existing = found.get(record.SN);
        if (existing && existing.host === existing.serviceHost) continue;
        found.set(record.SN, { serial: record.SN, name: record.deviceName || MODELS[record.modelId],
          model: MODELS[record.modelId], modelId: record.modelId, host: ip, apiPort: port, serviceHost: host });
      }
    } catch (error) { if (seed === host) errors.push(error.message); }
  };
  const seeds = [...new Set(['127.0.0.1', ...(seed ? [validateHost(seed)] : [])])];
  await Promise.all(seeds.map(host => inspect(host, 1600)));
  let scanned = 0;
  if (scan || !found.size) {
    const targets = lanTargets(interfaces).filter(host => !seeds.includes(host));
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(32, targets.length) }, async () => {
      while (cursor < targets.length) { const host = targets[cursor++]; scanned++; await inspect(host, 600); }
    }));
  }
  return { devices: [...found.values()].sort((a, b) => a.name.localeCompare(b.name)), scanned,
    errors, service: 'pixelhue-19998' };
}

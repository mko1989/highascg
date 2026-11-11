import { configuration, child } from './configuration.js';
import { fail } from './pixelhue.js';
import { choice, verified } from './studio-common.js';

// Input source backup (WO-037). PixelFlow HotBackupPanel.tsx: GET/PUT system/ctrl/source-backup, every edit
// re-sends the whole { enable, primaryFirst, backup[] } object. Input source type is 2.
const INPUT = 2, on = node => Boolean(node) && node.attributes.Support === '1' && node.attributes.Editable !== '0';
async function context(client) {
  const feature = child(await configuration(client), 'SourceBackup');
  if (!on(feature)) return null;
  const [backup, list] = await Promise.all([client.call('system/ctrl/source-backup'), client.call('interface/list-detail')]);
  const raw = backup.data?.sourceBackup;
  if (!raw || !Array.isArray(list.data?.list)) throw fail('Device did not return its source backup settings.', 502);
  const inputs = list.data.list.filter(i => i.auxiliaryInfo?.connectorInfo?.interfaceType === INPUT && i.auxiliaryInfo.connectorInfo.workMode !== 2)
    .map(i => ({ id: i.interfaceId, name: i.general?.name || `Input ${i.interfaceId}`, capacity: i.auxiliaryInfo.connectorInfo.capacity, signal: i.state === 1 ? 1 : 0 }));
  return { raw: { ...raw, backup: Array.isArray(raw.backup) ? raw.backup : [] }, inputs, sameCapacity: child(feature, 'CapacityStrategy')?.attributes.Value !== '1' };
}
export async function readSourceBackup(client) {
  const base = { session: client.session, device: client.deviceInfo() }, ctx = await context(client);
  if (!ctx) return { ...base, supported: false, enable: 0, primaryFirst: 0, pairs: [], inputs: [] };
  const name = (id, fallback) => ctx.inputs.find(i => i.id === id)?.name || fallback || `Source ${id}`;
  return { ...base, supported: true, enable: ctx.raw.enable ? 1 : 0, primaryFirst: ctx.raw.primaryFirst ? 1 : 0, sameCapacity: ctx.sameCapacity, inputs: ctx.inputs,
    pairs: ctx.raw.backup.map(p => ({ id: p.id, primary: p.primarySourceId, backup: p.backupSourceId, primaryName: name(p.primarySourceId, p.primarySourceName), backupName: name(p.backupSourceId, p.backupSourceName),
      auto: p.switchMode !== 1, using: p.usingSourceId === p.backupSourceId ? 'backup' : p.usingSourceId === p.primarySourceId ? 'primary' : 'none', primaryFirst: p.primaryFirst ? 1 : 0,
      editable: p.primarySourceType === INPUT && p.backupSourceType === INPUT })) };
}
export async function applySourceBackup(client, body) {
  const ctx = await context(client);
  if (!ctx) throw fail('This device does not advertise source backup.', 403);
  const next = structuredClone(ctx.raw), pair = id => { const item = next.backup.find(p => p.id === id); if (!item) throw fail('Backup pair no longer exists. Refresh.', 409); return item; };
  const needEnabled = () => { if (!next.enable) throw fail('Turn source backup on before editing pairs.', 409); };
  if (body.action === 'enable') next.enable = choice(body.enable, [0, 1], 'backup state');
  else if (body.action === 'primary-first') {
    next.primaryFirst = choice(body.primaryFirst, [0, 1], 'primary preference'); for (const item of next.backup) item.primaryFirst = next.primaryFirst;
  } else if (body.action === 'add') {
    needEnabled();
    const primary = ctx.inputs.find(i => i.id === body.primary), backup = ctx.inputs.find(i => i.id === body.backup);
    if (!primary || !backup || primary.id === backup.id) throw fail('Choose two different current inputs.');
    if (next.backup.some(p => [p.primarySourceId, p.backupSourceId].some(id => id === primary.id || id === backup.id))) throw fail('One of these inputs already belongs to a backup pair.');
    if (ctx.sameCapacity ? primary.capacity !== backup.capacity : backup.capacity > primary.capacity) throw fail(ctx.sameCapacity ? 'Primary and backup inputs must have the same capacity (SL/DL/4K).' : 'The backup input cannot have a larger capacity than the primary.');
    // PixelFlow sends a new automatic pair with no source in use while either side has no signal.
    const live = primary.signal && backup.signal;
    next.backup.push({ id: Math.max(0, ...next.backup.map(p => Number(p.id) || 0)) + 1, primarySourceId: primary.id, primarySourceType: INPUT, primarySourceState: primary.signal,
      backupSourceId: backup.id, backupSourceType: INPUT, backupSourceState: backup.signal, switchMode: 0, usingSourceId: live ? primary.id : 0, usingSourceType: live ? INPUT : 0,
      primaryFirst: next.primaryFirst ? 1 : 0, primarySourceName: primary.name, backupSourceName: backup.name });
  } else if (body.action === 'update') {
    needEnabled(); const item = pair(body.id);
    if (body.auto === undefined && body.using === undefined && body.primaryFirst === undefined) throw fail('No backup pair change supplied.');
    if (body.primaryFirst !== undefined) item.primaryFirst = choice(body.primaryFirst, [0, 1], 'primary preference');
    if (body.auto !== undefined) {
      item.switchMode = choice(body.auto, [true, false], 'switch mode') ? 0 : 1;
      if (body.auto) { item.usingSourceId = item.primarySourceId; item.usingSourceType = item.primarySourceType; } // HotBackupPanel.tsx:1008
    }
    if (body.using !== undefined) {
      if (item.switchMode !== 1) throw fail('Choose the source in use only in manual mode.');
      const side = choice(body.using, ['primary', 'backup'], 'source in use');
      item.usingSourceId = item[`${side}SourceId`]; item.usingSourceType = item[`${side}SourceType`];
    }
  } else if (body.action === 'remove') { pair(body.id); next.backup = next.backup.filter(p => p.id !== body.id); }
  else if (body.action === 'clear') next.backup = [];
  else throw fail('Unsupported source backup action.');
  await client.call('system/ctrl/source-backup', { sourceBackup: next }, { timeoutMs: 20000 }).catch(error => {
    if (/code 8297/.test(error.message)) throw fail('The device refused this pair: a source used by Cut & Fill or keying cannot be backed up.', 409);
    throw error;
  });
  const want = next.backup.map(p => [p.id, p.primarySourceId, p.backupSourceId, p.switchMode, p.primaryFirst ? 1 : 0]);
  return verified(() => readSourceBackup(client), state => state.enable === (next.enable ? 1 : 0) && state.primaryFirst === (next.primaryFirst ? 1 : 0) && state.pairs.length === want.length &&
    want.every(([id, primary, backup, mode, first]) => state.pairs.some(p => p.id === id && p.primary === primary && p.backup === backup && p.auto === (mode !== 1) && p.primaryFirst === first)) &&
    (body.using === undefined || state.pairs.find(p => p.id === body.id)?.using === body.using), 'the source backup settings');
}

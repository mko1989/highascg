import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail } from './pixelhue.js';
import { choice } from './studio-common.js';
import { parseGroup } from '../public/group-geometry.js';

// Group sources (WO-027): reusable "two sources as one" definitions shown in the Groups tab.
// They are app data (the P20 has no multi-input source), stored per device serial OUTSIDE the repo
// so git/Syncthing never carry server-written files: $PIXELHUE_STUDIO_DATA or ~/.pixelhue-studio.
export const dataDir = () => process.env.PIXELHUE_STUDIO_DATA || join(homedir(), '.pixelhue-studio');
const file = () => join(dataDir(), 'group-sources.json');

async function load() { try { return JSON.parse(await readFile(file(), 'utf8')); } catch { return {}; } }
async function save(all) {
  await mkdir(dataDir(), { recursive: true });
  const temp = `${file()}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(all, null, 2)); await rename(temp, file());
}

// Saved definitions plus groups already placed on the device (GRP<n> layer pairs), deduplicated.
export async function readGroupSources(client, layers, sources) {
  const saved = (await load())[client.serial] || [];
  const key = g => `${g.orient}|${g.a.type}:${g.a.id}|${g.b.type}:${g.b.id}`, seen = new Set(saved.map(key)), found = [];
  for (const layer of layers) {
    const g = parseGroup(layer.name); if (!g || g.part !== 'A') continue;
    const b = layers.find(l => l.screenId === layer.screenId && l.scene === layer.scene && parseGroup(l.name)?.group === g.group && parseGroup(l.name)?.part === 'B');
    if (!b) continue;
    const def = { id: `device-${layer.screenId}-${layer.scene}-${g.group}`, name: `${layer.sourceName || 'A'} + ${b.sourceName || 'B'}`, orient: g.orient,
      a: { type: layer.sourceType, id: layer.sourceId }, b: { type: b.sourceType, id: b.sourceId }, onDevice: true };
    if (!seen.has(key(def))) { seen.add(key(def)); found.push(def); }
  }
  const valid = s => sources.some(x => x.type === s.type && x.id === s.id);
  return [...saved, ...found].map(def => ({ ...def, available: valid(def.a) && valid(def.b) }));
}

export async function saveGroupSource(client, request, sources) {
  const orient = choice(request.orientation, ['H', 'V'], 'group layout');
  const picked = (request.sources || []).map(s => sources.find(x => x.type === s?.type && x.id === s?.id));
  if (picked.length !== 2 || picked.some(s => !s)) throw fail('Choose two current sources for the group.');
  if (picked[0].type === picked[1].type && picked[0].id === picked[1].id) throw fail('Choose two different sources.');
  const name = typeof request.name === 'string' && request.name.trim() ? request.name.trim().slice(0, 64) : `${picked[0].name} + ${picked[1].name}`;
  const all = await load(), list = all[client.serial] || [];
  const def = { id: randomUUID(), name, orient, a: { type: picked[0].type, id: picked[0].id }, b: { type: picked[1].type, id: picked[1].id } };
  all[client.serial] = [...list, def]; await save(all);
  return def;
}

export async function deleteGroupSource(client, id) {
  const all = await load(), list = all[client.serial] || [];
  if (!list.some(d => d.id === id)) throw fail('Group source not found (groups placed on the device are listed until their layers are removed).', 404);
  all[client.serial] = list.filter(d => d.id !== id); await save(all);
}

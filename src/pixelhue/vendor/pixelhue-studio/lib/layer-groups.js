import { fail } from './pixelhue.js';
import { choice, verified } from './studio-common.js';

// Grouped inputs (WO-025): two normal layers kept edge-to-edge (H = side by side, A left; V = top/bottom,
// A top) and moved/resized as one rectangle. The P20 has no device group or multi-input source
// (interface/live-bkg and interface/mosaic-source are 404, MosaicSource Support=0), so the group lives in
// the layer names `GRP<n>-<H|V>-<A|B>`, which the device stores and every client sees.
import { parseGroup, groupOf, unionWindow, splitWindow, groupSize } from '../public/group-geometry.js';
export { parseGroup, groupOf, unionWindow, splitWindow, groupSize };

const rename = (client, layerId, name) => client.call('layers/general', [{ layerId, general: { name } }]);

export async function applyGroup(client, request, state, { read, screen, geometry, create, resourceHint }) {
  if (request.action === 'group-create') {
    const orient = choice(request.orientation, ['H', 'V'], 'group orientation'), scene = choice(request.scene, [2, 4], 'programming scene');
    if (!Array.isArray(request.sources) || request.sources.length !== 2) throw fail('Choose two sources for the group.');
    const sources = request.sources.map(s => state.sources.find(x => x.id === s?.id && x.type === s?.type));
    if (sources.some(s => !s) || ([3, 4].includes(sources[0].type) && sources[0].id === screen.id) || ([3, 4].includes(sources[1].type) && sources[1].id === screen.id)) throw fail('Choose two inputs or other screens.');
    const used = new Set(state.layers.map(l => parseGroup(l.name)?.group).filter(Boolean)); let n = 1; while (used.has(n)) n++;
    const size = groupSize(sources[0], sources[1], orient);
    const rect = request.window ? { ...request.window } : { x: Math.round((screen.width - size.width) / 2), y: Math.round((screen.height - size.height) / 2), width: size.width, height: size.height };
    const [wa, wb] = splitWindow(rect, orient, size.share);
    const before = new Set(state.layers.map(l => l.id)), made = [];
    try {
      for (const [source, window, part] of [[sources[0], wa, 'A'], [sources[1], wb, 'B']]) {
        const next = await create({ action: 'create', screenId: screen.id, scene, source: { id: source.id, type: source.type }, window, name: `GRP${n}-${orient}-${part}` });
        const layer = next.layers.find(l => !before.has(l.id) && !made.some(m => m.id === l.id)); made.push({ id: layer.id, part });
        if (layer.name !== `GRP${n}-${orient}-${part}`) await rename(client, layer.id, `GRP${n}-${orient}-${part}`);
      }
    } catch (error) {
      for (const m of made) await client.call('layers', [{ layerId: m.id, sn: client.serial }], { method: 'DELETE' }).catch(() => {});
      throw error;
    }
    return verified(() => read(client), next => made.every(m => next.layers.find(l => l.id === m.id)?.name === `GRP${n}-${orient}-${m.part}`), 'the group layer names');
  }
  const layer = state.layers.find(l => l.id === request.id && l.screenId === screen.id);
  const group = groupOf(state.layers, layer);
  if (!group) throw fail('This layer is not part of a complete group. Refresh.', 409);
  if (request.action === 'group-window') {
    geometry(request.window, screen, state.roam); // validate the combined rectangle
    const local = { ...request.window };
    const share = group.orient === 'H' ? group.a.window.width / (group.a.window.width + group.b.window.width) : group.a.window.height / (group.a.window.height + group.b.window.height);
    const [wa, wb] = splitWindow(local, group.orient, share);
    await client.call('layers/window', [{ layerId: group.a.id, window: geometry(wa, screen, state.roam) }, { layerId: group.b.id, window: geometry(wb, screen, state.roam) }]).catch(resourceHint);
    return verified(() => read(client), next => [[group.a.id, wa], [group.b.id, wb]].every(([id, w]) => {
      const l = next.layers.find(x => x.id === id); return l && ['x', 'y', 'width', 'height'].every(k => l.window[k] === w[k]);
    }), 'the group position');
  }
  if (request.action === 'group-delete') { // Clear on a grouped layer removes both members (WO-026).
    await client.call('layers', [{ layerId: group.a.id, sn: client.serial }, { layerId: group.b.id, sn: client.serial }], { method: 'DELETE' });
    return verified(() => read(client), next => !next.layers.some(l => [group.a.id, group.b.id].includes(l.id)), 'group deletion');
  }
  if (request.action === 'group-ungroup') {
    await rename(client, group.a.id, 'Layer A'); await rename(client, group.b.id, 'Layer B');
    return verified(() => read(client), next => [group.a.id, group.b.id].every(id => !parseGroup(next.layers.find(l => l.id === id)?.name)), 'the ungrouped layer names');
  }
  throw fail('Unsupported group action.');
}

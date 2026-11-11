import { fail } from './pixelhue.js';
import { integer } from './studio-common.js';

// Preset auto-take (WO-024): load the preset to PVW, confirm the device's PVW matches the preset, then Take
// the preset's screens. Companion's auto-take takes immediately without confirmation; the owner asked for
// a confirmed load. Confirmation compares stored layer windows (global) with PVW readback when the preset
// carries position/size (absolute presets, or relative ones with 3-3/3-4); otherwise it confirms that the
// preset's layers exist on PVW.
const CONFIRM_MS = 6000, POLL_MS = 250;

function matches(preset, raw, screens) {
  const geometry = preset.loadType !== 2 || preset.params.some(p => ['3', '3-3', '3-4'].includes(p));
  return preset.content.every(entry => {
    const screen = screens.find(s => s.guid === entry.guid); if (!screen) return true;
    const pvw = raw.filter(l => l.layerIdObj?.attachScreenId === screen.id && l.layerIdObj.sceneType === 4);
    return entry.layers.filter(l => [2, 4].includes(l.type) && l.enable !== 0).every(stored => {
      const live = pvw.find(l => l.serial === stored.serial && l.layerIdObj.type === stored.type);
      if (!live) return false;
      if (!geometry || !stored.window) return true;
      return ['x', 'y', 'width', 'height'].every(key => live.window?.[key] === stored.window[key]);
    });
  });
}

export async function autoTake(client, preset, state, request, { read, applyBody, takePayload }) {
  const time = request.time ?? 500; integer(time, 'Transition duration', 0, 10000);
  const screens = state.screens.filter(s => s.enabled && preset.content.some(c => c.guid === s.guid));
  if (!screens.length) throw fail(`${preset.name} has no current enabled screens to take.`, 409);
  // Take is allowed on a locked PGM, as in PixelFlow: the lock guards editing, not switching (WO-022).
  const started = Date.now();
  await client.call('preset/apply', applyBody(preset, 4, { keyframes: false, effect: false, time: 0, swap: request.swap !== false }), { method: 'POST', timeoutMs: 30000 });
  let confirmed = false;
  while (Date.now() - started < CONFIRM_MS) {
    const raw = (await client.call('layers/list-detail')).data?.list || [];
    if (matches(preset, raw, screens)) { confirmed = true; break; }
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
  if (!confirmed) throw fail(`${preset.name} was sent to PVW but its layers were not confirmed within ${CONFIRM_MS / 1000} s, so Take was not sent. Check PVW and take manually.`, 409);
  const loadedMs = Date.now() - started;
  // Keyframes run on the Take when requested: layers animate from the PGM look to the preset look.
  await client.call('screen/take', takePayload(screens, 'take', request.swap === false ? 0 : 1, time), { timeoutMs: 20000 });
  return { ...await read(client), autoTake: { preset: preset.name, screens: screens.map(s => s.name), loadedMs, time } };
}

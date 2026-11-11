import { child } from './configuration.js';
import { fail } from './pixelhue.js';
import { integer, choice } from './studio-common.js';

// Device clock and electrostatic protection (WO-036). PixelFlow: DeviceTimeSetting.tsx → PUT node/clock
// { nodeId, time: { timestamp (UTC seconds), timezone (feature.xml Timezone enum) } };
// device anti-static panel → POST node/anti-static { nodeId, antiStatic: { enable, time (ms) } }.
const on = node => Boolean(node) && node.attributes.Support === '1' && node.attributes.Editable !== '0';
export function extraOptions(config) {
  const zone = child(config, 'Timezone'), anti = child(child(child(config, 'Features'), 'Device'), 'AntiStatic'), time = child(anti, 'Time');
  return {
    timezones: on(zone) ? zone.children.filter(n => n.name === 'Enum').map(n => ({ value: Number(n.attributes.Value), offset: Number(n.attributes.Offset), name: n.attributes.Name || `Zone ${n.attributes.Value}` }))
      .filter(z => Number.isFinite(z.value) && Number.isFinite(z.offset)) : [],
    antiStatic: on(anti) ? { min: Number(time?.attributes.Min ?? 100), max: Number(time?.attributes.Max ?? 2000) } : null };
}
export async function readExtras(client, node, options) {
  let time = null;
  if (options.timezones.length) {
    // node/detail carries a snapshot; node/clock is the running clock PixelFlow re-reads before editing.
    const clock = await client.call('node/clock?nodeId=1').catch(() => null), value = clock?.data?.time || node.time;
    if (Number.isFinite(value?.timestamp)) time = { timestamp: value.timestamp, timezone: value.timezone };
  }
  const anti = options.antiStatic && node.antiStatic ? { enable: node.antiStatic.enable ? 1 : 0, time: node.antiStatic.time } : null;
  return { time, antiStatic: anti };
}
export function planExtras(changes, before) {
  const plan = [];
  if (changes.time !== undefined) {
    if (!before.options.timezones.length || !before.node.time) throw fail('The device clock is unavailable.');
    const timezone = choice(changes.time?.timezone, before.options.timezones.map(z => z.value), 'time zone');
    const timestamp = integer(changes.time.timestamp, 'Device time', 946684800, 4102444800); // 2000–2100, UTC seconds
    plan.push(['node/clock', { nodeId: 1, time: { timestamp, timezone } }]);
  }
  if (changes.antiStatic !== undefined) {
    const limits = before.options.antiStatic;
    if (!limits || !before.node.antiStatic) throw fail('Electrostatic protection is unavailable.');
    const enable = choice(changes.antiStatic?.enable, [0, 1], 'electrostatic protection state');
    const time = integer(changes.antiStatic.time ?? before.node.antiStatic.time, 'Hold time', limits.min, limits.max);
    plan.push(['node/anti-static', { nodeId: 1, antiStatic: { enable, time } }, 'POST']);
  }
  return plan;
}
export const extrasRetained = (changes, state) =>
  (changes.time === undefined || (state.node.time?.timezone === changes.time.timezone && Math.abs(state.node.time.timestamp - changes.time.timestamp) < 120)) &&
  (changes.antiStatic === undefined || (state.node.antiStatic?.enable === changes.antiStatic.enable &&
    (changes.antiStatic.time === undefined || state.node.antiStatic.time === changes.antiStatic.time)));

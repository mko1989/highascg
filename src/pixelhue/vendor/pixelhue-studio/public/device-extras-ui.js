import { el, text, button, input, select, field } from './ui.js';

// Device clock and electrostatic protection blocks (WO-036).
const pad = n => String(Math.abs(n)).padStart(2, '0');
export const zoneLabel = z => `(UTC${z.offset < 0 ? '-' : '+'}${pad(Math.trunc(z.offset / 60))}:${pad(z.offset % 60)}) ${z.name}`;
// The device stores UTC seconds; the wall time shown is that instant in the selected device zone.
export const wallTime = (timestamp, offset) => new Date((timestamp + offset * 60) * 1000).toISOString().slice(0, 19);
export const fromWallTime = (value, offset) => Math.round(Date.parse(`${value.length === 16 ? `${value}:00` : value}Z`) / 1000) - offset * 60;

export function renderClock(state, apply) {
  const { node, options } = state, block = el('section', { className: 'settings-block' }); block.append(el('h2', {}, 'Device clock'));
  const zones = options.timezones, offsetOf = value => zones.find(z => z.value === Number(value))?.offset ?? 0;
  const zone = select(zones.map(z => [z.value, zoneLabel(z)]), node.time.timezone, 'Device time zone');
  const when = input(wallTime(node.time.timestamp, offsetOf(node.time.timezone)), 'Device date and time', 'datetime-local'); when.step = 1;
  // Changing the zone keeps the instant and shows it in the new zone, as the device will.
  let instant = node.time.timestamp;
  when.onchange = () => { const next = fromWallTime(when.value, offsetOf(zone.value)); if (Number.isFinite(next)) instant = next; };
  zone.onchange = () => { when.value = wallTime(instant, offsetOf(zone.value)); };
  block.append(field('Time zone', zone), field('Date and time', when),
    button('Set clock', () => apply({ time: { timezone: Number(zone.value), timestamp: instant } })),
    button('Use this computer’s time', () => {
      // Match the browser zone by name when the device lists it; otherwise keep the chosen zone.
      const local = Intl.DateTimeFormat().resolvedOptions().timeZone, match = zones.find(z => z.name === local);
      apply({ time: { timezone: match ? match.value : Number(zone.value), timestamp: Math.round(Date.now() / 1000) } });
    }, 'button quiet'));
  return block;
}
export function renderAntiStatic(state, apply) {
  const { node, options } = state, limits = options.antiStatic, block = el('section', { className: 'settings-block' });
  block.append(el('h2', {}, 'Electrostatic protection'));
  const enable = select([[0, 'Off'], [1, 'On']], node.antiStatic.enable, 'Electrostatic protection');
  const time = input(node.antiStatic.time, 'Hold time in milliseconds', 'number'); time.min = limits.min; time.max = limits.max; time.step = 100;
  block.append(field('Protection', enable), field(`Hold last image (${limits.min}–${limits.max} ms)`, time),
    button('Save protection', () => apply({ antiStatic: { enable: Number(enable.value), time: Number(time.value) } })),
    el('p', { className: 'block-note' }, 'When a static discharge briefly drops an input, its last image is held for this long instead of going black.'));
  return block;
}

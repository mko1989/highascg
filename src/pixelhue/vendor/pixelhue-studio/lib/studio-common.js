import { fail } from './pixelhue.js';
export const clone = value => structuredClone(value);
export function integer(value, label, min = 0, max = 65535) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw fail(`${label} must be ${min}–${max}.`);
  return value;
}
export function name(value, label = 'Name') {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > 32 || /[\x00-\x1f]/.test(value)) throw fail(`${label} must contain 1–32 UTF-8 bytes.`);
  return value;
}
export function choice(value, options, label) {
  if (!options.includes(value)) throw fail(`Unsupported ${label}.`);
  return value;
}
export function timing(value) {
  if (!value) throw fail('Timing is required.');
  integer(value.width, 'Width', 64, 16384); integer(value.height, 'Height', 64, 16384);
  if (!Number.isFinite(value.frame) || value.frame < 1 || value.frame > 240) throw fail('Frame rate must be 1–240 Hz.');
  integer(value.standardType, 'Timing standard', 0, 7);
  choice(value.interlaced, [0, 1], 'scan type');
  return Object.fromEntries(['width', 'height', 'frame', 'standardType', 'interlaced'].map(key => [key, value[key]]));
}
export function batch(changes, limit = 512) {
  if (!Array.isArray(changes) || !changes.length || changes.length > limit) throw fail(`Supply 1–${limit} changes.`);
  return changes;
}
export async function verified(read, matches, message) {
  let state;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 120));
    state = await read(); if (matches(state)) return state;
  }
  throw Object.assign(fail(`The device did not retain ${message}. Refresh to inspect the actual settings.`, 409), { snapshot: state });
}
export const sameTiming = (a, b) => ['width', 'height', 'frame', 'standardType', 'interlaced'].every(key => a?.[key] === b?.[key]);

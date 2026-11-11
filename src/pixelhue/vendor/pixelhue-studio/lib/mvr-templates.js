import { configuration, child } from './configuration.js';
import { fail } from './pixelhue.js';

// Built-in MVR layouts (WO-037). PixelFlow MVRToolbar.tsx: GET layers/template?moduleType=0 (0 = MVR), then
// PUT layers/template/select { templateId, screenId, sceneType: 2, templateType, moduleType: 0 }; the device replaces
// every MVR window. templateIdObj.type 1 = built-in, 2 = custom. Code 8307 = scaling limit, windows not placed.
const MVR = 0;
async function supported(client) {
  const layer = child(child(await configuration(client), 'Features'), 'Layer');
  return ['DefaultMVRTemplate', 'CustomMVRTemplate'].some(name => child(layer, name)?.attributes.Support === '1');
}
async function list(client) {
  const response = await client.call(`layers/template?moduleType=${MVR}`), rows = Array.isArray(response.data) ? response.data : response.data?.list;
  return (Array.isArray(rows) ? rows : []).filter(t => t?.templateIdObj?.moduleType === MVR && Number.isSafeInteger(t.templateId));
}
export async function readMvrTemplates(client) {
  const base = { session: client.session };
  if (!['P20', 'Q8'].includes(client.model) || !await supported(client)) return { ...base, supported: false, templates: [] };
  // A firmware that advertises templates without serving the list shows none.
  const rows = await list(client).catch(() => []);
  return { ...base, supported: true, templates: rows.map(t => ({ id: t.templateId, type: t.templateIdObj.type, windows: Array.isArray(t.cells) ? t.cells.length : null,
    label: `${t.templateIdObj.type === 2 ? 'Custom' : 'Layout'} ${t.templateId}${Array.isArray(t.cells) ? ` · ${t.cells.length} windows` : ''}` })) };
}
export async function applyMvrTemplate(client, body) {
  if (!await supported(client)) throw fail('This device does not advertise MVR layouts.', 403);
  if (body.confirmReplace !== true) throw fail('Applying a layout replaces every MVR window. Confirm to continue.', 409);
  const state = await client.read(), screen = state.screens.find(s => s.id === body.screenId);
  if (!screen) throw fail('MVR output no longer exists. Refresh.', 409);
  const template = (await list(client)).find(t => t.templateId === body.templateId && t.templateIdObj.type === body.type);
  if (!template) throw fail('MVR layout no longer exists. Refresh.', 409);
  await client.call('layers/template/select', { templateId: template.templateId, screenId: screen.id, sceneType: 2, templateType: template.templateIdObj.type, moduleType: MVR }, { timeoutMs: 20000 }).catch(error => {
    if (/code 8307/.test(error.message)) throw fail('The device could not place this layout: a window would exceed its scaling limit. Add the windows manually.', 409);
    throw error;
  });
  return client.read();
}

import { $, el, text, button, input, select, field, panelHeader, sessionPath, setDisabled } from './ui.js';
import { createSourceBackup } from './source-backup-ui.js';
import { createSelfTest } from './self-test-ui.js';
import { renderClock, renderAntiStatic } from './device-extras-ui.js';
import { renderLayerProfile, renderNetwork, renderMaintenance, renderCards, reconnectHint } from './device-maintenance-ui.js';

export function createDeviceUI({ api, notice, operation, getSession, invalidate }) {
  const root = $('device-settings');
  let state, session, busy = false, controls = {};
  const backup = createSourceBackup({ api, operation, notice }), selfTest = createSelfTest({ api, operation, notice });
  function values() {
    if (!state) return {};
    const changes = {};
    if (controls.name.value !== state.node.name) changes.name = controls.name.value;
    if (controls.beacon && Number(controls.beacon.value) !== state.node.beacon) changes.beacon = Number(controls.beacon.value);
    if (controls.fan && Number(controls.fan.value) !== state.node.fanMode) changes.fanMode = Number(controls.fan.value);
    if (controls.genlock && (Number(controls.genlock.value) !== state.node.genlock?.type ||
      (Number(controls.genlock.value) === 2 && Number(controls.genlockInput.value) !== state.node.genlock?.sourceId))) {
      changes.genlock = { type: Number(controls.genlock.value), sourceId: Number(controls.genlockInput.value) };
    }
    return changes;
  }
  async function refresh() {
    if (!getSession()) return;
    await operation(async () => { state = await api(sessionPath('device', getSession())); session = state.session; await Promise.all([backup.load(session).catch(() => backup.reset()), selfTest.load(session).catch(() => selfTest.reset())]); render(); });
  }
  async function apply(changes) {
    await operation(async () => {
      state = await api('device', { session, changes }, 'PUT');
      invalidate('device'); render(); notice('Device settings saved.', 'success');
    });
  }
  async function act(body) {
    await operation(async () => {
      const result = await api('device-action', { session, ...body }, 'PUT');
      if (result.reconnect) { reconnectHint(result, notice); return; }
      state = result; invalidate('device'); render(); notice('Network settings saved.', 'success');
    });
  }
  function render() {
    root.replaceChildren(); controls = {};
    if (!state) { root.append(text('Connect a device to load its setup.')); return; }
    const { node, device, options } = state;
    root.append(panelHeader(`${device.model} setup`, refresh));
    const facts = el('dl', { className: 'device-facts' });
    for (const [label, value] of [['Model', device.model], ['Serial', device.serial], ['Firmware', node.firmware || 'Unavailable'], ['Address', `${device.host}:${device.port}`]]) facts.append(el('dt', {}, label), el('dd', {}, value));
    root.append(facts);
    const form = el('form', { className: 'settings-grid' });
    controls.name = input(node.name, 'Device name'); controls.name.maxLength = 32;
    form.append(field('Device name', controls.name));
    if (options.beacon) { controls.beacon = select([[0, 'Off'], [1, 'On']], node.beacon, 'Identify device'); form.append(field('Identify device', controls.beacon)); }
    if (options.fanModes.length) {
      controls.fan = select(options.fanModes.map(v => [v, v === 1 ? 'Standard' : v === 2 ? 'High performance' : `Mode ${v}`]), node.fanMode, 'Fan mode');
      form.append(field('Fan mode', controls.fan));
    }
    if (options.genlockTypes.length) {
      controls.genlock = select(options.genlockTypes.map(v => [v, ['Free-run', 'External genlock', 'Input'][v] || `Source ${v}`]), node.genlock?.type, 'Genlock source');
      controls.genlockInput = select((state.inputs || []).map(i => [i.id, i.name]), node.genlock?.sourceId, 'Genlock input');
      const inputField = field('Genlock input', controls.genlockInput);
      controls.genlock.onchange = () => { inputField.hidden = Number(controls.genlock.value) !== 2; };
      inputField.hidden = node.genlock?.type !== 2; form.append(field('Genlock', controls.genlock), inputField);
    }
    const save = button('Save device settings', () => { const changes = values(); if (Object.keys(changes).length) apply(changes); });
    form.onsubmit = event => { event.preventDefault(); save.click(); }; form.append(save); root.append(form);
    if (options.workModes.length > 1) {
      const modes = el('section', { className: 'settings-block' }); modes.append(el('h2', {}, 'Operating mode'));
      const choice = select(options.workModes.map(m => [m.value, m.label]), node.mode?.workMode, 'Device operating mode');
      modes.append(field('Mode', choice), button('Change mode', () => {
        if (Number(choice.value) === node.mode?.workMode) return;
        if (window.confirm('Changing device mode can reset screens and routing. Change mode?')) apply({ workMode: Number(choice.value), confirmModeChange: true });
      }));
      root.append(modes);
    }
    if (options.layerModes.length > 1) root.append(renderLayerProfile(state, apply));
    if (node.time) root.append(renderClock(state, apply));
    if (node.antiStatic) root.append(renderAntiStatic(state, apply));
    backup.render(); root.append(backup.element);
    root.append(renderNetwork(state.network, act));
    if (node.subcards.length) root.append(renderCards(node.subcards));
    selfTest.render(); root.append(selfTest.element);
    root.append(renderMaintenance(options, device, act));
    if (!state.configurationAvailable) root.append(text('Capability information is unavailable. Only reported settings are shown.'));
    setDisabled(root, busy);
  }
  render();
  return { open: () => state ? undefined : refresh(), refresh,
    hasChanges: () => Object.keys(values()).length > 0,
    reset(next) { if (session === next) return; session = next; state = undefined; backup.reset(); selfTest.reset(); render(); },
    setBusy(value) { busy = value; setDisabled(root, busy); } };
}

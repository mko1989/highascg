import { $, el, text, button, input, select, field, cell, table } from './ui.js';

// Network, power, factory reset and installed-card sections of the Device tab (WO-015).
export function renderLayerProfile({ node, options }, apply) {
  const block = el('section', { className: 'settings-block' }); block.append(el('h2', {}, 'Layer profile'));
  const describe = mode => !mode ? '' : [mode.main != null ? `${mode.main} MAIN layers · ${mode.pip} PIP layers` : '',
    mode.hdr === true ? 'HDR supported' : mode.hdr === false ? 'HDR not supported' : ''].filter(Boolean).join(' · ');
  const profile = select(options.layerModes.map(m => [m.value, m.value === node.layerMode ? `${m.label} (current)` : m.label]), node.layerMode, 'Layer profile');
  const info = el('p', { className: 'block-note' }), current = () => options.layerModes.find(m => m.value === Number(profile.value));
  const update = () => { info.textContent = describe(current()); }; profile.onchange = update; update();
  block.append(field('Profile', profile), button('Change layer profile', () => {
    if (Number(profile.value) === node.layerMode) return;
    if (window.confirm(`Switch to ${current().label}? The device recreates its layers, so existing layer programming can be lost.`)) apply({ layerMode: Number(profile.value) });
  }), info);
  return block;
}

export function renderNetwork(network, act) {
  const block = el('section', { className: 'settings-block' }); block.append(el('h2', {}, 'Network'));
  if (!network) { block.append(text('Network settings are unavailable on this device.')); return block; }
  const mode = select([[0, 'Static'], [1, 'DHCP']], network.dhcp, 'Address mode');
  const ip = input(network.ip, 'IP address'), mask = input(network.netmask, 'Subnet mask'), gateway = input(network.gateway, 'Gateway');
  const fields = [ip, mask, gateway];
  for (const node of fields) { node.inputMode = 'decimal'; node.spellcheck = false; node.autocomplete = 'off'; }
  const sync = () => { for (const node of fields) node.dataset.fixed = String(Number(mode.value) === 1); for (const node of fields) node.disabled = Number(mode.value) === 1; };
  mode.onchange = sync; sync();
  block.append(field('Address mode', mode), field('IP address', ip), field('Subnet mask', mask), field('Gateway', gateway),
    button('Save network', () => {
      const next = { dhcp: Number(mode.value), ip: ip.value.trim(), netmask: mask.value.trim(), gateway: gateway.value.trim() };
      const target = next.dhcp ? 'DHCP (the address may change)' : next.ip;
      if (window.confirm(`Apply network settings? The device moves to ${target} and this app may need to reconnect.`)) act({ action: 'network', network: next, confirm: true });
    }));
  block.append(el('p', { className: 'block-note' }, `${network.port} · MAC ${network.mac || 'unknown'}`));
  return block;
}

export function renderMaintenance(options, device, act) {
  const block = el('section', { className: 'settings-block' }); block.append(el('h2', {}, 'Restart and reset'));
  if (options.power.includes('restart')) block.append(button('Restart device', () => {
    if (window.confirm(`Restart ${device.model} ${device.serial}? Outputs go dark until it is back.`)) act({ action: 'restart', confirm: true });
  }));
  if (options.power.includes('shutdown')) block.append(button('Shut down', () => {
    if (window.confirm(`Shut down ${device.model} ${device.serial}? It can only be powered on again at the unit.`)) act({ action: 'shutdown', confirm: true });
  }));
  const keep = select([['user-data', 'Keep network, EDID, files and user data'], ['network', 'Keep network settings only'], ['nothing', 'Erase everything (address → 192.168.0.10)']], 'user-data', 'Factory reset option');
  block.append(field('Factory reset', keep), button('Factory reset…', () => {
    const typed = window.prompt(`Factory reset ${device.model} ${device.serial}: ${keep.selectedOptions[0].text}. The device restarts. Type RESET to continue.`);
    if (typed === 'RESET') act({ action: 'factory-reset', keep: keep.value, confirm: 'RESET' });
  }, 'button danger'));
  return block;
}

export function renderCards(subcards) {
  const cards = table(['Slot', 'Card', 'Ports', 'State']);
  for (const card of subcards) {
    const row = el('tr'), name = el('div'); name.append(el('span', {}, card.name), text(`${card.kind} · model ${card.modelId}`));
    cell(row, document.createTextNode(card.slot)); cell(row, name); cell(row, document.createTextNode(card.ports || '—'));
    cell(row, document.createTextNode(card.online === 0 ? 'Offline' : 'Online')); cards.body.append(row);
  }
  const block = el('section', { className: 'settings-block cards-block' }); block.append(el('h2', {}, 'Installed cards'), cards.wrap);
  return block;
}

export function reconnectHint(result, notice) {
  if (result.host) $('host').value = result.host;
  notice(result.message, 'success');
}

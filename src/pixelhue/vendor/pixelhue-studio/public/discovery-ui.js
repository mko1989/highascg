import { $, el, text, button } from './ui.js';
export function createDiscoveryUI({ api, notice, connectDevice, getSeed }) {
  let pending = false, busy = false;
  function setBusy(value) {
    busy = value; $('find-devices').disabled = busy || pending; $('scan-lan').disabled = busy || pending;
    for (const node of $('discovered-devices').querySelectorAll('button')) node.disabled = busy;
  }
  async function find(scan = false) {
    if (pending) return; pending = true;
    $('find-devices').disabled = true; $('scan-lan').disabled = true;
    $('discovery-status').textContent = scan ? 'Searching the LAN…' : 'Finding devices…';
    try {
      const seed = getSeed().trim();
      const result = await api(`discovery?seed=${encodeURIComponent(seed)}&scan=${scan ? 1 : 0}`);
      $('discovered-devices').replaceChildren(...result.devices.map(device => {
        const row = el('div', { className: 'discovered-device' }), info = el('div');
        info.append(el('strong', {}, device.name), text(`${device.model} · ${device.host} · ${device.serial}`));
        row.append(info, button('Connect', () => connectDevice(device))); return row;
      }));
      $('discovery-status').textContent = result.devices.length ? `${result.devices.length} ${result.devices.length === 1 ? 'device' : 'devices'} found` : 'No Pixelhue devices found. Enter an address or scan the LAN.';
    } catch (error) { $('discovery-status').textContent = error.message; notice(error.message, 'error'); }
    finally { pending = false; setBusy(busy); }
  }
  $('find-devices').onclick = () => find(); $('scan-lan').onclick = () => find(true);
  return { find, setBusy };
}

import { $, el, text, button, input, panelHeader, sessionPath, setDisabled } from './ui.js';

// Audio matrix (WO-036): inputs down, outputs across, one input per output. Clicks apply immediately.
const groupByPort = channels => { const groups = []; for (const c of channels) { const last = groups.at(-1); if (last?.id === c.interfaceId) last.channels.push(c); else groups.push({ id: c.interfaceId, port: c.port, kind: c.kind, channels: [c] }); } return groups; };
// Clicking with Pair on routes every channel of the input port to the same-numbered channel of the output port.
export function pairRoutes(state, input, output, enable) {
  const ins = state.inputs.filter(c => c.interfaceId === input.interfaceId), outs = state.outputs.filter(c => c.interfaceId === output.interfaceId);
  return outs.flatMap(o => { const match = ins.find(i => i.channel === o.channel); return match ? [{ output: o.key, input: enable ? match.key : null }] : []; })
    .filter(route => enable || state.routes[route.output] === ins.find(i => i.channel === state.outputs.find(o => o.key === route.output).channel)?.key);
}
export function createAudioUI({ api, notice, operation, getSession }) {
  const root = $('audio-content'); let state, session, busy = false, pair = true;
  try { pair = localStorage.getItem('audio-pair') !== '0'; } catch {}
  const adopt = next => { state = next; session = next.session; render(); };
  const refresh = () => getSession() ? operation(async () => adopt(await api(sessionPath('audio', getSession())))) : undefined;
  const send = (body, done) => operation(async () => { adopt(await api('audio', { session, ...body }, 'PUT')); if (done) notice(done, 'success'); });
  function flag(channel, key, label) {
    const node = button(label, () => send({ channels: [{ key: channel.key, type: channel.type, [key]: channel[key] ? 0 : 1 }] }), `audio-flag${channel[key] ? ' active' : ''}`);
    node.title = `${key === 'mute' ? 'Mute' : 'Test tone'} · ${channel.port} ${channel.name}`; node.setAttribute('aria-pressed', String(Boolean(channel[key]))); return node;
  }
  function portFlag(group, key, label) {
    const all = group.channels.every(c => c[key]), some = group.channels.some(c => c[key]);
    const node = button(label, () => send({ channels: group.channels.map(c => ({ key: c.key, type: c.type, [key]: all ? 0 : 1 })) }), `audio-flag${all ? ' active' : some ? ' mixed' : ''}`);
    node.title = `${key === 'mute' ? 'Mute' : 'Test tone'} · all channels of ${group.port}`; return node;
  }
  function render() {
    root.replaceChildren();
    if (!state) { root.append(text('Connect a device to load its audio matrix.')); return; }
    if (!state.supported) { root.append(text('This device does not advertise an audio matrix.')); return; }
    const head = panelHeader('Audio', refresh), routed = Object.values(state.routes).filter(Boolean).length;
    const pairing = el('label', { className: 'checkbox-label', title: 'One click routes all channels of the input port to the same channels of the output port' });
    const box = input('', 'Route channel pairs', 'checkbox'); box.checked = pair;
    box.onchange = () => { pair = box.checked; try { localStorage.setItem('audio-pair', pair ? '1' : '0'); } catch {} };
    pairing.append(box, 'Pair');
    const clear = button('Clear all', () => { if (window.confirm('Remove every audio route?')) send({ clear: true }, 'Audio routes cleared.'); }, 'button danger');
    clear.dataset.fixed = String(!routed);
    head.append(text(`${state.inputs.length} in · ${state.outputs.length} out · ${routed} routed`), pairing, clear); root.append(head);
    const wrap = el('div', { className: 'audio-matrix-wrap' }), grid = el('table', { className: 'audio-matrix' });
    const outs = groupByPort(state.outputs), ins = groupByPort(state.inputs);
    const ports = el('tr'), chans = el('tr'); ports.append(el('th', { className: 'audio-corner', colspan: 2, rowspan: 2 }, 'In ↓  Out →'));
    for (const group of outs) {
      const th = el('th', { colspan: group.channels.length, className: 'audio-port-col' }); const label = el('span', {}, group.port);
      th.append(label, portFlag(group, 'mute', 'M'), portFlag(group, 'tone', 'T')); ports.append(th);
      for (const c of group.channels) { const cell = el('th', { className: 'audio-chan-col', title: `${c.port} · ${c.name}` }); cell.append(el('span', {}, String(c.channel + 1)), flag(c, 'mute', 'M'), flag(c, 'tone', 'T')); chans.append(cell); }
    }
    const thead = el('thead'); thead.append(ports, chans); const body = el('tbody');
    for (const group of ins) group.channels.forEach((row, index) => {
      const tr = el('tr', { className: index === 0 ? 'audio-port-start' : '' });
      if (index === 0) { const th = el('th', { rowspan: group.channels.length, className: 'audio-port-row', scope: 'rowgroup' }); const tools = el('span', { className: 'audio-flags' }); tools.append(portFlag(group, 'mute', 'M'), portFlag(group, 'tone', 'T')); th.append(el('span', {}, group.port), tools); tr.append(th); }
      const th = el('th', { className: 'audio-chan-row', scope: 'row' }), tools = el('span', { className: 'audio-flags' });
      tools.append(flag(row, 'mute', 'M'), flag(row, 'tone', 'T'));
      th.append(el('span', { className: row.signal === 1 ? 'audio-signal on' : row.signal === 0 ? 'audio-signal' : 'audio-signal none', title: row.signal === 1 ? 'Signal' : row.signal === 0 ? 'No signal' : '' }), el('span', {}, row.name), tools); tr.append(th);
      for (const column of state.outputs) {
        const active = state.routes[column.key] === row.key, td = el('td'), point = el('button', { type: 'button', className: `audio-point${active ? ' active' : ''}`, 'aria-pressed': String(active),
          'aria-label': `${row.port} ${row.name} to ${column.port} ${column.name}`, title: `${row.port} ${row.name} → ${column.port} ${column.name}` });
        point.onclick = event => {
          const single = [{ output: column.key, input: active ? null : row.key }];
          const routes = pair && !event.altKey ? pairRoutes(state, row, column, !active) : single;
          send({ routes: routes.length ? routes : single });
        };
        td.append(point); tr.append(td);
      }
      body.append(tr);
    });
    grid.append(thead, body); wrap.append(grid);
    root.append(wrap, text('Click a crosspoint to route; an output takes one input. M mutes, T sends a test tone. Alt-click routes a single channel while Pair is on.'));
    setDisabled(root, busy);
  }
  render();
  return { open: () => state ? undefined : refresh(), refresh, hasChanges: () => false,
    reset(next) { if (session === next) return; session = next; state = undefined; render(); },
    setBusy(value) { busy = value; setDisabled(root, busy); } };
}

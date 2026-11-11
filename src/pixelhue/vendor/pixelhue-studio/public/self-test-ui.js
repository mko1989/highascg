import { el, text, button, sessionPath } from './ui.js';

// Device tab "Self-test" block (WO-037): last result, abnormal items first, run on demand.
export function createSelfTest({ api, operation, notice }) {
  const element = el('section', { className: 'settings-block selftest-block' }); let state, session;
  function render() {
    element.replaceChildren(); element.hidden = !state?.supported; if (!state?.supported) return;
    element.append(el('h2', {}, 'Self-test'));
    const summary = !state.total ? 'No result stored.' : state.abnormal ? `${state.abnormal} of ${state.total} checks abnormal` : `All ${state.total} checks normal`;
    element.append(el('span', { className: state.abnormal ? 'selftest-bad' : 'muted' }, `${state.checkType === 1 ? 'Device test' : 'Power-on check'}: ${summary}`),
      button('Run self-test', () => { if (window.confirm('Run the device self-test now? The device must be idle.')) operation(async () => {
        notice('Self-test running…'); state = await api('self-test', { session, action: 'run' }, 'PUT'); render();
        notice(state.abnormal ? `Self-test finished: ${state.abnormal} abnormal.` : 'Self-test finished: all normal.', state.abnormal ? 'error' : 'success');
      }); }));
    if (!state.total) return;
    const details = el('details', { className: 'selftest-details' }); details.open = state.abnormal > 0; details.append(el('summary', {}, 'Details'));
    for (const part of state.parts) {
      const list = el('dl', { className: 'device-facts' });
      for (const item of [...part.items].sort((a, b) => Number(a.ok) - Number(b.ok))) list.append(el('dt', { className: item.ok ? '' : 'selftest-bad' }, `${item.name}${item.index ? ` ${item.index + 1}` : ''}`), el('dd', { className: item.ok ? '' : 'selftest-bad' }, `${item.value}${item.ok ? '' : ' · abnormal'}`));
      details.append(text(`Slot ${part.slotId} · model ${part.modelId}`), list);
    }
    element.append(details);
  }
  render();
  return { element, render,
    async load(next) { session = next; state = await api(sessionPath('self-test', next)); render(); },
    reset() { state = undefined; render(); } };
}

// MVR toolbar: built-in device layouts (WO-037). One select; choosing a layout replaces all windows after a confirmation.
export function createMvrTemplates({ api, operation, notice, getState, adopt }) {
  const select = document.getElementById('mvr-template'); let session;
  function render(templates) {
    select.replaceChildren(new Option(templates.length ? 'Apply layout…' : 'No device layouts', ''), ...templates.map(t => new Option(t.label, `${t.type}:${t.id}`)));
    select.hidden = !templates.length; select.value = '';
  }
  select.onchange = () => {
    const state = getState(), [type, id] = select.value.split(':').map(Number), screenId = Number(document.getElementById('screen').value); select.value = '';
    if (!state || !id || !window.confirm('Apply this device layout? It replaces every window on this MVR output.')) return;
    operation(async () => { adopt(await api('mvr-templates', { session: state.session, screenId, templateId: id, type, confirmReplace: true }, 'PUT')); notice('MVR layout applied.', 'success'); });
  };
  render([]);
  return {
    async load(state) {
      if (!state?.capabilities?.mvr || session === state.session) return; session = state.session;
      try { render((await api(`mvr-templates?session=${encodeURIComponent(state.session)}`)).templates); } catch { render([]); }
    },
    reset() { session = undefined; render([]); }, setBusy(busy) { select.disabled = busy; } };
}

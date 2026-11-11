import { el, text, button, select, field, input, sessionPath } from './ui.js';

// Device tab "Source backup" block (WO-037). Every action applies immediately, like the other device blocks.
const CAPACITY = ['SL', 'DL', '4K'];
export function createSourceBackup({ api, operation, notice }) {
  const element = el('section', { className: 'settings-block backup-block' }); let state, session;
  const send = (body, done) => operation(async () => { state = await api('source-backup', { session, ...body }, 'PUT'); render(); notice(done, 'success'); });
  function render() {
    element.replaceChildren(); element.hidden = !state?.supported; if (!state?.supported) return;
    element.append(el('h2', {}, 'Source backup'));
    const enable = select([[0, 'Off'], [1, 'On']], state.enable, 'Source backup');
    enable.onchange = () => send({ action: 'enable', enable: Number(enable.value) }, Number(enable.value) ? 'Source backup on.' : 'Source backup off.');
    const first = input('', 'Primary source preferred', 'checkbox'); first.checked = state.primaryFirst === 1;
    first.onchange = () => send({ action: 'primary-first', primaryFirst: first.checked ? 1 : 0 }, 'Primary preference saved.');
    const firstLabel = el('label', { className: 'checkbox-label', title: 'Return to the primary whenever its signal is back' }); firstLabel.append(first, ' Primary preferred');
    element.append(field('Backup', enable), firstLabel);
    if (!state.enable) { element.append(el('p', { className: 'block-note' }, `${state.pairs.length} pair${state.pairs.length === 1 ? '' : 's'} stored. Turn backup on to edit pairs.`)); return; }
    const list = el('div', { className: 'backup-pairs' });
    for (const pair of state.pairs) {
      const row = el('div', { className: 'mapping-row' }), auto = select([[1, 'Auto'], [0, 'Manual']], pair.auto ? 1 : 0, `Switch mode of ${pair.primaryName}`);
      auto.onchange = () => send({ action: 'update', id: pair.id, auto: auto.value === '1' }, 'Switch mode saved.');
      const using = select([['primary', `Primary · ${pair.primaryName}`], ['backup', `Backup · ${pair.backupName}`], ...(pair.using === 'none' ? [['none', 'None (no signal)']] : [])], pair.using, `Source in use for ${pair.primaryName}`);
      using.dataset.fixed = String(pair.auto); using.onchange = () => send({ action: 'update', id: pair.id, using: using.value }, 'Source in use saved.');
      row.append(el('span', { className: 'backup-names' }, `${pair.primaryName} → ${pair.backupName}`), field('Switch', auto), field('In use', using),
        button('Remove', () => send({ action: 'remove', id: pair.id }, 'Backup pair removed.'), 'button quiet'));
      if (!pair.editable) for (const control of row.querySelectorAll('select')) control.dataset.fixed = 'true';
      list.append(row);
    }
    element.append(list);
    const used = new Set(state.pairs.flatMap(p => [p.primary, p.backup])), free = state.inputs.filter(i => !used.has(i.id));
    const label = i => `${i.name} · ${CAPACITY[i.capacity] ?? 'Managed'}${i.signal ? '' : ' · no signal'}`;
    const primary = select([['', 'Primary input'], ...free.map(i => [i.id, label(i)])], '', 'New pair primary input'), backup = select([['', 'Backup input']], '', 'New pair backup input');
    primary.onchange = () => {
      const chosen = free.find(i => i.id === Number(primary.value));
      backup.replaceChildren(new Option('Backup input', ''), ...free.filter(i => chosen && i.id !== chosen.id && (state.sameCapacity ? i.capacity === chosen.capacity : i.capacity <= chosen.capacity)).map(i => new Option(label(i), String(i.id))));
    };
    element.append(field('Add pair', primary), field(state.sameCapacity ? 'Same capacity only' : 'Backup', backup), button('Add', () => {
      if (!primary.value || !backup.value) { notice('Choose a primary and a backup input.', 'error'); return; }
      send({ action: 'add', primary: Number(primary.value), backup: Number(backup.value) }, 'Backup pair added.');
    }));
    if (state.pairs.length > 1) element.append(button('Remove all', () => { if (window.confirm('Remove every backup pair?')) send({ action: 'clear' }, 'Backup pairs removed.'); }, 'button danger'));
  }
  render();
  return { element, render,
    async load(next) { session = next; state = await api(sessionPath('source-backup', next)); render(); },
    reset() { state = undefined; render(); } };
}

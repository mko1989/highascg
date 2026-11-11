import { el, text, button, input, select, field, sessionPath } from './ui.js';
import { SOURCE_MIME } from './program-stage.js';

// Programming source tabs like PixelFlow's SourceListPanel (WO-027): Inputs, Screens, Groups, and — when the
// device gallery supports them — Backgrounds (BKG pictures) and Logos (LOGO pictures), each with upload.
// Drag keys: "<type>:<id>" input/screen, "g:<id>" group source, "b:<pictureId>" background, "l:<pictureId>" logo.
export const parseDragKey = key => {
  const [kind, rest] = String(key).split(/:(.*)/s);
  if (kind === 'g') return { kind: 'group', id: rest };
  if (kind === 'b') return { kind: 'bkg', id: Number(rest) };
  if (kind === 'l') return { kind: 'logo', id: Number(rest) };
  const [type, id] = String(key).split(':').map(Number); return { kind: 'source', type, id };
};

function draggable(node, key, onPick, onDouble) {
  node.draggable = true; node.dataset.key = key;
  node.ondragstart = event => { onPick(key); event.dataTransfer.setData(SOURCE_MIME, key); event.dataTransfer.effectAllowed = 'copy'; };
  node.onclick = () => onPick(key); if (onDouble) node.ondblclick = () => onDouble(key);
  return node;
}

function sourceRow(item, ctx) {
  const key = `${item.type}:${item.id}`;
  const row = draggable(button('', () => {}, `button source-choice${ctx.sourceKey === key ? ' selected' : ''}`), key, ctx.pick, ctx.addToPvw);
  row.dataset.search = `${item.mapping || ''} ${item.name}`.toLowerCase();
  if (item.type === 2) {
    const heading = el('span', { className: 'source-input-heading' });
    heading.append(el('strong', {}, item.mapping || 'Input'), el('span', { className: `source-signal ${item.signalHealth || 'off'}` }, item.signalLabel || (item.connected ? 'Live' : 'No signal')));
    row.append(heading);
  }
  row.append(el('span', { className: 'source-input-name' }, item.name), text(`${item.width || '?'} × ${item.height || '?'}`));
  return row;
}

function groupsTab(ctx) {
  const box = el('div', { className: 'source-list' }), { state } = ctx;
  const name = s => state.sources.find(x => x.type === s.type && x.id === s.id)?.name || 'missing source';
  if (!state.groupSources.length) box.append(text('No groups yet. Create one below; it stays here as a source.'));
  for (const g of state.groupSources) {
    const key = `g:${g.id}`, row = draggable(button(g.name, () => {}, `button source-choice group-source${ctx.sourceKey === key ? ' selected' : ''}${g.available ? '' : ' unavailable'}`), key, ctx.pick, ctx.addToPvw);
    row.append(text(`${g.orient === 'H' ? 'Side by side' : 'Top / bottom'} · ${name(g.a)} ${g.orient === 'H' ? '|' : '/'} ${name(g.b)}${g.onDevice ? ' · on screen' : ''}`));
    const wrap = el('div', { className: 'group-source-row' }); wrap.append(row);
    if (!g.onDevice) wrap.append(button('✕', () => { if (window.confirm(`Remove group source ${g.name}?`)) ctx.command({ action: 'groupsource-delete', screenId: ctx.screenId(), id: g.id }, 'Group source removed.'); }, 'button quiet remove-source'));
    box.append(wrap);
  }
  const form = el('details', { className: 'group-form' }); form.append(el('summary', {}, 'New group…'));
  const options = state.sources.map(s => [`${s.type}:${s.id}`, s.mapping ? `${s.mapping} · ${s.name}` : s.name]);
  const a = select(options, options[0]?.[0], 'Group source A'), b = select(options, options[1]?.[0], 'Group source B');
  const orient = select([['H', 'Side by side'], ['V', 'Top / bottom']], 'H', 'Group layout'), label = input('', 'Group name'); label.placeholder = 'Name (optional)';
  form.append(field('A (left / top)', a), field('B (right / bottom)', b), field('Layout', orient), field('Name', label), button('Save group source', () => {
    if (a.value === b.value) { ctx.notice('Choose two different sources.', 'error'); return; }
    const pick = v => { const [type, id] = v.split(':').map(Number); return { type, id }; };
    ctx.command({ action: 'groupsource-save', screenId: ctx.screenId(), orientation: orient.value, name: label.value, sources: [pick(a.value), pick(b.value)] }, 'Group saved as a source. Drag it onto PGM or PVW.');
  }, 'button primary'));
  return [box, form];
}

function picturesTab(ctx, type) {
  const box = el('div', { className: 'picture-grid' }), prefix = type === 1 ? 'b' : 'l';
  const pictures = (ctx.gallery?.pictures || []).filter(p => p.type === type);
  if (!ctx.gallery) box.append(text('Loading gallery…'));
  else if (!pictures.length) box.append(text(type === 1 ? 'No backgrounds in the device gallery.' : 'No logos in the device gallery.'));
  for (const p of pictures) {
    const key = `${prefix}:${p.id}`, card = draggable(el('button', { type: 'button', className: `picture-card${ctx.sourceKey === key ? ' selected' : ''}`, title: `${p.name} · ${p.width} × ${p.height}` }), key, ctx.pick, ctx.addToPvw);
    const img = el('img', { alt: '', loading: 'lazy', src: `/api/gallery/thumb?${sessionPath('', ctx.session).slice(1)}&id=${p.id}` }); img.draggable = false;
    card.append(img, el('span', {}, p.name), el('small', {}, `${p.width} × ${p.height}${p.used ? ' · in use' : ''}`));
    if (!ctx.galleryEdit) { box.append(card); continue; }
    // Edit mode (WO-037): rename and delete; a picture in use on a screen cannot be deleted.
    const wrap = el('div', { className: 'picture-edit' }), rename = button('✎', () => { const next = window.prompt('Picture name', p.name); if (next && next.trim() && next !== p.name) ctx.manage({ action: 'rename', id: p.id, name: next }, 'Picture renamed.'); }, 'button quiet');
    const remove = button('×', () => { if (window.confirm(`Delete ${p.name} from the device gallery?`)) ctx.manage({ action: 'delete', ids: [p.id] }, 'Picture deleted.'); }, 'button quiet');
    rename.setAttribute('aria-label', `Rename ${p.name}`); remove.setAttribute('aria-label', `Delete ${p.name}`); remove.dataset.fixed = String(p.used); remove.title = p.used ? 'In use on a screen' : '';
    const tools = el('div', { className: 'picture-edit-tools' }); tools.append(rename, remove); wrap.append(card, tools); box.append(wrap);
  }
  const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/bmp', hidden: true });
  file.onchange = () => { if (file.files[0]) ctx.upload(type, file.files[0]); file.value = ''; };
  const limit = type === 2 ? ctx.gallery?.support?.logo : ctx.gallery?.support?.bkg;
  const cap = ctx.gallery?.capacity ? ` · ${ctx.gallery.capacity.usedCapacity}/${ctx.gallery.capacity.totalCapacity} MB used` : '';
  const help = text(type === 1 ? `Drag onto PGM or PVW to set that screen's background${cap}` : `Drag onto PGM or PVW to place the logo (max ${limit?.maxWidth || 512} × ${limit?.maxHeight || 512})${cap}`);
  const actions = el('div', { className: 'picture-actions' }); actions.append(button(type === 1 ? 'Upload background…' : 'Upload logo…', () => file.click(), 'button secondary'));
  // Capture the active screen's PGM into the gallery as a background (PixelFlow CaptureModal).
  const screen = ctx.state.screens.find(s => s.id === ctx.screenId());
  if (type === 1 && screen) actions.append(button('Capture PGM', () => {
    let n = 1; while (pictures.some(p => p.name === `PGM ${n}`)) n++;
    const name = window.prompt(`Capture ${screen.name} PGM as a background named`, `PGM ${n}`); if (name && name.trim()) ctx.manage({ action: 'capture', source: 'pgm', id: screen.id, name }, 'PGM captured to the gallery.');
  }, 'button secondary'));
  if (pictures.length) actions.append(button(ctx.galleryEdit ? 'Done' : 'Edit', () => ctx.setGalleryEdit(!ctx.galleryEdit), 'button quiet'));
  return [box, actions, file, help];
}

export function renderSourceTabs(root, ctx) {
  root.replaceChildren();
  const tabs = [['inputs', 'Inputs'], ['screens', 'Screens'], ['groups', 'Groups']];
  if (ctx.gallery?.support?.bkg) tabs.push(['bkg', 'Backgrounds']);
  if (ctx.gallery?.support?.logo) tabs.push(['logo', 'Logos']);
  const current = tabs.some(([id]) => id === ctx.tab) ? ctx.tab : 'inputs';
  const bar = el('div', { className: 'source-tabs', role: 'tablist', 'aria-label': 'Source types' });
  for (const [id, label] of tabs) {
    const tab = button(label, () => ctx.setTab(id), `button source-tab${current === id ? ' active' : ''}`);
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(current === id)); bar.append(tab);
  }
  root.append(bar);
  if (current === 'inputs' || current === 'screens') {
    const items = ctx.state.sources.filter(s => current === 'inputs' ? s.type === 2 : s.type !== 2);
    const search = input(ctx.filter || '', 'Filter programming sources'); search.placeholder = 'Filter';
    const list = el('div', { className: 'source-list' }); for (const item of items) { const row = sourceRow(item, ctx); row.hidden = !row.dataset.search.includes(search.value.toLowerCase()); list.append(row); }
    search.oninput = () => { ctx.setFilter?.(search.value); for (const row of list.children) row.hidden = !row.dataset.search.includes(search.value.toLowerCase()); };
    root.append(text('Drag into empty space to add at native size · drop on a layer to swap its source (Shift adds) · double-click adds to PVW'), search, list);
  } else if (current === 'groups') root.append(...groupsTab(ctx));
  else root.append(...picturesTab(ctx, current === 'bkg' ? 1 : 2));
}

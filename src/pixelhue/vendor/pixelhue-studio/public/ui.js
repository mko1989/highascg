export const $ = id => document.getElementById(id);
export function el(tag, attributes = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    if (key === 'className') node.className = value;
    else if (key === 'disabled' || key === 'checked' || key === 'hidden') node[key] = Boolean(value);
    else node.setAttribute(key, String(value));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}
export const text = (value, className = 'muted') => el('small', { className }, value);
export const button = (label, action, className = 'button secondary') => {
  const node = el('button', { type: 'button', className }, label); node.onclick = action; return node;
};
export function input(value, label, type = 'text') {
  const node = el('input', { type, 'aria-label': label }); node.value = value ?? ''; return node;
}
export function select(options, value, label) {
  const node = el('select', { 'aria-label': label });
  for (const [id, name] of options) node.add(new Option(name, String(id)));
  node.value = String(value ?? ''); return node;
}
export function field(label, control) {
  const node = el('label'); node.append(el('span', {}, label), control); return node;
}
export function cell(row, ...children) { const node = el('td'); node.append(...children); row.append(node); return node; }
export function table(headers) {
  const wrap = el('div', { className: 'studio-table-wrap' }), node = el('table', { className: 'studio-table' });
  const head = el('thead'), row = el('tr'); for (const label of headers) row.append(el('th', { scope: 'col' }, label));
  head.append(row); const body = el('tbody'); node.append(head, body); wrap.append(node); return { wrap, body };
}
export function setDisabled(root, busy) {
  for (const node of root.querySelectorAll('button,input,select,textarea,fieldset')) node.disabled = busy || node.dataset.fixed === 'true';
}
export function panelHeader(title, refresh) {
  const row = el('div', { className: 'tool-heading' }); row.append(el('h1', {}, title), button('Refresh', refresh)); return row;
}
export const sessionPath = (resource, session) => `${resource}?session=${encodeURIComponent(session)}`;

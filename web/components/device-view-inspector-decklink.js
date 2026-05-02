/**
 * DeckLink IO controls for Device View inspector.
 */
import * as Actions from './device-view-actions.js'

export function renderDeckLinkIoControls(h, conn, { skipPh, load }) {
	const ioDir = String(conn?.caspar?.ioDirection || 'in').toLowerCase() === 'out' ? 'out' : 'in'
	const ioWrap = Object.assign(document.createElement('div'), { className: 'device-view__inspector-links' })
	const inBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Set SDI as INPUT', disabled: ioDir === 'in' })
	const outBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Set SDI as OUTPUT', disabled: ioDir === 'out' })
	inBtn.onclick = () => Actions.updateConnector(conn.id, { caspar: { ioDirection: 'in' } }, skipPh).then(load)
	outBtn.onclick = () => Actions.updateConnector(conn.id, { caspar: { ioDirection: 'out' } }, skipPh).then(load)
	ioWrap.append(inBtn, outBtn)
	h.append(ioWrap)
}

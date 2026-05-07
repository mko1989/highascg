/**
 * DeckLink IO controls for Device View inspector.
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'
import { api } from '../lib/api-client.js'

export function renderDeckLinkIoControls(h, conn, { currentSettings, lastPayload, skipPh, statusEl, load, setCasparRestartDirty }) {
	const ioDir = String(conn?.caspar?.ioDirection || 'in').toLowerCase() === 'out' ? 'out' : 'in'
	const devNum = parseInt(String(conn?.externalRef || '0'), 10) || 0
	const channelMap = lastPayload?.live?.caspar?.channelMap || currentSettings?.channelMap || {}
	const inputsCh = channelMap.inputsCh
	const isCurrentlyInput = ioDir === 'in'

	const ioWrap = Object.assign(document.createElement('div'), { className: 'device-view__inspector-links' })

	if (isCurrentlyInput) {
		// Show "Remove as Input" button
		const removeBtn = Object.assign(document.createElement('button'), {
			className: 'header-btn',
			textContent: '⏹ Remove as Input',
			style: 'width:100%;color:#f85149'
		})
		removeBtn.onclick = async () => {
			removeBtn.disabled = true
			try {
				// 1. Stop AMCP playback if we know the channel
				if (inputsCh != null && devNum > 0) {
					const layer = devNum
					try {
						await api.post('/api/raw', { cmd: `STOP ${inputsCh}-${layer}` })
						await api.post('/api/raw', { cmd: `MIXER ${inputsCh}-${layer} CLEAR` })
					} catch (e) { /* best effort */ }
				}
				// 2. Remove from extra live sources
				const routeValue = inputsCh != null ? `route://${inputsCh}-${devNum}` : `decklink://${devNum}`
				try {
					await api.post('/api/device-view', { removeExtraLiveSource: { value: routeValue } })
				} catch (e) { /* best effort */ }
				// 3. Set connector back to output
				await Actions.updateConnector(conn.id, { caspar: { ioDirection: 'out' } }, skipPh)
				setCasparRestartDirty(true)
				setStatus(statusEl, `DeckLink ${devNum} removed as input`, true)
				await load()
			} catch (e) {
				setStatus(statusEl, `Failed: ${e?.message || e}`, false)
				removeBtn.disabled = false
			}
		}
		ioWrap.appendChild(removeBtn)

		// Show current status
		if (inputsCh != null) {
			const statusNote = Object.assign(document.createElement('p'), {
				className: 'device-view__note',
				textContent: `Active as input on channel ${inputsCh}, layer ${devNum}`,
				style: 'color:var(--accent);margin-top:6px'
			})
			ioWrap.appendChild(statusNote)
		}
	} else {
		// Show "Set as Input" button
		const inputBtn = Object.assign(document.createElement('button'), {
			className: 'header-btn',
			textContent: '▶ Set as Input',
			style: 'width:100%'
		})
		if (inputsCh == null) {
			inputBtn.disabled = true
			inputBtn.title = 'No inputs host channel configured. Enable DeckLink inputs in Settings → Inputs first.'
		}
		inputBtn.onclick = async () => {
			if (inputsCh == null) {
				setStatus(statusEl, 'No inputs host channel. Configure in Settings → Inputs.', false)
				return
			}
			inputBtn.disabled = true
			try {
				// 1. Set connector as input
				await Actions.updateConnector(conn.id, { caspar: { ioDirection: 'in' } }, skipPh)
				// 2. Play DeckLink on inputs channel via AMCP
				const layer = devNum > 0 ? devNum : 1
				try {
					await api.post('/api/raw', { cmd: `PLAY ${inputsCh}-${layer} DECKLINK ${devNum}` })
				} catch (e) {
					setStatus(statusEl, `AMCP PLAY failed: ${e?.message || e}`, false)
				}
				// 3. Add to extra live sources for Sources panel Live tab
				const routeValue = `route://${inputsCh}-${layer}`
				const liveSource = {
					value: routeValue,
					type: 'route',
					routeType: 'decklink',
					label: `DeckLink ${devNum}`,
					decklinkSlot: layer,
					inputsChannel: inputsCh,
					decklinkDevice: devNum,
					connectorId: conn.id
				}
				try {
					await api.post('/api/device-view', { addExtraLiveSource: liveSource })
				} catch (e) { /* best effort */ }
				setCasparRestartDirty(true)
				setStatus(statusEl, `DeckLink ${devNum} set as input on ch ${inputsCh}-${layer}`, true)
				await load()
			} catch (e) {
				setStatus(statusEl, `Failed: ${e?.message || e}`, false)
				inputBtn.disabled = false
			}
		}
		ioWrap.appendChild(inputBtn)

		// Also show "Set as Output" as secondary
		const outBtn = Object.assign(document.createElement('button'), {
			className: 'header-btn',
			textContent: 'Set SDI as OUTPUT',
			disabled: ioDir === 'out',
			style: 'width:100%;margin-top:6px;opacity:0.7'
		})
		outBtn.onclick = () => Actions.updateConnector(conn.id, { caspar: { ioDirection: 'out' } }, skipPh).then(load)
		ioWrap.appendChild(outBtn)
	}

	h.append(ioWrap)
}

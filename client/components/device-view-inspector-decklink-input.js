/**
 * DeckLink input routing controls for Device View inspector.
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'
import { api } from '../lib/api-client.js'
import { decklinkInputForSlot, decklinkSlotFromConnector, routeForDecklinkSlot } from '../lib/input-channels.js'
import { normalizeDecklinkIoDirection, DECKLINK_IO_UNASSIGNED } from '../lib/decklink-io-direction.js'
import { appendDecklinkSectionHeading, appendDecklinkSectionNote } from './device-view-inspector-decklink-shared.js'

/**
 * @param {HTMLElement} inputSection
 * @param {object} conn
 * @param {object} ctx — { currentSettings, lastPayload, statusEl, load, setCasparRestartDirty }
 */
export function renderDecklinkInputSection(inputSection, conn, ctx) {
	const { currentSettings, lastPayload, statusEl, load, setCasparRestartDirty } = ctx
	const ioDir = normalizeDecklinkIoDirection(conn?.caspar)
	const devNum = parseInt(String(conn?.externalRef || '0'), 10) || 0
	const slot = decklinkSlotFromConnector(conn)
	const channelMap = lastPayload?.live?.caspar?.channelMap || currentSettings?.channelMap || {}
	const inputEntry = decklinkInputForSlot(channelMap, slot)
	const isCurrentlyInput = ioDir === 'in'

	appendDecklinkSectionHeading(inputSection, 'Input')
	appendDecklinkSectionNote(
		inputSection,
		'Each DeckLink input uses its own Caspar channel so you can meter and route it independently. Drag the input from Sources onto other layers.',
	)

	if (isCurrentlyInput) {
		const removeBtn = Object.assign(document.createElement('button'), {
			className: 'header-btn',
			textContent: 'Stop input',
			style: 'width:100%',
		})
		removeBtn.onclick = async () => {
			removeBtn.disabled = true
			try {
				if (inputEntry?.channel != null) {
					const layer = inputEntry.layer ?? slot
					const cl = `${inputEntry.channel}-${layer}`
					try {
						await api.post('/api/raw', { cmd: `STOP ${cl}` })
						await api.post('/api/raw', { cmd: `MIXER ${cl} CLEAR` })
					} catch (e) {
						/* best effort */
					}
				}
				const routeValue = routeForDecklinkSlot(channelMap, slot) || `decklink://${devNum}`
				try {
					const rm = await api.post('/api/device-view', { removeExtraLiveSource: { value: routeValue } })
					if (Array.isArray(rm?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
						window.__highascgApplyExtraLiveSources(rm.extraLiveSources)
					}
				} catch (e) {
					/* best effort */
				}
				await Actions.updateConnector(conn.id, { caspar: { ioDirection: DECKLINK_IO_UNASSIGNED } })
				setCasparRestartDirty(true)
				setStatus(statusEl, `Port ${devNum}: unassigned.`, true)
				await load()
			} catch (e) {
				setStatus(statusEl, `Failed: ${e?.message || e}`, false)
				removeBtn.disabled = false
			}
		}
		inputSection.appendChild(removeBtn)

		if (inputEntry?.channel != null) {
			inputSection.append(
				Object.assign(document.createElement('p'), {
					className: 'device-view__note',
					style: 'margin-top:8px;font-size:11px',
					textContent: `Live on ch ${inputEntry.channel} · layer ${inputEntry.layer ?? slot} · ${inputEntry.route || ''}`,
				}),
			)
		}
	} else {
		const formBox = Object.assign(document.createElement('div'), { className: 'device-view__decklink-input-setup' })

		if (inputEntry == null && ioDir !== DECKLINK_IO_UNASSIGNED) {
			appendDecklinkSectionNote(
				formBox,
				`Configure DeckLink input count in Settings (slot ${slot} needs a dedicated channel). Apply Caspar config and restart before using this port as input.`,
			)
		} else if (ioDir === DECKLINK_IO_UNASSIGNED) {
			appendDecklinkSectionNote(
				formBox,
				'Starts a dedicated Caspar host channel for this SDI port. After restart, the input loops on that channel.',
			)
		}

		const activateBtn = Object.assign(document.createElement('button'), {
			className: 'header-btn',
			textContent: 'Start an input',
			style: 'width:100%;margin-top:8px',
		})

		activateBtn.onclick = async () => {
			activateBtn.disabled = true

			try {
				await Actions.updateConnector(conn.id, { caspar: { ioDirection: 'in' } })

				const refetched = await Actions.loadDeviceView()
				const newMap = refetched?.live?.caspar?.channelMap || refetched?.suggested?.channelMap || {}
				const entry = decklinkInputForSlot(newMap, slot)
				const layer = entry?.layer ?? slot
				const playCh = entry?.channel

				if (playCh != null && devNum > 0) {
					try {
						await api.post('/api/raw', { cmd: `PLAY ${playCh}-${layer} DECKLINK ${devNum}` })
					} catch (e) {
						console.warn('[decklink-input] immediate PLAY failed', e)
					}

					const routeValue = entry?.route || routeForDecklinkSlot(newMap, slot)
					if (routeValue) {
						const liveSource = {
							value: routeValue,
							type: 'route',
							routeType: 'decklink',
							label: entry?.label || `DeckLink ${slot}`,
							decklinkSlot: slot,
							inputsChannel: playCh,
							inputsLayer: layer,
							decklinkDevice: devNum,
							connectorId: conn.id,
						}
						try {
							const addRes = await api.post('/api/device-view', { addExtraLiveSource: liveSource })
							if (Array.isArray(addRes?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
								window.__highascgApplyExtraLiveSources(addRes.extraLiveSources)
							}
						} catch (e) {
							console.warn('[decklink-input] add extra live source failed', e)
						}
					}
				} else {
					setStatus(statusEl, `Port marked input. Set decklink_input_count ≥ ${slot} and restart Caspar.`, false)
				}

				setCasparRestartDirty(true)
				setStatus(statusEl, playCh != null ? `Port ${devNum} is input on ch ${playCh}.` : `Port ${devNum} is input.`, true)
				await load()
			} catch (e) {
				setStatus(statusEl, `Failed: ${e?.message || e}`, false)
				activateBtn.disabled = false
			}
		}

		formBox.appendChild(activateBtn)
		inputSection.appendChild(formBox)
	}

	return { ioDir, isCurrentlyInput }
}

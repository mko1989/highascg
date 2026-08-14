/**
 * DeckLink input routing controls for Device View inspector.
 */
import { setStatus } from './device-view-ui-utils.js'
import { decklinkInputForSlot, decklinkSlotFromConnector, routeForDecklinkSlot } from '../lib/input-channels.js'
import { normalizeDecklinkIoDirection, DECKLINK_IO_UNASSIGNED } from '../lib/decklink-io-direction.js'
import { appendDecklinkSectionHeading, appendDecklinkSectionNote } from './device-view-inspector-decklink-shared.js'
import { mountDecklinkHostSourceControls } from './inspector-decklink-host.js'
import { mountSourceLabelControl } from './inspector-source-label.js'
import {
	addDecklinkInputSlot,
	removeDecklinkInputSlot,
} from '../lib/decklink-add-input.js'
import { markCasparRestartDirty } from '../lib/caspar-restart-hint.js'

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

	if (isCurrentlyInput) {
		/* WO-525: the shared control — same key and same field as the host-channel inspector. The
		 * previous local copy read `ctx.lastPayload`, which is the device-view snapshot and never carries
		 * `sourceLabels`, so the field opened blank and the saved name looked lost. */
		mountSourceLabelControl(inputSection, {
			connectorId: conn.id,
			sources: lastPayload?.extraLiveSources,
			fallbackLabel: `DeckLink ${slot}`,
			/* WO-534: a bare `load()` is served straight from the 5s payload cache
			 * (device-view-render.js `shouldUseCache`) — i.e. the pre-rename snapshot, re-rendered
			 * over the field the operator just edited. WO-436 forced the other nine inspector
			 * reloads; this WO-525-era one was added afterwards and missed it. */
			onSaved: () => load?.({ forceRefresh: true }),
		})
		const removeBtn = Object.assign(document.createElement('button'), {
			className: 'header-btn',
			textContent: 'Stop input',
			style: 'width:100%',
		})
		removeBtn.onclick = async () => {
			removeBtn.disabled = true
			try {
				const routeValue = routeForDecklinkSlot(channelMap, slot) || `decklink://${devNum}`
				const r = await removeDecklinkInputSlot(null, {
					slot,
					connectorId: conn.id,
					liveSourceValue: routeValue,
				})
				if (r.casparRestartNeeded) {
					if (typeof setCasparRestartDirty === 'function') setCasparRestartDirty(true)
					else markCasparRestartDirty()
				}
				setStatus(statusEl, `Port ${devNum}: unassigned.`, true)
				await load?.()
			} catch (e) {
				setStatus(statusEl, `Failed: ${e?.message || e}`, false)
				removeBtn.disabled = false
			}
		}
		inputSection.appendChild(removeBtn)

		if (inputEntry?.channel != null) {
			const liveSource = {
				value: routeForDecklinkSlot(channelMap, slot) || inputEntry.route || '',
				decklinkDevice: parseInt(String(currentSettings?.casparServer?.[`decklink_input_${slot}_device`] ?? devNum), 10) || devNum,
				decklinkSlot: slot,
				connectorId: conn.id,
				inputsChannel: inputEntry.channel,
			}
			mountDecklinkHostSourceControls(inputSection, {
				source: liveSource,
				slot,
				lastPayload,
				currentSettings,
				// This inspector already mounted the shared label control above — it has to appear even
				// when the input has no host channel yet, which is why it is not left to this call.
				// Letting the host controls mount a second one put TWO Label boxes on the same connector
				// id (owner 14.08: "in decklink ports inspector there are 2 input boxes for labels").
				includeLabel: false,
				onApplied: async (r) => {
					setStatus(statusEl, r?.message || `DeckLink updated on ch ${inputEntry.channel}.`, true)
					await load?.()
				},
			})
		}
	} else {
		const formBox = Object.assign(document.createElement('div'), { className: 'device-view__decklink-input-setup' })

		if (inputEntry == null && ioDir !== DECKLINK_IO_UNASSIGNED) {
			appendDecklinkSectionNote(
				formBox,
				`Set decklink_input_count ≥ ${slot} in Settings, then apply Caspar config.`,
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
				const dev = Math.max(1, devNum || slot)
				const r = await addDecklinkInputSlot(null, { device: dev, slot })
				if (!r.ok) {
					if (typeof setCasparRestartDirty === 'function') setCasparRestartDirty(true)
					else markCasparRestartDirty()
					setStatus(statusEl, r.error || `Port ${devNum}: failed to start input.`, false)
					activateBtn.disabled = false
					return
				}
				if (Array.isArray(r.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
					window.__highascgApplyExtraLiveSources(r.extraLiveSources)
				}
				if (r.casparRestartNeeded || r.pendingApply) {
					if (typeof setCasparRestartDirty === 'function') setCasparRestartDirty(true)
					else markCasparRestartDirty()
				}
				const applyNote = r.casparRestartNeeded
					? ' Apply Caspar config and restart if the input does not appear.'
					: ''
				setStatus(statusEl, `Port ${devNum} is input on ch ${r.hostChannel}.${applyNote}`, true)
				await load?.()
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

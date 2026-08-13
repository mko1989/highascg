/**
 * DeckLink input routing controls for Device View inspector.
 */
import { setStatus } from './device-view-ui-utils.js'
import { decklinkInputForSlot, decklinkSlotFromConnector, routeForDecklinkSlot } from '../lib/input-channels.js'
import { normalizeDecklinkIoDirection, DECKLINK_IO_UNASSIGNED } from '../lib/decklink-io-direction.js'
import { appendDecklinkSectionHeading, appendDecklinkSectionNote } from './device-view-inspector-decklink-shared.js'
import { mountDecklinkHostSourceControls } from './inspector-decklink-host.js'
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
		mountSourceLabelControl(inputSection, conn, ctx)
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

/**
 * Operator-editable name for this input (WO-506).
 *
 * The store, resolver and `POST /api/sources/label` landed with WO-506, but nothing could SET a
 * label — owner: *"the labels of screens is not finished. cant add labels to decklink inputs."*
 * This is the missing control. It lives in the device-view host-channel inspector, not the Sources
 * tab: a Sources selection is not a place to hang settings, and per-input controls belong here.
 *
 * The key is the CONNECTOR id (`dlsdi_3`), which survives re-cabling and re-mapping, so a renamed
 * camera keeps its name when it is re-patched. Clearing the field removes the override rather than
 * storing a blank, and the placeholder shows the generated name it will fall back to.
 *
 * @param {HTMLElement} parent
 * @param {object} conn device-graph connector
 * @param {object} ctx inspector context
 */
function mountSourceLabelControl(parent, conn, ctx) {
	const key = String(conn?.id || '').trim()
	if (!key) return
	const state = ctx?.lastPayload || {}
	const sources = Array.isArray(state.extraLiveSources) ? state.extraLiveSources : []
	const mine = sources.find((s) => String(s?.connectorId || '') === key) || null
	const generated = String(mine?.generatedLabel || mine?.label || '').trim()
	const custom = String((state.sourceLabels || {})[key] || '').trim()

	const row = document.createElement('div')
	row.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-bottom:8px'
	row.appendChild(
		Object.assign(document.createElement('span'), {
			textContent: 'Label',
			style: 'font-size:10px;opacity:0.6',
		}),
	)
	const input = Object.assign(document.createElement('input'), {
		type: 'text',
		className: 'device-view__inspector-input',
		value: custom,
		placeholder: generated || `DeckLink ${decklinkSlotFromConnector(conn)}`,
		maxLength: 64,
	})
	input.title = 'Shown wherever this source appears. Leave empty to use the generated name.'

	let saving = false
	const save = async () => {
		if (saving) return
		saving = true
		try {
			const res = await fetch('/api/sources/label', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sourceId: key, label: input.value }),
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			// A rename changes no Caspar config, so this must NOT set the restart-dirty flag —
			// making the operator restart playout to rename a camera would be absurd.
			if (typeof ctx.load === 'function') ctx.load({ forceRefresh: true })
		} catch (e) {
			if (ctx?.statusEl) ctx.statusEl.textContent = `Label save failed: ${e?.message || e}`
		} finally {
			saving = false
		}
	}
	input.addEventListener('change', save)
	input.addEventListener('blur', save)
	row.appendChild(input)
	parent.appendChild(row)
}

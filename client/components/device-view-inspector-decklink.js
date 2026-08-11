/**
 * DeckLink IO controls for Device View inspector.
 */
import { normalizeDecklinkIoDirection, DECKLINK_IO_UNASSIGNED } from '../lib/decklink-io-direction.js'
import { renderDecklinkInputSection } from './device-view-inspector-decklink-input.js'
import {
	appendDecklinkSectionHeading,
	appendDecklinkSectionNote,
	connectorCableCount,
} from './device-view-inspector-decklink-shared.js'
import {
	renderDecklinkConsumerSettingsControls,
	renderDecklinkKeyFillControls,
	renderDecklinkOutputInheritControls,
} from './device-view-inspector-decklink-output.js'
import { renderDecklinkRearOrderEditor } from './device-view-inspector-decklink-rear-order.js'

export function renderDeckLinkIoControls(h, conn, { currentSettings, lastPayload, statusEl, load, setCasparRestartDirty }) {
	renderDecklinkRearOrderEditor(h, { lastPayload, load })

	if (conn?.kind === 'decklink_out') {
		renderDecklinkOutputInheritControls(h, conn, { lastPayload })
		renderDecklinkConsumerSettingsControls(h, conn, { lastPayload, statusEl, load, setCasparRestartDirty })
		renderDecklinkKeyFillControls(h, conn, { lastPayload, statusEl, load, setCasparRestartDirty })
		return
	}

	const ioDir = normalizeDecklinkIoDirection(conn?.caspar)
	const cableCount = connectorCableCount(lastPayload, conn?.id)

	const ioWrap = Object.assign(document.createElement('div'), { className: 'device-view__inspector-links' })

	const inputSection = Object.assign(document.createElement('div'), { className: 'device-view__decklink-io-section' })
	const { isCurrentlyInput } = renderDecklinkInputSection(inputSection, conn, {
		currentSettings,
		lastPayload,
		statusEl,
		load,
		setCasparRestartDirty,
	})

	ioWrap.appendChild(inputSection)

	ioWrap.append(Object.assign(document.createElement('hr'), { className: 'device-view__section-divider' }))

	const outputSection = Object.assign(document.createElement('div'), { className: 'device-view__decklink-io-section' })
	appendDecklinkSectionHeading(outputSection, 'Output')

	if (isCurrentlyInput) {
		appendDecklinkSectionNote(
			outputSection,
			'This port is in input mode. Stop input above to use it as a program / fill+key output.'
		)
	} else {
		if (ioDir === DECKLINK_IO_UNASSIGNED) {
			/* WO-479: a drawn cable is not reflected in `ioDirection` until Apply writes the config,
			 * so a patched port used to keep telling the operator to patch it. */
			if (cableCount > 0) {
				appendDecklinkSectionNote(
					outputSection,
					`Cabled (${cableCount} connection${cableCount === 1 ? '' : 's'}) — becomes a program output on Apply. Fill+key below.`
				)
			} else {
				appendDecklinkSectionNote(
					outputSection,
					'Unassigned SDI port. Cable a screen destination here to use as program output, or configure fill+key below.'
				)
			}
		} else {
			appendDecklinkSectionNote(outputSection, 'Program output, fill+key pairs, and destination mapping.')
		}
		renderDecklinkOutputInheritControls(outputSection, conn, { lastPayload })
		renderDecklinkConsumerSettingsControls(outputSection, conn, { lastPayload, statusEl, load, setCasparRestartDirty })
		renderDecklinkKeyFillControls(outputSection, conn, { lastPayload, statusEl, load, setCasparRestartDirty })
	}

	ioWrap.appendChild(outputSection)
	h.append(ioWrap)
}

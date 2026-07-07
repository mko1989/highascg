/**
 * DeckLink IO controls for Device View inspector.
 */
import { normalizeDecklinkIoDirection, DECKLINK_IO_UNASSIGNED } from '../lib/decklink-io-direction.js'
import { renderDecklinkInputSection } from './device-view-inspector-decklink-input.js'
import {
	appendDecklinkSectionHeading,
	appendDecklinkSectionNote,
} from './device-view-inspector-decklink-shared.js'
import {
	renderDecklinkConsumerSettingsControls,
	renderDecklinkKeyFillControls,
	renderDecklinkOutputInheritControls,
	renderDecklinkRearOrderEditor,
} from './device-view-inspector-decklink-output.js'

export function renderDeckLinkIoControls(h, conn, { currentSettings, lastPayload, statusEl, load, setCasparRestartDirty }) {
	renderDecklinkRearOrderEditor(h, { lastPayload, load })

	if (conn?.kind === 'decklink_out') {
		renderDecklinkOutputInheritControls(h, conn, { lastPayload })
		renderDecklinkConsumerSettingsControls(h, conn, { lastPayload, statusEl, load, setCasparRestartDirty })
		renderDecklinkKeyFillControls(h, conn, { lastPayload, statusEl, load, setCasparRestartDirty })
		return
	}

	const ioDir = normalizeDecklinkIoDirection(conn?.caspar)

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
			appendDecklinkSectionNote(
				outputSection,
				'Unassigned SDI port. Cable a screen destination here to use as program output, or configure fill+key below.'
			)
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

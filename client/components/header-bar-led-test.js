/**
 * Header bar LED test card and FTB controls.
 */

import { api } from '../lib/api-client.js'
import { showLedTestModal, getLedTestSettings, syncLedTestSettings } from './led-test-modal.js'
import {
	applyLedTestPattern,
	isLedTestMasterEnabled,
	setLedTestMasterEnabled,
} from '../lib/led-test-apply.js'

export function initLedTestCard(container, stateStore) {
	const ledTestCb = document.createElement('input')
	ledTestCb.type = 'checkbox'
	ledTestCb.id = 'header-led-test-cb'
	ledTestCb.checked = isLedTestMasterEnabled()
	void syncLedTestSettings().catch(() => {})
	ledTestCb.title = 'Show LED test card on all program channels (layer 999): screens + resolution + IPs by default; full grid per channel in Test card…'

	const ledTestBtn = document.createElement('button')
	ledTestBtn.type = 'button'
	ledTestBtn.className = 'header-btn header-btn--led-setup'
	ledTestBtn.textContent = 'Test card…'
	ledTestBtn.title = 'Grid size and labels'

	let ftbBusy = false
	let ledTestApplyBusy = false

	const ftbBtn = document.createElement('button')
	ftbBtn.type = 'button'
	ftbBtn.className = 'header-btn header-btn--ftb'
	ftbBtn.textContent = 'FTB'
	ftbBtn.title = 'Fade to black: fade out all program and preview layers, then clear'

	container.appendChild(ledTestCb)
	container.appendChild(ledTestBtn)
	container.appendChild(ftbBtn)

	async function applyLedTest(enabled, options = {}) {
		ledTestApplyBusy = true
		try {
			const { failures, targets } = await applyLedTestPattern(stateStore, enabled, {
				...options,
				onAllFailed: () => {
					setLedTestMasterEnabled(false)
					ledTestCb.checked = false
				},
			})
			if (enabled && failures.length > 0) {
				if (failures.length === targets.length) {
					alert(
						'LED test card: failed on all outputs.\n' +
							failures.map((f) => `ch ${f.channel}: ${f.message}`).join('\n'),
					)
				}
			}
		} catch (e) {
			setLedTestMasterEnabled(false)
			ledTestCb.checked = false
			alert('LED test card: ' + (e?.message || e))
		} finally {
			ledTestApplyBusy = false
		}
	}

	ledTestCb.addEventListener('change', () => {
		const enabled = !!ledTestCb.checked
		setLedTestMasterEnabled(enabled)
		void applyLedTest(enabled)
	})

	ledTestBtn.addEventListener('click', async () => {
		await syncLedTestSettings().catch(() => {}) // WO-629: the node's settings (Godot may have changed them)
		showLedTestModal((event) => {
			if (event?.type === 'channel') {
				if (event.enabled) {
					setLedTestMasterEnabled(true)
					ledTestCb.checked = true
				} else {
					const s = getLedTestSettings(stateStore)
					const anyOn = Object.values(s.channelsEnabled || {}).some((v) => v === true)
					if (!anyOn) {
						setLedTestMasterEnabled(false)
						ledTestCb.checked = false
					}
				}
				void applyLedTest(event.enabled, { channels: [event.channel] })
				return
			}
			/* Settings edits: the node already re-applied the card while it is up (POST …/settings). */
		}, stateStore)
	})

	ftbBtn.addEventListener('click', () => {
		void (async () => {
			if (ftbBusy) return
			ftbBusy = true
			ftbBtn.disabled = true
			try {
				await api.post('/api/ftb', {}) // layer 999 stays — the checkbox keeps following the node (WO-629)
			} catch (e) {
				alert('FTB: ' + (e?.message || e))
			} finally {
				ftbBusy = false
				ftbBtn.disabled = false
			}
		})()
	})

	// WO-629: the checkbox mirrors the node's state.ledTestPatternActive (a Godot client or the startup splash may
	// switch it), except while this client's own switch is in flight.
	stateStore?.on?.('*', () => {
		if (ledTestApplyBusy) return
		const on = stateStore.getState()?.ledTestPatternActive === true
		if (on === isLedTestMasterEnabled()) return
		setLedTestMasterEnabled(on)
		ledTestCb.checked = on
	})
}

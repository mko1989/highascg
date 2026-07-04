/**
 * Header bar LED test card and FTB controls.
 */

import { api } from '../lib/api-client.js'
import { showLedTestModal, getLedTestSettings } from './led-test-modal.js'
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
	ledTestCb.title = 'Show LED test card on all program channels (layer 999): screens + resolution + IPs by default; full grid per channel in Test card…'

	const ledTestBtn = document.createElement('button')
	ledTestBtn.type = 'button'
	ledTestBtn.className = 'header-btn header-btn--led-setup'
	ledTestBtn.textContent = 'Test card…'
	ledTestBtn.title = 'Grid size and labels'

	let ftbBusy = false
	let ledTestApplyBusy = false
	let ledTestServerSyncDone = false

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
			if (e?.code === 'NO_CHANNELS') {
				setLedTestMasterEnabled(false)
				ledTestCb.checked = false
				alert(e.message)
				return
			}
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

	ledTestBtn.addEventListener('click', () => {
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
			if (!isLedTestMasterEnabled()) return
			void applyLedTest(true)
		}, stateStore)
	})

	ftbBtn.addEventListener('click', () => {
		void (async () => {
			if (ftbBusy) return
			ftbBusy = true
			ftbBtn.disabled = true
			try {
				await api.post('/api/ftb', {})
				setLedTestMasterEnabled(false)
				ledTestCb.checked = false
			} catch (e) {
				alert('FTB: ' + (e?.message || e))
			} finally {
				ftbBusy = false
				ftbBtn.disabled = false
			}
		})()
	})

	// One-time sync from server on connect (startup splash). Do not fight user toggles afterward.
	stateStore?.on?.('*', () => {
		if (ledTestApplyBusy || ledTestServerSyncDone) return
		const st = stateStore.getState()
		if (st.ledTestPatternActive !== true) return
		if (isLedTestMasterEnabled()) {
			ledTestServerSyncDone = true
			return
		}
		ledTestServerSyncDone = true
		setLedTestMasterEnabled(true)
		ledTestCb.checked = true
	})
}

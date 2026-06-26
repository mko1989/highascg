/**
 * Header bar LED test card and FTB controls.
 */

import { api } from '../lib/api-client.js'
import { showLedTestModal, getLedTestSettings, getLedTestShowGridForChannel } from './led-test-modal.js'

export function initLedTestCard(container, stateStore) {
	const ledTestCb = document.createElement('input')
	ledTestCb.type = 'checkbox'
	ledTestCb.id = 'header-led-test-cb'
	ledTestCb.title = 'Show LED test card on all program channels (layer 999): screens + resolution + IPs by default; full grid per channel in Test card…'

	const ledTestBtn = document.createElement('button')
	ledTestBtn.type = 'button'
	ledTestBtn.className = 'header-btn header-btn--led-setup'
	ledTestBtn.textContent = 'Test card…'
	ledTestBtn.title = 'Grid size and labels'

	let ftbBusy = false
	const ftbBtn = document.createElement('button')
	ftbBtn.type = 'button'
	ftbBtn.className = 'header-btn header-btn--ftb'
	ftbBtn.textContent = 'FTB'
	ftbBtn.title = 'Fade to black: fade out all program and preview layers, then clear'

	container.appendChild(ledTestCb)
	container.appendChild(ledTestBtn)
	container.appendChild(ftbBtn)

	async function applyLedTest(enabled) {
		try {
			const s = getLedTestSettings(stateStore)
			const { gridByChannel: _g, channelsEnabled: _c, ...rest } = s
			const st = stateStore?.getState?.() || {}
			const programChannelsRaw = Array.isArray(st?.channelMap?.programChannels) ? st.channelMap.programChannels : [1]
			const programChannels = [...new Set(programChannelsRaw.map((x) => parseInt(String(x), 10)).filter((n) => Number.isFinite(n) && n > 0))]
			const mvCh = parseInt(String(st?.channelMap?.multiviewCh ?? ''), 10)
			
			const activeChs = Object.entries(s.channelsEnabled || {})
				.filter(([, v]) => v === true)
				.map(([k]) => parseInt(k, 10))
			const gridChs = Object.entries(s.gridByChannel || {})
				.filter(([, v]) => v === true)
				.map(([k]) => parseInt(k, 10))
			const channelsToApply = [...activeChs, ...gridChs]
			const uniqueChannels = [...new Set(channelsToApply)].filter((n) => Number.isFinite(n) && n > 0)
			
			let targets = []
			if (enabled) {
				if (!uniqueChannels.length) {
					ledTestCb.checked = false
					localStorage.setItem('highascg_led_test_enabled', 'false')
					alert(
						'LED test card: choose at least one channel under Test card… → “Enable test card on channel”, then try again.',
					)
					return
				}
				targets = uniqueChannels
			} else {
				targets = [...new Set([...programChannels, ...(Number.isFinite(mvCh) && mvCh > 0 ? [mvCh] : []), ...uniqueChannels])].filter((n) => Number.isFinite(n) && n > 0)
			}
			const failures = []

			for (const channel of targets) {
				const row = st?.configComparison?.serverChannels?.find((x) => x.index === channel)
				const cs = st?.settings?.casparServer && typeof st.settings.casparServer === 'object'
					? st.settings.casparServer
					: st?.config?.casparServer && typeof st.config.casparServer === 'object'
						? st.config.casparServer
						: {}
				let connectorLabel = ''
				const progIdx = programChannels.indexOf(channel)

				if (progIdx >= 0) {
					const screenNo = progIdx + 1
					const screenSystemId = String(cs[`screen_${screenNo}_system_id`] || '').trim()
					const osMode = String(cs[`screen_${screenNo}_os_mode`] || '').trim()
					const osRateRaw = parseFloat(String(cs[`screen_${screenNo}_os_rate`] ?? ''))
					const osRate = Number.isFinite(osRateRaw) && osRateRaw > 0 ? osRateRaw : null
					const xrandrPart = [osMode, osRate != null ? `${osRate}Hz` : ''].filter(Boolean).join(' @ ')
					const deck = parseInt(String(cs[`screen_${progIdx + 1}_decklink_device`] ?? 0), 10) || 0
					connectorLabel = `Output: Screen ${screenNo} (PGM ch ${channel})`
					if (screenSystemId) connectorLabel += ` · ${screenSystemId}`
					if (xrandrPart) connectorLabel += ` · ${xrandrPart}`
					if (deck > 0) connectorLabel += ` · DeckLink ${deck}`
					else if (row?.hasScreen) connectorLabel += ' · Screen consumer'
				} else if (Number.isFinite(mvCh) && channel === mvCh) {
					const mvDeck = parseInt(String(cs.multiview_decklink_device ?? 0), 10) || 0
					const mvSystemId = String(cs.multiview_system_id || '').trim()
					const mvOsMode = String(cs.multiview_os_mode || '').trim()
					const mvOsRateRaw = parseFloat(String(cs.multiview_os_rate ?? ''))
					const mvOsRate = Number.isFinite(mvOsRateRaw) && mvOsRateRaw > 0 ? mvOsRateRaw : null
					const mvXrandrPart = [mvOsMode, mvOsRate != null ? `${mvOsRate}Hz` : ''].filter(Boolean).join(' @ ')
					connectorLabel = `Output: Multiview (ch ${channel})`
					if (mvSystemId) connectorLabel += ` · ${mvSystemId}`
					if (mvXrandrPart) connectorLabel += ` · ${mvXrandrPart}`
					if (mvDeck > 0) connectorLabel += ` · DeckLink ${mvDeck}`
					else if (row?.hasScreen) connectorLabel += ' · Screen consumer'
				}

				const payload = {
					enabled,
					...rest,
					channel,
					showLedGrid: getLedTestShowGridForChannel(channel),
					showCircle: s.showCircle !== false,
					showCross: s.showCross !== false,
					connectorLabel,
				}
				if (row) {
					payload.resolutionLabel = row.resolutionLabel
					payload.resolutionWidth = row.screenWidth
					payload.resolutionHeight = row.screenHeight
					payload.videoMode = row.videoMode
				}
				try {
					await api.post('/api/led-test-card', payload)
				} catch (err) {
					failures.push({ channel, message: err?.message || String(err) })
				}
			}

			if (enabled && failures.length === targets.length) {
				ledTestCb.checked = false
				localStorage.setItem('highascg_led_test_enabled', 'false')
				alert(
					'LED test card: failed on all outputs.\n' +
						failures.map((f) => `ch ${f.channel}: ${f.message}`).join('\n')
				)
				return
			}
			if (enabled && failures.length > 0) {
				console.warn(
					'LED test card: partial failure',
					failures.map((f) => `ch ${f.channel}: ${f.message}`).join('; ')
				)
			}
			localStorage.setItem('highascg_led_test_enabled', enabled ? 'true' : 'false')
		} catch (e) {
			ledTestCb.checked = false
			localStorage.setItem('highascg_led_test_enabled', 'false')
			alert('LED test card: ' + (e?.message || e))
		}
	}

	ledTestCb.addEventListener('change', () => {
		void applyLedTest(!!ledTestCb.checked)
	})

	ledTestBtn.addEventListener('click', () => {
		showLedTestModal(() => {
			if (ledTestCb.checked) void applyLedTest(true)
		}, stateStore)
	})

	ftbBtn.addEventListener('click', () => {
		void (async () => {
			if (ftbBusy) return
			ftbBusy = true
			ftbBtn.disabled = true
			try {
				await api.post('/api/ftb', {})
				ledTestCb.checked = false
				localStorage.setItem('highascg_led_test_enabled', 'false')
			} catch (e) {
				alert('FTB: ' + (e?.message || e))
			} finally {
				ftbBusy = false
				ftbBtn.disabled = false
			}
		})()
	})

	let ledTestSyncedFromServer = false
	const unsubscribe = stateStore?.on?.('*', () => {
		if (ledTestSyncedFromServer) return
		const st = stateStore.getState()
		if (!st?.channelMap && st.ledTestPatternActive === undefined) return

		ledTestSyncedFromServer = true
		unsubscribe?.()

		const serverActive = !!st.ledTestPatternActive
		ledTestCb.checked = serverActive
		localStorage.setItem('highascg_led_test_enabled', serverActive ? 'true' : 'false')

		// Reflect server state only — never auto-enable test pattern on connect/refresh.
		if (!serverActive) {
			void applyLedTest(false)
		}
	})
}

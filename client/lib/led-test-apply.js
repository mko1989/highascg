/**
 * Apply LED test card settings to Caspar channels (layer 999).
 */

import { api } from './api-client.js'
import { getLedTestSettings, getLedTestShowGridForChannel } from '../components/led-test-modal.js'

const LS_MASTER = 'highascg_led_test_enabled'

/** @returns {boolean} */
export function isLedTestMasterEnabled() {
	return localStorage.getItem(LS_MASTER) === 'true'
}

/** @param {boolean} on */
export function setLedTestMasterEnabled(on) {
	localStorage.setItem(LS_MASTER, on ? 'true' : 'false')
}

let applyChain = Promise.resolve()

/**
 * @param {() => Promise<void>} fn
 */
function queueLedTestApply(fn) {
	applyChain = applyChain.then(fn).catch(() => {})
	return applyChain
}

/**
 * @param {import('./state-store.js').StateStore | { getState?: () => object }} stateStore
 * @param {boolean} enabled
 * @param {{ channels?: number[], onAllFailed?: () => void, masterOff?: boolean }} [options]
 * @returns {Promise<{ failures: { channel: number, message: string }[] }>}
 */
export async function applyLedTestPattern(stateStore, enabled, options = {}) {
	return queueLedTestApply(async () => {
		const failures = []
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
		const uniqueChannels = [...new Set([...activeChs, ...gridChs])].filter((n) => Number.isFinite(n) && n > 0)

		const channelScoped = Array.isArray(options.channels) && options.channels.length > 0
		let targets
		if (channelScoped) {
			targets = [...new Set(options.channels.map((n) => parseInt(String(n), 10)).filter((n) => Number.isFinite(n) && n > 0))]
		} else if (enabled) {
			if (!uniqueChannels.length) {
				const err = new Error(
					'LED test card: choose at least one channel under Test card… → “Enable test card on channel”, then try again.',
				)
				err.code = 'NO_CHANNELS'
				throw err
			}
			targets = uniqueChannels
		} else {
			targets = [...new Set([...programChannels, ...(Number.isFinite(mvCh) && mvCh > 0 ? [mvCh] : []), ...uniqueChannels])].filter(
				(n) => Number.isFinite(n) && n > 0,
			)
		}

		const masterOff = options.masterOff === true || (!enabled && !channelScoped)

		for (let ti = 0; ti < targets.length; ti++) {
			const channel = targets[ti]
			const isLast = ti === targets.length - 1
			const channelEnabled = !!enabled
			const row = st?.configComparison?.serverChannels?.find((x) => x.index === channel)
			const cs =
				st?.settings?.casparServer && typeof st.settings.casparServer === 'object'
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
				enabled: channelEnabled,
				...rest,
				channel,
				showLedGrid: getLedTestShowGridForChannel(channel),
				showCircle: s.showCircle !== false,
				showCross: s.showCross !== false,
				connectorLabel,
				masterOff: masterOff && isLast,
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

	if (enabled && failures.length === targets.length && targets.length > 0) {
		if (typeof options.onAllFailed === 'function') options.onAllFailed()
	}

	if (enabled && failures.length > 0 && failures.length < targets.length) {
		console.warn(
			'LED test card: partial failure',
			failures.map((f) => `ch ${f.channel}: ${f.message}`).join('; '),
		)
	}

	return { failures, targets }
	})
}

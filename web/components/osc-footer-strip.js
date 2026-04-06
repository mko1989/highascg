/**
 * Compact OSC VU strip (footer): program channels from state + {@link OscClient} audio levels.
 * @see WO-08 T2.2 (Refactored to use modular vu-meter.js)
 */
import { createVuMeter } from './vu-meter.js'

/**
 * @param {() => import('../lib/osc-client.js').OscClient | null} getOscClient
 * @param {import('../lib/state-store.js').StateStore} stateStore
 */
export function initOscFooterStrip(getOscClient, stateStore) {
	const el = document.getElementById('app-footer-osc')
	if (!el) return

	const meters = []
	el.innerHTML = ''
	
	function programChannels() {
		const p = stateStore.getState()?.channelMap?.programChannels
		if (Array.isArray(p) && p.length) return p
		return [1, 2, 3, 4]
	}

	function createMeters() {
		meters.forEach((m) => m.destroy())
		meters.length = 0
		el.innerHTML = ''
		const prog = programChannels()
		for (let i = 0; i < 4; i++) {
			const ch = prog[i] != null ? prog[i] : i + 1
			const m = createVuMeter(el, {
				channels: 2,
				orientation: 'vertical',
				label: `PGM ${ch}`,
				getLevels: () => {
					const oc = getOscClient()
					const c = oc?.channels?.[String(ch)] || oc?.channels?.[ch]
					const lv = c?.audio?.levels
					return {
						l: lv?.[0]?.dBFS ?? -60,
						r: lv?.[1]?.dBFS ?? lv?.[0]?.dBFS ?? -60
					}
				}
			})
			meters.push(m)
		}
	}

	function applyVisibility() {
		// Always show program VU when OSC data is available (no opt-in from Settings).
		el.hidden = false
		if (meters.length === 0) createMeters()
	}

	stateStore.on('channelMap', () => createMeters())
	applyVisibility()
}

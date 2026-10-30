'use strict'

/**
 * PGM/PRV channel numbering for {@link module:config/routing-map getChannelMap} (split out of routing-map.js, which sat
 * at the 500-line limit, for WO-868).
 *
 * Virtual mode takes the numbers the config names. Otherwise mains are numbered PGM then PRV per screen from `firstCh`
 * (1 in the legacy scheme; 2 when the operator GUI owns channel 1, WO-868). `isPinned` (WO-868, only passed in the
 * operator-first scheme) skips stored host-live pins the way allocCh() does, so a +1 shift can never land a main on a
 * pinned host channel (WO-414: pins never move).
 *
 * @param {{ useVirtual: boolean, virtualMainChannels: object[], screenCount: number, previewEnabledByMain: boolean[],
 *   firstCh?: number, isPinned?: ((ch: number) => boolean) | null }} opts
 * @returns {{ programChannels: number[], previewChannels: (number|null)[], switcherBus1Channels: (number|null)[],
 *   switcherBusChannels: (number|null)[], switcherBusMode: boolean }}
 */
function allocateMainChannels(opts) {
	const { useVirtual, virtualMainChannels, screenCount, previewEnabledByMain } = opts
	const programChannels = []; const previewChannels = []
	const switcherBus1Channels = []
	const switcherBusChannels = []
	// Switcher-bus (3-channel per destination) is retired.
	// Keep transition model forced to 2-channel PGM/PRV flow.
	const switcherBusMode = false
	if (useVirtual) {
		for (let i = 0; i < screenCount; i++) {
			const v = virtualMainChannels[i] || {}
			const pgm = parseInt(v.pgm, 10) || 1
			// When prv is empty/missing, preview is disabled for this main — do not default to pgm
			const prvRaw = v.prv != null && String(v.prv).trim() !== '' ? parseInt(v.prv, 10) : null
			const prv = prvRaw != null && Number.isFinite(prvRaw) && prvRaw >= 1 ? prvRaw : null
			programChannels.push(pgm)
			previewChannels.push(previewEnabledByMain[i] && prv != null ? prv : null)
			switcherBus1Channels.push(prv)
			switcherBusChannels.push(null)
		}
		// Warn about duplicate channel assignments in virtual mode
		const allAssigned = [...programChannels, ...previewChannels.filter(Boolean)]
		const seen = new Set()
		for (const ch of allAssigned) {
			if (seen.has(ch)) {
				if (typeof console !== 'undefined') console.warn(`[routing-map] Warning: duplicate channel number ${ch} in virtual main channel assignments`)
			}
			seen.add(ch)
		}
		return { programChannels, previewChannels, switcherBus1Channels, switcherBusChannels, switcherBusMode }
	}
	let ch = Number.isFinite(opts.firstCh) && opts.firstCh >= 1 ? opts.firstCh : 1
	const isPinned = typeof opts.isPinned === 'function' ? opts.isPinned : null
	const next = () => {
		if (isPinned) while (isPinned(ch)) ch++
		return ch++
	}
	for (let i = 0; i < screenCount; i++) {
		if (switcherBusMode) {
			const out = next()
			if (previewEnabledByMain[i]) {
				const bus1 = next()
				const bus2 = next()
				programChannels.push(out)
				previewChannels.push(bus1)
				switcherBus1Channels.push(bus1)
				switcherBusChannels.push(bus2)
			} else {
				programChannels.push(out)
				previewChannels.push(null)
				switcherBus1Channels.push(null)
				switcherBusChannels.push(null)
			}
		} else {
			const pgm = next()
			const prv = previewEnabledByMain[i] ? next() : null
			programChannels.push(pgm)
			previewChannels.push(prv)
			switcherBus1Channels.push(prv)
			switcherBusChannels.push(null)
		}
	}
	return { programChannels, previewChannels, switcherBus1Channels, switcherBusChannels, switcherBusMode }
}

module.exports = { allocateMainChannels }

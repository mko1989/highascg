'use strict'

const { getChannelMap, readCasparSetting, resolveDecklinkInputDeviceIndex } = require('./routing')

/**
 * Client-side validation for DeckLink input vs output indices (before Caspar startup).
 * @param {Record<string, unknown>} casparServerSlice - `casparServer` object (merged or partial)
 * @returns {{ warnings: string[] }}
 */
function validateDecklinkCasparSlice(casparServerSlice) {
	const warnings = []
	const cs = casparServerSlice && typeof casparServerSlice === 'object' ? casparServerSlice : {}
	const map = getChannelMap({ casparServer: cs })
	if (!map.inputsEnabled || map.decklinkCount === 0) return { warnings }

	const outputDevices = new Set()
	for (let n = 1; n <= map.screenCount; n++) {
		const dlOut = parseInt(String(readCasparSetting({ casparServer: cs }, `screen_${n}_decklink_device`) ?? '0'), 10)
		if (dlOut > 0) outputDevices.add(dlOut)
	}
	const mvDl = parseInt(String(readCasparSetting({ casparServer: cs }, 'multiview_decklink_device') ?? '0'), 10)
	if (mvDl > 0) outputDevices.add(mvDl)

	const used = new Map()
	for (let i = 1; i <= map.decklinkCount; i++) {
		const dev = resolveDecklinkInputDeviceIndex({ casparServer: cs }, i)
		if (outputDevices.has(dev)) {
			warnings.push(
				`DeckLink input slot ${i} resolves to device ${dev}, which is also used as a program or multiview DeckLink output — that input will be skipped at startup.`
			)
		}
		if (used.has(dev)) {
			warnings.push(
				`DeckLink input slots ${used.get(dev)} and ${i} both use device ${dev} — the duplicate slot will be skipped at startup.`
			)
		} else {
			used.set(dev, i)
		}
	}
	return { warnings }
}

module.exports = { validateDecklinkCasparSlice }

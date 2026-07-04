'use strict'

const { getChannelMap, readCasparSetting, resolveDecklinkInputDeviceIndex } = require('./routing')
const { validateDecklinkOutputResolutions } = require('./decklink-output-resolve')

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
		const dlKey = parseInt(String(readCasparSetting({ casparServer: cs }, `screen_${n}_decklink_key_device`) ?? '0'), 10)
		if (dlKey > 0) outputDevices.add(dlKey)
		if (dlOut > 0 && dlKey > 0 && dlOut === dlKey) {
			warnings.push(`Screen ${n}: DeckLink fill device and key device are both ${dlOut}; key device must differ from fill device.`)
		}
	}
	const mvDl = parseInt(String(readCasparSetting({ casparServer: cs }, 'multiview_decklink_device') ?? '0'), 10)
	if (mvDl > 0) outputDevices.add(mvDl)
	const mvKey = parseInt(String(readCasparSetting({ casparServer: cs }, 'multiview_decklink_key_device') ?? '0'), 10)
	if (mvKey > 0) outputDevices.add(mvKey)
	if (mvDl > 0 && mvKey > 0 && mvDl === mvKey) {
		warnings.push(`Multiview: DeckLink fill device and key device are both ${mvDl}; key device must differ from fill device.`)
	}

	const used = new Map()
	const { resolveDecklinkInputSlots } = require('./decklink-input-slots')
	const inputSlots = resolveDecklinkInputSlots({ casparServer: cs })
	for (const i of inputSlots) {
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

/**
 * DeckLink output resolution validation (graph + settings shape).
 * @param {Record<string, unknown>} config - full app config or flat generator config with deviceGraph
 * @returns {{ warnings: string[] }}
 */
function validateDecklinkOutputResolution(config) {
	return { warnings: validateDecklinkOutputResolutions(config || {}) }
}

module.exports = { validateDecklinkCasparSlice, validateDecklinkOutputResolution }

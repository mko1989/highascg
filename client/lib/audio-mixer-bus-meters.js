import { programBusChannelCountForChannel } from './program-audio-layouts.js'

/** Max bus meters / OSC variable slots (matches Caspar 16ch cap). */
export const MAX_BUS_METER_CHANNELS = 16

/**
 * Program bus width for one Caspar program channel.
 * @param {object} [settings]
 * @param {object} [channelMap]
 * @param {number} programCh
 */
export function programBusChannelCount(settings, channelMap, programCh) {
	return programBusChannelCountForChannel(settings, channelMap, programCh)
}

/** @param {string} masterKey e.g. `pgm:1` @param {number} channelIndex 0-based */
export function busMeterFillKey(masterKey, channelIndex) {
	return `${masterKey}:bus:${channelIndex}`
}

/**
 * @param {string} key
 * @returns {{ casparChannel: number, channelIndex: number } | null}
 */
export function parseBusMeterFillKey(key) {
	const m = String(key).match(/^(?:pgm|prv):(\d+):bus:(\d+)$/)
	if (!m) return null
	return { casparChannel: parseInt(m[1], 10), channelIndex: parseInt(m[2], 10) }
}

/**
 * @param {number} count
 * @param {'audio-mixer' | 'audio-mixer-view'} prefix
 */
export function renderBusMeterBankHtml(count, prefix) {
	const n = Math.max(1, Math.min(MAX_BUS_METER_CHANNELS, count))
	const cells = []
	for (let i = 0; i < n; i++) {
		const label = i + 1
		cells.push(`<div class="${prefix}__bus-meter-cell" title="Bus channel ${label}">
			<div class="${prefix}__bus-meter-label">${label}</div>
			<div class="${prefix}__meter-vertical ${prefix}__meter-vertical--bus" aria-hidden="true">
				<div class="${prefix}__meter-fill"></div>
			</div>
		</div>`)
	}
	return `<div class="${prefix}__bus-meter-bank" aria-label="Program bus ${n} channels">${cells.join('')}</div>`
}

/**
 * @param {string} masterKey
 * @param {ParentNode} container
 * @param {Map<string, HTMLDivElement>} meterFills
 * @param {number} count
 * @param {'audio-mixer' | 'audio-mixer-view'} prefix
 */
export function registerBusMeterFills(masterKey, container, meterFills, count, prefix) {
	const bank = container.querySelector(`.${prefix}__bus-meter-bank`)
	if (!bank) return
	const cells = bank.querySelectorAll(`.${prefix}__bus-meter-cell`)
	cells.forEach((cell, i) => {
		if (i >= count) return
		const fill = cell.querySelector(`.${prefix}__meter-fill`)
		if (fill) meterFills.set(busMeterFillKey(masterKey, i), fill)
	})
}

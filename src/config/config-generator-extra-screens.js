'use strict'

/**
 * WO-1034 — one PGM destination on several GPU jacks.
 *
 * `screen_N_extra_outputs` (screen-consumer-port-resolve.js, geometry from layout-sync) lists the jacks after the
 * first that the destination's program half is cabled to. Each becomes a further `<screen>` consumer on the PGM
 * channel, placed on that jack's head and carrying that jack's own flags — the case this was built for is a fill
 * window on one jack and a key-only window on the other.
 *
 * `<device>` only sets the consumer index on Linux (600 + device − 1, +10 when key-only; screen_consumer.cpp
 * `index()`): extras take device 61.. → index 660.. (670.. key-only), clear of the PGM / PRV / multiview windows and
 * of the slice windows at 640.. (mapping-slices-windows.js).
 */

const { buildProgramScreenConsumerInnerXml } = require('./config-generator-screen-xml')
const { casparBoolEnabled } = require('./config-generator-utils')

const EXTRA_OUTPUT_DEVICE_BASE = 61
const MAX_EXTRA_OUTPUTS = 8
const STRETCH = ['none', 'fill', 'uniform', 'uniform_to_fill']

const px = (v) => Math.round(Number(v) || 0)

/** The placed extras of screen n, with the `<device>` each one gets. */
function extraOutputsOfScreen(config, n) {
	const list = Array.isArray(config?.[`screen_${n}_extra_outputs`]) ? config[`screen_${n}_extra_outputs`] : []
	return list
		.filter((o) => o && o.placed === true && px(o.width) > 0 && px(o.height) > 0)
		.slice(0, MAX_EXTRA_OUTPUTS)
		.map((o, k) => ({ ...o, device: EXTRA_OUTPUT_DEVICE_BASE + k }))
}

/**
 * @param {Record<string, unknown>} config flat generator config
 * @param {number} n 1-based screen index
 * @returns {string} `<screen>` blocks for the PGM channel's `<consumers>`
 */
function extraOutputScreensXml(config, n) {
	return extraOutputsOfScreen(config, n)
		.map((o) => {
			const flags = o.flags && typeof o.flags === 'object' ? o.flags : {}
			/* the PGM window's writer, reading this jack's flags in place of screen n's */
			const view = { ...config }
			for (const k of Object.keys(view)) if (k.startsWith(`screen_${n}_`)) delete view[k]
			for (const [field, v] of Object.entries(flags)) view[`screen_${n}_${field}`] = v
			const stretch = STRETCH.includes(String(flags.stretch || 'none')) ? String(flags.stretch) : 'none'
			const inner = buildProgramScreenConsumerInnerXml(view, n, {
				nextDevice: o.device,
				posX: px(o.x),
				posY: px(o.y),
				dims: { width: px(o.width), height: px(o.height) },
				stretch,
				windowed: casparBoolEnabled(flags.windowed, true),
				alwaysOnTop: casparBoolEnabled(flags.always_on_top, true),
				borderless: casparBoolEnabled(flags.borderless, true),
			})
			return `
                <screen>
                    ${inner}
                </screen>`
		})
		.join('')
}

module.exports = { EXTRA_OUTPUT_DEVICE_BASE, extraOutputsOfScreen, extraOutputScreensXml }

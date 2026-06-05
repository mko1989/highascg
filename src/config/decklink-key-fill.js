'use strict'

const { escapeXml } = require('./config-generator-builders')

const KEYER_VALUES = new Set(['internal', 'external', 'external_separate_device', 'default'])

/**
 * @param {unknown} raw
 * @returns {number}
 */
function parseDecklinkDeviceIndex(raw) {
	const n = parseInt(String(raw ?? ''), 10)
	return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeDecklinkKeyer(raw) {
	const s = String(raw || 'internal').trim().toLowerCase()
	return KEYER_VALUES.has(s) ? s : 'internal'
}

/**
 * Read fill + optional key device from casparServer slice (`screen_N_*` or `multiview_*`).
 * @param {Record<string, unknown>|null|undefined} cs
 * @param {string} prefix - e.g. `screen_2_` or `multiview_`
 */
function readDecklinkKeyFillSettings(cs, prefix) {
	const fillDevice = parseDecklinkDeviceIndex(cs?.[`${prefix}decklink_device`])
	const keyDevice = parseDecklinkDeviceIndex(cs?.[`${prefix}decklink_key_device`])
	const keyer = normalizeDecklinkKeyer(cs?.[`${prefix}decklink_keyer`])
	const keyFillEnabled = keyDevice > 0 && keyDevice !== fillDevice && fillDevice > 0
	return { fillDevice, keyDevice: keyFillEnabled ? keyDevice : 0, keyer, keyFillEnabled }
}

/**
 * @param {Record<string, unknown>|null|undefined} caspar
 */
function readDecklinkKeyFillFromConnectorCaspar(caspar) {
	if (!caspar || typeof caspar !== 'object') {
		return { keyDevice: 0, keyer: 'internal', enabled: false }
	}
	const keyDevice = parseDecklinkDeviceIndex(caspar.decklinkKeyDevice)
	const keyer = normalizeDecklinkKeyer(caspar.decklinkKeyer)
	const enabled =
		caspar.decklinkKeyFill === true ||
		caspar.decklinkKeyFill === 'true' ||
		(keyDevice > 0 && caspar.decklinkKeyFill !== false && caspar.decklinkKeyFill !== 'false')
	return { keyDevice, keyer, enabled: enabled && keyDevice > 0 }
}

/**
 * Persist key/fill fields on casparServer for a screen or multiview prefix.
 * @param {Record<string, unknown>} cs
 * @param {string} prefix
 * @param {{ keyDevice?: number, keyer?: string, fillDevice?: number }} opts
 */
function writeDecklinkKeyFillToCasparServer(cs, prefix, opts = {}) {
	const fill = parseDecklinkDeviceIndex(opts.fillDevice ?? cs[`${prefix}decklink_device`])
	const key = parseDecklinkDeviceIndex(opts.keyDevice)
	if (fill > 0) cs[`${prefix}decklink_device`] = fill
	if (key > 0 && key !== fill) {
		cs[`${prefix}decklink_key_device`] = key
		cs[`${prefix}decklink_keyer`] = normalizeDecklinkKeyer(opts.keyer)
	} else {
		cs[`${prefix}decklink_key_device`] = 0
		if (opts.keyer != null) cs[`${prefix}decklink_keyer`] = normalizeDecklinkKeyer(opts.keyer)
	}
}

/**
 * CasparCG DeckLink consumers for fill-only or fill+key on separate SDI outputs.
 * @param {{ fillDevice: number, keyDevice?: number, keyer?: string }} opts
 * @returns {string}
 */
function buildDecklinkKeyFillConsumersXml(opts) {
	const fillDevice = parseDecklinkDeviceIndex(opts?.fillDevice)
	if (fillDevice <= 0) return ''
	const keyDevice = parseDecklinkDeviceIndex(opts?.keyDevice)
	if (keyDevice > 0 && keyDevice !== fillDevice) {
		const keyer = normalizeDecklinkKeyer(opts?.keyer)
		return `
             <decklink>
               <device>${fillDevice}</device>
                 <key-device>${keyDevice}</key-device>
             <keyer>${escapeXml(keyer)}</keyer>
	     </decklink>
		<decklink>
               <device>${keyDevice}</device>
             <key-only>true</key-only>
             </decklink>`
	}
	return `\n                <decklink>
                    <device>${fillDevice}</device>
                </decklink>`
}

module.exports = {
	parseDecklinkDeviceIndex,
	normalizeDecklinkKeyer,
	readDecklinkKeyFillSettings,
	readDecklinkKeyFillFromConnectorCaspar,
	writeDecklinkKeyFillToCasparServer,
	buildDecklinkKeyFillConsumersXml,
	KEYER_VALUES,
}

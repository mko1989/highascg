'use strict'

function param(str) {
	if (str == null || str === '') return ''
	const s = String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
	return /\s/.test(s) ? `"${s}"` : s
}

/**
 * Clip name for raw PLAY/LOAD lines. Always double-quote non-route media so Caspar never
 * tokenizes on spaces/odd characters (Caspar logs may still show dequoted text).
 * @param {string} str
 */
function clipParamForPlay(str) {
	if (str == null || str === '') return ''
	const s = String(str)
	if (s.startsWith('route://')) return param(s)
	const esc = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
	return `"${esc}"`
}

function chLayer(channel, layer) {
	const c = parseInt(channel, 10)
	if (layer === undefined || layer === null || layer === '') return String(c)
	return `${c}-${parseInt(layer, 10)}`
}

module.exports = { param, clipParamForPlay, chLayer }

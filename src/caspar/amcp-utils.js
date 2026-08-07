'use strict'

/**
 * When true, log every successful AMCP send/recv at debug (default suppresses MIXER/CG/PLAY… noise).
 * Env: HIGHASCG_AMCP_TRACE=1
 */
function amcpVerboseTrace() {
	return process.env.HIGHASCG_AMCP_TRACE === '1' || String(process.env.HIGHASCG_AMCP_TRACE || '').toLowerCase() === 'true'
}

// AMCP is line-delimited: an embedded CR/LF ends the command and starts a NEW one
// (quoting does not help), so `veryfast\r\nKILL` would kill the server. Every
// escaper below folds CR/LF to a space (review 2026-08-03 src-api §2 / engine §1).
function stripAmcpLineBreaks(s) {
	return s.replace(/[\r\n]+/g, ' ')
}

function param(str) {
	if (str == null || str === '') return ''
	const s = stripAmcpLineBreaks(String(str)).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
	return /\s/.test(s) ? `"${s}"` : s
}

/** FFmpeg audio filter for PLAY/LOAD AF — always quoted (pan=… contains `=` / `|`). */
function audioFilterParam(str) {
	if (str == null || str === '') return ''
	const s = stripAmcpLineBreaks(String(str)).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
	return `"${s}"`
}

/**
 * Clip name for raw PLAY/LOAD lines. Always double-quote non-route media so Caspar never
 * tokenizes on spaces/odd characters (Caspar logs may still show dequoted text).
 * @param {string} str
 */
function clipParamForPlay(str) {
	if (str == null || str === '') return ''
	const s = stripAmcpLineBreaks(String(str))
	if (s.startsWith('route://')) return param(s)
	const esc = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
	return `"${esc}"`
}

function chLayer(channel, layer) {
	const c = parseInt(channel, 10)
	if (layer === undefined || layer === null || layer === '') return String(c)
	return `${c}-${parseInt(layer, 10)}`
}

/**
 * Append `DEFER` so mixer transforms queue until `MIXER <channel> COMMIT` (atomic multi-layer looks).
 * Idempotent if the line already ends with DEFER.
 * @param {string} line
 * @returns {string}
 */
function deferMixerAmcpLine(line) {
	const s = String(line).trim()
	if (!/^MIXER\s+\d+-\d+\s+/i.test(s)) return s
	if (/\bDEFER\b/i.test(s)) return s
	return `${s} DEFER`
}

module.exports = {
	param,
	audioFilterParam,
	clipParamForPlay,
	chLayer,
	amcpVerboseTrace,
	deferMixerAmcpLine,
}

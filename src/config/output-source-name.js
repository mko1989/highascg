'use strict'

/**
 * WO-378 — the ONE vocabulary for "what feeds this output".
 *
 * Owner, todos28.07.26:
 *
 *   "host channels must be able to feed any and all outputs."
 *   "the vocabulary is wrong by calling casparcg channels programs. program should be only used as
 *    a label/id of a pgm screen. the rest should be dealt in channels terminology"
 *
 * So the vocabulary is split by MEANING, not by consumer:
 *
 *   `channel_<N>`  — a Caspar channel, named directly. The canonical form for anything that is
 *                    just a channel: host channels (decklink/live-audio input buses), dedicated
 *                    encode buses, anything future. Resolves to N and asks no questions.
 *   `program_<N>`  — the PGM bus **of screen N**. A screen label, which is the only thing
 *                    "program" is allowed to mean. Resolved through the channel map, because which
 *                    Caspar channel carries screen N's PGM is a mapping decision.
 *   `preview_<N>`  — the PRV bus of screen N, same reasoning.
 *   `multiview`    — the multiview bus.
 *
 * Before this module the three resolvers (`resolveInputTargetToChannel`,
 * `resolveRecordSourceChannel`, `resolveStreamOutputCasparChannel`) each carried their own copy of
 * the program/preview regexes, none of them understood `channel_<N>`, and two silently fell back
 * to `programCh(1)`. A host channel therefore could not feed a stream or a record at all: the
 * client already had a `channel_${ch}` token for it (`hostChannelVideoSourceToken`, itself never
 * wired to anything) and the server would have resolved it to channel 1.
 */

const CHANNEL_RE = /^channel[_-]?(\d+)$/
const PROGRAM_RE = /^program[_-]?(\d+)$/
const PREVIEW_RE = /^preview[_-]?(\d+)$/

/** @param {number|string} n @returns {string} canonical name for a bare Caspar channel */
function channelSourceName(n) {
	const v = Math.max(1, parseInt(String(n), 10) || 0)
	return `channel_${v}`
}

/**
 * @param {unknown} raw
 * @returns {{ kind: 'channel'|'program'|'preview'|'multiview'|'unknown', index?: number, channel?: number }}
 */
function parseOutputSourceName(raw) {
	const s = String(raw ?? '')
		.trim()
		.toLowerCase()
	if (!s) return { kind: 'unknown' }
	if (s === 'multiview') return { kind: 'multiview' }

	const ch = CHANNEL_RE.exec(s)
	if (ch) {
		const n = parseInt(ch[1], 10)
		return n >= 1 ? { kind: 'channel', channel: n } : { kind: 'unknown' }
	}
	const pm = PROGRAM_RE.exec(s)
	if (pm) {
		const n = parseInt(pm[1], 10)
		return n >= 1 ? { kind: 'program', index: n } : { kind: 'unknown' }
	}
	const pr = PREVIEW_RE.exec(s)
	if (pr) {
		const n = parseInt(pr[1], 10)
		return n >= 1 ? { kind: 'preview', index: n } : { kind: 'unknown' }
	}
	return { kind: 'unknown' }
}

/**
 * Resolve a source name to a Caspar channel number.
 *
 * @param {{ screenCount: number, programCh: (n: number) => number|null,
 *           previewCh: (n: number) => number|null, multiviewCh: number|null }} map
 *        a `getChannelMap()` result — the caller supplies it so this module stays free of config
 *        plumbing and the switcher-aware record path can pass its own.
 * @param {unknown} raw
 * @returns {number|null} null when the name is unknown or the mapping has no such bus — callers
 *          decide their own fallback, they do not all agree on one.
 */
function resolveOutputSourceToChannel(map, raw) {
	if (!map) return null
	const parsed = parseOutputSourceName(raw)
	switch (parsed.kind) {
		case 'channel':
			// A channel names itself. No screenCount bound: host/encode channels live outside it.
			return parsed.channel
		case 'multiview':
			return map.multiviewCh != null ? map.multiviewCh : null
		case 'program': {
			if (parsed.index > map.screenCount) return null
			const ch = map.programCh(parsed.index)
			return ch != null ? ch : null
		}
		case 'preview': {
			if (parsed.index > map.screenCount) return null
			const ch = map.previewCh(parsed.index)
			return ch != null ? ch : null
		}
		default:
			return null
	}
}

module.exports = {
	channelSourceName,
	parseOutputSourceName,
	resolveOutputSourceToChannel,
}

'use strict'

const { clipParamForPlay } = require('./amcp-utils')
const { resolveClipForAmcpLoad, isPassthroughAmcpClip } = require('../media/caspar-cls-id')

const CLIP_VERB_RE = /^(PLAY|LOADBG|LOAD)\s+(\d+(?:-\d+)?)\s+(.+)$/i

/**
 * Extract first clip/path token from the tail of a PLAY/LOADBG/LOAD line.
 * @param {string} rest
 * @returns {{ clip: string, suffix: string } | null}
 */
function parseClipTokenAndSuffix(rest) {
	const raw = String(rest || '').trim()
	if (!raw) return null

	if (/^\[HTML\]/i.test(raw)) {
		const m = raw.match(/^(\[HTML\]\s+(?:"(?:\\.|[^"\\])*"|[^\s]+))(?:\s+(.*))?$/i)
		if (!m) return { clip: raw, suffix: '' }
		return { clip: m[1].trim(), suffix: (m[2] || '').trim() }
	}

	if (raw.startsWith('"')) {
		let end = 1
		while (end < raw.length) {
			if (raw[end] === '\\') {
				end += 2
				continue
			}
			if (raw[end] === '"') break
			end++
		}
		if (end >= raw.length) return null
		const clip = raw
			.slice(1, end)
			.replace(/\\"/g, '"')
			.replace(/\\\\/g, '\\')
		return { clip, suffix: raw.slice(end + 1).trim() }
	}

	const m = raw.match(/^(\S+)(?:\s+(.*))?$/)
	if (!m) return null
	return { clip: m[1], suffix: (m[2] || '').trim() }
}

/**
 * Resolve project-scoped / CLS media ids in raw PLAY/LOADBG/LOAD AMCP lines.
 * Client preview pushes send scene layer basenames; scene-take resolves on server — mirror that here.
 * @param {string} line
 * @param {object} [ctx]
 * @returns {string}
 */
function normalizeClipPlayAmcpLine(line, ctx) {
	const raw = String(line || '').trim()
	if (!CLIP_VERB_RE.test(raw)) return raw

	const m = raw.match(CLIP_VERB_RE)
	if (!m) return raw
	const verb = m[1].toUpperCase()
	const chLayer = m[2]
	const parsed = parseClipTokenAndSuffix(m[3])
	if (!parsed) return raw

	let clip = parsed.clip
	if (clip.startsWith('[HTML]')) return raw
	if (isPassthroughAmcpClip(clip)) return raw
	if (/^DECKLINK\b/i.test(clip)) return raw

	const clipCtx = {
		CHOICES_MEDIAFILES: ctx?.CHOICES_MEDIAFILES,
		config: ctx?.config,
		persistence: ctx?.persistence,
	}
	const resolved = resolveClipForAmcpLoad(clip, clipCtx)
	if (!resolved || resolved === clip) return raw

	const clipParam = clipParamForPlay(resolved)
	return `${verb} ${chLayer} ${clipParam}${parsed.suffix ? ` ${parsed.suffix}` : ''}`
}

/**
 * @param {string[]} lines
 * @param {object} [ctx]
 * @returns {string[]}
 */
function normalizeClipPlayAmcpLines(lines, ctx) {
	if (!Array.isArray(lines) || lines.length === 0) return lines
	return lines.map((line) => normalizeClipPlayAmcpLine(line, ctx))
}

module.exports = {
	parseClipTokenAndSuffix,
	normalizeClipPlayAmcpLine,
	normalizeClipPlayAmcpLines,
}

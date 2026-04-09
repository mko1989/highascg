'use strict'

const { spawnSync } = require('child_process')

/**
 * Ensure system `ffmpeg` can use the NDI demuxer (libndi_newtek_input).
 * Uses `ffmpeg -formats` — do **not** use `-list_sources` / `-find_sources` here; option names vary by build.
 * @returns {{ ok: boolean, error?: string }}
 */
function validateFfmpegNdiInput() {
	let r
	try {
		r = spawnSync('ffmpeg', ['-hide_banner', '-formats'], {
			encoding: 'utf8',
			timeout: 12000,
			maxBuffer: 12 * 1024 * 1024,
		})
	} catch (e) {
		return { ok: false, error: `ffmpeg spawn failed: ${e.message || e}` }
	}
	if (r.error && r.error.code === 'ENOENT') {
		return { ok: false, error: 'ffmpeg not found in PATH' }
	}
	const combined = `${r.stderr || ''}\n${r.stdout || ''}`
	if (!/libndi_newtek_input/i.test(combined)) {
		return {
			ok: false,
			error:
				'ffmpeg has no libndi_newtek_input demuxer (see ffmpeg -formats). Install NDI-enabled FFmpeg or use captureMode "udp".',
		}
	}
	return { ok: true }
}

/**
 * Probe argument lists for listing NDI sources — FFmpeg builds differ (`find_sources` vs `list_sources`, `libndi_newtek` vs `libndi_newtek_input`).
 * @returns {{ out: string, args: string[] } | null}
 */
function runNdiListProbe() {
	const candidates = [
		['-hide_banner', '-f', 'libndi_newtek_input', '-find_sources', '1', '-i', 'dummy'],
		['-hide_banner', '-f', 'libndi_newtek_input', '-list_sources', '1', '-i', 'dummy'],
		['-hide_banner', '-f', 'libndi_newtek', '-find_sources', '1', '-i', 'dummy'],
	]
	let lastOut = ''
	for (const args of candidates) {
		const r = spawnSync('ffmpeg', args, {
			encoding: 'utf8',
			timeout: 12000,
			maxBuffer: 10 * 1024 * 1024,
		})
		const out = `${r.stderr || ''}\n${r.stdout || ''}`
		lastOut = out
		if (/Unrecognized option|Option not found/i.test(out)) {
			continue
		}
		if (/Unknown input format/i.test(out) && /libndi/i.test(out)) {
			continue
		}
		return { out, args }
	}
	return { out: lastOut, args: [] }
}

/**
 * List NDI sources using FFmpeg (requires libndi-enabled ffmpeg).
 * @returns {{ ok: boolean, sources: string[], raw?: string, error?: string }}
 */
function listNdiSources() {
	try {
		const probe = runNdiListProbe()
		if (!probe) {
			return { ok: false, sources: [], error: 'NDI list probe failed' }
		}
		const out = probe.out
		const sources = parseNdiListOutput(out)
		return {
			ok: sources.length > 0 || /ndi/i.test(out),
			sources,
			raw: out.slice(0, 8000),
		}
	} catch (e) {
		return { ok: false, sources: [], error: e.message || String(e) }
	}
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function parseNdiListOutput(text) {
	const found = new Set()
	const lines = text.split(/\r?\n/)
	const reIndexed = /^\s*(\d+)\s*:\s*(.+)$/
	const noise = /^(dummy|list_sources|find_sources|Input|indev)$/i

	for (const line of lines) {
		let m = line.match(reIndexed)
		if (m) {
			const rest = m[2].trim()
			if (rest && !rest.startsWith('[') && !noise.test(rest)) found.add(rest.replace(/\s+$/g, ''))
		}
		m = line.match(/["']([^"']+)["']/)
		if (m && m[1].length > 2 && !noise.test(m[1])) found.add(m[1])

		let pm
		const reParenLine = /\(([^)]+)\)/g
		while ((pm = reParenLine.exec(line)) !== null) {
			const inner = pm[1].trim()
			if (inner.length > 2 && !inner.includes('libndi') && !noise.test(inner)) found.add(inner)
		}

		if (/CasparCG Channel/i.test(line)) {
			const cm = line.match(/CasparCG Channel\s*\d+/i)
			if (cm) found.add(cm[0].replace(/\s+/g, ' ').trim())
		}
	}

	return [...found]
}

/**
 * Pick the best matching source name for a Caspar channel from a discovered list.
 * @param {string[]} sources
 * @param {number} channelNum
 * @returns {string|null}
 */
function matchCasparChannelFromSources(sources, channelNum) {
	const n = String(channelNum)
	const exact = `CasparCG Channel ${n}`
	for (const s of sources) {
		if (s === exact || s.endsWith(`(${exact})`) || s.includes(`(${exact})`)) return s.includes('(') ? extractDisplayName(s) || s : s
	}
	const re = new RegExp(`CasparCG\\s+Channel\\s*${n}\\b`, 'i')
	for (const s of sources) {
		if (re.test(s)) return extractDisplayName(s) || s
	}
	return null
}

/**
 * "HOST (CasparCG Channel 1)" → "CasparCG Channel 1" when the parenthetical is the NDI name.
 * @param {string} s
 * @returns {string|null}
 */
function extractDisplayName(s) {
	const m = s.match(/\(([^)]+)\)\s*$/)
	if (m && /CasparCG Channel/i.test(m[1])) return m[1].trim()
	return null
}

/**
 * @param {object} config — streaming config
 * @param {number} channelNum
 * @returns {string}
 */
function resolveNdiSourceName(config, channelNum) {
	const ch = String(channelNum)
	const mode = config.ndiNamingMode || 'auto'

	if (mode === 'custom') {
		const map = config.ndiChannelNames || {}
		const name = map[ch] ?? map[channelNum]
		if (name && String(name).trim()) return String(name).trim()
		return (config.ndiSourcePattern || 'CasparCG Channel {ch}').replace('{ch}', ch)
	}

	if (mode === 'pattern') {
		return (config.ndiSourcePattern || 'CasparCG Channel {ch}').replace('{ch}', ch)
	}

	// auto: prefer per-channel cache from discovery
	const resolved = config._ndiResolvedNames && config._ndiResolvedNames[ch]
	if (resolved) return resolved

	const match = config._ndiDiscoveredSources && matchCasparChannelFromSources(config._ndiDiscoveredSources, channelNum)
	if (match) return match

	return (config.ndiSourcePattern || 'CasparCG Channel {ch}').replace('{ch}', ch)
}

/**
 * Populate `_ndiDiscoveredSources` and `_ndiResolvedNames` on `config` for NDI tier.
 * @param {object} config — streaming config (mutated)
 * @param {Array<{channel: number}>} targets
 */
function prepareNdiStreaming(config, targets) {
	delete config._ndiDiscoveredSources
	delete config._ndiResolvedNames

	const mode = config.ndiNamingMode || 'auto'
	if (mode === 'pattern' || mode === 'custom') return

	// auto: try FFmpeg discovery
	const { sources, ok } = listNdiSources()
	if (ok && sources.length) {
		config._ndiDiscoveredSources = sources
		config._ndiResolvedNames = {}
		for (const t of targets) {
			const m = matchCasparChannelFromSources(sources, t.channel)
			if (m) config._ndiResolvedNames[String(t.channel)] = m
		}
		if (Object.keys(config._ndiResolvedNames).length) {
			console.log('[NDI] Auto-matched sources:', JSON.stringify(config._ndiResolvedNames))
		} else {
			console.log('[NDI] No CasparCG Channel N in discovered list; using default name pattern.')
		}
	} else {
		console.log('[NDI] Source listing unavailable or empty; using default name pattern.')
	}
}

module.exports = {
	listNdiSources,
	parseNdiListOutput,
	matchCasparChannelFromSources,
	resolveNdiSourceName,
	prepareNdiStreaming,
	validateFfmpegNdiInput,
	runNdiListProbe,
}

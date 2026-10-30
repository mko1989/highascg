'use strict'

/**
 * WO-846: shared parsing for work orders (work/work-orders/NNN_WO_<slug>.md and work/work-orders/deprecated/).
 *
 * Header contract (first ~40 lines): a `# ` title, an `**Area:** a, b` line and a status line that starts with one
 * of STATUSES, as `**Status: DONE (…)**` or `**Status:** DONE (…)`. Anything after the canonical word is free text.
 */

const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')
const WO_DIR = path.join(REPO_ROOT, 'work/work-orders')
const DEPRECATED_DIR = path.join(WO_DIR, 'deprecated')
const WO_FILE_RE = /^(\d+[a-z]?)_WO_.+\.md$/
const STATUSES = ['OPEN', 'IN PROGRESS', 'DONE', 'DEPRECATED']
const AREAS = {
	engine: 'Looks, takes, timeline, playback',
	amcp: 'AMCP client and protocol',
	'caspar-build': 'CasparCG server build and binaries',
	audio: 'Audio routing, devices, meters',
	'video-io': 'DeckLink, NDI, v4l2, virtual camera, recording',
	mapping: 'Pixel map, screens, multiview, destinations',
	lighting: 'DMX, Art-Net, sACN, fixtures, consoles',
	'godot-client': 'Godot client',
	'web-client': 'Web client',
	companion: 'Companion integration',
	'devices-config': 'Devices tab, settings, config generation',
	'os-iso': 'ISO, sticks, kernel, NVIDIA, boot',
	network: 'Cluster, replication, Tailscale, auth',
	media: 'Media library, thumbnails, ingest, transcode',
	'tracking-vr': 'Tracking, previs, VR',
	'testing-ci': 'Tests and CI',
	process: 'Docs, wiki, audits, work-order tooling',
}
const HEADER_LINES = 40
const STATUS_LINE_RE = /^(\s*>?\s*)\*\*Status(?::\*\*|:|\*\*:)\s*/i
const AREA_LINE_RE = /^\*\*Area:\*\*\s*(.*)$/

/** @param {string} line */
function canonicalStatusOf(rest) {
	const t = rest
		.replace(/^\*\*\s*/, '')
		.trim()
		.toUpperCase()
	for (const s of STATUSES) if (t.startsWith(s) && !/^[A-Z]/.test(t.slice(s.length, s.length + 1))) return s
	return null
}

/**
 * @param {string} text
 * @returns {{ title: string, status: string|null, statusText: string, statusLine: number, area: string[], areaLine: number }}
 */
function parseHeader(text) {
	const lines = text.split('\n').slice(0, HEADER_LINES)
	let title = ''
	let statusLine = -1
	let areaLine = -1
	let status = null
	let statusText = ''
	let area = []
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i]
		if (!title && /^# /.test(l)) title = l.slice(2).trim()
		if (statusLine === -1) {
			const m = l.match(STATUS_LINE_RE)
			if (m) {
				statusLine = i
				const rest = l.slice(m[0].length)
				status = canonicalStatusOf(rest)
				statusText = rest.replace(/\*\*$/, '').trim()
			}
		}
		if (areaLine === -1) {
			const m = l.match(AREA_LINE_RE)
			if (m) {
				areaLine = i
				area = m[1]
					.split(',')
					.map((a) => a.trim())
					.filter(Boolean)
			}
		}
	}
	return { title, status, statusText, statusLine, area, areaLine }
}

/** Title without the "WO-NNN —" / "Work Order NNN:" prefix. */
function shortTitle(title, wo) {
	return String(title || '')
		.replace(new RegExp(`^(WO-?\\s*${wo}[a-z]?|Work Order\\s+${wo}[a-z]?)\\s*[—:–-]*\\s*`, 'i'), '')
		.replace(/[`*]/g, '')
		.trim()
}

/** Every work order file: `{ file, rel, wo, deprecated }`, sorted by number then name. */
function listWorkOrders(woDir = WO_DIR) {
	const out = []
	for (const [dir, deprecated] of [
		[woDir, false],
		[path.join(woDir, 'deprecated'), true],
	]) {
		if (!fs.existsSync(dir)) continue
		for (const name of fs.readdirSync(dir)) {
			const m = name.match(WO_FILE_RE)
			if (!m) continue
			out.push({ file: name, rel: deprecated ? `deprecated/${name}` : name, wo: m[1], deprecated })
		}
	}
	const num = (w) => parseInt(w, 10)
	return out.sort((a, b) => num(a.wo) - num(b.wo) || a.wo.localeCompare(b.wo) || a.file.localeCompare(b.file))
}

/** Parsed record per work order, the data behind INDEX.md / index.json. */
function readWorkOrders(woDir = WO_DIR) {
	return listWorkOrders(woDir).map((e) => {
		const h = parseHeader(fs.readFileSync(path.join(woDir, e.rel), 'utf8'))
		return {
			wo: e.wo,
			file: e.rel,
			title: shortTitle(h.title, e.wo) || e.file,
			status: h.status,
			statusText: h.statusText,
			area: h.area,
		}
	})
}

module.exports = {
	REPO_ROOT,
	WO_DIR,
	DEPRECATED_DIR,
	WO_FILE_RE,
	STATUSES,
	AREAS,
	STATUS_LINE_RE,
	AREA_LINE_RE,
	canonicalStatusOf,
	parseHeader,
	shortTitle,
	listWorkOrders,
	readWorkOrders,
}

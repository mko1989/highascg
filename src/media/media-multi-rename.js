'use strict'

/**
 * WO-603 slice 3 — the WO-592 D multi-rename planner, server side (owner D directive: the client asks, node composes).
 * A verbatim CommonJS port of client/lib/media-multi-rename.js (the web modal keeps its copy until the WO-609 cutover;
 * smoke-wo603-multi-rename-plan.test.js pins both to the same output). The conflict check runs against the server's
 * own media catalogue instead of a client's list.
 *
 * A name (extension stripped) splits into: lead number + separator, title, separator + trail number.
 *   "01_Grzegorz Zytka" → lead "01" sep "_"  · title "Grzegorz Zytka"
 *   "Summer Rally 02"   → title "Summer Rally" · sep " " trail "02"
 * The numbering is the lead number when there is one, else the trail number.
 */

const NAME_RE = /^(?:(\d+)([\s._-]*))?(.*?)(?:([\s._-]*)(\d+))?$/

/**
 * @param {string} baseName - file name without folder
 * @returns {{ ext: string, lead: string, leadSep: string, title: string, trailSep: string, trail: string }}
 */
function parseNumberedName(baseName) {
	const s = String(baseName || '')
	const dot = s.lastIndexOf('.')
	const ext = dot > 0 ? s.slice(dot) : ''
	const stem = dot > 0 ? s.slice(0, dot) : s
	const m = NAME_RE.exec(stem) || []
	let [, lead = '', leadSep = '', title = '', trailSep = '', trail = ''] = m
	// A bare number ("07") parses as lead with an empty title — keep it as the numbering.
	if (!title && trail && !lead) {
		lead = trail
		trail = ''
		trailSep = ''
	}
	// With a lead number, or no separator before it, a trailing digit run is part of the title
	// ("03_LOOP_2x3" → title "LOOP_2x3", never "LOOP_2x" + 3).
	if (trail && (lead || !trailSep)) {
		title += trailSep + trail
		trail = ''
		trailSep = ''
	}
	return { ext, lead, leadSep, title, trailSep, trail }
}

function pad(n, width) {
	return String(n).padStart(Math.max(0, width), '0')
}

/**
 * @param {string[]} ids - selected media ids (folder/name.ext), in list order
 * @param {{ title?: string, renumber?: { start: number, step: number, pad: number } | null }} opts
 *   title: '' keeps each file's own title
 * @param {Iterable<string>} [existingIds] - every media id (conflict check against non-selected files)
 * @returns {Array<{ from: string, to: string, error?: string }>}
 */
function buildMultiRenamePlan(ids, opts = {}, existingIds = []) {
	const newTitle = String(opts.title ?? '').trim()
	const rn = opts.renumber
	const plan = ids.map((from, i) => {
		const slash = from.lastIndexOf('/')
		const folder = slash >= 0 ? from.slice(0, slash + 1) : ''
		const p = parseNumberedName(from.slice(slash + 1))
		const title = newTitle || p.title
		let lead = p.lead
		let trail = p.trail
		if (rn) {
			const n = pad(Number(rn.start || 0) + i * Number(rn.step || 1), Number(rn.pad) || 0)
			if (lead || !trail) lead = n
			else trail = n
		}
		const leadSep = lead ? p.leadSep || (title ? ' ' : '') : ''
		const trailSep = trail ? p.trailSep || (title ? ' ' : '') : ''
		const to = `${folder}${lead}${leadSep}${title}${trailSep}${trail}${p.ext}`
		return { from, to }
	})
	const selected = new Set(ids.map((x) => x.toLowerCase()))
	const others = new Set([...existingIds].map((x) => String(x).toLowerCase()).filter((x) => !selected.has(x)))
	const seen = new Map()
	for (const row of plan) {
		const k = row.to.toLowerCase()
		seen.set(k, (seen.get(k) || 0) + 1)
	}
	for (const row of plan) {
		const k = row.to.toLowerCase()
		if (!row.to.slice(row.to.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '').trim()) row.error = 'empty name'
		else if (seen.get(k) > 1) row.error = 'duplicate name'
		else if (others.has(k)) row.error = 'a file with this name exists'
	}
	return plan
}

module.exports = { parseNumberedName, buildMultiRenamePlan }

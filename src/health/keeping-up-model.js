'use strict'

/**
 * WO-1088 — the "keeping up" model, pure: raw check results in (one array per ~1 s sample, from
 * keeping-up-checks.js), a debounced status per check, the worst offender and an incident history out.
 *
 * A raw result: { key, group, name, level (0 ok · 1 behind · 2 failing), target, measured, unit, text, label, hint,
 *                 severity (bigger = worse, compares samples of the SAME check), rise?, fall? }.
 * Hysteresis: a check rises only after `rise` consecutive samples above its status (to the lowest level the run held),
 * falls only after `fall` consecutive samples below it (to the highest level the run held) — so one noisy second never
 * flips the indicator, and a recovering check does not flap. A check missing from a sample is not applicable any more
 * (output stopped, Caspar down, feature off): it is dropped, and an open incident ends ("gone").
 */

const OK = 0
const BEHIND = 1
const FAILING = 2
const STATUS = ['ok', 'behind', 'failing']
const RISE = 2
const FALL = 5
/** Group order when two offenders share a level: what the audience sees first, the box last. */
const GROUP_RANK = { caspar: 0, output: 1, source: 2, client: 3, server: 4, box: 5 }

class KeepingUpModel {
	/** @param {{ now?: () => number, maxIncidents?: number }} [opts] */
	constructor(opts = {}) {
		this._now = opts.now || Date.now
		this._max = opts.maxIncidents || 20
		/** @type {Map<string, { status: number, upRun: number, upMin: number, downRun: number, downMax: number, since: number, last: object, incident: object | null }>} */
		this._checks = new Map()
		/** @type {object[]} newest first */
		this.incidents = []
		this._seq = 0
	}

	/**
	 * One sample. → { changed, events: [{ type: 'start' | 'end', incident }] } — `changed`: some status, the worst
	 * offender or the incident list moved (the WS broadcast trigger); measured values alone never set it.
	 */
	update(results) {
		const now = this._now()
		const events = []
		let changed = false
		const seen = new Set()
		for (const r of results) {
			if (!r || !r.key || seen.has(r.key)) continue
			seen.add(r.key)
			let c = this._checks.get(r.key)
			if (!c) {
				c = { status: OK, upRun: 0, upMin: FAILING, downRun: 0, downMax: OK, since: now, last: r, incident: null }
				this._checks.set(r.key, c) // a new check starts ok: nothing an operator sees moved yet
			}
			c.last = r
			const before = c.status
			step(c, clampLevel(r.level), r.rise ?? RISE, r.fall ?? FALL)
			if (c.status !== before) {
				c.since = now
				changed = true
			}
			if (c.status > OK && !c.incident) {
				c.incident = { id: ++this._seq, key: r.key, name: r.name, group: r.group, label: r.label, level: c.status,
					status: STATUS[c.status], worst: r.text, worstSeverity: r.severity ?? 0, startedAt: now, endedAt: null, durationS: null }
				this.incidents.unshift(c.incident)
				if (this.incidents.length > this._max) this.incidents.length = this._max
				events.push({ type: 'start', incident: c.incident })
			} else if (c.incident) {
				const inc = c.incident
				if (c.status > inc.level) {
					inc.level = c.status
					inc.status = STATUS[c.status]
					changed = true
				}
				if (r.level > OK && (r.severity ?? 0) > inc.worstSeverity) {
					inc.worstSeverity = r.severity ?? 0
					inc.worst = r.text
					if (r.label) inc.label = r.label
				}
				if (c.status === OK) {
					events.push({ type: 'end', incident: closeIncident(inc, now, 'recovered') })
					c.incident = null
				}
			}
		}
		for (const [key, c] of this._checks) {
			if (seen.has(key)) continue
			if (c.incident) events.push({ type: 'end', incident: closeIncident(c.incident, now, 'gone') })
			if (c.status > OK) changed = true
			this._checks.delete(key)
		}
		if (events.length) changed = true
		return { changed, events }
	}

	/** Checks with their debounced status, offenders first (level, group, then how far off). */
	checks() {
		const out = []
		for (const [key, c] of this._checks) {
			const r = c.last
			out.push({ key, group: r.group, name: r.name, status: STATUS[c.status], level: c.status, target: r.target ?? null,
				measured: r.measured ?? null, unit: r.unit || '', text: r.text || '', label: c.status > OK ? r.label || r.name : '',
				hint: r.hint || '', since: c.since, raw: clampLevel(r.level), severity: r.severity ?? 0 })
		}
		return out.sort(compareChecks)
	}

	/** { level, status, label, checks, incidents, updatedAt } — label: the worst offender in plain words, '' when ok. */
	summary() {
		const checks = this.checks()
		const worst = checks[0] && checks[0].level > OK ? checks[0] : null
		return { level: worst ? worst.level : OK, status: STATUS[worst ? worst.level : OK], label: worst ? worst.label : '',
			worstKey: worst ? worst.key : null, checks, incidents: this.incidents.map((i) => ({ ...i })), updatedAt: this._now() }
	}
}

function clampLevel(l) {
	const n = Number(l)
	return n >= FAILING ? FAILING : n >= BEHIND ? BEHIND : OK
}

/** The hysteresis step on one check's state (mutates `c`). */
function step(c, raw, rise, fall) {
	if (raw > c.status) {
		c.downRun = 0
		c.upRun++
		c.upMin = Math.min(c.upRun === 1 ? FAILING : c.upMin, raw)
		if (c.upRun >= Math.max(1, rise)) {
			c.status = c.upMin
			c.upRun = 0
		}
	} else if (raw < c.status) {
		c.upRun = 0
		c.downRun++
		c.downMax = Math.max(c.downRun === 1 ? OK : c.downMax, raw)
		if (c.downRun >= Math.max(1, fall)) {
			c.status = c.downMax
			c.downRun = 0
		}
	} else {
		c.upRun = 0
		c.downRun = 0
	}
}

function closeIncident(inc, now, how) {
	inc.endedAt = now
	inc.durationS = Math.max(0, Math.round((now - inc.startedAt) / 1000))
	inc.ended = how
	return inc
}

function compareChecks(a, b) {
	return b.level - a.level || (GROUP_RANK[a.group] ?? 9) - (GROUP_RANK[b.group] ?? 9) || b.raw - a.raw || b.severity - a.severity ||
		String(a.key).localeCompare(String(b.key))
}

/** One journal line per incident start / end: `[keeping-up] …`. */
function journalLine(ev) {
	const i = ev.incident
	if (ev.type === 'start') return `[keeping-up] ${i.status}: ${i.label} (${i.worst})`
	const how = i.ended === 'gone' ? 'ended (check gone)' : 'recovered'
	return `[keeping-up] ${how} after ${i.durationS} s: ${i.label} — worst ${i.status}, ${i.worst}`
}

module.exports = { KeepingUpModel, journalLine, step, OK, BEHIND, FAILING, STATUS }

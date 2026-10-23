'use strict'

/**
 * WO-712 R4 — react: "when look X goes on air → do Y", the zone actions the other way round. The rules sit next to the
 * zones (`project.previs.tracking.zones.on_air`, Zones section) and run where the `zones` duty is ticked
 * (zone-service.js), on this server's own takes and on the air state a linked playout server sends (R3b, `air` topic in
 * cluster-exchange.js).
 *
 *   on_air: [{ id, when, do, enabled }]
 *     when  a look id or a look name (case-insensitive): until the shared project (R5) the other server's ids are not
 *           this server's, so a name matches across both projects
 *     do    one zone action (zone-actions.js parseAction): look:… | companion:… | auto:home | fixtures:<look id>
 *
 * A rule fires when a matching look newly appears on program on any source (a look that stays on air fires once).
 * A source's first update only records what is on air (a restart, or a server linking with a look already up, fires
 * nothing); zone-service.js seeds `self` from the live state when it starts, so this server's first take fires.
 * Loop guard: an air change that a rule's own `look:` take caused (that look, within GUARD_MS) fires no rules, so two
 * rules that take each other's looks do not ping-pong.
 */

const GUARD_MS = 3000
const MAX_RULES = 64
const MAX_RECENT = 10

/** → [{ id, when, do, enabled }] (blank `when` or `do` rows are kept: the operator is still typing). */
function normalizeAirRules(raw) {
	const out = []
	const used = new Set()
	for (const r of Array.isArray(raw) ? raw.slice(0, MAX_RULES) : []) {
		if (!r || typeof r !== 'object') continue
		let id = String(r.id || '').trim()
		for (let n = out.length + 1; !id || used.has(id); n++) id = `air${n}`
		used.add(id)
		out.push({ id, when: String(r.when ?? '').trim(), do: String(r.do ?? '').trim(), enabled: r.enabled !== false })
	}
	return out
}

const same = (a, b) => a.toLowerCase() === b.toLowerCase()
const matches = (when, look) => !!when && (when === String(look.sceneId || '') || same(when, String(look.name || '')))

/**
 * @param {{ parse: Function, run: (action: object) => Promise<{ok: boolean, detail: string}>, allowed: () => boolean,
 *   now?: () => number, log?: Function }} deps
 */
function createAirRules(deps) {
	const now = deps.now || Date.now
	let rules = []
	let parsed = new Map()
	const onAir = new Map() // source key → Set of `${sceneId}` on program
	const known = new Set() // sources whose first update has been recorded
	const guard = new Map() // sceneId a rule took → until
	const recent = []

	function configure(raw) {
		rules = normalizeAirRules(raw)
		parsed = new Map(rules.map((r) => [r.id, deps.parse(r.do)]))
		return rules
	}

	/**
	 * A source's program looks now (`[{ sceneId, name }]`; [] = nothing on air / the source is gone).
	 * → the rules it fired (their run promises are not awaited by the caller).
	 */
	function update(source, looks) {
		const list = Array.isArray(looks) ? looks.filter((l) => l && l.sceneId) : []
		const before = onAir.get(source) || new Set()
		const ids = new Set(list.map((l) => String(l.sceneId)))
		if (ids.size) onAir.set(source, ids)
		else onAir.delete(source)
		if (!known.has(source)) {
			known.add(source)
			return []
		}
		const t = now()
		for (const [id, until] of guard) if (until < t) guard.delete(id)
		const fresh = list.filter((l) => !before.has(String(l.sceneId)) && !guard.has(String(l.sceneId)))
		const fired = []
		for (const look of fresh) {
			for (const r of rules) {
				if (!r.enabled || !matches(r.when, look)) continue
				const a = parsed.get(r.id)
				if (!a || a.type === 'invalid' || a.type === 'presenter') continue // blank / bad: zone-service warns at load
				fired.push(fire(r, a, look, source))
			}
		}
		return fired
	}

	async function fire(rule, action, look, source) {
		const name = look.name || look.sceneId
		const entry = { at: now(), rule: rule.id, look: name, source, detail: '' }
		if (!deps.allowed()) {
			entry.detail = 'not run: zone actions are off for this server'
		} else {
			if (action.type === 'look') guard.set(String(action.sceneId), now() + GUARD_MS)
			const r = await deps.run(action)
			entry.detail = r.detail
			entry.ok = !!r.ok
			deps.log?.(r.ok ? 'info' : 'warn', `[on-air] ${name} on air (${source}) → ${r.detail}`)
		}
		recent.unshift(entry)
		recent.length = Math.min(recent.length, MAX_RECENT)
		return entry
	}

	return {
		configure,
		update,
		rules: () => rules,
		recent: () => recent.slice(),
		onAir: () => Object.fromEntries([...onAir].map(([k, v]) => [k, [...v]])),
	}
}

module.exports = { createAirRules, normalizeAirRules, GUARD_MS }

'use strict'

/**
 * WO-1084 — the ONE rule for Caspar `<screen>` consumers: a window only opens on a screen that is connected and lit
 * (xrandr: connected with a mode), and never on the operator's screen. Owner 15.11 (warehouse, fewer monitors than at
 * the show): "the consumers that dont have their connectors up shouldnt be started/turned on."
 *
 * PURE: XML + heads in, XML + decisions out. Callers:
 *   - tools/runtime/gate-screen-consumers.js — run.sh, before EVERY Caspar launch, on the file Caspar is about to read
 *     (generator, override, project bundle, ISO template, stick restore, hand edit: the WO-717 table);
 *   - src/system/screen-hotplug.js — a screen that comes up / goes down while Caspar runs (ADD ch-idx XML / REMOVE).
 *
 * A consumer that must not start is NOT deleted: its block stays in casparcg.config inside a marker comment carrying
 * the reason ("configured but offline"); {@link restoreOfflineScreens} gives the exact original back, so every
 * launch decides again from the full config and a comparison with the generator's output ignores the marks.
 *
 * Decision per window (rect = <x> <y> <width> <height> of the `<screen>` block):
 *   - no display information (xrandr unreadable)        → start (fail open: never darken a show on a probe error);
 *   - it overlaps the operator's screen                  → not started (the GUI is never covered);
 *     except the Operator GUI channel's own window (the generator's legacy under-the-GUI consumer);
 *   - it touches no lit screen at all                    → not started (unplugged, no mode, a name this GPU lacks:
 *     X would clamp the window onto whatever screen exists — the operator's, in a warehouse);
 *   - otherwise                                          → start.
 * Geometry, not names: on NVIDIA the DRM connector names are offset from the xrandr names (card0-DP-2 = DP-3), and
 * the window lands where its rect says, whatever jack the config meant.
 */

const MARK_RE = /<!--HACG-OFFLINE(64)? reason="([^"]*)" ([\s\S]*?) HACG-OFFLINE-->/g
const OPERATOR_GUI_CHANNEL_RE = /Operator GUI channel/

/** @typedef {{ name: string, connected: boolean, active: boolean, x: number, y: number, width: number, height: number }} Head */
/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */

const safeReason = (s) => String(s || '').replace(/--+/g, '-').replace(/"/g, "'").replace(/\s+/g, ' ').trim()

/** The block, wrapped in the offline marker (base64 when the block itself contains `--`, which a comment cannot). */
function markOffline(block, reason) {
	const r = safeReason(reason)
	if (!block.includes('--')) return `<!--HACG-OFFLINE reason="${r}" ${block} HACG-OFFLINE-->`
	return `<!--HACG-OFFLINE64 reason="${r}" ${Buffer.from(block, 'utf8').toString('base64')} HACG-OFFLINE-->`
}

/** Every marked block back to the exact original. Idempotent; an unmarked file comes back unchanged. */
function restoreOfflineScreens(xml) {
	if (typeof xml !== 'string' || !xml.includes('HACG-OFFLINE')) return xml
	return xml.replace(MARK_RE, (_m, b64, _reason, body) => (b64 ? Buffer.from(body, 'base64').toString('utf8') : body))
}

/** The marks in a file: [{ channel, reason, block }] (channel = 1-based Caspar order). */
function listOfflineScreens(xml) {
	const out = []
	walkScreens(String(xml || ''), { includeMarked: true }, (s) => {
		if (s.marked) out.push({ channel: s.channel, reason: s.reason, block: s.block, rect: s.rect, port: s.port })
	})
	return out
}

function num(block, tag) {
	const m = block.match(new RegExp(`<${tag}>\\s*(-?\\d+)\\s*</${tag}>`))
	return m ? parseInt(m[1], 10) : null
}

function bool(block, tag) {
	const m = block.match(new RegExp(`<${tag}>\\s*(true|false)\\s*</${tag}>`))
	return m ? m[1] === 'true' : null
}

/** Rect of a `<screen>` block, or null when it has no position (Caspar then picks one itself). */
function screenRect(block) {
	const x = num(block, 'x')
	const y = num(block, 'y')
	if (x == null || y == null) return null
	return { x, y, width: Math.max(1, num(block, 'width') || 0), height: Math.max(1, num(block, 'height') || 0) }
}

/** Caspar's consumer index (= INFO port) of a config `<screen>`: 600 + 10·key-only + (device − 1). */
function screenPort(block) {
	const dev = Math.max(1, num(block, 'device') || 1)
	return 600 + (bool(block, 'key-only') ? 10 : 0) + (dev - 1)
}

/**
 * Visit every `<screen>` of every `<channel>` (Caspar numbers channels in file order; comments are skipped, so a
 * commented-out channel or consumer is not one). `fn({ channel, block, rect, port, operatorGui, marked, reason,
 * start, end })` — start/end index the block (or its mark) in `xml`.
 */
function walkScreens(xml, opts, fn) {
	const top = /<!--[\s\S]*?-->|<channel>[\s\S]*?<\/channel>/g
	let channel = 0
	let lastComment = ''
	let m
	while ((m = top.exec(xml))) {
		if (m[0].startsWith('<!--')) {
			lastComment = m[0]
			continue
		}
		channel++
		const operatorGui = OPERATOR_GUI_CHANNEL_RE.test(lastComment)
		lastComment = ''
		const inner = /<!--HACG-OFFLINE(64)? reason="([^"]*)" ([\s\S]*?) HACG-OFFLINE-->|<!--[\s\S]*?-->|<screen\s*>[\s\S]*?<\/screen\s*>/g
		let s
		while ((s = inner.exec(m[0]))) {
			const start = m.index + s.index
			const end = start + s[0].length
			if (s[0].startsWith('<!--HACG-OFFLINE')) {
				if (!opts.includeMarked) continue
				const block = s[1] ? Buffer.from(s[3], 'base64').toString('utf8') : s[3]
				fn({ channel, block, rect: screenRect(block), port: screenPort(block), operatorGui, marked: true, reason: s[2], start, end })
				continue
			}
			if (s[0].startsWith('<!--')) continue
			fn({ channel, block: s[0], rect: screenRect(s[0]), port: screenPort(s[0]), operatorGui, marked: false, reason: '', start, end })
		}
	}
}

const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const at = (r) => `@${r.x},${r.y} ${r.width}x${r.height}`

/**
 * PURE. Start this window? `heads` null = unknown (start). `operatorNames` = the GUI's screen(s) by xrandr name.
 * @param {Rect|null} rect
 * @param {Head[]|null} heads
 * @param {{ operatorNames?: string[], operatorGui?: boolean }} [opts]
 * @returns {{ start: boolean, reason: string, on: string[] }}
 */
function decideScreen(rect, heads, opts = {}) {
	if (!Array.isArray(heads)) return { start: true, reason: 'display state unknown', on: [] }
	if (!rect) return { start: true, reason: 'no position in the config', on: [] }
	const lit = heads.filter((h) => h && h.connected && h.active && h.width > 0 && h.height > 0)
	const ops = new Set((opts.operatorNames || []).filter(Boolean).map(String))
	const on = lit.filter((h) => intersects(rect, h))
	const opHit = on.filter((h) => ops.has(h.name))
	if (opHit.length && !opts.operatorGui) {
		return { start: false, reason: `would cover the operator screen ${opHit.map((h) => h.name).join('+')}`, on: on.map((h) => h.name) }
	}
	if (!on.length) {
		const dark = heads.filter((h) => h && h.connected && !h.active).map((h) => h.name)
		return {
			start: false,
			reason: `no connected screen there${dark.length ? ` (connected without a mode: ${dark.join(', ')})` : ''}`,
			on: [],
		}
	}
	return { start: true, reason: `on ${on.map((h) => h.name).join('+')}`, on: on.map((h) => h.name) }
}

/**
 * PURE. Restore every mark, then decide each `<screen>` again and mark the ones that must not start.
 * @param {string} xml
 * @param {{ heads: Head[]|null, operatorNames?: string[] }} state
 * @returns {{ xml: string, changed: boolean, started: Array, offline: Array }} changed = differs from the input
 */
function gateScreenConsumers(xml, state) {
	if (typeof xml !== 'string') return { xml, changed: false, started: [], offline: [] }
	const base = restoreOfflineScreens(xml)
	const started = []
	const offline = []
	const cuts = []
	walkScreens(base, { includeMarked: false }, (s) => {
		const d = decideScreen(s.rect, state?.heads ?? null, { operatorNames: state?.operatorNames, operatorGui: s.operatorGui })
		const row = { channel: s.channel, port: s.port, rect: s.rect, reason: d.reason, on: d.on, block: s.block }
		if (d.start) started.push(row)
		else {
			offline.push(row)
			cuts.push({ start: s.start, end: s.end, text: markOffline(s.block, `ch${s.channel} ${d.reason}`) })
		}
	})
	let out = base
	for (const c of cuts.reverse()) out = out.slice(0, c.start) + c.text + out.slice(c.end)
	return { xml: out, changed: out !== xml, started, offline }
}

/** One log line: "started ch2 @0,0 … on DP-0; not started ch4 @3072,0 …: no connected screen …". */
function summarize(r) {
	const s = r.started.map((x) => `ch${x.channel}${x.rect ? ` ${at(x.rect)}` : ''} ${x.reason}`)
	const o = r.offline.map((x) => `ch${x.channel} ${x.rect ? at(x.rect) : ''}: ${x.reason}`)
	return `${s.length} started${s.length ? ` (${s.join('; ')})` : ''}, ${o.length} not started${o.length ? ` (${o.join('; ')})` : ''}`
}

module.exports = {
	decideScreen,
	gateScreenConsumers,
	restoreOfflineScreens,
	listOfflineScreens,
	walkScreens,
	screenRect,
	screenPort,
	markOffline,
	summarize,
}

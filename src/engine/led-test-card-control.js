'use strict'

/**
 * WO-629 — the LED test card's settings and master switch, composed in node (owner directive: every function is an
 * endpoint). The web keeps these in browser localStorage (client/components/led-test-modal.js +
 * client/lib/led-test-apply.js), so a second client never saw them. Here they are one box-wide record
 * (persistence key `ledTestCard`), and the master switch decides its own target channels and drives the existing
 * per-channel POST /api/led-test-card (layer 999) for each.
 *
 * The master's on/off truth stays `ctx._ledTestPatternActive` (state.ledTestPatternActive, WS `change`), which
 * that route and the startup card already maintain.
 */

const persistence = require('../utils/persistence')

const KEY = 'ledTestCard'

/** Template patterns (led_grid_test.html), in the web modal's order. */
const PATTERNS = [
	['grid-white', 'Grid (White)'],
	['smpte-bars', 'SMPTE Color Bars'],
	['gradient-h', 'Gradient Horizontal'],
	['gradient-v', 'Gradient Vertical'],
	['checkerboard', 'Checkerboard'],
	['bouncing-element', 'Bouncing Character'],
	['led-builder', 'Animated: Bunny builds the wall'],
	['animated-radar', 'Animated: Radar Sweep'],
	['animated-stripes', 'Animated: Scrolling Stripes'],
	['animated-pulse', 'Animated: Expanding Pulse'],
	['animated-noise', 'Animated: TV Static'],
	['solid-red', 'Solid Red'],
	['solid-green', 'Solid Green'],
	['solid-blue', 'Solid Blue'],
	['solid-white', 'Solid White'],
	['solid-black', 'Solid Black'],
]

/** The web modal's defaults (getLedTestSettings). */
const DEFAULTS = Object.freeze({
	cols: 20,
	rows: 10,
	panelWidth: 192,
	panelHeight: 108,
	centerLabel: 'HighAsCG',
	showCenterCharacter: true,
	showPanelLabels: true,
	showSpecLine: true,
	showCircle: true,
	showCross: true,
	gridByChannel: {},
	channelsEnabled: {},
	pattern: 'grid-white',
	charCount: 3,
	builderSpeed: 3,
})

function int(v, def, lo, hi) {
	const n = parseInt(String(v), 10)
	return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : def))
}

/** `{ "1": true, "x": true, "2": false }` → `{ "1": true }` (only positive channel numbers that are on). */
function onMap(raw) {
	const out = {}
	if (raw && typeof raw === 'object') {
		for (const [k, v] of Object.entries(raw)) {
			const ch = parseInt(k, 10)
			if (v === true && Number.isFinite(ch) && ch > 0) out[String(ch)] = true
		}
	}
	return out
}

/** Pure: any stored/posted shape → a complete, clamped settings record. */
function normalizeSettings(raw) {
	const r = raw && typeof raw === 'object' ? raw : {}
	const bool = (k) => (r[k] === undefined ? DEFAULTS[k] : r[k] !== false && r[k] !== 'false')
	const gridByChannel = onMap(r.gridByChannel)
	let pattern = PATTERNS.some(([id]) => id === r.pattern) ? r.pattern : DEFAULTS.pattern
	// WO-588: the builder fills LED panels — only offered while some channel shows the full grid.
	if (pattern === 'led-builder' && !Object.keys(gridByChannel).length) pattern = DEFAULTS.pattern
	return {
		cols: int(r.cols, DEFAULTS.cols, 1, 256),
		rows: int(r.rows, DEFAULTS.rows, 1, 256),
		panelWidth: int(r.panelWidth, DEFAULTS.panelWidth, 1, 16384),
		panelHeight: int(r.panelHeight, DEFAULTS.panelHeight, 1, 16384),
		centerLabel: String(r.centerLabel ?? '').trim() || DEFAULTS.centerLabel,
		showCenterCharacter: bool('showCenterCharacter'),
		showPanelLabels: bool('showPanelLabels'),
		showSpecLine: bool('showSpecLine'),
		showCircle: bool('showCircle'),
		showCross: bool('showCross'),
		gridByChannel,
		channelsEnabled: onMap(r.channelsEnabled),
		pattern,
		charCount: int(r.charCount, DEFAULTS.charCount, 1, 48),
		builderSpeed: int(r.builderSpeed, DEFAULTS.builderSpeed, 1, 10),
	}
}

function getSettings() {
	return normalizeSettings(persistence.get(KEY))
}

/** Merge `patch` (maps replace whole) into the stored record. */
function saveSettings(patch) {
	const next = normalizeSettings({ ...getSettings(), ...(patch && typeof patch === 'object' ? patch : {}) })
	persistence.set(KEY, next)
	return next
}

function chans(list) {
	return [...new Set((Array.isArray(list) ? list : []).map((x) => parseInt(String(x), 10)))].filter(
		(n) => Number.isFinite(n) && n > 0
	)
}

/**
 * Pure: which channels a switch touches (web applyLedTestPattern).
 * - `channels` given → exactly those.
 * - on → the channels picked in the dialog (show card or full grid); none picked → every program channel
 *   (the header checkbox's own promise, "on all program channels"; the web refused with NO_CHANNELS instead).
 * - off → every program + multiview channel and anything picked, so nothing is left on layer 999.
 */
function planTargets(settings, channelMap, enabled, channels) {
	const cm = channelMap || {}
	const program = chans(cm.programChannels?.length ? cm.programChannels : [1])
	const mv = chans([cm.multiviewCh, ...(Array.isArray(cm.multiviewChannels) ? cm.multiviewChannels : [])])
	const picked = chans([...Object.keys(settings.channelsEnabled || {}), ...Object.keys(settings.gridByChannel || {})])
	if (Array.isArray(channels) && channels.length) return chans(channels)
	if (enabled) return picked.length ? picked.sort((a, b) => a - b) : program
	return chans([...program, ...mv, ...picked])
}

/**
 * Pure: the per-channel POST /api/led-test-card body. No connectorLabel — that route names the output itself from
 * the operator's screen label + GPU connector (WO-506); the web's client-side "Output: Screen N" overrode it.
 */
function cardBody(settings, channel, enabled, masterOff) {
	const { gridByChannel, channelsEnabled: _c, ...rest } = settings
	return {
		...rest,
		enabled: !!enabled,
		channel,
		showLedGrid: gridByChannel[String(channel)] === true,
		masterOff: !!masterOff,
	}
}

let chain = Promise.resolve()

/**
 * Switch the card on/off on its targets, one channel after another (serialised: overlapping toggles must not
 * interleave CG ADD/CLEAR on the same layer).
 * @param {object} ctx app ctx (amcp, getState, _wsBroadcast)
 * @param {boolean} enabled
 * @param {{ channels?: number[], masterOff?: boolean, post?: Function }} [opts] `post` is injectable for tests
 * @returns {Promise<{ ok: boolean, enabled: boolean, targets: number[], failures: { channel: number, error: string }[] }>}
 */
function applyCard(ctx, enabled, opts = {}) {
	const run = async () => {
		const settings = getSettings()
		const st = typeof ctx?.getState === 'function' ? ctx.getState() || {} : {}
		const targets = planTargets(settings, st.channelMap, enabled, opts.channels)
		const scoped = Array.isArray(opts.channels) && opts.channels.length > 0
		const masterOff = opts.masterOff === true || (!enabled && !scoped)
		const post = opts.post || require('../api/routes-led-test-card').handlePost
		const failures = []
		for (let i = 0; i < targets.length; i++) {
			const body = cardBody(settings, targets[i], enabled, masterOff && i === targets.length - 1)
			let r
			try {
				r = await post('/api/led-test-card', body, ctx)
			} catch (e) {
				r = { status: 500, body: JSON.stringify({ error: e?.message || String(e) }) }
			}
			if (!r || r.status !== 200) {
				let msg = `HTTP ${r?.status ?? '?'}`
				try {
					msg = JSON.parse(r.body).error || msg
				} catch {
					/* keep the status */
				}
				failures.push({ channel: targets[i], error: msg })
			}
		}
		const ok = targets.length > 0 && (enabled ? failures.length < targets.length : failures.length === 0)
		return { ok, enabled: !!enabled, targets, failures }
	}
	const p = chain.then(run, run)
	chain = p.catch(() => {})
	return p
}

/** The dialog's per-channel "Show test card": remember it, then switch that channel alone. */
async function setChannel(ctx, channel, enabled, opts = {}) {
	const ch = parseInt(String(channel), 10)
	const cur = getSettings()
	const channelsEnabled = { ...cur.channelsEnabled }
	if (enabled) channelsEnabled[String(ch)] = true
	else delete channelsEnabled[String(ch)]
	const next = saveSettings({ channelsEnabled })
	// The last channel switched off turns the master off too (the web header checkbox did the same).
	const masterOff = !enabled && !Object.keys(next.channelsEnabled).length
	return applyCard(ctx, enabled, { ...opts, channels: [ch], masterOff })
}

module.exports = {
	KEY,
	PATTERNS,
	DEFAULTS,
	normalizeSettings,
	getSettings,
	saveSettings,
	planTargets,
	cardBody,
	applyCard,
	setChannel,
}

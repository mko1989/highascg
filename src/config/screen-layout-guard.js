'use strict'

/**
 * Generate-time sanity checks that Apply can show the operator (WO-515).
 *
 * Apply used to succeed silently on a layout that could not physically work. Measured on the dev
 * box: a 6144x1536 PGM screen consumer, `always-on-top`, placed at 0,0 on a desktop that is only
 * 5760x1080 — it covered every other output including the operator GUI, and the operator's screen
 * simply went black with no explanation anywhere.
 *
 * These are WARNINGS, not blockers, on purpose. Overlapping windows are a legitimate setup (an
 * operator GUI deliberately under a PGM hole, WO-243) and screen geometry can be wrong in the probe
 * rather than in the config. Refusing to Apply would strand a box that is merely unusual; telling
 * the operator what will happen costs nothing and is what was missing.
 *
 * @see src/api/device-view-apply.js — where these reach the operator
 */

const { resolveDecklinkInputSlots } = require('./decklink-input-slots')

/** @typedef {{ n: number, x: number, y: number, w: number, h: number, device: number }} ScreenRect */

/**
 * Screen consumer rectangles as the generator will emit them.
 * @param {Record<string, unknown>} cfg flat casparServer-shaped config
 * @returns {ScreenRect[]}
 */
function screenRectsFromConfig(cfg) {
	const out = []
	if (!cfg || typeof cfg !== 'object') return out
	for (let n = 1; n <= 16; n++) {
		const w = parseInt(String(cfg[`screen_${n}_custom_width`] ?? ''), 10)
		const h = parseInt(String(cfg[`screen_${n}_custom_height`] ?? ''), 10)
		if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) continue
		out.push({
			n,
			x: parseInt(String(cfg[`screen_${n}_x`] ?? '0'), 10) || 0,
			y: parseInt(String(cfg[`screen_${n}_y`] ?? '0'), 10) || 0,
			w,
			h,
			device: parseInt(String(cfg[`screen_${n}_device`] ?? '0'), 10) || 0,
		})
	}
	return out
}

function overlaps(a, b) {
	return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {{ desktop?: { width: number, height: number }, rects?: ScreenRect[] }} [opts]
 *   `desktop` is the physical extent (e.g. from xrandr). Omit it when unknown — the desktop checks
 *   are then skipped rather than guessed at.
 * @returns {string[]} operator-facing warnings, empty when the layout is sane
 */
function collectScreenLayoutWarnings(cfg, opts = {}) {
	const warnings = []
	const rects = Array.isArray(opts.rects) ? opts.rects : screenRectsFromConfig(cfg)

	const desktop = opts.desktop
	if (desktop && desktop.width > 0 && desktop.height > 0) {
		for (const r of rects) {
			if (r.x + r.w > desktop.width || r.y + r.h > desktop.height) {
				warnings.push(
					`Screen ${r.n} (${r.w}x${r.h} at ${r.x},${r.y}) extends past the ${desktop.width}x${desktop.height} desktop — ` +
						`the part beyond the edge will not be visible, and an always-on-top window this size covers the outputs under it.`,
				)
			}
		}
	}

	// Overlap is reported per pair, once, and only between windows on the same X device.
	for (let i = 0; i < rects.length; i++) {
		for (let j = i + 1; j < rects.length; j++) {
			const a = rects[i]
			const b = rects[j]
			if (a.device !== b.device) continue
			if (!overlaps(a, b)) continue
			warnings.push(
				`Screen ${a.n} and screen ${b.n} overlap on display device ${a.device} ` +
					`(${a.w}x${a.h} at ${a.x},${a.y} vs ${b.w}x${b.h} at ${b.x},${b.y}) — whichever is always-on-top hides the other.`,
			)
		}
	}

	return warnings
}

/**
 * DeckLink output bindings that cannot work, surfaced where the operator can see them.
 *
 * WO-507 dropped these silently: it wrote to `config.__generatorWarn`, which nothing ever set, so
 * the warnings were dead code from the day they were written. The guard itself worked — the config
 * came out correct — but a dropped output with no explanation is exactly the silent-config failure
 * this session kept tripping over. Same computation, real channel.
 *
 * @param {Record<string, unknown>} cfg
 * @param {object} [appConfig] full app config (device graph) for input-slot resolution
 * @returns {string[]}
 */
function collectDecklinkBindingWarnings(cfg, appConfig) {
	const warnings = []
	if (!cfg || typeof cfg !== 'object') return warnings
	const reserved = new Set(resolveDecklinkInputSlots(appConfig || cfg) || [])

	/** device → screens claiming it, to catch one card on two channels (WO-509/514). */
	const claims = new Map()
	for (let n = 1; n <= 16; n++) {
		const dev = parseInt(String(cfg[`screen_${n}_decklink_device`] ?? '0'), 10) || 0
		if (dev > 0) {
			if (reserved.has(dev)) {
				warnings.push(
					`Screen ${n} is bound to DeckLink ${dev}, which is configured as an INPUT — ` +
						`no SDI output will be produced for it. A card cannot be an input and an output at once.`,
				)
			}
			claims.set(dev, [...(claims.get(dev) || []), `screen ${n}`])
		}
		const tiles = cfg[`screen_${n}_decklink_tiles`]
		if (Array.isArray(tiles)) {
			for (const t of tiles) {
				const td = parseInt(String(t?.device ?? '0'), 10) || 0
				if (td <= 0) continue
				if (reserved.has(td)) {
					warnings.push(
						`Screen ${n} has a pixel-map tile on DeckLink ${td}, which is configured as an INPUT — that tile will not be output.`,
					)
				}
				claims.set(td, [...(claims.get(td) || []), `screen ${n} tile`])
			}
		}
	}
	const mv = parseInt(String(cfg.multiview_decklink_device ?? '0'), 10) || 0
	if (mv > 0) claims.set(mv, [...(claims.get(mv) || []), 'multiview'])

	for (const [dev, owners] of claims) {
		const unique = [...new Set(owners)]
		if (unique.length > 1) {
			warnings.push(
				`DeckLink ${dev} is claimed by ${unique.join(' and ')} — CasparCG cannot open one card twice, ` +
					`and the channel that loses will fail to start.`,
			)
		}
	}
	return warnings
}

module.exports = {
	screenRectsFromConfig,
	collectScreenLayoutWarnings,
	collectDecklinkBindingWarnings,
}

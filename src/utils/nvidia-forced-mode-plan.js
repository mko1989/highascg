'use strict'

/**
 * WO-1129 — which connectors get a CustomEDID (NVIDIA forced mode), decided purely from config + what X/the disk show.
 *
 * Never automatic: only a Caspar screen whose `screen_N_os_mode_source` is EXPLICITLY 'custom' (the Devices view's
 * Custom OS resolution) asks for one — the legacy inference in os-mode-source.js does not count (owner: a forced
 * 1080p50 on a laptop panel looked bad; it must be the operator's own choice).
 *
 * The decision is made against the connector's ORIGINAL EDID, not against the current mode list alone: once our
 * CustomEDID is live, X lists the mode, and "listed → not needed → remove" would flip-flop on every Apply.
 */

const fs = require('fs')
const crypto = require('crypto')
const { readOsModeSourceSetting } = require('./os-mode-source')
const { buildForcedModeEdid, RATE_TOLERANCE_HZ } = require('./edid-forced-mode')

/** NVIDIA connector names as the X driver and the root helper accept them. */
const CONNECTOR_RE = /^[A-Za-z0-9-]+$/

let nvidiaMemo
/**
 * The proprietary (or open-kernel) NVIDIA driver — the one whose X driver refuses RandR user modes. nouveau never
 * creates /proc/driver/nvidia. Memoized: the driver cannot change without a reboot.
 * @param {{ exists?: (p: string) => boolean }} [deps]
 */
function isNvidiaProprietaryDriver(deps = {}) {
	if (deps.exists) return deps.exists('/proc/driver/nvidia/version')
	if (nvidiaMemo === undefined) {
		try {
			nvidiaMemo = fs.existsSync('/proc/driver/nvidia/version')
		} catch {
			nvidiaMemo = false
		}
	}
	return nvidiaMemo
}

/**
 * Explicit forced-mode heads of a layout (calculateLayoutPositions result). The operator-GUI heads claim their
 * output first (same order as applyX11Layout), so a screen sharing that output is not forced.
 * @param {object} config
 * @param {object} layout
 * @param {(sysId: string) => string} [resolve] sysId → live xrandr output name
 * @returns {Array<{ output: string, width: number, height: number, refreshHz: number, screenN: number }>}
 */
function collectForcedModeHeads(config, layout, resolve = (s) => s) {
	const wanted = Object.entries(layout?.screens || {}).filter(([key, info]) => {
		const n = parseInt(String(info?.screenIndex ?? key), 10)
		return Number.isFinite(n) && readOsModeSourceSetting(config, n) === 'custom'
	})
	if (wanted.length === 0) return [] // nothing explicit: no output name is even resolved
	const claimed = new Set(Object.values(layout?.operatorGui || {}).map((h) => resolve(String(h?.sysId || '').trim())))
	const out = []
	for (const [key, info] of wanted) {
		const m = String(info?.mode || '').trim().match(/^(\d+)x(\d+)$/i)
		const hz = Number(info?.rate)
		const output = resolve(String(info?.sysId || '').trim())
		if (!m || !(hz > 0) || !CONNECTOR_RE.test(output) || claimed.has(output)) continue
		claimed.add(output)
		const n = parseInt(String(info?.screenIndex ?? key), 10)
		out.push({ output, width: parseInt(m[1], 10), height: parseInt(m[2], 10), refreshHz: hz, screenN: n })
	}
	return out
}

/**
 * Does `xrandr --query` list WxH at ≈hz on this output? (Rates are the numbers after the mode token: `144.00*+`.)
 * @param {string} queryText
 * @param {string} output
 * @param {string} wxh e.g. '1920x1080'
 * @param {number} hz
 */
function xrandrOutputListsModeRate(queryText, output, wxh, hz) {
	let inOut = false
	for (const line of String(queryText || '').split('\n')) {
		const head = line.match(/^(\S+)\s+(connected|disconnected)\b/)
		if (head) {
			inOut = head[1] === output
			continue
		}
		if (!/^\s/.test(line)) inOut = false // "Screen 0: …" or any other top-level line ends the block
		if (!inOut) continue
		const toks = line.trim().split(/\s+/)
		if (toks[0] !== wxh) continue
		for (const t of toks.slice(1)) {
			const r = parseFloat(t)
			if (Number.isFinite(r) && Math.abs(r - hz) < RATE_TOLERANCE_HZ) return true
		}
	}
	return false
}

/** Display-friendly rate: 50 → '50', 59.94 → '59.94'. */
function fmtHz(hz) {
	return String(Math.round(hz * 100) / 100)
}

function edidKey(output, buf) {
	return `${output}|${crypto.createHash('sha1').update(buf).digest('hex')}`
}

/**
 * Pure decision. Inputs are what the disk / X show right now; nothing is written.
 * @param {{
 *   heads: ReturnType<typeof collectForcedModeHeads>,
 *   installed: Map<string, Buffer>,            // /etc/X11/highascg-edid/<conn>.bin
 *   liveEdid: (output: string) => Buffer | null,   // what X reports now (may be our CustomEDID)
 *   storedOrig: (output: string) => Buffer | null, // the real EDID saved when we first forced this output
 *   queryText: string,                          // xrandr --query
 *   attempted?: Set<string>,                    // output|sha1 that already got an X restart in this process
 *   fallbackTimings?: (head: object) => string[] | null,
 * }} p
 * @returns {{ install: Array<{ output: string, edid: Buffer, orig: Buffer, label: string, key: string }>,
 *   remove: string[], pending: Array<{ output: string, label: string, key: string }>, warnings: string[] }}
 */
function planCustomEdidSync(p) {
	const install = []
	const pending = []
	const warnings = []
	const claimed = new Set()
	for (const head of p.heads || []) {
		const { output } = head
		claimed.add(output)
		const wxh = `${head.width}x${head.height}`
		const label = `${output}: forcing ${wxh}@${fmtHz(head.refreshHz)}`
		const installed = p.installed.get(output) || null
		const live = p.liveEdid(output)
		const listed = xrandrOutputListsModeRate(p.queryText, output, wxh, head.refreshHz)
		if (!installed && listed) continue // the driver offers it natively — nothing to force
		let orig = live
		if (installed && (!live || live.equals(installed))) orig = p.storedOrig(output) || live || installed
		if (!orig) {
			warnings.push(`${output}: no EDID readable — cannot force ${wxh}@${fmtHz(head.refreshHz)}`)
			continue
		}
		const built = buildForcedModeEdid(orig, {
			width: head.width,
			height: head.height,
			refreshHz: head.refreshHz,
			fallbackTimings: typeof p.fallbackTimings === 'function' ? p.fallbackTimings(head) : null,
		})
		if (!built.ok) {
			warnings.push(`${output}: cannot force ${wxh}@${fmtHz(head.refreshHz)} — ${built.error}`)
			continue
		}
		if (built.alreadyPresent) {
			claimed.delete(output) // the real EDID has it: a CustomEDID would add nothing (an old one goes)
			if (!listed) warnings.push(`${output}: the EDID offers ${wxh}@${fmtHz(head.refreshHz)} but X does not list it`)
			continue
		}
		const key = edidKey(output, built.edid)
		if (installed && installed.equals(built.edid)) {
			if (listed) continue // steady state
			if (p.attempted && p.attempted.has(key)) {
				warnings.push(`${output}: custom EDID installed but X still does not list ${wxh}@${fmtHz(head.refreshHz)} (driver rejected it?)`)
			} else {
				pending.push({ output, label, key })
			}
			continue
		}
		install.push({ output, edid: built.edid, orig, label, key })
	}
	const remove = [...p.installed.keys()].filter((o) => !claimed.has(o)).sort()
	return { install, remove, pending, warnings }
}

module.exports = {
	CONNECTOR_RE,
	isNvidiaProprietaryDriver,
	collectForcedModeHeads,
	xrandrOutputListsModeRate,
	planCustomEdidSync,
}

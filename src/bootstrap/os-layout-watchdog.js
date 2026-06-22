'use strict'

const { applyX11Layout, checkXrandrLayout } = require('../utils/os-config')
const { getDisplaysXrandrDetailed } = require('../utils/hardware-info')
const { applyOperatorDisplaySession } = require('../utils/x-display-session')

function envTruthy(name, defaultVal) {
	const raw = process.env[name]
	if (raw == null || String(raw).trim() === '') return defaultVal
	const v = String(raw).trim().toLowerCase()
	return v === '1' || v === 'true' || v === 'yes'
}

function parsePositiveInt(name, fallback) {
	const n = parseInt(process.env[name] || '', 10)
	return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * After nodm/X stabilizes, verify xrandr matches config and re-apply when drifted.
 * @param {{ config: object, log?: (level: string, msg: string) => void }} ctx
 */
function startOsLayoutWatchdog(ctx) {
	if (!envTruthy('HIGHASCG_OS_LAYOUT_WATCHDOG', true)) return null
	if (envTruthy('HIGHASCG_HEADLESS', false) && !envTruthy('HIGHASCG_OS_LAYOUT_WATCHDOG_FORCE', false)) {
		// Headless API-only nodes without :0 still skip unless forced.
	}

	const settleMs = parsePositiveInt('HIGHASCG_OS_LAYOUT_SETTLE_MS', 4000)
	const pollMs = parsePositiveInt('HIGHASCG_OS_LAYOUT_POLL_MS', 1500)
	const maxAttempts = parsePositiveInt('HIGHASCG_OS_LAYOUT_MAX_ATTEMPTS', 12)
	const log = typeof ctx?.log === 'function' ? ctx.log : () => {}

	let attempts = 0
	let done = false
	/** @type {ReturnType<typeof setInterval> | null} */
	let timer = null

	const tick = () => {
		if (done) return
		attempts += 1
		const xr = getDisplaysXrandrDetailed()
		if (!xr?.displays?.length) {
			if (attempts >= maxAttempts) {
				done = true
				if (timer) clearInterval(timer)
				log('warn', `[OS-Watchdog] No Xrandr outputs after ${maxAttempts} polls — giving up`)
			}
			return
		}

		if (attempts === 1) {
			log('info', `[OS-Watchdog] Xrandr ready (${xr.displays.length} connected); checking layout after settle`)
		}

		if (attempts * pollMs < settleMs) return

		const check = checkXrandrLayout(ctx.config)
		if (check.ok) {
			done = true
			if (timer) clearInterval(timer)
			log('info', '[OS-Watchdog] xrandr layout matches config')
			applyOperatorDisplaySession(ctx.config, { log }).catch(() => {})
			return
		}

		for (const m of check.mismatches) {
			log(
				'warn',
				`[OS-Watchdog] mismatch ${m.sysId} ${m.field}: expected=${m.expected} actual=${m.actual}`
			)
		}

		log('info', '[OS-Watchdog] Re-applying xrandr layout')
		const res = applyX11Layout(ctx.config)
		if (res?.verify?.ok) {
			done = true
			if (timer) clearInterval(timer)
			log('info', '[OS-Watchdog] xrandr layout corrected')
			applyOperatorDisplaySession(ctx.config, { log }).catch((e) => {
				log('warn', `[OS-Watchdog] NVIDIA display policy after layout: ${e?.message || e}`)
			})
			return
		}

		if (attempts >= maxAttempts) {
			done = true
			if (timer) clearInterval(timer)
			log('warn', `[OS-Watchdog] Layout still wrong after ${maxAttempts} attempts — operator may need Apply OS`)
		}
	}

	timer = setInterval(tick, pollMs)
	tick()
	return () => {
		done = true
		if (timer) clearInterval(timer)
	}
}

module.exports = { startOsLayoutWatchdog }

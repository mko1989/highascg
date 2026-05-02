/**
 * OS-specific settings handlers for HighAsCG.
 */
'use strict'

const { execSync } = require('child_process')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { applyX11Layout, calculateLayoutPositions, restartDisplayManager } = require('../utils/os-config')
const { resolveMainScreenCount } = require('../config/routing')
const { normalizeCasparServerConfigPath } = require('./routes-caspar-config')
const { normalizeTandemTopology } = require('../config/tandem-topology')
const { normalizeDeviceGraph } = require('../config/device-graph')
const { normalizeRtmpConfig } = require('../config/rtmp-output')
const defaults = require('../config/defaults')

const SYSTEM_DISPLAY_KEYS = [
	'screen_count', 'screen_1_system_id', 'screen_2_system_id', 'screen_3_system_id', 'screen_4_system_id',
	'screen_1_os_mode', 'screen_2_os_mode', 'screen_3_os_mode', 'screen_4_os_mode',
	'screen_1_os_backend', 'screen_2_os_backend', 'screen_3_os_backend', 'screen_4_os_backend',
	'screen_1_os_rate', 'screen_2_os_rate', 'screen_3_os_rate', 'screen_4_os_rate',
	'screen_1_os_x', 'screen_2_os_x', 'screen_3_os_x', 'screen_4_os_x',
	'screen_1_os_y', 'screen_2_os_y', 'screen_3_os_y', 'screen_4_os_y',
	'x11_horizontal_swap', 'multiview_system_id', 'multiview_os_mode', 'multiview_os_rate', 'multiview_os_backend',
	'multiview_os_x', 'multiview_os_y'
]

function mergeSystemDisplaySettings(ctx, s) {
	if (!s || typeof s !== 'object') return
	if (s.screen_count != null) { const n = parseInt(s.screen_count, 10); if (n >= 1 && n <= 4) ctx.config.screen_count = n }
	if (s.x11_horizontal_swap !== undefined) ctx.config.x11_horizontal_swap = !!s.x11_horizontal_swap
	if (s.multiview_system_id !== undefined) ctx.config.multiview_system_id = String(s.multiview_system_id || '').trim()
	if (s.multiview_os_mode !== undefined) ctx.config.multiview_os_mode = String(s.multiview_os_mode || '').trim()
	if (s.multiview_os_backend !== undefined) {
		const b = String(s.multiview_os_backend || '').trim().toLowerCase()
		ctx.config.multiview_os_backend = (b === 'nvidia' || b === 'xrandr') ? b : 'xrandr'
	}
	if (s.multiview_os_rate !== undefined) { const r = parseFloat(s.multiview_os_rate); if (Number.isFinite(r) && r > 0) ctx.config.multiview_os_rate = r; else delete ctx.config.multiview_os_rate }
	if (s.multiview_os_x !== undefined) { const x = parseInt(s.multiview_os_x, 10); if (Number.isFinite(x)) ctx.config.multiview_os_x = x; else delete ctx.config.multiview_os_x }
	if (s.multiview_os_y !== undefined) { const y = parseInt(s.multiview_os_y, 10); if (Number.isFinite(y)) ctx.config.multiview_os_y = y; else delete ctx.config.multiview_os_y }
	for (let n = 1; n <= 4; n++) {
		const sid = `screen_${n}_system_id`; if (s[sid] !== undefined) ctx.config[sid] = String(s[sid] || '').trim()
		const om = `screen_${n}_os_mode`; if (s[om] !== undefined) ctx.config[om] = String(s[om] || '').trim()
		const ob = `screen_${n}_os_backend`
		if (s[ob] !== undefined) {
			const b = String(s[ob] || '').trim().toLowerCase()
			ctx.config[ob] = (b === 'nvidia' || b === 'xrandr') ? b : 'xrandr'
		}
		const or = `screen_${n}_os_rate`; if (s[or] !== undefined) { const r = parseFloat(s[or]); if (Number.isFinite(r) && r > 0) ctx.config[or] = r; else delete ctx.config[or] }
		const ox = `screen_${n}_os_x`; if (s[ox] !== undefined) { const x = parseInt(s[ox], 10); if (Number.isFinite(x)) ctx.config[ox] = x; else delete ctx.config[ox] }
		const oy = `screen_${n}_os_y`; if (s[oy] !== undefined) { const y = parseInt(s[oy], 10); if (Number.isFinite(y)) ctx.config[oy] = y; else delete ctx.config[oy] }
	}
}

function pickOscForPersistence(o) {
	return { enabled: o.enabled, listenPort: o.listenPort, listenAddress: o.listenAddress, peakHoldMs: o.peakHoldMs, emitIntervalMs: o.emitIntervalMs, staleTimeoutMs: o.staleTimeoutMs, wsDeltaBroadcast: o.wsDeltaBroadcast }
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseXrandrCurrentPositions(queryOut) {
	const out = new Map()
	const lines = String(queryOut || '').split('\n')
	for (const line of lines) {
		const m = line.match(/^([A-Za-z0-9._-]+)\s+connected(?:\s+primary)?\s+(\d+)x(\d+)\+(-?\d+)\+(-?\d+)/)
		if (!m) continue
		out.set(m[1], {
			width: parseInt(m[2], 10) || 0,
			height: parseInt(m[3], 10) || 0,
			x: parseInt(m[4], 10) || 0,
			y: parseInt(m[5], 10) || 0,
		})
	}
	return out
}

function readCurrentXrandrPositions() {
	try {
		const out = execSync('xrandr --display :0 --query', {
			env: { ...process.env, DISPLAY: ':0', XAUTHORITY: process.env.XAUTHORITY || `/home/${process.env.USER || 'casparcg'}/.Xauthority` },
			encoding: 'utf8',
		})
		return parseXrandrCurrentPositions(out)
	} catch (_) {
		return new Map()
	}
}

function expectedHeadsFromLayout(layout) {
	return [...Object.values(layout?.screens || {}), ...Object.values(layout?.multiview || {})]
}

function isLayoutMatchingCurrent(expectedHeads, currentById) {
	for (const h of expectedHeads) {
		const id = String(h?.sysId || '').trim()
		if (!id) continue
		const cur = currentById.get(id)
		if (!cur) return false
		if (Number(cur.x) !== Number(h.x) || Number(cur.y) !== Number(h.y)) return false
	}
	return true
}

async function handleOsPost(path, body, ctx) {
	if (path !== '/api/settings/apply-os') return null
	const settings = parseBody(body); const s = (settings && typeof settings === 'object') ? settings : {}
	if (typeof ctx.log === 'function') ctx.log('info', '[settings-os] apply-os start')
	mergeSystemDisplaySettings(ctx, s)
	if (typeof ctx.log === 'function') {
		for (let n = 1; n <= 4; n++) {
			const sid = String(ctx.config[`screen_${n}_system_id`] || '').trim()
			if (!sid) continue
			const mode = String(ctx.config[`screen_${n}_os_mode`] || '').trim() || 'auto'
			const x = ctx.config[`screen_${n}_os_x`]
			const y = ctx.config[`screen_${n}_os_y`]
			ctx.log('info', `[settings-os] screen_${n} id=${sid} os_mode=${mode} pos=${Number.isFinite(x) ? x : 'auto'},${Number.isFinite(y) ? y : 'auto'}`)
		}
	}
	const osMainCount = resolveMainScreenCount(ctx.config); ctx.config.screen_count = osMainCount
	if (!ctx.config.casparServer) ctx.config.casparServer = { ...defaults.casparServer }
	ctx.config.casparServer.screen_count = osMainCount

	if (ctx.configManager) {
		const cfg = ctx.config; const cur = ctx.configManager.get()
		const newConfig = { ...cur, screen_count: cfg.screen_count, caspar: cfg.caspar, streaming: { ...cfg.streaming }, periodic_sync_interval_sec: cfg.periodic_sync_interval_sec, periodic_sync_interval_sec_osc: cfg.periodic_sync_interval_sec_osc, osc_info_supplement_ms: cfg.osc_info_supplement_ms, osc: pickOscForPersistence(cfg.osc), ui: cfg.ui || defaults.ui, audioRouting: cfg.audioRouting || defaults.audioRouting, offline_mode: cfg.offline_mode, dmx: { ...defaults.dmx, ...(cfg.dmx || {}) }, casparServer: cfg.casparServer || defaults.casparServer, companion: cfg.companion || { host: '127.0.0.1', port: 8000 }, pixelhue: { ...defaults.pixelhue, ...(cfg.pixelhue || {}) }, tandemTopology: normalizeTandemTopology(cfg.tandemTopology), deviceGraph: normalizeDeviceGraph(cfg.deviceGraph), rtmp: normalizeRtmpConfig(cfg.rtmp), usbIngest: { ...defaults.usbIngest, ...(cfg.usbIngest || {}) }, streamingChannel: { ...defaults.streamingChannel, ...(cfg.streamingChannel || {}) } }
		delete newConfig.streaming._effectiveBasePort; delete newConfig.streaming._casparHost
		for (const k of SYSTEM_DISPLAY_KEYS) { if (s[k] !== undefined) { if (cfg[k] !== undefined) newConfig[k] = cfg[k]; else delete newConfig[k] } }
		ctx.configManager.save(newConfig)
	}
	if (typeof ctx.log === 'function') {
		try {
			const layout = calculateLayoutPositions(ctx.config)
			const heads = [...Object.values(layout.screens || {}), ...Object.values(layout.multiview || {})]
			if (!heads.length) {
				ctx.log('warn', '[settings-os] xrandr plan has no mapped outputs')
			} else {
				for (const h of heads) {
					ctx.log(
						'info',
						`[settings-os] plan id=${h.sysId} mode=${h.mode} pos=${h.x},${h.y} size=${h.width}x${h.height}${h.rate != null ? ` rate=${h.rate}` : ''}`
					)
				}
				const xparts = heads.map((h) => {
					return `--output ${h.sysId} --pos ${h.x}x${h.y}`
				})
				ctx.log('info', `[settings-os] xrandr command preview: xrandr --display :0 ${xparts.join(' ')}`)
			}
		} catch (e) {
			ctx.log('warn', `[settings-os] failed to build xrandr plan preview: ${e?.message || e}`)
		}
	}
	const layoutRes = applyX11Layout(ctx.config) || { applied: false, persisted: false }
	if (typeof ctx.log === 'function') {
		ctx.log('info', `[settings-os] layout result applied=${!!layoutRes.applied} persisted=${!!layoutRes.persisted}`)
	}
	let dmRestarted = false
	let reapplyAfterRestart = false
	try {
		const expected = expectedHeadsFromLayout(calculateLayoutPositions(ctx.config))
		dmRestarted = !!restartDisplayManager()
		if (typeof ctx.log === 'function') ctx.log('info', `[settings-os] nodm restart attempted result=${dmRestarted}`)
		if (dmRestarted) {
			await sleep(1200)
			const current = readCurrentXrandrPositions()
			const match = isLayoutMatchingCurrent(expected, current)
			if (typeof ctx.log === 'function') ctx.log('info', `[settings-os] post-restart xrandr verify match=${match}`)
			if (!match) {
				reapplyAfterRestart = true
				const retryRes = applyX11Layout(ctx.config) || { applied: false, persisted: false }
				if (typeof ctx.log === 'function') {
					ctx.log(
						'warn',
						`[settings-os] post-restart layout mismatch -> reapply applied=${!!retryRes.applied} persisted=${!!retryRes.persisted}`,
					)
				}
			}
		}
	} catch (e) {
		if (typeof ctx.log === 'function') ctx.log('warn', `[settings-os] nodm restart/verify failed: ${e?.message || e}`)
	}
	if (typeof ctx.log === 'function') ctx.log('info', `[settings-os] apply-os end dmRestarted=${dmRestarted}`)
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			ok: true,
			dmRestarted,
			layoutApplied: !!layoutRes.applied,
			layoutPersisted: !!layoutRes.persisted,
			reapplyAfterRestart,
		}),
	}
}

module.exports = { handleOsPost, mergeSystemDisplaySettings, pickOscForPersistence, SYSTEM_DISPLAY_KEYS }

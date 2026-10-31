'use strict'

/**
 * WO-906 — playout outputs on their own X screen (:0.1), the operator GUI alone on :0.0. One machine-local switch.
 *   GET  /api/system/playout-screen  — { enabled, installed: [screens], conf: the conf the config asks for | null, warning? }
 *   POST /api/system/playout-screen  — { enable: bool, apply?: bool (default true) }
 *        sets `casparServer.playout_x_screen`, then the standard full apply (installs / removes the X layout through the
 *        root helper, nodm restart, xrandr per screen, Caspar restart on its screen). `apply: false` sets the flag only.
 * Way back: POST { enable: false } — or, with the server down, scripts/runtime/playout-screen.sh off --emergency.
 */

const fs = require('fs')
const path = require('path')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const xs = require('../utils/x-screens')

/** The way back, kept before every switch: casparcg.config, caspar-env and casparServer as they were. */
function writeBackup(ctx) {
	const dir = path.join(process.env.HOME || '/home/casparcg', '.highascg', 'backup', `wo906-${new Date().toISOString().replace(/[:.]/g, '-')}`)
	fs.mkdirSync(dir, { recursive: true })
	const copy = (src, name) => {
		try {
			if (src && fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, name))
		} catch {
			/* best effort */
		}
	}
	copy(require('./routes-caspar-config').resolveCasparConfigWritePath(ctx), 'casparcg.config')
	copy(require('../utils/caspar-gl-sync-env').ENV_FILE, 'caspar-env')
	fs.writeFileSync(path.join(dir, 'casparServer.json'), JSON.stringify(ctx.config?.casparServer || {}, null, 1))
	return dir
}

function reply(status, body) {
	return { status, headers: JSON_HEADERS, body: jsonBody(body) }
}

function handleGet(ctx) {
	try {
		const want = require('../utils/x-screens-sync').wantedConf(ctx.config)
		return reply(200, {
			enabled: xs.isPlayoutXScreen(ctx.config),
			installed: xs.installedScreens(),
			conf: want.conf,
			...(want.warning || want.error ? { warning: want.warning || want.error } : {}),
		})
	} catch (e) {
		return reply(500, { error: e?.message || String(e) })
	}
}

async function handlePost(body, ctx) {
	const b = parseBody(body) || {}
	if (typeof b.enable !== 'boolean') return reply(400, { error: '"enable" (true | false) required' })
	try {
		const backupDir = writeBackup(ctx)
		const cm = ctx.configManager
		const base = cm ? cm.get() : ctx.config
		const cs = { ...(base.casparServer || {}) }
		if (b.enable) cs[xs.FLAG_KEY] = true
		else delete cs[xs.FLAG_KEY]
		if (cm) {
			cm.save({ ...base, casparServer: cs })
			Object.assign(ctx.config, cm.get())
		} else Object.assign(ctx.config, { casparServer: cs })
		if (!b.enable && ctx.config.casparServer) delete ctx.config.casparServer[xs.FLAG_KEY]
		if (typeof ctx.log === 'function') ctx.log('info', `[WO-906] playout X screen ${b.enable ? 'on' : 'off'}`)
		if (b.apply === false || ctx.config?.offline_mode) return reply(200, { ok: true, enabled: b.enable, backupDir, apply: null })
		const { applyCasparConfigToDiskAndRestart } = require('./routes-caspar-config')
		const res = await applyCasparConfigToDiskAndRestart(ctx, { force: true })
		let apply
		try {
			apply = { status: res.status, ...JSON.parse(res.body) }
		} catch {
			apply = { status: res.status }
		}
		delete apply.fullApply
		const ok = apply.status === 200
		return reply(ok ? 200 : 502, { ok, enabled: b.enable, backupDir, installed: xs.installedScreens(), apply })
	} catch (e) {
		if (typeof ctx.log === 'function') ctx.log('error', `[WO-906] playout-screen: ${e?.stack || e}`)
		return reply(500, { ok: false, error: e?.message || String(e) })
	}
}

module.exports = { handleGet, handlePost }

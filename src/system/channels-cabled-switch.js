'use strict'

/**
 * WO-1029 plan 07 (C12) — the "Channels only for the screens cabled here" switch, device-local. Mirrors the WO-868
 * operator-first switch (operator-first-switch.js) without its restart:
 *
 *   1. plan (channels-cabled-plan.js) — refuse on any refusal (`force` overrides only the forceable ones); a no-op returns
 *   2. backup of the persisted state + config into ~/.highascg/backup/wo1029-cwc-<UTC>/
 *   3. persisted channel-keyed state remapped by role (vanished channels dropped), config slices that hold channel numbers
 *   4. the flag `cluster.channelsWhereCabled` written through the config manager (the settings save path — it keeps
 *      `cluster` because the save spreads the stored config)
 *   5. the server marked "restart needed": the normal Apply (cluster apply) restarts Caspar. The switch NEVER restarts it
 *      and never writes casparcg.config; the Apply's air snapshot carries content across by destination.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { planChannelsCabled, publicPlan, withFlag } = require('./channels-cabled-plan')

function writeBackup(ctx, persistence) {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-')
	const dir = path.join(process.env.HOME || os.homedir(), '.highascg', 'backup', `wo1029-cwc-${stamp}`)
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
	try {
		persistence.flushSync?.()
	} catch {
		/* best effort */
	}
	fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(persistence.getAll ? persistence.getAll() : {}, null, 1), { mode: 0o600 })
	const cm = ctx.configManager
	fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cm ? cm.get() : ctx.config, null, 1), { mode: 0o600 })
	return dir
}

/**
 * @param {object} ctx
 * @param {{ enable: boolean, force?: boolean, log?: (level: string, msg: string) => void }} opts
 */
async function runChannelsCabledSwitch(ctx, opts) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const enable = opts.enable === true
	const plan = planChannelsCabled(ctx, { enable, includeProjects: false })
	const blocking = plan.refusals.filter((r) => !(r.forceable && opts.force === true))
	if (blocking.length) return { ok: false, status: 409, error: blocking.map((r) => r.message).join(' '), plan: publicPlan(plan) }
	if (plan.noop) return { ok: true, status: 200, noop: true, plan: publicPlan(plan) }
	const persistence = ctx.persistence || require('../utils/persistence')
	const backupDir = writeBackup(ctx, persistence)
	log('info', `[WO-1029] channels where cabled → ${enable ? 'ON' : 'OFF'}: backup ${backupDir}; remap ${JSON.stringify(plan.remap)}`)

	for (const [key, value] of Object.entries(plan._state.next)) {
		persistence.set(key, value)
		if (key === 'programLayerBankByChannel' && ctx.liveDeck?.replaceProgramLayerBanks) {
			ctx.liveDeck.replaceProgramLayerBanks(value)
			ctx.liveDeck.persistProgramLayerBanks?.()
		}
		if (key === 'multiviewLayout') ctx._multiviewLayout = value
	}
	const cm = ctx.configManager
	const base = cm ? cm.get() : ctx.config
	const next = withFlag({ ...base, ...plan._configPatch }, enable)
	if (cm) {
		cm.save(next)
		Object.assign(ctx.config, cm.get())
	} else Object.assign(ctx.config, next)
	try {
		persistence.flushSync?.()
	} catch {
		/* best effort */
	}
	// the generated config differs on disk already (caspar-config-dirty.js `unwritten`); this keeps "restart needed" even
	// when only the shape of the map changed. Cleared by a good Apply.
	try {
		require('../config/caspar-config-dirty').markRestartPending(ctx, 'channels where cabled switched')
	} catch (e) {
		log('warn', `[WO-1029] could not mark the restart pending: ${e?.message || e}`)
	}
	if (typeof ctx._wsBroadcast === 'function') {
		try {
			ctx._wsBroadcast('change', { path: 'cluster.channelsWhereCabled', value: { enabled: enable, backupDir } })
		} catch {
			/* optional */
		}
	}
	return { ok: true, status: 200, on: enable, plan: publicPlan(plan), backupDir, persistenceKeys: plan._state.keys, configSlices: Object.keys(plan._configPatch), restartNeeded: true }
}

module.exports = { runChannelsCabledSwitch }

'use strict'

const fs = require('fs')
const { isHostLiveSource, listHostLiveChannelEntries } = require('./host-live-sources')
const { buildConfigXml } = require('./config-generator')
const { buildCasparGeneratorFlatConfig } = require('./build-caspar-generator-config')

/**
 * @param {string} xml
 * @returns {number}
 */
function maxCasparChannelInXml(xml) {
	const nums = []
	for (const m of String(xml || '').matchAll(/<!-- HighAsCG: Caspar channel (\d+):/g)) {
		const n = parseInt(m[1], 10)
		if (Number.isFinite(n)) nums.push(n)
	}
	return nums.length ? Math.max(...nums) : 0
}

/**
 * @param {object} ctx
 */
function readAppliedCasparMaxChannel(ctx) {
	try {
		const { resolveCasparConfigWritePath } = require('../api/routes-caspar-config')
		const p = resolveCasparConfigWritePath(ctx)
		if (!p || !fs.existsSync(p)) return 0
		return maxCasparChannelInXml(fs.readFileSync(p, 'utf8'))
	} catch (_) {
		return 0
	}
}

/**
 * @param {object} config
 */
function requiredHostLiveMaxChannel(config) {
	const entries = listHostLiveChannelEntries(config)
	if (!entries.length) return 0
	return Math.max(...entries.map((e) => e.channel))
}

/**
 * @param {object} ctx
 */
function hostLiveCasparChannelsOutOfDate(ctx) {
	const config = ctx?.config || {}
	const required = requiredHostLiveMaxChannel(config)
	if (required <= 0) return { needed: false, required, applied: readAppliedCasparMaxChannel(ctx) }
	const flat = buildCasparGeneratorFlatConfig(config)
	const generatedMax = maxCasparChannelInXml(buildConfigXml(flat))
	const applied = readAppliedCasparMaxChannel(ctx)
	return {
		needed: generatedMax > applied || required > applied,
		required,
		generatedMax,
		applied,
	}
}

/**
 * Regenerate casparcg.config and restart Caspar when host live channels are missing from disk.
 * @param {object} ctx
 */
async function applyCasparConfigForHostLiveIfNeeded(ctx) {
	const check = hostLiveCasparChannelsOutOfDate(ctx)
	if (!check.needed) {
		return { ok: true, applied: false, ...check }
	}
	if (ctx?.config?.offline_mode) {
		return { ok: false, applied: false, reason: 'offline_mode', ...check }
	}
	const { applyCasparConfigToDiskAndRestart } = require('../api/routes-caspar-config')
	const res = await applyCasparConfigToDiskAndRestart(ctx, {})
	const body = res?.body ? JSON.parse(res.body) : {}
	return {
		ok: res?.status === 200 && body.ok !== false,
		applied: true,
		status: res?.status,
		restartSent: body.restartSent,
		reconnected: body.reconnected,
		...check,
		message: body.message || body.error,
	}
}

module.exports = {
	maxCasparChannelInXml,
	hostLiveCasparChannelsOutOfDate,
	applyCasparConfigForHostLiveIfNeeded,
	requiredHostLiveMaxChannel,
}

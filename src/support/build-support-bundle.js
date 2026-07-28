'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const logBuffer = require('../utils/log-buffer')
const { redactObject, listRedactedKeyPatterns } = require('./redact-settings')
const { buildZipStore } = require('./zip-store')
const { buildGpuDisplaySnapshot } = require('./gpu-display-snapshot')
const { tailFileLines, resolveCasparLogPath } = require('../api/routes-logs')
const { readSystemInventoryFile } = require('../bootstrap/system-inventory-file')
const { buildNetworkStatus } = require('../system/network-inventory')
const { normalizeNetworkSettings } = require('../config/network-settings')
const { loadFullProject } = require('../engine/project-scenes')
const { buildConfigXml, mergeAudioRoutingIntoConfig } = require('../config/config-generator')
const { REPO_ROOT } = require('../repo-paths')

const SCHEMA_VERSION = 1

/**
 * @returns {string|null}
 */
function readBuildStamp() {
	const candidates = [
		path.join(REPO_ROOT, 'BUILD_STAMP'),
		path.join(REPO_ROOT, '.highascg-build-stamp'),
	]
	for (const p of candidates) {
		try {
			if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim() || null
		} catch {
			/* ignore */
		}
	}
	return null
}

/**
 * @param {object} ctx
 */
async function readOscDiagnostics(ctx) {
	try {
		const routesOsc = require('../api/routes-osc')
		if (typeof routesOsc.handleGet !== 'function') return null
		const res = await routesOsc.handleGet('/api/osc/diagnostics', ctx)
		if (res?.body) return JSON.parse(String(res.body))
	} catch {
		/* optional */
	}
	return null
}

/**
 * @param {object} ctx
 * @param {{ logLines?: number, casparLines?: number, operatorNote?: string }} [opts]
 */
async function buildSupportBundleFiles(ctx, opts = {}) {
	const logLines = Math.min(5000, Math.max(100, parseInt(String(opts.logLines || 5000), 10) || 5000))
	const casparLines = Math.min(3000, Math.max(100, parseInt(String(opts.casparLines || 2000), 10) || 2000))
	const config = ctx.config || {}
	const casparPath = resolveCasparLogPath()

	const records = logBuffer.getHighasRecords(logLines)
	const warnErrorText = records
		.filter((r) => r.level === 'warn' || r.level === 'error')
		.map((r) => r.line)
		.join('\n')

	let projectSummary = { active: false }
	try {
		const project = loadFullProject()
		if (project) {
			projectSummary = {
				active: true,
				id: project.id || null,
				name: project.name || null,
				sceneCount: Array.isArray(project.scenes) ? project.scenes.length : 0,
				scenes: Array.isArray(project.scenes)
					? project.scenes.slice(0, 200).map((s) => ({ id: s.id, name: s.name }))
					: [],
			}
		}
	} catch (e) {
		projectSummary = { active: false, error: e instanceof Error ? e.message : String(e) }
	}

	let casparXml
	try {
		const screenCount = typeof ctx.getChannelCount === 'function' ? ctx.getChannelCount() : 1
		casparXml = buildConfigXml(mergeAudioRoutingIntoConfig(config), screenCount)
	} catch (e) {
		casparXml = `<!-- failed to generate: ${e instanceof Error ? e.message : String(e)} -->`
	}

	let hostStats = null
	try {
		const { handleGet } = require('../api/routes-host-stats')
		const res = await handleGet(ctx)
		if (res?.body) hostStats = JSON.parse(String(res.body))
	} catch {
		hostStats = null
	}

	let inventory
	try {
		inventory = readSystemInventoryFile()
	} catch {
		inventory = null
	}

	const networkCfg = normalizeNetworkSettings(config.network, config.network)
	const network = buildNetworkStatus(networkCfg)

	let gpuDisplay
	try {
		gpuDisplay = await buildGpuDisplaySnapshot(ctx)
	} catch (e) {
		gpuDisplay = { error: e instanceof Error ? e.message : String(e) }
	}

	const oscDiagnostics = await readOscDiagnostics(ctx)
	const wsLogLineStats =
		typeof ctx._getWsLogLineStats === 'function' ? ctx._getWsLogLineStats() : { dropped: null, maxHz: null }

	const runtime = {
		casparConnected: !!(ctx._casparStatus?.connected ?? ctx.amcp?.isConnected?.()),
		offlineMode: !!config.offline_mode,
		replicationRole: ctx._replicationRuntime?.role || null,
		streamingTier: config.streaming?.tier || null,
		uptimeSec: Math.floor(process.uptime()),
		osc: oscDiagnostics,
		wsLogLine: wsLogLineStats,
	}

	const manifest = {
		kind: 'highascg-support-bundle',
		schemaVersion: SCHEMA_VERSION,
		createdAt: new Date().toISOString(),
		hostname: os.hostname(),
		buildStamp: readBuildStamp(),
		packageVersion: require('../../package.json').version,
		operatorNote: opts.operatorNote ? String(opts.operatorNote).slice(0, 2000) : null,
		redactedKeyPatterns: listRedactedKeyPatterns(),
		logBufferLineCount: records.length,
		wsLogLineDropped: wsLogLineStats?.dropped ?? null,
		files: [],
		runtime,
	}

	const files = {
		'manifest.json': JSON.stringify(manifest, null, 2),
		'logs/highascg.jsonl': records.map((r) => JSON.stringify(r)).join('\n'),
		'logs/highascg-warn-error.txt': warnErrorText || '(no warn/error lines in buffer)',
		'logs/caspar-tail.txt': tailFileLines(casparPath, casparLines, 1024 * 1024).join('\n'),
		'config/highascg-redacted.json': JSON.stringify(redactObject(config), null, 2),
		'config/caspar-server.xml': casparXml,
		'project/project-summary.json': JSON.stringify(projectSummary, null, 2),
		'system/inventory.json': JSON.stringify(inventory || { missing: true }, null, 2),
		'system/network.json': JSON.stringify(network, null, 2),
		'system/gpu-display.json': JSON.stringify(gpuDisplay || { missing: true }, null, 2),
		'runtime/status.json': JSON.stringify(runtime, null, 2),
		'runtime/host-stats.json': JSON.stringify(hostStats || { missing: true }, null, 2),
	}

	manifest.files = Object.keys(files).map((name) => ({
		path: name,
		bytes: Buffer.byteLength(files[name], 'utf8'),
	}))
	files['manifest.json'] = JSON.stringify(manifest, null, 2)

	return { files, manifest, filename: `highascg-support_${os.hostname()}_${manifest.createdAt.replace(/[:.]/g, '-')}.zip` }
}

/**
 * @param {object} ctx
 * @param {{ logLines?: number, casparLines?: number, operatorNote?: string }} [opts]
 */
async function buildSupportBundleZip(ctx, opts = {}) {
	const { files, filename } = await buildSupportBundleFiles(ctx, opts)
	const maxBytes = parseInt(process.env.HIGHASCG_SUPPORT_BUNDLE_MAX_BYTES || String(25 * 1024 * 1024), 10) || 25 * 1024 * 1024
	let total = 0
	for (const content of Object.values(files)) {
		total += Buffer.byteLength(String(content), 'utf8')
	}
	if (total > maxBytes) {
		throw new Error(`Support bundle would exceed ${maxBytes} bytes (${total}). Reduce log line counts.`)
	}
	return { buffer: buildZipStore(files), filename }
}

module.exports = { buildSupportBundleFiles, buildSupportBundleZip, readBuildStamp }

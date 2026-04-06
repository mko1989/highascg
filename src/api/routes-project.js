/**
 * Project Sync Routes: Reconciliation and Commitment of offline drafts.
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const liveSceneState = require('../state/live-scene-state')
const { runSceneTake, layerHasContent } = require('../engine/scene-transition')
const fs = require('fs')
const path = require('path')
const { getMediaIngestBasePath, scanMediaRecursiveForBrowser } = require('../media/local-media')
const persistence = require('../utils/persistence')
const { buildConfigXml, mergeAudioRoutingIntoConfig } = require('../config/config-generator')
const { resolveCasparConfigWritePath } = require('./routes-caspar-config')

/**
 * Reconciliation report: compares draft assets with live index.
 * @param {object} ctx - app context
 */
async function handleReconcile(ctx) {
	if (!ctx.amcp) {
		return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
	}

	const live = liveSceneState.getAll()
	const missingMedia = new Set()
	const missingTemplates = new Set()
	const usedMedia = new Set()
	const usedTemplates = new Set()

	// 1. Collect used assets from all channels
	for (const chKey of Object.keys(live)) {
		const entry = live[chKey]
		if (!entry?.scene?.layers) continue

		for (const layer of entry.scene.layers) {
			if (!layerHasContent(layer)) continue
			
			const val = String(layer.value || '')
			if (val.startsWith('route://')) continue
			
			// Simple heuristic: if it has an extension or is in CHOICES_MEDIAFILES, it's media
			// If it's in CHOICES_TEMPLATES, it's a template
			
			const isMedia = ctx.CHOICES_MEDIAFILES?.some(m => m.id === val)
			const isTemplate = ctx.CHOICES_TEMPLATES?.some(t => t.id === val)
			
			if (isMedia) usedMedia.add(val)
			else if (isTemplate) usedTemplates.add(val)
			else {
				// Ambiguous or missing from both caches? 
				// We'll treat as media by default for the report if it looks like a filename
				if (val.includes('.') || val.includes('\\\\') || val.includes('/')) {
					usedMedia.add(val)
				} else if (val) {
					usedTemplates.add(val)
				}
			}
		}
	}

	// 2. Check existence in actual server index (if possible)
	// Note: amcp.query.cls() / tls() might be needed if state is stale
	const mediaIndex = new Set((ctx.state?.getState()?.media || []).map(m => m.id))
	const templateIndex = new Set((ctx.state?.getState()?.templates || []).map(t => t.id))

	for (const m of usedMedia) if (!mediaIndex.has(m)) missingMedia.add(m)
	for (const t of usedTemplates) if (!templateIndex.has(t)) missingTemplates.add(t)

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			ok: true,
			reconciliation: {
				usedMedia: Array.from(usedMedia),
				usedTemplates: Array.from(usedTemplates),
				missingMedia: Array.from(missingMedia),
				missingTemplates: Array.from(missingTemplates),
				isClean: missingMedia.size === 0 && missingTemplates.size === 0
			}
		})
	}
}

/**
 * Sync Draft to Live playout.
 * @param {object} ctx
 */
async function handleSyncPush(ctx) {
	if (!ctx.amcp) {
		return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
	}

	const live = liveSceneState.getAll()
	const results = []

	// Perform a Take for every channel currently in the draft bank
	for (const chKey of Object.keys(live)) {
		const channel = parseInt(chKey, 10)
		const entry = live[chKey]
		if (!channel || !entry?.scene) continue

		try {
			await runSceneTake(ctx.amcp, {
				channel,
				self: ctx,
				currentScene: null, // Force full refresh
				incomingScene: entry.scene,
				forceCut: true
			})
			results.push({ channel, ok: true })
		} catch (e) {
			results.push({ channel, ok: false, error: e.message })
		}
	}

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			ok: results.every(r => r.ok),
			results
		})
	}
}

async function handleManifestDiff(body, ctx) {
	let incomingManifest = []
	try {
		const parsed = typeof body === 'string' ? JSON.parse(body) : body
		incomingManifest = parsed.mediaManifest || []
	} catch (e) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid body' }) }
	}

	const config = ctx.config || {}
	const mediaBase = getMediaIngestBasePath(config)
	const requiredMedia = []

	for (const item of incomingManifest) {
		if (!item.path || item.path.includes('..')) continue

		const fullPath = path.join(mediaBase, item.path)
		try {
			if (!fs.existsSync(fullPath)) {
				requiredMedia.push(item.path)
			} else {
				const stat = fs.statSync(fullPath)
				if (stat.size !== item.size) {
					requiredMedia.push(item.path)
				}
			}
		} catch (e) {
			requiredMedia.push(item.path)
		}
	}

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ requiredMedia })
	}
}

async function handleApplyBundle(body, ctx) {
	let payload = {}
	try {
		payload = typeof body === 'string' ? JSON.parse(body) : body
	} catch (e) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid bundle payload' }) }
	}

	// 1. Update Persistence State
	if (payload.state && typeof payload.state === 'object') {
		const currentKeys = Object.keys(persistence.getAll())
		for (const k of currentKeys) persistence.remove(k)
		for (const [k, v] of Object.entries(payload.state)) {
			persistence.set(k, v)
		}
	}

	// 2. Update CasparCG Config XML
	if (payload.casparcgConfig && typeof payload.casparcgConfig === 'string') {
		const filePath = resolveCasparConfigWritePath(ctx)
		if (filePath) {
			try {
				await fs.promises.mkdir(path.dirname(filePath), { recursive: true }).catch(() => {})
				await fs.promises.writeFile(filePath, payload.casparcgConfig, 'utf8')
			} catch (e) {
				console.warn('[Sync] Failed to write caspar config:', e.message)
			}
		}
	}

	// 3. Update HighAsCG Config
	if (payload.config && typeof payload.config === 'object' && ctx.configManager) {
		try {
			// Do not overwrite localhost specific settings with remote preshow server settings like binding address
			const newConfig = { ...payload.config }
			// Delete machine-specific transient overrides if necessary, or just force save
			if (ctx.config?.server) newConfig.server = ctx.config.server
			
			// Crucially: clear offline mode when applying to production server
			newConfig.offline_mode = false
			
			ctx.configManager.save(newConfig)
			// Trigger a hard app restart (via pm2/systemctl if it exits)
			setTimeout(() => process.exit(0), 1000)
		} catch (e) {
			console.warn('[Sync] Failed to save HighAsCG config:', e.message)
		}
	}

	// Tell Caspar to Restart optionally
	if (ctx.amcp) {
		try {
			await ctx.amcp.query.restart()
		} catch (e) {}
	}

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, message: 'Bundle applied. HighAsCG and CasparCG restarting.' })
	}
}

async function handlePost(requestPath, body, ctx) {
	if (requestPath === '/api/project/reconcile') return handleReconcile(ctx)
	if (requestPath === '/api/project/sync') return handleSyncPush(ctx)
	if (requestPath === '/api/project/diff') return handleManifestDiff(body, ctx)
	if (requestPath === '/api/project/apply-bundle') return handleApplyBundle(body, ctx)
	return null
}

async function handleBundle(ctx) {
	const config = ctx.config || {}
	const state = persistence.getAll() || {}
	
	const screenCount = ctx.getChannelCount ? ctx.getChannelCount() : 1
	const mergedConfig = mergeAudioRoutingIntoConfig(config)
	const casparcgConfig = buildConfigXml(mergedConfig, screenCount)
	
	const mediaBase = getMediaIngestBasePath(config)
	const mediaManifest = []
	if (mediaBase && fs.existsSync(mediaBase)) {
		const files = scanMediaRecursiveForBrowser(mediaBase, 20000)
		for (const relPath of files) {
			const fullPath = path.join(mediaBase, relPath)
			try {
				const stat = fs.statSync(fullPath)
				if (stat.isFile()) {
					mediaManifest.push({
						path: relPath,
						size: stat.size,
						mtime: stat.mtimeMs
					})
				}
			} catch (e) {
				// skip
			}
		}
	}

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			config,
			state,
			casparcgConfig,
			mediaManifest
		})
	}
}

async function handleGet(pathStr, query, ctx) {
	if (pathStr === '/api/project/bundle') return handleBundle(ctx)
	return null
}

module.exports = { handlePost, handleGet }

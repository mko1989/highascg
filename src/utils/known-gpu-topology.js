'use strict'

const fs = require('fs')
const path = require('path')

/** Fallback key in data/known-gpus.json when no GPU model matches. */
const GENERIC_GPU_KEY = '__generic__'

let cachedKnown = null

function loadKnownGpus() {
	if (cachedKnown) return cachedKnown
	try {
		const { REPO_ROOT } = require('../repo-paths')
		const knownPath = path.join(REPO_ROOT, 'data/known-gpus.json')
		if (fs.existsSync(knownPath)) {
			cachedKnown = JSON.parse(fs.readFileSync(knownPath, 'utf8'))
			return cachedKnown
		}
	} catch (e) {
		console.error(`[known-gpu-topology] Failed to load known-gpus.json:`, e.message)
	}
	cachedKnown = {}
	return cachedKnown
}

/** Last-resort inline table when known-gpus.json is missing or empty. */
function inlineGenericFallback() {
	return [
		{ physicalPortId: 'gpu_p0', slotOrder: 0, dpA: 'DP-0', dpB: 'DP-1', connectorNumber: 0, location: 0 },
		{ physicalPortId: 'gpu_p1', slotOrder: 1, dpA: 'HDMI-0', dpB: 'HDMI-1', connectorNumber: 1, location: 1 },
		{ physicalPortId: 'gpu_p2', slotOrder: 2, dpA: 'DP-2', dpB: 'DP-3', connectorNumber: 2, location: 2 },
		{ physicalPortId: 'gpu_p3', slotOrder: 3, dpA: 'DP-4', dpB: 'DP-5', connectorNumber: 3, location: 3 },
	]
}

/**
 * Default rear-panel topology for a GPU model (or generic RTX 20/30 template).
 * @param {string | null | undefined} gpuModel
 * @returns {object[]}
 */
function resolveDefaultTopologyForGpu(gpuModel) {
	const known = loadKnownGpus()
	const model = String(gpuModel || '').trim()
	if (model && Array.isArray(known[model]) && known[model].length) {
		return known[model].map((row) => ({ ...row }))
	}
	if (model) {
		const lower = model.toLowerCase()
		for (const [key, rows] of Object.entries(known)) {
			if (key === GENERIC_GPU_KEY || !Array.isArray(rows) || !rows.length) continue
			const kl = key.toLowerCase()
			if (lower.includes(kl) || kl.includes(lower)) {
				return rows.map((row) => ({ ...row }))
			}
		}
	}
	if (Array.isArray(known[GENERIC_GPU_KEY]) && known[GENERIC_GPU_KEY].length) {
		return known[GENERIC_GPU_KEY].map((row) => ({ ...row }))
	}
	return inlineGenericFallback()
}

/**
 * @param {string | null | undefined} gpuModel
 * @returns {number}
 */
function resolveSocketCountForGpu(gpuModel) {
	return resolveDefaultTopologyForGpu(gpuModel).length
}

module.exports = {
	GENERIC_GPU_KEY,
	loadKnownGpus,
	inlineGenericFallback,
	resolveDefaultTopologyForGpu,
	resolveSocketCountForGpu,
}

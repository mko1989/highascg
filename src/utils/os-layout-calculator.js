'use strict'

const { buildMappingGpuLayoutArtifacts } = require('./mapping-gpu-os-layout')
const logger = require('./logger').defaultLogger
const { collectGpuLayoutAssignments } = require('./os-layout-calculator-assign')
const { mergeMappingGpuOutputsWithScreens, recomputeMappingGpuBBox } = require('./os-layout-calculator-helpers')
const { isOperatorGuiFirst } = require('../config/operator-gui-first')
const { applyMappingGpuPlacementOffsets } = require('./os-layout-calculator-offset')
const { computePlacedLayoutResults } = require('./os-layout-calculator-place')

function logLayoutPlan(results) {
	try {
		const screenEntries = Object.entries(results.screens)
		const mvEntries = Object.entries(results.multiview)
		const ogEntries = Object.entries(results.operatorGui || {})
		const mapEntries = Array.isArray(results.mappingGpuOutputs) ? results.mappingGpuOutputs : []
		if (screenEntries.length === 0 && mvEntries.length === 0 && ogEntries.length === 0 && mapEntries.length === 0) {
			logger.info('[OS-Config] Layout plan: no assigned outputs')
		} else {
			for (const info of mapEntries) {
				logger.info(
					`[OS-Config] Layout mapping→GPU: id=${info.sysId} node=${info.nodeId} mode=${info.mode} pos=${info.x},${info.y} size=${info.width}x${info.height} backend=${info.backend}${info.rate != null ? ` rate=${info.rate}` : ''}`,
				)
			}
			for (const [idx, info] of screenEntries) {
				logger.info(
					`[OS-Config] Layout screen_${idx}: id=${info.sysId} mode=${info.mode} pos=${info.x},${info.y} size=${info.width}x${info.height} backend=${info.backend}${info.rate != null ? ` rate=${info.rate}` : ''}`,
				)
			}
			for (const [idx, info] of mvEntries) {
				logger.info(
					`[OS-Config] Layout multiview_${idx}: id=${info.sysId} mode=${info.mode} pos=${info.x},${info.y} size=${info.width}x${info.height} backend=${info.backend}${info.rate != null ? ` rate=${info.rate}` : ''}`,
				)
			}
			for (const [idx, info] of ogEntries) {
				logger.info(
					`[OS-Config] Layout operator_gui_${idx}: id=${info.sysId} mode=${info.mode} pos=${info.x},${info.y} size=${info.width}x${info.height} backend=${info.backend}${info.rate != null ? ` rate=${info.rate}` : ''}`,
				)
			}
			for (const [idx, info] of Object.entries(results.prv || {})) {
				logger.info(
					`[OS-Config] Layout prv_${idx} (WO-364): id=${info.sysId} mode=${info.mode} pos=${info.x},${info.y} size=${info.width}x${info.height} backend=${info.backend}${info.rate != null ? ` rate=${info.rate}` : ''}`,
				)
			}
			if (results.mappingGpuBBox) {
				const b = results.mappingGpuBBox
				logger.info(
					`[OS-Config] Layout mapping GPU bbox: ${b.minX},${b.minY} → ${b.maxX},${b.maxY} (for downstream placement / WO-40a)`,
				)
			}
		}
	} catch (_) {}
}

/** Width the operator GUI heads take at the left edge when "Operator GUI first" is on (computePlacedLayoutResults put them at 0). */
function operatorFirstLead(config, results) {
	if (!isOperatorGuiFirst(config)) return 0
	let lead = 0
	for (const info of Object.values(results.operatorGui || {})) {
		if (info && Number.isFinite(info.x) && Number.isFinite(info.width)) lead = Math.max(lead, info.x + info.width)
	}
	return lead
}

function calculateLayoutPositions(config) {
	const assignments = collectGpuLayoutAssignments(config)
	const results = computePlacedLayoutResults(config, assignments)

	let { mappingGpuOutputs } = buildMappingGpuLayoutArtifacts(config)
	let mappingGpuBBox
	;({ mappingGpuOutputs, mappingGpuBBox } = mergeMappingGpuOutputsWithScreens(config, results, mappingGpuOutputs))

	/* WO-868 × WO-869: with "Operator GUI first" the operator monitor keeps the left edge and the pixel-mapping canvas
	 * starts right of it; the mapping rows and every slice window move by this lead (layout-sync shifts the windows). */
	const lead = mappingGpuOutputs.length ? operatorFirstLead(config, results) : 0
	if (lead > 0) {
		mappingGpuOutputs = mappingGpuOutputs.map((r) => ({ ...r, x: r.x + lead }))
		mappingGpuBBox = recomputeMappingGpuBBox(mappingGpuOutputs)
	}

	applyMappingGpuPlacementOffsets(
		config,
		results,
		mappingGpuBBox,
		mappingGpuOutputs,
		assignments.operatorScreenAssignments,
		assignments.graphHasDestinationGpuBinding,
		lead,
	)

	results.mappingGpuOutputs = mappingGpuOutputs
	results.mappingGpuBBox = mappingGpuBBox
	if (lead > 0) results.mappingCanvasOffsetX = lead  // absent otherwise: the pre-WO-868 layout goldens stay byte-identical

	logLayoutPlan(results)
	return results
}

module.exports = { calculateLayoutPositions }

'use strict'

const { buildMappingGpuLayoutArtifacts } = require('./mapping-gpu-os-layout')
const logger = require('./logger').defaultLogger
const { collectGpuLayoutAssignments } = require('./os-layout-calculator-assign')
const { mergeMappingGpuOutputsWithScreens } = require('./os-layout-calculator-helpers')
const { applyMappingGpuPlacementOffsets } = require('./os-layout-calculator-offset')
const { computePlacedLayoutResults } = require('./os-layout-calculator-place')

function logLayoutPlan(results) {
	try {
		const screenEntries = Object.entries(results.screens)
		const mvEntries = Object.entries(results.multiview)
		const mapEntries = Array.isArray(results.mappingGpuOutputs) ? results.mappingGpuOutputs : []
		if (screenEntries.length === 0 && mvEntries.length === 0 && mapEntries.length === 0) {
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
			if (results.mappingGpuBBox) {
				const b = results.mappingGpuBBox
				logger.info(
					`[OS-Config] Layout mapping GPU bbox: ${b.minX},${b.minY} → ${b.maxX},${b.maxY} (for downstream placement / WO-40a)`,
				)
			}
		}
	} catch (_) {}
}

function calculateLayoutPositions(config) {
	const assignments = collectGpuLayoutAssignments(config)
	const results = computePlacedLayoutResults(config, assignments)

	let { mappingGpuOutputs, mappingGpuBBox } = buildMappingGpuLayoutArtifacts(config)
	;({ mappingGpuOutputs, mappingGpuBBox } = mergeMappingGpuOutputsWithScreens(config, results, mappingGpuOutputs))

	applyMappingGpuPlacementOffsets(
		config,
		results,
		mappingGpuBBox,
		mappingGpuOutputs,
		assignments.operatorScreenAssignments,
		assignments.graphHasDestinationGpuBinding,
	)

	results.mappingGpuOutputs = mappingGpuOutputs
	results.mappingGpuBBox = mappingGpuBBox

	logLayoutPlan(results)
	return results
}

module.exports = { calculateLayoutPositions }

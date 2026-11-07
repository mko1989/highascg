'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')
const { checkXrandrLayout, calculateLayoutPositions } = require('../utils/os-config')
const { plannedHeadsFromLayout, needsNodmRestartForLayout } = require('../utils/xrandr-layout-verify')

/**
 * @param {*} ctx
 */
function handleXrandrLayoutGet(ctx) {
	const layout = calculateLayoutPositions(ctx.config)
	const check = checkXrandrLayout(ctx.config)
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			ok: check.ok,
			planned: plannedHeadsFromLayout(layout),
			mismatches: check.mismatches,
			actual: check.actual,
			canvas: needsNodmRestartForLayout(ctx.config, { layout }), // WO-919: what an Apply would do (nodm? unplugged / moved heads)
		}),
	}
}

module.exports = { handleXrandrLayoutGet }

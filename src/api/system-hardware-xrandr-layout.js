'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')
const { checkXrandrLayout, applyX11Layout, calculateLayoutPositions } = require('../utils/os-config')
const { plannedHeadsFromLayout } = require('../utils/xrandr-layout-verify')

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
		}),
	}
}

/**
 * @param {*} ctx
 */
function handleXrandrLayoutApplyPost(ctx) {
	const res = applyX11Layout(ctx.config)
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			ok: !!res.applied,
			layoutApplied: !!res.applied,
			layoutPersisted: !!res.persisted,
			xrandrCommand: res.xrandrCommand || null,
			verify: res.verify || null,
		}),
	}
}

module.exports = { handleXrandrLayoutGet, handleXrandrLayoutApplyPost }

'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')
const { describeOperatorDisplay } = require('../utils/x-display-session')
const { isPointerConfineActive } = require('../system/pointer-confine')

/**
 * @param {*} ctx
 */
async function operatorDisplayGet(ctx) {
	const info = describeOperatorDisplay(ctx.config || {})
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			...info,
			confineActive: isPointerConfineActive(),
		}),
	}
}

module.exports = { operatorDisplayGet }

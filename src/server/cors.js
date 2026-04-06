'use strict'

/** @type {Record<string, string>} */
const BASE = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function corsHeaders() {
	return { ...BASE }
}

/** @param {Record<string, string> | undefined} extra */
function mergeCors(extra) {
	return { ...BASE, ...(extra || {}) }
}

module.exports = { BASE, corsHeaders, mergeCors }

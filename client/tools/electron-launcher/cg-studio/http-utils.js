'use strict'

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }

function jsonBody(obj) {
	return JSON.stringify(obj)
}

module.exports = { JSON_HEADERS, jsonBody }

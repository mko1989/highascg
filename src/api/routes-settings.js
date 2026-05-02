/**
 * Settings API Router.
 */
'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')
const { getDisplayDetails } = require('../utils/hardware-info')
const Get = require('./settings-get')
const Post = require('./settings-post')
const OS = require('./settings-os')

async function handleGet(path, ctx) {
	return Get.handleGet(path, ctx)
}

async function handleHardwareGet(path) {
	if (path === '/api/hardware/displays') {
		try { const displays = getDisplayDetails(); return { status: 200, headers: JSON_HEADERS, body: jsonBody({ displays }) } } catch { return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: 'Failed to enum displays' }) } }
	}
	return null
}

async function handlePost(path, body, ctx) {
	return Post.handlePost(path, body, ctx)
}

async function handleOsPost(path, body, ctx) {
	return OS.handleOsPost(path, body, ctx)
}

module.exports = { handleGet, handlePost, handleHardwareGet, handleOsPost }

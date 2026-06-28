'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { normalizeNetworkSettings, isAllowedEthernetIface, isValidIpv4 } = require('../config/network-settings')
const { buildNetworkStatus } = require('../system/network-inventory')

const APPLY_SCRIPT = '/usr/local/lib/highascg/highascg-network-apply.sh'
const RESET_SCRIPT = '/usr/local/lib/highascg/highascg-network-reset.sh'
const REPO_APPLY_SCRIPT = path.join(__dirname, '../../tools/runtime/highascg-network-apply.sh')
const REPO_RESET_SCRIPT = path.join(__dirname, '../../tools/runtime/highascg-network-reset.sh')

/**
 * @param {object} ctx
 */
function handleNetworkGet(ctx) {
	const networkCfg = normalizeNetworkSettings(ctx.config?.network, ctx.config?.network)
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody(buildNetworkStatus(networkCfg)),
	}
}

/**
 * @param {string} body
 * @param {object} ctx
 */
function handleNetworkApplyPost(body, ctx) {
	const b = parseBody(body)
	if (!b || typeof b !== 'object') {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid JSON body' }) }
	}
	const prev = normalizeNetworkSettings(ctx.config?.network, ctx.config?.network)
	const network = normalizeNetworkSettings(
		{
			primaryInterface: b.interface ?? b.primaryInterface ?? prev.primaryInterface,
			mode: b.mode ?? prev.mode,
			static: { ...prev.static, ...(b.static && typeof b.static === 'object' ? b.static : {}) },
		},
		prev,
	)
	const iface = network.primaryInterface
	if (!iface || !isAllowedEthernetIface(iface)) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid or missing Ethernet interface' }) }
	}
	if (network.mode === 'static') {
		const { address, prefixLength, gateway } = network.static
		if (!isValidIpv4(address)) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid static IPv4 address' }) }
		}
		if (gateway && !isValidIpv4(gateway)) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid gateway address' }) }
		}
		if (!Number.isFinite(prefixLength) || prefixLength < 1 || prefixLength > 32) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid prefix length' }) }
		}
	}

	const script = fs.existsSync(APPLY_SCRIPT) ? APPLY_SCRIPT : REPO_APPLY_SCRIPT
	if (!fs.existsSync(script)) {
		return {
			status: 503,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'Network apply helper not installed', script }),
		}
	}

	const args =
		network.mode === 'dhcp'
			? ['dhcp', iface]
			: [
				'static',
				iface,
				network.static.address,
				String(network.static.prefixLength),
				network.static.gateway || '',
				(network.static.dns && network.static.dns[0]) || '',
			]

	let log = ''
	try {
		log = execFileSync('sudo', ['-n', script, ...args], { encoding: 'utf8', timeout: 30000 })
	} catch (e) {
		const err = e && typeof e === 'object' ? e : {}
		const stderr = String(err.stderr || err.message || e)
		const needsSudo = /password|a password is required|not allowed/i.test(stderr)
		return {
			status: needsSudo ? 503 : 500,
			headers: JSON_HEADERS,
			body: jsonBody({
				error: needsSudo
					? 'Network apply requires passwordless sudo for highascg-network-apply.sh'
					: 'Network apply failed',
				log: stderr,
			}),
		}
	}

	if (ctx.config) {
		ctx.config.network = network
		if (ctx.configManager) {
			const cur = ctx.configManager.get()
			ctx.configManager.save({ ...cur, network })
		}
	}

	const status = buildNetworkStatus(network)
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, log, ...status }),
	}
}

/**
 * @param {string} body
 * @param {object} ctx
 */
function handleNetworkResetPost(body, ctx) {
	const b = parseBody(body)
	const prev = normalizeNetworkSettings(ctx.config?.network, ctx.config?.network)
	const ifaceRaw = b?.interface ?? b?.primaryInterface ?? prev.primaryInterface
	const iface = String(ifaceRaw || '').trim()
	if (iface && !isAllowedEthernetIface(iface)) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid Ethernet interface' }) }
	}

	const script = fs.existsSync(RESET_SCRIPT) ? RESET_SCRIPT : REPO_RESET_SCRIPT
	if (!fs.existsSync(script)) {
		return {
			status: 503,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'Network reset helper not installed', script }),
		}
	}

	const args = iface ? [iface] : []
	let log = ''
	try {
		log = execFileSync('sudo', ['-n', script, ...args], { encoding: 'utf8', timeout: 45000 })
	} catch (e) {
		const err = e && typeof e === 'object' ? e : {}
		const stderr = String(err.stderr || err.stdout || err.message || e)
		const needsSudo = /password|a password is required|not allowed/i.test(stderr)
		return {
			status: needsSudo ? 503 : 500,
			headers: JSON_HEADERS,
			body: jsonBody({
				error: needsSudo
					? 'Network reset requires passwordless sudo for highascg-network-reset.sh'
					: 'Network reset failed',
				log: stderr,
			}),
		}
	}

	const status = buildNetworkStatus(prev)
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, log, ...status }),
	}
}

module.exports = { handleNetworkGet, handleNetworkApplyPost, handleNetworkResetPost }

'use strict'

/**
 * WO-811 template credentials (owner 29.10: "why would a producer need a password???" and "The multiview overlay sends
 * the password through Caspar. Caspar's own log could then record it").
 *
 * The HTML templates that open the node's WebSocket from inside Caspar's CEF (multiview chrome, playback timers, shader
 * FFT tier) never get the shared password. They get this node's TEMPLATE KEY instead:
 * - a random value made when the node process starts, held only in memory (never on disk, never synced), so it is
 *   useless after the next node restart;
 * - put into the template by the node itself when it sends the template to Caspar (CG ADD data `templateKey`, or
 *   `#template_key=` on an own `/templates/…html` URL) — src/caspar/amcp-template-credential.js; no producer types it;
 * - accepted ONLY as `?template_key=` on the WebSocket upgrades templates use (`/api/ws`, `/api/video-feed`), never on
 *   an HTTP route, never as Bearer / cookie / `?token=`, and only from the Caspar host (`caspar.host`; when Caspar runs
 *   on this machine: loopback or one of this machine's own addresses);
 * - read-only on `/api/ws`: such a socket receives state and may ask `osc_resync`, nothing else (ws-server.js).
 * Only consulted while enforcement is ON (auth.checkWebSocketAuth); with it off nothing changes.
 */

const crypto = require('crypto')
const os = require('os')

const TEMPLATE_KEY_QUERY = 'template_key'
const TEMPLATE_KEY_FIELD = 'templateKey'
const KEY = crypto.randomBytes(32).toString('hex')

/** This node process's template key (new on every node start). */
function templateCredential() {
	return KEY
}

function bareAddress(a) {
	return String(a || '')
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, '')
		.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '')
}

function isLoopback(a) {
	const s = bareAddress(a)
	return s === '::1' || s === 'localhost' || /^127\./.test(s)
}

/** @returns {Set<string>} every address of this machine's interfaces */
function ownAddresses() {
	const out = new Set()
	try {
		for (const list of Object.values(os.networkInterfaces() || {})) {
			for (const i of list || []) if (i?.address) out.add(bareAddress(i.address))
		}
	} catch {
		/* no interfaces readable → loopback only */
	}
	return out
}

/** A host name / address that is this machine (loopback, its hostname, one of its interface addresses). */
function isOwnHost(host) {
	const h = bareAddress(host)
	if (!h) return false
	return isLoopback(h) || h === String(os.hostname() || '').toLowerCase() || ownAddresses().has(h)
}

/**
 * The upgrade comes from the machine Caspar runs on. Caspar on this machine (`caspar.host` loopback / own address /
 * hostname) → loopback or an own address; Caspar elsewhere → exactly that address.
 * @param {import('http').IncomingMessage} req
 * @param {object} config
 */
function isFromCasparHost(req, config) {
	const remote = bareAddress(req?.socket?.remoteAddress)
	if (!remote) return false
	const caspar = bareAddress(config?.caspar?.host || '127.0.0.1')
	if (isOwnHost(caspar)) return isLoopback(remote) || ownAddresses().has(remote)
	return remote === caspar
}

function requestTemplateKey(req) {
	try {
		return String(new URL(req?.url || '/', 'http://127.0.0.1').searchParams.get(TEMPLATE_KEY_QUERY) || '').trim()
	} catch {
		return ''
	}
}

/**
 * A WebSocket upgrade carrying this node's template key from the Caspar host.
 * @param {import('http').IncomingMessage} req
 * @param {object} config
 */
function isTemplateCredentialRequest(req, config) {
	const given = Buffer.from(requestTemplateKey(req), 'utf8')
	const want = Buffer.from(KEY, 'utf8')
	if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return false
	return isFromCasparHost(req, config)
}

/**
 * Templates that open the node WebSocket (template/*.js `wsAuthQuery`, template/shaders/player.js `initTierB`):
 * a Caspar template name (`shaders/<id>`, `multiview_master`, …) or a `/templates/…` path, `.html` optional.
 * @param {string} name
 */
function isWsTemplateName(name) {
	const n = String(name || '')
		.trim()
		.replace(/^"|"$/g, '')
		.replace(/^\/?templates\//i, '')
		.replace(/\.html$/i, '')
		.toLowerCase()
	return /^shaders\/[^\s/][^\s]*$/.test(n) || ['multiview_master', 'multiview_overlay', 'playback_timers'].includes(n)
}

module.exports = {
	TEMPLATE_KEY_QUERY,
	TEMPLATE_KEY_FIELD,
	templateCredential,
	isOwnHost,
	isTemplateCredentialRequest,
	isWsTemplateName,
}

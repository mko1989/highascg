'use strict'

/**
 * WO-1106 B1 — "may this request change installed code?" Installing, enabling, disabling or removing a module, and
 * installing / importing the person-detection runtime, put code on the box that runs with the server's rights. With API
 * auth off (the factory default) every device on the network reaches these routes, so they answer only when:
 *   - API auth is enforced and the request carries the password (the dispatcher already refused it otherwise; checked
 *     again here so a route reached some other way is not trusted by accident), or
 *   - the request comes from the box itself: loopback socket, no proxy header, loopback Host / Origin
 *     (box-local-request.js — stricter than a bare loopback socket, so a reverse proxy or a page rendered by Caspar's
 *     CEF does not count). The on-box Godot client talks to 127.0.0.1 with no Origin and passes.
 */

const { isEnforceAuthActive, getExpectedApiToken, extractAuthTokenFromRequest, secureCompare } = require('../server/auth')
const { checkBoxLocalRequest } = require('../api/box-local-request')

const REFUSAL = 'Installing or changing modules is only allowed with a password or on the box itself. Turn on API auth in Settings ▸ System, or do this on the box itself.'

/**
 * @param {import('http').IncomingMessage | null | undefined} req
 * @param {any} ctx
 * @returns {{ ok: true, via: 'auth' | 'box' } | { ok: false, status: 403, code: 'NOT_ALLOWED', error: string }}
 */
function mayChangeInstalledCode(req, ctx) {
	if (req && isEnforceAuthActive(ctx?.config)) {
		const expected = getExpectedApiToken(ctx?.config)
		const provided = extractAuthTokenFromRequest(req)
		if (expected && provided && secureCompare(provided, expected)) return { ok: true, via: 'auth' }
	}
	if (req && checkBoxLocalRequest(req).ok) return { ok: true, via: 'box' }
	return { ok: false, status: 403, code: 'NOT_ALLOWED', error: REFUSAL }
}

module.exports = { mayChangeInstalledCode }

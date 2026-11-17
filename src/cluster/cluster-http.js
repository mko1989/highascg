'use strict'

/**
 * WO-1106 C17 — the cluster's HTTP calls to a peer (split out of cluster-peers.js, which re-exports them). Every answer
 * is read with a byte cap and a whole-answer deadline on top of the idle timeout.
 */

const http = require('http')
const { outboundAuthHeaders } = require('../server/auth')

const TIMEOUT_MS = 1500

/** WO-1106 C17: answer caps — ping / status answers are small; anything else (device view, a call's answer) up to the
 *  relay's cap (cluster-relay.js MAX_BODY). A device answering :4200 during a scan cannot stream node out of memory. */
const SMALL_BODY = 1024 * 1024
const MAX_BODY = 8 * 1024 * 1024
const SMALL_PATHS = /^\/api\/(replication\/ping|cluster\/(identity|master|hello|peers))(\?|\/|$)/
const capFor = (path) => (SMALL_PATHS.test(String(path)) ? SMALL_BODY : MAX_BODY)
/** WO-1106 C17: a whole-answer deadline on top of the idle timeout (a body trickling a byte a second never goes idle). */
const deadlineFor = (timeout) => 2 * (Number(timeout) || TIMEOUT_MS) + 10000

/** http.request → { status, body: Buffer } | { status: 0, error } (never throws, settles once; cap + deadline). */
function fetchBody(reqOpts, data, { cap = capFor(reqOpts.path), deadline = deadlineFor(reqOpts.timeout) } = {}) {
	return new Promise((resolve) => {
		let done = false
		const settle = (v) => {
			if (done) return
			done = true
			clearTimeout(timer)
			resolve(v)
		}
		const fail = (msg) => {
			settle({ status: 0, error: msg })
			req.destroy(new Error(msg))
		}
		const timer = setTimeout(() => fail('deadline'), deadline)
		timer.unref?.()
		const req = http.request(reqOpts, (res) => {
			const chunks = []
			let size = 0
			res.on('data', (c) => {
				size += c.length
				if (size > cap) return fail('answer too large')
				chunks.push(c)
			})
			res.on('end', () => settle({ status: res.statusCode, body: Buffer.concat(chunks) }))
			res.on('error', (e) => settle({ status: 0, error: e.message }))
			res.on('aborted', () => settle({ status: 0, error: 'aborted' }))
		})
		req.on('timeout', () => req.destroy(new Error('timeout')))
		req.on('error', (e) => settle({ status: 0, error: e.message }))
		req.end(data || undefined)
	})
}

const parsed = (body) => {
	try {
		return JSON.parse(body.toString('utf8'))
	} catch {
		return null
	}
}

/** GET http://host:port/path → { ok, status, json } (never throws). WO-811: carries this node's shared password
 * (auth.outboundAuthHeaders, none today) — except `{ auth: false }`, the subnet scan, which must not hand it to every host. */
async function getJson(host, port, path, timeout = TIMEOUT_MS, { auth = true } = {}) {
	const headers = { Accept: 'application/json', ...(auth ? outboundAuthHeaders() : {}) }
	const r = await fetchBody({ host, port, path, method: 'GET', timeout, headers })
	if (!r.status) return { ok: false, status: 0, json: null, error: r.error }
	const json = parsed(r.body)
	return { ok: r.status >= 200 && r.status < 300 && json !== null, status: r.status, json }
}

/** POST JSON → { ok, status, json } (never throws). */
const postJson = (host, port, path, body, timeout = 5000) => requestJson('POST', host, port, path, body, timeout)

/** method + JSON body → { ok, status, json } (never throws). */
async function requestJson(method, host, port, path, body, timeout = 5000) {
	const data = Buffer.from(body === undefined ? '' : JSON.stringify(body))
	const headers = { 'Content-Type': 'application/json', 'Content-Length': data.length, Accept: 'application/json', ...outboundAuthHeaders() }
	const r = await fetchBody({ host, port, path, method, timeout, headers }, data)
	if (!r.status) return { ok: false, status: 0, json: null, error: r.error }
	return { ok: r.status >= 200 && r.status < 300, status: r.status, json: parsed(r.body) }
}

module.exports = { getJson, postJson, requestJson, fetchBody, capFor, deadlineFor, SMALL_BODY, MAX_BODY }

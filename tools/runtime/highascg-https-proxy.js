#!/usr/bin/env node
'use strict'
/**
 * WO-319 — TLS-terminating reverse proxy for the highascg UI.
 *
 * WHY THIS EXISTS: the live GUI preview uses WebCodecs (VideoDecoder), which browsers expose ONLY in
 * a secure context. The operator kiosk is fine (http://127.0.0.1 = localhost = secure), but a client
 * on the LAN hitting http://<box-ip>:4200 is an INSECURE context, so VideoDecoder is undefined and
 * the "Live preview" toggle correctly hides itself. Serving the UI over HTTPS makes the LAN origin a
 * secure context (once the self-signed cert is accepted once) and the toggle appears.
 *
 * This is a PROXY, not a change to the app server: highascg keeps serving plain HTTP on :4200,
 * untouched; this process terminates TLS on :4443 and forwards everything — regular requests AND
 * WebSocket upgrades (the operator WS and the /ws/gui-stream video relay) — to it. Built on Node
 * built-ins only (https/http/net), no dependencies.
 *
 * HOST HEADER IS PRESERVED on purpose: highascg's isOriginAllowed() accepts an Origin that equals
 * `https://<host>`, and the browser sends Host=<box-ip>:4443 / Origin=https://<box-ip>:4443. Rewrite
 * the Host to 127.0.0.1 and that check would reject the WS. So forward headers verbatim.
 *
 * Usage:
 *   node tools/runtime/highascg-https-proxy.js            # :4443 -> 127.0.0.1:4200, auto self-signed cert
 *   HTTPS_PORT=8443 TARGET_PORT=4200 node tools/runtime/highascg-https-proxy.js
 *
 * The cert is generated once into <repo>/config/certs/ (openssl), with the box's LAN IPs as SANs so
 * the hostname matches. Delete that dir to regenerate (e.g. after the IP changes).
 */

const https = require('https')
const http = require('http')
const net = require('net')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || '4443', 10)
const TARGET_HOST = process.env.TARGET_HOST || '127.0.0.1'
const TARGET_PORT = parseInt(process.env.TARGET_PORT || '4200', 10)
const CERT_DIR = process.env.HIGHASCG_CERT_DIR || path.join(__dirname, '../../config/certs')
const KEY_PATH = path.join(CERT_DIR, 'highascg-key.pem')
const CERT_PATH = path.join(CERT_DIR, 'highascg-cert.pem')

/** All non-internal IPv4 addresses, for the cert SAN list (so https://<lan-ip> matches the cert). */
function localIPv4s() {
	const out = []
	for (const addrs of Object.values(os.networkInterfaces())) {
		for (const a of addrs || []) {
			if (a.family === 'IPv4' && !a.internal) out.push(a.address)
		}
	}
	return out
}

/** Generate a self-signed cert covering localhost + every LAN IP, if one is not already present. */
function ensureCert() {
	if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) return
	fs.mkdirSync(CERT_DIR, { recursive: true })
	const ips = localIPv4s()
	const sans = ['DNS:localhost', `DNS:${os.hostname()}`, 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)]
	console.log(`[https-proxy] generating self-signed cert (SAN: ${sans.join(', ')})`)
	execFileSync(
		'openssl',
		[
			'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
			'-keyout', KEY_PATH,
			'-out', CERT_PATH,
			'-days', '3650',
			'-subj', '/CN=highascg',
			'-addext', `subjectAltName=${sans.join(',')}`,
		],
		{ stdio: ['ignore', 'ignore', 'inherit'] },
	)
	fs.chmodSync(KEY_PATH, 0o600)
}

ensureCert()
const tlsOpts = { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) }

const server = https.createServer(tlsOpts, (creq, cres) => {
	// Forward the request verbatim (method, path, headers — Host preserved) to the HTTP app server.
	const preq = http.request(
		{ host: TARGET_HOST, port: TARGET_PORT, method: creq.method, path: creq.url, headers: creq.headers },
		(pres) => {
			cres.writeHead(pres.statusCode || 502, pres.headers)
			pres.pipe(cres)
		},
	)
	preq.on('error', (e) => {
		if (!cres.headersSent) cres.writeHead(502, { 'content-type': 'text/plain' })
		cres.end(`proxy error: ${e.message}`)
	})
	creq.pipe(preq)
})

// WebSocket upgrades (operator WS + /ws/gui-stream) — forward the raw stream to the app server.
server.on('upgrade', (creq, csocket, head) => {
	const psocket = net.connect(TARGET_PORT, TARGET_HOST, () => {
		// Reconstruct the request line + headers exactly, then splice the two sockets together.
		let raw = `${creq.method} ${creq.url} HTTP/${creq.httpVersion}\r\n`
		for (let i = 0; i < creq.rawHeaders.length; i += 2) {
			raw += `${creq.rawHeaders[i]}: ${creq.rawHeaders[i + 1]}\r\n`
		}
		raw += '\r\n'
		psocket.write(raw)
		if (head && head.length) psocket.write(head)
		psocket.pipe(csocket)
		csocket.pipe(psocket)
	})
	const kill = () => {
		psocket.destroy()
		csocket.destroy()
	}
	psocket.on('error', kill)
	csocket.on('error', kill)
})

server.on('error', (e) => {
	console.error(`[https-proxy] server error: ${e.message}`)
	process.exit(1)
})

server.listen(HTTPS_PORT, () => {
	const ips = localIPv4s()
	console.log(`[https-proxy] HTTPS :${HTTPS_PORT} -> http://${TARGET_HOST}:${TARGET_PORT}`)
	for (const ip of ips) console.log(`[https-proxy]   network clients: https://${ip}:${HTTPS_PORT}/`)
	console.log('[https-proxy]   (self-signed — accept the browser warning once; then Live preview appears)')
})

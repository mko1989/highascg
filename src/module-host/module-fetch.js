'use strict'

/**
 * WO-1076 — where a module package comes from: a local .tgz (a USB stick) or an https URL (a release asset), plus the
 * sha256 that vouches for it. https only, redirects only to https (GitHub release assets redirect to their CDN), a
 * byte cap enforced while streaming, a timeout. No credentials are ever sent.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const MAX_PACKED_BYTES = 64 * 1024 * 1024

const fail = (code, error, status = 400) => Object.assign(new Error(error), { code, status })

/**
 * @param {string} url
 * @param {{ maxBytes?: number, timeoutMs?: number, maxRedirects?: number }} [opts]
 * @returns {Promise<Buffer>}
 */
function fetchHttps(url, opts = {}) {
	const maxBytes = opts.maxBytes ?? MAX_PACKED_BYTES
	const timeoutMs = opts.timeoutMs ?? 60_000
	const redirects = opts.maxRedirects ?? 5
	return new Promise((resolve, reject) => {
		let u
		try {
			u = new URL(url)
		} catch {
			return reject(fail('BAD_URL', 'not a URL'))
		}
		if (u.protocol !== 'https:') return reject(fail('BAD_URL', 'only https URLs are allowed'))
		const req = require('https').get(u, { headers: { 'User-Agent': 'highascg-module-installer', Accept: 'application/octet-stream' } }, (res) => {
			const st = res.statusCode || 0
			if (st >= 300 && st < 400 && res.headers.location) {
				res.resume()
				if (redirects <= 0) return reject(fail('FETCH', 'too many redirects', 502))
				return fetchHttps(new URL(res.headers.location, u).toString(), { ...opts, maxRedirects: redirects - 1 }).then(resolve, reject)
			}
			if (st !== 200) {
				res.resume()
				return reject(fail('FETCH', `download failed: HTTP ${st}`, 502))
			}
			if (Number(res.headers['content-length'] || 0) > maxBytes) {
				res.destroy()
				return reject(fail('TOO_LARGE', `package larger than ${maxBytes} bytes`, 413))
			}
			const chunks = []
			let n = 0
			res.on('data', (c) => {
				n += c.length
				if (n > maxBytes) {
					res.destroy()
					reject(fail('TOO_LARGE', `package larger than ${maxBytes} bytes`, 413))
				} else chunks.push(c)
			})
			res.on('end', () => resolve(Buffer.concat(chunks)))
			res.on('error', (e) => reject(fail('FETCH', `download failed: ${e.message}`, 502)))
		})
		req.setTimeout(timeoutMs, () => req.destroy(fail('FETCH', 'download timed out', 504)))
		req.on('error', (e) => reject(e.code === 'FETCH' ? e : fail('FETCH', `download failed: ${e.message}`, 502)))
	})
}

/**
 * A local package: absolute path to a regular .tgz / .tar.gz file, within the size cap.
 * @param {string} file
 * @param {number} [maxBytes]
 */
function readLocalPackage(file, maxBytes = MAX_PACKED_BYTES) {
	if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0')) throw fail('BAD_PATH', 'path must be an absolute file path')
	if (!/\.(tgz|tar\.gz)$/i.test(file)) throw fail('BAD_PATH', 'path must name a .tgz / .tar.gz file')
	let st
	try {
		st = fs.statSync(file)
	} catch {
		throw fail('BAD_PATH', 'package file not found', 404)
	}
	if (!st.isFile()) throw fail('BAD_PATH', 'path is not a regular file')
	if (st.size > maxBytes) throw fail('TOO_LARGE', `package larger than ${maxBytes} bytes`, 413)
	return fs.readFileSync(file)
}

/** `abc…` or a sha256sum line `abc…  file.tgz` → lowercase hex, or null. */
function parseSha256(s) {
	const m = /^\s*([0-9a-fA-F]{64})(?:\s|$)/.exec(String(s || ''))
	return m ? m[1].toLowerCase() : null
}

const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

module.exports = { fetchHttps, readLocalPackage, parseSha256, sha256Hex, MAX_PACKED_BYTES }

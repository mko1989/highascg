/**
 * CG Studio HTTP handlers (runs on Electron launcher, not playout server).
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { JSON_HEADERS, jsonBody } = require('./http-utils')
const { getPublicDir, getTemplateRoot } = require('./cg-studio-context')
const { scanAllTemplates, getTemplateDetail } = require('./template-scan')
const { exportTemplate } = require('./export-template')

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
}

const DEFAULT_PORT = 4300

function resolveStudioPort() {
	const env = process.env.HIGHASCG_CG_STUDIO_PORT
	if (env && !Number.isNaN(parseInt(env, 10))) return parseInt(env, 10)
	return DEFAULT_PORT
}

function buildStudioUrl(port, bindAddress) {
	const host = !bindAddress || bindAddress === '0.0.0.0' ? '127.0.0.1' : bindAddress
	return `http://${host}:${port}/`
}

/**
 * @param {string} method
 * @param {string} p
 * @param {string} bodyStr
 * @param {Record<string, string>} [query]
 */
async function handleStudioApi(method, p, bodyStr, query = {}) {
	if (method === 'GET' && p === '/api/health') {
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, module: 'cg-studio', host: 'launcher' }),
		}
	}

	if (method === 'GET' && p === '/api/templates') {
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ templates: scanAllTemplates() }),
		}
	}

	const detailMatch = p.match(/^\/api\/templates\/([^/]+)$/)
	if (method === 'GET' && detailMatch) {
		const id = decodeURIComponent(detailMatch[1])
		const category = query.category || undefined
		const detail = getTemplateDetail(id, category)
		if (!detail) {
			return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Template not found' }) }
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(detail) }
	}

	if (method === 'POST' && p === '/api/export') {
		try {
			const body = JSON.parse(bodyStr || '{}')
			const result = exportTemplate({
				baseTemplateId: body.baseTemplateId,
				baseCategory: body.baseCategory,
				exportId: body.exportId,
				exportName: body.exportName,
				data: body.data,
				style: body.style,
			})
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(result) }
		} catch (e) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: false, error: String(e.message || e) }),
			}
		}
	}

	return null
}

/**
 * @returns {{ status: number, headers: object, body: string | Buffer } | null}
 */
async function serveStatic(urlPath) {
	const PUBLIC_DIR = getPublicDir()
	const TEMPLATE_ROOT = getTemplateRoot()
	let filePath
	if (urlPath === '/' || urlPath === '') {
		filePath = path.join(PUBLIC_DIR, 'index.html')
	} else if (urlPath.startsWith('/studio-assets/')) {
		const rel = urlPath.replace(/^\/studio-assets\//, '')
		if (rel.includes('..')) return null
		filePath = path.join(TEMPLATE_ROOT, rel)
	} else {
		const rel = urlPath.replace(/^\//, '')
		if (rel.includes('..')) return null
		filePath = path.join(PUBLIC_DIR, rel)
	}

	const pubRoot = path.resolve(PUBLIC_DIR) + path.sep
	const tplRoot = path.resolve(TEMPLATE_ROOT) + path.sep
	const resolved = path.resolve(filePath)
	if (!resolved.startsWith(pubRoot) && !resolved.startsWith(tplRoot)) return null
	if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
		if (urlPath === '/' || !urlPath.includes('.')) {
			filePath = path.join(PUBLIC_DIR, 'index.html')
			if (!fs.existsSync(filePath)) return null
		} else {
			return null
		}
	}

	const ext = path.extname(filePath).toLowerCase()
	const isBinary = ['.png', '.jpg', '.jpeg', '.woff', '.woff2', '.ttf'].includes(ext)
	const body = isBinary ? fs.readFileSync(filePath) : fs.readFileSync(filePath, 'utf8')
	const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' }
	if (ext === '.html' || ext === '.js' || ext === '.css') {
		headers['Cache-Control'] = 'no-cache'
	}
	return { status: 200, headers, body }
}

/**
 * @param {import('http').IncomingMessage} req
 */
async function handleStudioRequest(req) {
	const u = new URL(req.url || '/', 'http://localhost')
	const p = u.pathname
	const method = req.method || 'GET'

	if (p.startsWith('/api/')) {
		let bodyStr = ''
		if (method === 'POST' || method === 'PUT') {
			const chunks = []
			for await (const chunk of req) chunks.push(chunk)
			bodyStr = Buffer.concat(chunks).toString('utf8')
		}
		const query = Object.fromEntries(u.searchParams.entries())
		return handleStudioApi(method, p, bodyStr, query)
	}

	return serveStatic(p)
}

module.exports = {
	resolveStudioPort,
	buildStudioUrl,
	handleStudioRequest,
}

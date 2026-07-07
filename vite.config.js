import { defineConfig, loadEnv } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoDir = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.join(repoDir, 'client')

function readWebUiPort() {
	for (const rel of ['client/lib/webui-port.json', 'webui-port.json']) {
		const p = path.join(repoDir, rel)
		if (!fs.existsSync(p)) continue
		try {
			const cfg = JSON.parse(fs.readFileSync(p, 'utf8'))
			const port = Number(cfg.port)
			if (port > 0) return port
		} catch {
			/* try next */
		}
	}
	return 4350
}

const WEBUI_PORT = readWebUiPort()

const STATIC_MIME = {
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.css': 'text/css',
	'.js': 'application/javascript',
	'.json': 'application/json',
	'.txt': 'text/plain',
}

/** Copy trees the UI loads by URL (/assets/…, /fonts/…) — not only Vite-bundled imports. */
function copyClientStaticTreesPlugin() {
	const trees = [
		{ src: path.join(clientDir, 'assets'), urlPath: '/assets' },
		{ src: path.join(clientDir, 'fonts'), urlPath: '/fonts' },
		{ src: path.join(clientDir, 'fixtures'), urlPath: '/fixtures' },
	]
	return {
		name: 'highascg-copy-client-static',
		configureServer(server) {
			for (const { src, urlPath } of trees) {
				if (!fs.existsSync(src)) continue
				server.middlewares.use(urlPath, (req, res, next) => {
					const urlParts = (req.url || '').split('?')
					const query = urlParts[1] || ''
					if (query.includes('raw') || query.includes('import')) return next()
					const rel = decodeURIComponent(urlParts[0] || '')
					if (!rel || rel.includes('..')) return next()
					const file = path.join(src, rel)
					if (!file.startsWith(src)) return next()
					fs.readFile(file, (err, data) => {
						if (err) return next()
						const ext = path.extname(file).toLowerCase()
						if (STATIC_MIME[ext]) res.setHeader('Content-Type', STATIC_MIME[ext])
						res.end(data)
					})
				})
			}
		},
		closeBundle() {
			const outDir = path.join(repoDir, 'dist-web')
			for (const { src, urlPath } of trees) {
				if (!fs.existsSync(src)) continue
				const dest = path.join(outDir, urlPath.replace(/^\//, ''))
				fs.mkdirSync(dest, { recursive: true })
				fs.cpSync(src, dest, { recursive: true })
			}
		},
	}
}

/** @param {string} apiOrigin */
function vendorImportMapEntries(apiOrigin) {
	// Always use relative paths for vendor imports so they go through the same-origin proxy (Web UI port / companion)
	// which avoids all CORS issues and works under any custom LAN IP configuration.
	return {
		three: '/vendor/three/build/three.module.js',
		'three/': '/vendor/three/',
		'three/addons/': '/vendor/three/examples/jsm/',
		'html-to-image': '/vendor/html-to-image/es/index.js',
	}
}

const optionalModulesRegistryPath = path.join(clientDir, 'lib', 'optional-modules-registry.json')

/** Dev: local GET /api/modules (before proxy) — set HIGHASCG_ENABLED_MODULES=cg-studio,previs */
function optionalModulesDevApiPlugin() {
	return {
		name: 'highascg-optional-modules-dev-api',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const urlPath = (req.url || '').split('?')[0]
				if (urlPath !== '/api/modules' || req.method !== 'GET') return next()
				let registry = []
				try {
					registry = JSON.parse(fs.readFileSync(optionalModulesRegistryPath, 'utf8')).modules || []
				} catch {
					/* ignore */
				}
				const visible = registry.filter((m) => m.launcherHidden !== true)
				const env = process.env.HIGHASCG_ENABLED_MODULES
				const enabledIds = env
					? env.split(',').map((s) => s.trim()).filter(Boolean)
					: visible.filter((m) => m.defaultEnabled).map((m) => m.id)
				const allowed = new Set(enabledIds)
				const enabled = []
				const bundles = []
				const styles = []
				for (const mod of visible) {
					if (!allowed.has(mod.id)) continue
					enabled.push(mod.id)
					if (mod.bundle && !bundles.includes(mod.bundle)) bundles.push(mod.bundle)
					for (const href of mod.styles || []) {
						if (!styles.includes(href)) styles.push(href)
					}
				}
				res.setHeader('Content-Type', 'application/json')
				res.end(JSON.stringify({ enabled, bundles, styles, wsNamespaces: enabled.filter((id) => id !== 'cg-studio') }))
			})
		},
	}
}

/** Dev project files API — set HIGHASCG_DEV_PROJECT_FILES=1 in .env.development */
function projectFilesDevApiPlugin() {
	const projectsDir = path.join(clientDir, 'fixtures', 'project-files')
	let activeId = 'demo-show'

	function listFiles() {
		if (!fs.existsSync(projectsDir)) return []
		return fs
			.readdirSync(projectsDir)
			.filter((f) => f.endsWith('.json'))
			.map((filename) => {
				const id = filename.replace(/\.json$/i, '')
				const full = path.join(projectsDir, filename)
				let name = id
				let savedAt = null
				try {
					const stat = fs.statSync(full)
					savedAt = stat.mtime.toISOString()
					const j = JSON.parse(fs.readFileSync(full, 'utf8'))
					if (j?.name) name = String(j.name)
					if (j?.savedAt) savedAt = String(j.savedAt)
				} catch {
					/* ignore */
				}
				const sizeBytes = fs.statSync(full).size
				return {
					id,
					name,
					filename,
					savedAt,
					modifiedAt: savedAt,
					sizeBytes,
					active: id === activeId,
				}
			})
			.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))
	}

	function readProject(id) {
		const safe = String(id || '').replace(/[^\w.-]+/g, '')
		const full = path.join(projectsDir, `${safe}.json`)
		if (!full.startsWith(projectsDir) || !fs.existsSync(full)) return null
		return JSON.parse(fs.readFileSync(full, 'utf8'))
	}

	return {
		name: 'highascg-project-files-dev-api',
		configureServer(server) {
			if (process.env.HIGHASCG_DEV_PROJECT_FILES !== '1') return
			fs.mkdirSync(projectsDir, { recursive: true })
			server.middlewares.use(async (req, res, next) => {
				const urlPath = (req.url || '').split('?')[0]
				if (!urlPath.startsWith('/api/project')) return next()

				if (urlPath === '/api/project/list' && req.method === 'GET') {
					const files = listFiles()
					res.setHeader('Content-Type', 'application/json')
					res.end(JSON.stringify({ ok: true, activeId, files }))
					return
				}

				const fileMatch = urlPath.match(/^\/api\/project\/file\/([^/]+)(\/download)?$/)
				if (fileMatch && req.method === 'GET') {
					const id = decodeURIComponent(fileMatch[1])
					const project = readProject(id)
					if (!project) {
						res.statusCode = 404
						res.setHeader('Content-Type', 'application/json')
						res.end(JSON.stringify({ error: 'Project file not found' }))
						return
					}
					const body = JSON.stringify(project, null, 2)
					res.setHeader('Content-Type', 'application/json')
					if (fileMatch[2]) {
						res.setHeader(
							'Content-Disposition',
							`attachment; filename="${id}.json"`,
						)
					}
					res.end(body)
					return
				}

				if (urlPath === '/api/project/load' && req.method === 'POST') {
					let body = ''
					req.on('data', (chunk) => {
						body += chunk
					})
					req.on('end', () => {
						try {
							const payload = JSON.parse(body || '{}')
							const id = payload.id ? String(payload.id) : activeId
							const project = readProject(id)
							if (!project) {
								res.statusCode = 404
								res.setHeader('Content-Type', 'application/json')
								res.end(JSON.stringify({ error: 'Project file not found' }))
								return
							}
							activeId = id
							res.setHeader('Content-Type', 'application/json')
							res.end(JSON.stringify(project))
						} catch (err) {
							res.statusCode = 400
							res.end(err?.message || String(err))
						}
					})
					return
				}

				if (urlPath === '/api/project/save' && req.method === 'POST') {
					let body = ''
					req.on('data', (chunk) => {
						body += chunk
					})
					req.on('end', () => {
						try {
							const payload = JSON.parse(body || '{}')
							const project = payload.project
							if (!project || typeof project !== 'object') {
								res.statusCode = 400
								res.end('Missing project')
								return
							}
							const rawId =
								payload.id ||
								String(project.name || 'project')
									.trim()
									.toLowerCase()
									.replace(/[^\w.-]+/g, '_') ||
								'project'
							const id = String(rawId).replace(/[^\w.-]+/g, '_') || 'project'
							fs.mkdirSync(projectsDir, { recursive: true })
							fs.writeFileSync(
								path.join(projectsDir, `${id}.json`),
								JSON.stringify(project, null, 2),
								'utf8',
							)
							activeId = id
							res.setHeader('Content-Type', 'application/json')
							res.end(JSON.stringify({ ok: true, id, filename: `${id}.json` }))
						} catch (err) {
							res.statusCode = 400
							res.end(err?.message || String(err))
						}
					})
					return
				}

				next()
			})
		},
	}
}

/** Inject import map + meta for Vite dev (:4350 → API :4200). Production: in-repo client/ → dist-web/ on playout. */
function highascgApiOriginPlugin(apiOrigin) {
	return {
		name: 'highascg-api-origin',
		transformIndexHtml(html) {
			const origin = (apiOrigin || '').replace(/\/$/, '')
			const map = JSON.stringify({ imports: vendorImportMapEntries(origin) }, null, '\t')
			let out = html.replace(/location\.port === '\d+'/, `location.port === '${WEBUI_PORT}'`)
			if (html.includes('id="highascg-importmap-bootstrap"')) {
				out = out.replace(
					/<script type="importmap" id="highascg-importmap">[\s\S]*?<\/script>/,
					`<script type="importmap" id="highascg-importmap">\n${map}\n\t</script>`,
				)
			}
			out = out.replace(
				/<meta name="highascg-api-origin" content="[^"]*">/,
				`<meta name="highascg-api-origin" content="${origin}">`,
			)
			return out
		},
	}
}

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '')
	// Dev proxy target only — production: same machine, server serves dist-web/ on :4200.
	const proxyTarget = (env.VITE_HIGHASCG_API_ORIGIN || 'http://127.0.0.1:4200').replace(/\/$/, '')
	const apiOrigin = mode === 'production' ? '' : proxyTarget
	const apiHttp = proxyTarget.startsWith('http') ? proxyTarget : `http://${proxyTarget}`
	const apiWs = apiHttp.replace(/^http/, 'ws')

	return {
		root: 'client',
		base: './',
		plugins: [
			highascgApiOriginPlugin(apiOrigin),
			copyClientStaticTreesPlugin(),
			optionalModulesDevApiPlugin(),
			projectFilesDevApiPlugin(),
		],
		build: {
			outDir: '../dist-web',
			emptyOutDir: true,
			target: 'es2022',
			assetsInlineLimit: 4096,
			chunkSizeWarningLimit: 600,
			rollupOptions: {
				input: {
					main: path.join(clientDir, 'index.html'),
					setup: path.join(clientDir, 'setup.html'),
				},
				external: [
					'three',
					'html-to-image',
					'three/addons/controls/OrbitControls.js',
					'three/addons/loaders/GLTFLoader.js',
				],
				output: {
					manualChunks(id) {
						if (!id.includes('/client/')) return undefined
						// Shared libs used by both device-view and scenes chunks — must not live in either
						// or Rollup creates a circular import (TDZ: "can't access lexical declaration before initialization").
						// Members must only import other shared members (leaf modules) — a shared module importing
						// a main-chunk module recreates the chunk cycle (WO-138).
						if (
							id.includes('/lib/settings-state.js') ||
							id.includes('/lib/api-client.js') ||
							id.includes('/lib/api-origin.js') ||
							id.includes('/lib/editor-defaults-constants.js') ||
							id.includes('/lib/program-audio-layouts.js') ||
							// deps of the members above (plug shared -> main leaks, WO-138):
							id.includes('/lib/app-runtime.js') ||
							id.includes('/lib/scene-content-fit.js') ||
							id.includes('/lib/audio-channel-layouts.js') ||
							// leaf draw helpers used by main (timeline compose libs) and scenes (WO-138):
							id.includes('/lib/ui-font.js') ||
							id.includes('/components/preview-canvas-draw-base.js')
						) {
							return 'shared'
						}
						if (id.includes('/components/device-view') || id.includes('/lib/device-view-')) return 'device-view'
						if (
							id.includes('/components/scenes-') ||
							id.includes('/components/timeline-') ||
							id.includes('/components/preview-')
						) {
							return 'scenes'
						}
						if (id.includes('/components/previs-') || id.includes('/lib/previs-')) return 'previs'
						return undefined
					},
				},
			},
		},
		server: {
			port: WEBUI_PORT,
			host: true,
			proxy: {
				'/api/ws': { target: apiWs, ws: true },
				'/ws': { target: apiWs, ws: true },
				'/api': { target: apiHttp, changeOrigin: true },
				'/vendor': { target: apiHttp, changeOrigin: true },
				'/template': { target: apiHttp, changeOrigin: true },
				'/templates': { target: apiHttp, changeOrigin: true },
			},
		},
	}
})

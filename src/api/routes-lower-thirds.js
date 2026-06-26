/**
 * routes-lower-thirds.js — CRUD + playback API for lower-third templates.
 *
 * Endpoints (all under /api/lower-thirds):
 *
 *   GET  /api/lower-thirds/templates        — list available template variants
 *   GET  /api/lower-thirds/active            — get currently active LT state
 *   POST /api/lower-thirds/load              — load data + style into a template
 *   POST /api/lower-thirds/update            — update text / style of active LT
 *   POST /api/lower-thirds/play              — animate in
 *   POST /api/lower-thirds/stop              — animate out
 *   POST /api/lower-thirds/next              — advance to next data item
 *   POST /api/lower-thirds/previous          — go back one data item
 *   POST /api/lower-thirds/clear             — remove graphic entirely
 *
 * State is kept in-memory on appCtx.lowerThird.  The CG commands are sent via
 * the existing AMCP CG pipeline (routes-cg.js).
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const {
	resolveCgRequestChannel,
	resolveTemplateCgHostLayer,
} = require('../engine/cg-routing')

/** Directory holding the lower-thirds HTML files. */
const LT_DIR = path.join(__dirname, '..', '..', 'template', 'lower-thirds')
/** User exports from CG Studio. */
const STUDIO_LT_DIR = path.join(__dirname, '..', '..', 'template', 'studio')
/** Directory holding custom font files for templates. */
const FONTS_DIR = path.join(__dirname, '..', '..', 'template', 'fonts')
const busboy = require('busboy')

/** Canonical template list (id → display name). */
const TEMPLATE_CATALOG = {
	'lt-classic-box':      'Classic Box',
	'lt-slide-bar':        'Slide Bar',
	'lt-minimal-fade':     'Minimal Fade',
	'lt-split-color':      'Split Color',
	'lt-frosted-glass':    'Frosted Glass',
	'lt-underline-reveal': 'Underline Reveal',
	'lt-tag-badge':        'Tag Badge',
	'lt-gradient-wave':    'Gradient Wave',
	'lt-corner-bracket':   'Corner Bracket',
}

/** Default style payload used when none is supplied. */
const DEFAULT_STYLE = {
	primaryColor: 'lightblue',
	textColor: '#ffffff',
	position: 'left',
}

/** Default logical look layer for standalone LT API (maps to Caspar host 710). */
const DEFAULT_LT_LOGICAL_LAYER = 20

function humanizeLtId(id) {
	return id
		.replace(/^lt-/, '')
		.split('-')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ')
}

/** Scan template/studio/ for CG Studio exports. */
function listStudioTemplates() {
	if (!fs.existsSync(STUDIO_LT_DIR)) return []
	return fs
		.readdirSync(STUDIO_LT_DIR, { withFileTypes: true })
		.filter((ent) => ent.isFile() && ent.name.endsWith('.html') && ent.name.startsWith('lt-'))
		.map((ent) => {
			const id = ent.name.replace(/\.html$/, '')
			return {
				id,
				name: humanizeLtId(id),
				htmlPath: 'studio/' + ent.name,
				casparPath: 'studio/' + id,
				category: 'studio',
				available: true,
			}
		})
		.sort((a, b) => a.name.localeCompare(b.name))
}

/** Caspar CG template path for a lower-third id (built-in or studio export). */
function resolveLtCasparPath(templateId) {
	const id = String(templateId || '').trim()
	if (!id) return 'lower-thirds/lt-classic-box'
	if (TEMPLATE_CATALOG[id]) return 'lower-thirds/' + id
	const studioFile = path.join(STUDIO_LT_DIR, id + '.html')
	if (fs.existsSync(studioFile)) return 'studio/' + id
	return 'lower-thirds/' + id
}

/** Ensure per-channel lower-third state (channel 3 LT does not affect channel 1). */
function ensureState(ctx, body) {
	if (!ctx._lowerThirdByChannel) ctx._lowerThirdByChannel = {}
	const ch = resolveCgRequestChannel(body || {}, ctx)
	const key = String(ch)
	if (!ctx._lowerThirdByChannel[key]) {
		ctx._lowerThirdByChannel[key] = {
			templateId: null,
			data: [],
			style: { ...DEFAULT_STYLE },
			playing: false,
			activeStep: 0,
			channel: ch,
			logicalLayer: DEFAULT_LT_LOGICAL_LAYER,
			layer: resolveTemplateCgHostLayer(DEFAULT_LT_LOGICAL_LAYER, 'lower-thirds/lt-classic-box'),
			templateHostLayer: 1,
		}
	}
	return ctx._lowerThirdByChannel[key]
}

function ltHostLayer(st) {
	const logical = st.logicalLayer != null ? st.logicalLayer : st.layer
	const cgName = st.templateId ? resolveLtCasparPath(st.templateId) : 'lower-thirds/lt-classic-box'
	return resolveTemplateCgHostLayer(logical, cgName)
}

function applyLtRoutingFields(st, b, ctx) {
	if (b.channel !== undefined) st.channel = resolveCgRequestChannel(b, ctx, st.channel)
	else st.channel = resolveCgRequestChannel({ channel: st.channel }, ctx)
	if (b.logicalLayer !== undefined) st.logicalLayer = parseInt(b.logicalLayer, 10)
	if (b.layer !== undefined) {
		const raw = parseInt(b.layer, 10)
		if (raw >= 700) st.layer = raw
		else st.logicalLayer = raw
	}
	st.layer = ltHostLayer(st)
	if (b.templateHostLayer !== undefined) st.templateHostLayer = parseInt(b.templateHostLayer, 10)
}

/* ── GET handlers ──────────────────────────────────────────── */

function handleGet(p, ctx, query = {}) {
	if (p === '/api/lower-thirds/templates') {
		const builtins = Object.entries(TEMPLATE_CATALOG).map(([id, name]) => {
			const htmlFile = path.join(LT_DIR, id + '.html')
			const exists = fs.existsSync(htmlFile)
			return {
				id,
				name,
				htmlPath: 'lower-thirds/' + id + '.html',
				casparPath: 'lower-thirds/' + id,
				category: 'lower-thirds',
				available: exists,
			}
		})
		const templates = builtins.concat(listStudioTemplates())
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ templates }),
		}
	}

	if (p === '/api/lower-thirds/active') {
		const ch = resolveCgRequestChannel(query, ctx)
		const st = ensureState(ctx, { channel: ch })
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				templateId: st.templateId,
				data: st.data,
				style: st.style,
				playing: st.playing,
				activeStep: st.activeStep,
				channel: st.channel,
				logicalLayer: st.logicalLayer,
				layer: st.layer,
				templateHostLayer: st.templateHostLayer,
			}),
		}
	}

	if (p === '/api/lower-thirds/fonts') {
		if (!fs.existsSync(FONTS_DIR)) {
			fs.mkdirSync(FONTS_DIR, { recursive: true })
		}
		const fonts = fs.readdirSync(FONTS_DIR)
			.filter(f => !f.startsWith('.'))
			.map(name => ({ name, url: 'fonts/' + name }))
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ fonts }) }
	}

	return null
}

/* ── POST handlers ─────────────────────────────────────────── */

async function handlePost(p, body, ctx, req) {
	// Special case for multipart file upload which shouldn't parse the JSON body
	if (p === '/api/lower-thirds/fonts' && req) {
		return new Promise((resolve) => {
			if (!fs.existsSync(FONTS_DIR)) fs.mkdirSync(FONTS_DIR, { recursive: true })
			try {
				const bb = busboy({ headers: req.headers })
				let savedFile = null
				bb.on('file', (name, file, info) => {
					const { filename } = info
					savedFile = filename
					const saveTo = path.join(FONTS_DIR, path.basename(filename))
					file.pipe(fs.createWriteStream(saveTo))
				})
				bb.on('finish', () => {
					resolve({ status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, filename: savedFile }) })
				})
				bb.on('error', (err) => {
					resolve({ status: 500, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: err.message }) })
				})
				req.pipe(bb)
			} catch (err) {
				resolve({ status: 500, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: err.message }) })
			}
		})
	}

	// For DELETE requests routed here (if any) or we can just use POST /api/lower-thirds/fonts/delete
	if (p.startsWith('/api/lower-thirds/fonts/delete/')) {
		const filename = p.replace('/api/lower-thirds/fonts/delete/', '')
		if (filename) {
			const fp = path.join(FONTS_DIR, path.basename(filename))
			if (fs.existsSync(fp)) fs.unlinkSync(fp)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
		}
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: 'No filename provided' }) }
	}

	const b = parseBody(body)

	// ── load ──
	if (p === '/api/lower-thirds/load') {
		const st = ensureState(ctx, b)
		applyLtRoutingFields(st, b, ctx)
		if (b.templateId) {
			if (TEMPLATE_CATALOG[b.templateId] || fs.existsSync(path.join(STUDIO_LT_DIR, b.templateId + '.html'))) {
				st.templateId = b.templateId
			}
		}
		if (b.data) {
			st.data = Array.isArray(b.data) ? b.data : [b.data]
		}
		if (b.style) {
			st.style = { ...DEFAULT_STYLE, ...b.style }
		}
		applyLtRoutingFields(st, b, ctx)
		st.activeStep = 0
		st.playing = false

		// If CasparCG is connected, send CG ADD + UPDATE
		if (ctx.amcp && st.templateId) {
			const ch = st.channel
			const layer = st.layer
			const thl = st.templateHostLayer
			const templatePath = resolveLtCasparPath(st.templateId)
			try {
				await ctx.amcp.cg.cgAdd(ch, layer, thl, templatePath, false, JSON.stringify({
					data: st.data.length ? st.data : [{ title: '', subtitle: '' }],
					style: st.style,
				}))
			} catch (e) {
				ctx.log?.('warn', '[LT] CG ADD failed: ' + (e.message || e))
			}
		}

		// Broadcast state via WebSocket if available
		if (typeof ctx._wsBroadcast === 'function') {
			ctx._wsBroadcast('lower-third.state', {
				templateId: st.templateId,
				data: st.data,
				style: st.style,
				playing: st.playing,
				activeStep: st.activeStep,
				channel: st.channel,
				layer: st.layer,
				templateHostLayer: st.templateHostLayer,
			})
		}

		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, state: st }) }
	}

	// ── update text / style ──
	if (p === '/api/lower-thirds/update') {
		const st = ensureState(ctx, b)
		applyLtRoutingFields(st, b, ctx)
		if (b.data) {
			st.data = Array.isArray(b.data) ? b.data : [b.data]
		}
		if (b.style) {
			st.style = { ...st.style, ...b.style }
		}
		if (b.activeStep !== undefined) {
			st.activeStep = Math.max(0, Math.min(b.activeStep, st.data.length - 1))
		}

		// CG UPDATE on CasparCG
		if (ctx.amcp && st.templateId) {
			const ch = st.channel
			const layer = st.layer
			const thl = st.templateHostLayer
			try {
				await ctx.amcp.cg.cgUpdate(ch, layer, thl, JSON.stringify({
					data: st.data,
					style: st.style,
				}))
			} catch (e) {
				ctx.log?.('warn', '[LT] CG UPDATE failed: ' + (e.message || e))
			}
		}

		if (typeof ctx._wsBroadcast === 'function') {
			ctx._wsBroadcast('lower-third.state', {
				templateId: st.templateId,
				data: st.data,
				style: st.style,
				playing: st.playing,
				activeStep: st.activeStep,
				channel: st.channel,
				layer: st.layer,
				templateHostLayer: st.templateHostLayer,
			})
		}

		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, state: st }) }
	}

	// ── play ──
	if (p === '/api/lower-thirds/play') {
		const st = ensureState(ctx, b)
		applyLtRoutingFields(st, b, ctx)
		st.playing = true
		if (ctx.amcp) {
			const ch = st.channel
			const layer = st.layer
			const thl = st.templateHostLayer
			try { await ctx.amcp.cg.cgPlay(ch, layer, thl) } catch (e) {
				ctx.log?.('warn', '[LT] CG PLAY failed: ' + (e.message || e))
			}
		}
		if (typeof ctx._wsBroadcast === 'function') ctx._wsBroadcast('lower-third.state', { playing: true })
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
	}

	// ── stop ──
	if (p === '/api/lower-thirds/stop') {
		const st = ensureState(ctx, b)
		applyLtRoutingFields(st, b, ctx)
		st.playing = false
		if (ctx.amcp) {
			const ch = st.channel
			const layer = st.layer
			const thl = st.templateHostLayer
			try { await ctx.amcp.cg.cgStop(ch, layer, thl) } catch (e) {
				ctx.log?.('warn', '[LT] CG STOP failed: ' + (e.message || e))
			}
		}
		if (typeof ctx._wsBroadcast === 'function') ctx._wsBroadcast('lower-third.state', { playing: false })
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
	}

	// ── next ──
	if (p === '/api/lower-thirds/next') {
		const st = ensureState(ctx, b)
		applyLtRoutingFields(st, b, ctx)
		if (ctx.amcp) {
			const ch = st.channel
			const layer = st.layer
			const thl = st.templateHostLayer
			try { await ctx.amcp.cg.cgNext(ch, layer, thl) } catch (e) {
				ctx.log?.('warn', '[LT] CG NEXT failed: ' + (e.message || e))
			}
		}
		st.activeStep = Math.min(st.activeStep + 1, st.data.length - 1)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, activeStep: st.activeStep }) }
	}

	// ── previous ──
	if (p === '/api/lower-thirds/previous') {
		const st = ensureState(ctx, b)
		applyLtRoutingFields(st, b, ctx)
		if (ctx.amcp) {
			const ch = st.channel
			const layer = st.layer
			const thl = st.templateHostLayer
			try {
				await ctx.amcp.cg.cgInvoke(ch, layer, thl, 'previous')
			} catch (e) {
				ctx.log?.('warn', '[LT] CG INVOKE previous failed: ' + (e.message || e))
			}
		}
		st.activeStep = Math.max(st.activeStep - 1, 0)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, activeStep: st.activeStep }) }
	}

	// ── clear ──
	if (p === '/api/lower-thirds/clear') {
		const st = ensureState(ctx, b)
		applyLtRoutingFields(st, b, ctx)
		if (ctx.amcp) {
			const ch = st.channel
			const layer = st.layer
			const thl = st.templateHostLayer
			try { await ctx.amcp.cg.cgRemove(ch, layer, thl) } catch (e) {
				ctx.log?.('warn', '[LT] CG REMOVE failed: ' + (e.message || e))
			}
		}
		st.playing = false
		st.templateId = null
		st.data = []
		st.activeStep = 0
		if (typeof ctx._wsBroadcast === 'function') ctx._wsBroadcast('lower-third.state', { playing: false, templateId: null })
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
	}

	return null
}

module.exports = { handleGet, handlePost }

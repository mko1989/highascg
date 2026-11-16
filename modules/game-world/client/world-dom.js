/* global window, document, fetch, URLSearchParams */
/**
 * WO-1101 — small DOM / fetch helpers of the world pages. User text only ever via textContent; the pages talk to
 * /api/game/world/* only (model and kit URLs come from the server's state, checked before use).
 */
import { okPath } from './world-logic.js'

export const API = '/api/game/world'
export const WS_PATH = '/api/game/world/ws'

/** h('div.cls', { attr, text, onclick }, children…) */
export function h(spec, attrs, ...kids) {
	const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(spec) || []
	const el = document.createElement(m[1] || 'div')
	for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
		if (part[0] === '.') el.classList.add(part.slice(1))
		else el.id = part.slice(1)
	}
	if (attrs && typeof attrs === 'object' && !(attrs instanceof window.Node)) {
		for (const [k, v] of Object.entries(attrs)) {
			if (v == null || v === false) continue
			if (k === 'text') el.textContent = String(v)
			else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
			else el.setAttribute(k, v === true ? '' : String(v))
		}
	} else if (attrs != null) kids.unshift(attrs)
	for (const k of kids.flat()) {
		if (k == null || k === false) continue
		el.append(k instanceof window.Node ? k : document.createTextNode(String(k)))
	}
	return el
}

export function setText(el, s) {
	const t = String(s ?? '')
	if (el && el.textContent !== t) el.textContent = t
}

function authHeaders() {
	const headers = {}
	const token = new URLSearchParams(window.location.search).get('token')
	if (token) headers.Authorization = 'Bearer ' + token
	return headers
}

async function call(path, init) {
	try {
		const res = await fetch(API + path, { cache: 'no-store', credentials: 'same-origin', ...init })
		let data = null
		try {
			data = await res.json()
		} catch {
			/* no JSON */
		}
		return { ok: res.ok, status: res.status, data }
	} catch {
		return { ok: false, status: 0, data: null }
	}
}

/** GET /api/game/world/state (with the page's ?token= when there is one: the state needs auth while no game runs). */
export const getState = () => call('/state', { headers: authHeaders() })

/** POST a world host action. */
export const postHost = (body) =>
	call('/host', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) })

/** GET a same-origin JSON path the server handed over (the scene JSON). */
export async function getJson(path) {
	if (!okPath(path)) return null
	try {
		const res = await fetch(path, { cache: 'no-store', credentials: 'same-origin' })
		return res.ok ? await res.json() : null
	} catch {
		return null
	}
}

/** The world feed's socket address on this page's own host. */
export function wsUrl(loc = window.location) {
	return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}${WS_PATH}`
}

/** A colour swatch element (style values only from a checked '#rrggbb'). */
export function swatch(color) {
	const el = h('span.swatch')
	el.style.background = /^#[0-9a-f]{6}$/i.test(String(color)) ? String(color) : '#cccccc'
	return el
}

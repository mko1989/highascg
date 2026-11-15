/* global window, document, localStorage, fetch, navigator, URLSearchParams */
/**
 * DOM / storage / fetch helpers of the Stage Salad client (WO-1089). COPY-ADAPTED from the kit's dom.js
 * (modules/rc-game/client/dom.js), which hard-codes the RC API and the `rcgame.` storage prefix. User text is only
 * ever set via textContent. The client talks to /api/game/salad/* only (stage-salad contract §0: the game never touches anything else
 * on the box).
 */

export const API = '/api/game/salad'
const PREFIX = 'saladgame.'

/** h('div.cls#id', { attr }, children…) */
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

export function $(sel) {
	return document.querySelector(sel)
}

export function setText(el, s) {
	const t = String(s)
	if (el && el.textContent !== t) el.textContent = t
}

export function show(el, on) {
	if (el) el.hidden = !on
}

export function storeGet(key, fallback = null) {
	try {
		const v = localStorage.getItem(PREFIX + key)
		return v == null ? fallback : v
	} catch {
		return fallback
	}
}

export function storeSet(key, value) {
	try {
		localStorage.setItem(PREFIX + key, String(value))
	} catch {
		/* ignore */
	}
}

/** sessionStorage (per tab), guarded. */
export function sessGet(key) {
	try {
		return window.sessionStorage.getItem(PREFIX + key)
	} catch {
		return null
	}
}

export function sessSet(key, value) {
	try {
		if (value == null) window.sessionStorage.removeItem(PREFIX + key)
		else window.sessionStorage.setItem(PREFIX + key, String(value))
	} catch {
		/* ignore */
	}
}

/** Coarse pointer (touch phone / tablet). */
export function isTouchDevice() {
	try {
		return window.matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints || 0) > 0
	} catch {
		return false
	}
}

export function isPhone() {
	return isTouchDevice() && Math.min(window.screen?.width || 9999, window.screen?.height || 9999) < 600
}

async function call(path, init) {
	try {
		const res = await fetch(API + path, init)
		let data = null
		try {
			data = await res.json()
		} catch {
			/* ignore */
		}
		return { ok: res.ok, status: res.status, data }
	} catch {
		return { ok: false, status: 0, data: null }
	}
}

/** GET a game endpoint as JSON. @returns {Promise<{ ok: boolean, status: number, data: any }>} */
export function apiGet(path) {
	return call(path, { cache: 'no-store', credentials: 'same-origin' })
}

/** POST a host action. The API password travels as the session cookie or a `?token=` in the host page's URL. */
export function apiHost(body) {
	const headers = { 'Content-Type': 'application/json' }
	const token = new URLSearchParams(window.location.search).get('token')
	if (token) headers.Authorization = 'Bearer ' + token
	return call('/host', { method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify(body) })
}

export const COLORS = [
	'#ff4d3d',
	'#ffb020',
	'#f5e663',
	'#5ee06b',
	'#22c7b8',
	'#3aa0ff',
	'#6f6bff',
	'#c86bff',
	'#ff6bc1',
	'#f2f2f2',
]

export function safeColor(c, fallback = '#cccccc') {
	return /^#[0-9a-f]{6}$/i.test(String(c)) ? String(c) : fallback
}

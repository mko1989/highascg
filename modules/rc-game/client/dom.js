/* global window, document, localStorage, fetch, navigator, URLSearchParams */
/**
 * Small DOM / storage / fetch helpers of the RC game client (WO-1074). User text is only ever set via textContent.
 * The client talks to /api/game/rc/* only (contract: the game never touches anything else on the box).
 */

export const API = '/api/game/rc'

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
			else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
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
		const v = localStorage.getItem('rcgame.' + key)
		return v == null ? fallback : v
	} catch {
		return fallback
	}
}

export function storeSet(key, value) {
	try {
		localStorage.setItem('rcgame.' + key, String(value))
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

/** GET a game endpoint as JSON. @returns {Promise<{ ok: boolean, status: number, data: any }>} */
export async function apiGet(path) {
	try {
		const res = await fetch(API + path, { cache: 'no-store', credentials: 'same-origin' })
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

/** sessionStorage (per tab), guarded. */
export function sessGet(key) {
	try {
		return window.sessionStorage.getItem('rcgame.' + key)
	} catch {
		return null
	}
}

export function sessSet(key, value) {
	try {
		if (value == null) window.sessionStorage.removeItem('rcgame.' + key)
		else window.sessionStorage.setItem('rcgame.' + key, String(value))
	} catch {
		/* ignore */
	}
}

/** POST a host action. The API password travels as the session cookie or a `?token=` in the host page's URL. */
export async function apiHost(body) {
	const headers = { 'Content-Type': 'application/json' }
	const token = new URLSearchParams(window.location.search).get('token')
	if (token) headers.Authorization = 'Bearer ' + token
	try {
		const res = await fetch(API + '/host', {
			method: 'POST',
			headers,
			credentials: 'same-origin',
			body: JSON.stringify(body),
		})
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

/** Escape-free colour check for style values. */
export function safeColor(c, fallback = '#cccccc') {
	return /^#[0-9a-f]{6}$/i.test(String(c)) ? String(c) : fallback
}

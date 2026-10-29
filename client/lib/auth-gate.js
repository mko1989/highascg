/**
 * WO-811 — sign-in for the web UI when the server enforces API auth (restores WO-96's gate, deleted in dd17ea3f).
 * One shared password for every client (owner 29.10). POST /api/auth/login sets the existing `highascg_session`
 * cookie (src/api/routes-auth.js); every fetch already sends it (`credentials: 'include'`) and the browser sends it on
 * the /api/ws upgrade, so nothing else in the client changes. With enforcement OFF `/api/auth/status` says so and the
 * gate returns at once — the UI boots exactly as before.
 */

import { getApiBase } from './api-origin.js'

const FETCH_OPTS = { credentials: 'include' }
let _shown = null

function ensureOverlay() {
	let el = document.getElementById('highascg-auth-gate')
	if (el) return el
	el = document.createElement('div')
	el.id = 'highascg-auth-gate'
	el.style.cssText =
		'position:fixed;inset:0;z-index:99999;background:rgba(8,10,14,0.92);display:flex;align-items:center;justify-content:center;font:14px/1.4 system-ui,sans-serif;color:#e8eaed'
	el.innerHTML = GATE_HTML
	document.body.appendChild(el)
	return el
}

/* Static markup, no interpolation (nothing to escape). */
const GATE_HTML = `
		<form id="highascg-auth-form" style="background:#1a1d24;border:1px solid #3c4048;border-radius:8px;padding:24px;width:min(360px,calc(100vw - 32px));box-sizing:border-box">
			<h2 style="margin:0 0 8px;font-size:18px;font-weight:600">Sign in to HighAsCG</h2>
			<p style="margin:0 0 16px;color:#9aa0a6;font-size:13px">This server asks for its password.</p>
			<input id="highascg-auth-password" type="password" autocomplete="current-password" placeholder="Password" aria-label="Password" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:4px;border:1px solid #5f6368;background:#0d1117;color:#e8eaed;font-size:16px;margin-bottom:12px" />
			<p id="highascg-auth-error" style="margin:0 0 12px;color:#f28b82;font-size:13px;display:none"></p>
			<button type="submit" style="width:100%;padding:10px;border:0;border-radius:4px;background:#8ab4f8;color:#202124;font-weight:600;font-size:15px;cursor:pointer">Sign in</button>
		</form>`

/** Show the form until the password is accepted (the cookie is then set). */
function promptLogin() {
	if (_shown) return _shown
	const base = getApiBase()
	const overlay = ensureOverlay()
	const form = /** @type {HTMLFormElement} */ (overlay.querySelector('#highascg-auth-form'))
	const input = /** @type {HTMLInputElement} */ (overlay.querySelector('#highascg-auth-password'))
	const errEl = /** @type {HTMLElement} */ (overlay.querySelector('#highascg-auth-error'))
	input.focus()
	_shown = new Promise((resolve) => {
		form.addEventListener('submit', async (ev) => {
			ev.preventDefault()
			errEl.style.display = 'none'
			try {
				const res = await fetch(`${base}/api/auth/login`, {
					...FETCH_OPTS,
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ password: input.value.trim() }),
				})
				const body = await res.json().catch(() => ({}))
				if (!res.ok) {
					errEl.textContent = res.status === 401 ? 'Wrong password.' : body?.error || `Sign-in failed (${res.status})`
					errEl.style.display = 'block'
					return
				}
				overlay.remove()
				_shown = null
				resolve()
			} catch (e) {
				errEl.textContent = e?.message || 'Sign-in failed'
				errEl.style.display = 'block'
			}
		})
	})
	return _shown
}

/** Before bootstrap: ask only when the server enforces auth and this browser has no valid session. */
export async function ensureAuthGate() {
	let status
	try {
		const res = await fetch(`${getApiBase()}/api/auth/status`, FETCH_OPTS)
		status = await res.json()
	} catch {
		return
	}
	if (!status?.enforceAuth || status?.authenticated) return
	await promptLogin()
}

/** A 401 mid-session (password changed, cookie gone): sign in again, then reload so every view refetches. */
export function noteUnauthorized() {
	if (_shown || typeof document === 'undefined') return
	promptLogin().then(() => {
		try {
			window.location.reload()
		} catch {
			/* non-browser */
		}
	})
}

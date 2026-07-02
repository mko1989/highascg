/**
 * Blocks UI bootstrap until operator authenticates when API auth enforcement is on.
 */

import { getApiBase } from './api-origin.js'

const FETCH_OPTS = { credentials: 'include' }

function ensureOverlay() {
	let el = document.getElementById('highascg-auth-gate')
	if (el) return el
	el = document.createElement('div')
	el.id = 'highascg-auth-gate'
	el.style.cssText =
		'position:fixed;inset:0;z-index:99999;background:rgba(8,10,14,0.92);display:flex;align-items:center;justify-content:center;font:14px/1.4 system-ui,sans-serif;color:#e8eaed'
	el.innerHTML = `
		<form id="highascg-auth-form" style="background:#1a1d24;border:1px solid #3c4048;border-radius:8px;padding:24px;min-width:320px;max-width:90vw">
			<h2 style="margin:0 0 8px;font-size:18px;font-weight:600">Sign in</h2>
			<p style="margin:0 0 16px;color:#9aa0a6;font-size:13px">API authentication is enabled. Enter the operator token from <code>.private/api-token</code>.</p>
			<label style="display:block;margin-bottom:8px;font-size:12px;color:#9aa0a6">API token</label>
			<input id="highascg-auth-token" type="password" autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:4px;border:1px solid #5f6368;background:#0d1117;color:#e8eaed;margin-bottom:12px" />
			<p id="highascg-auth-error" style="margin:0 0 12px;color:#f28b82;font-size:13px;display:none"></p>
			<button type="submit" style="width:100%;padding:10px;border:0;border-radius:4px;background:#8ab4f8;color:#202124;font-weight:600;cursor:pointer">Continue</button>
		</form>`
	document.body.appendChild(el)
	return el
}

/**
 * @returns {Promise<void>}
 */
export async function ensureAuthGate() {
	const base = getApiBase()
	let status
	try {
		const res = await fetch(`${base}/api/auth/status`, FETCH_OPTS)
		status = await res.json()
	} catch {
		return
	}
	if (!status?.enforceAuth || status?.authenticated) return

	const overlay = ensureOverlay()
	const form = /** @type {HTMLFormElement} */ (overlay.querySelector('#highascg-auth-form'))
	const input = /** @type {HTMLInputElement} */ (overlay.querySelector('#highascg-auth-token'))
	const errEl = /** @type {HTMLElement} */ (overlay.querySelector('#highascg-auth-error'))

	await new Promise((resolve) => {
		form.addEventListener('submit', async (ev) => {
			ev.preventDefault()
			errEl.style.display = 'none'
			const token = input.value.trim()
			try {
				const res = await fetch(`${base}/api/auth/login`, {
					...FETCH_OPTS,
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ token }),
				})
				const body = await res.json().catch(() => ({}))
				if (!res.ok) {
					errEl.textContent = body?.error || `Login failed (${res.status})`
					errEl.style.display = 'block'
					return
				}
				overlay.remove()
				resolve()
			} catch (e) {
				errEl.textContent = e?.message || 'Login failed'
				errEl.style.display = 'block'
			}
		})
	})
}

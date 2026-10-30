'use strict'

/**
 * WO-811 phase 2 — sign-in for the served browser pages (phones: /intake, /audio; anything else a browser opens under
 * /api/). They are same-origin, so after POST /api/auth/login sets the `highascg_session` cookie (routes-auth.js) every
 * fetch and WebSocket of theirs carries it. While the server enforces auth, a browser navigation to a gated page gets
 * a 302 here (router-dispatch.js) instead of a bare 401 JSON it cannot act on. `/login` itself is a static page outside
 * /api/ (not gated, holds no secret). With enforcement OFF nothing ever redirects here.
 */

const LOGIN_PATH = '/login'

// WO-830c: browsers strip TAB/CR/LF from URLs, so `/%09/evil.example` decodes to `/\t/evil.example` = `//evil.example`.
// eslint-disable-next-line no-control-regex -- the control characters are the point
const UNSAFE_NEXT_CHARS_RE = /[\u0000-\u001f\u007f\\]/

/** @param {string} s one decoding level of `next` */
function isSameOriginPath(s) {
	return s.startsWith('/') && !s.startsWith('//') && !UNSAFE_NEXT_CHARS_RE.test(s)
}

/**
 * Only same-site absolute paths: a single leading `/`, never `//host`, `/\host`, a scheme, or a control character
 * (raw or after percent-decoding, the way the browser and the page's own redirect see it). Anything else -> '/'.
 */
function safeNext(next) {
	const s = String(next || '')
	if (!isSameOriginPath(s)) return '/'
	try {
		if (!isSameOriginPath(decodeURIComponent(s))) return '/'
	} catch {
		return '/'
	}
	return s
}

/** A browser page load (not fetch/XHR, which ask for JSON). */
function wantsHtml(req) {
	const accept = String(req?.headers?.accept || '')
	return accept.includes('text/html')
}

/** 302 to the sign-in page, back to `path` after. */
function loginRedirect(path) {
	return {
		status: 302,
		headers: { Location: `${LOGIN_PATH}?next=${encodeURIComponent(safeNext(path))}`, 'Cache-Control': 'no-store' },
		body: '',
	}
}

function loginPageHtml() {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HighAsCG sign in</title>
<style>
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0d1117; color: #e8eaed; font: 15px/1.4 system-ui, sans-serif; }
form { background: #1a1d24; border: 1px solid #3c4048; border-radius: 8px; padding: 24px; width: min(360px, calc(100vw - 32px)); box-sizing: border-box; }
h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
.hint { margin: 0 0 16px; color: #9aa0a6; font-size: 13px; }
input { width: 100%; box-sizing: border-box; padding: 10px; border-radius: 4px; border: 1px solid #5f6368; background: #0d1117; color: #e8eaed; font-size: 16px; margin-bottom: 12px; }
button { width: 100%; padding: 10px; border: 0; border-radius: 4px; background: #8ab4f8; color: #202124; font-weight: 600; font-size: 15px; }
#err { color: #f28b82; margin: 0 0 12px; display: none; }
</style>
</head>
<body>
<form id="f">
	<h1>Sign in to HighAsCG</h1>
	<p class="hint">This server asks for its password.</p>
	<input id="pw" type="password" autocomplete="current-password" placeholder="Password" aria-label="Password" autofocus>
	<p id="err"></p>
	<button type="submit">Sign in</button>
</form>
<script>
(function () {
	// WO-830c: same rule as safeNext() in login-page.js (searchParams.get already decoded once; check again for %25xx).
	function ok(p) { return p.charAt(0) === '/' && p.charAt(1) !== '/' && !/[\\u0000-\\u001f\\u007f\\\\]/.test(p) }
	var next = new URLSearchParams(location.search).get('next') || '/'
	try { if (!ok(next) || !ok(decodeURIComponent(next))) next = '/' } catch (e) { next = '/' }
	var err = document.getElementById('err')
	document.getElementById('f').addEventListener('submit', function (ev) {
		ev.preventDefault()
		err.style.display = 'none'
		fetch('/api/auth/login', {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ password: document.getElementById('pw').value.trim() }),
		}).then(function (r) {
			if (r.ok) return location.replace(next)
			err.textContent = r.status === 401 ? 'Wrong password.' : 'Sign-in failed (' + r.status + ')'
			err.style.display = 'block'
		}).catch(function (e) {
			err.textContent = 'Sign-in failed: ' + (e && e.message ? e.message : e)
			err.style.display = 'block'
		})
	})
})()
</script>
</body>
</html>
`
}

module.exports = { LOGIN_PATH, safeNext, wantsHtml, loginRedirect, loginPageHtml }

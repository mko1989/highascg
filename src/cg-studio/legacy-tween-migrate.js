/**
 * WO-1096 — one-time upgrade of CG Studio exports / .gtzip imports written before GSAP was removed.
 *
 * Templates in template/studio/ (export-template.js copies, gtzip-import-html.js output) used to load
 * `../lower-thirds/vendor/gsap.min.js` and call `gsap.timeline / gsap.set / gsap.to / gsap.fromTo`.
 * That vendored file is gone (proprietary GreenSock licence, not redistributable with the AGPL project), so such
 * a file would play nothing. lt-tween.js keeps the same call shape (and the lead-in a timeline `duration` var
 * gave), so the upgrade is textual: the script tag and the `gsap.` prefix. Idempotent; runs at boot.
 */

'use strict'

const fs = require('fs')
const path = require('path')

const LEGACY_SCRIPT_RE = /<script\s+src="([^"]*?)vendor\/gsap\.min\.js"\s*>\s*<\/script>/g
const LEGACY_CALL_RE = /\bgsap\.(timeline|set|to|fromTo)\s*\(/g
const LEGACY_SPEED_RE = /\bgsap\.globalTimeline\.timeScale\s*\(/g

/**
 * @param {string} html
 * @returns {{ html: string, changed: boolean }}
 */
function migrateLegacyTweenHtml(html) {
	const src = String(html || '')
	if (!LEGACY_SCRIPT_RE.test(src)) return { html: src, changed: false }
	LEGACY_SCRIPT_RE.lastIndex = 0
	const out = src
		.replace(LEGACY_SCRIPT_RE, (_m, prefix) => `<script src="${prefix}lt-tween.js"></script>`)
		.replace(LEGACY_SPEED_RE, 'LTTween.timeScale(')
		.replace(LEGACY_CALL_RE, (_m, fn) => `LTTween.${fn}(`)
	return { html: out, changed: out !== src }
}

/**
 * Rewrite every legacy *.html directly in `dir` (non-recursive; template/studio keeps assets in subfolders).
 * @param {string} dir
 * @returns {string[]} the rewritten file names
 */
function migrateLegacyTweenDir(dir) {
	const done = []
	let names
	try {
		names = fs.readdirSync(dir).filter((n) => /\.html?$/i.test(n))
	} catch (_) {
		return done
	}
	for (const name of names) {
		const fp = path.join(dir, name)
		try {
			const { html, changed } = migrateLegacyTweenHtml(fs.readFileSync(fp, 'utf8'))
			if (!changed) continue
			fs.writeFileSync(fp, html)
			done.push(name)
		} catch (_) {
			/* unreadable / read-only file: leave it, the next boot retries */
		}
	}
	return done
}

module.exports = { migrateLegacyTweenHtml, migrateLegacyTweenDir }

'use strict'

/**
 * WO-535 — the playhead never pressed a Companion button, and the flag inspector showed a stale one.
 *
 * Owner 14.08 (`todos14.08.26`):
 *   *"the test press goes thru but the playhead does not trigger a press."*
 *   *"the flag correctly displays the current display of the button, but inside the inspector it
 *     shows a stale button display."*
 *   *"it displays cannot reach companion satelite, and to check companion settings if its enabled.
 *     That is very wrong because the companion sattelite setting CANNOT be turned off."*
 *
 * The asymmetry in report 1 is the whole diagnosis. The settings-modal Test press is pure HTTP
 * (`routes-companion-preview.js:179` → `/api/location/p/r/c/press`). The playhead press tried
 * Satellite first — and `SatellitePreviewClient.pressButton` returns *silently* when its socket is
 * not connected. `_fireCompanionPress` set `satelliteOk = true` unconditionally, because only a
 * synchronous throw could reach its catch. So the press vanished, the HTTP fallback that the Test
 * button proves works was never reached, and nothing was logged.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { SatellitePreviewClient } = require('../../src/companion/satellite-preview-client')
const { resolveCompanionConfig } = require('../../src/companion/companion-config')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

describe('WO-535: pressButton reports whether the press left the box', () => {
	it('a disconnected client returns false, not undefined', () => {
		const c = new SatellitePreviewClient()
		c._connected = false
		assert.equal(c.pressButton(1, 0, 0), false)
	})

	it('a connected client sends KEY-STATE and returns true', () => {
		const c = new SatellitePreviewClient()
		const sent = []
		c._connected = true
		c._send = (line) => sent.push(line)
		assert.equal(c.pressButton(2, 3, 4), true)
		assert.equal(sent.length, 1, 'the press-down goes immediately; the release is on a timer')
		assert.match(sent[0], /KEY-STATE/)
		assert.match(sent[0], /2\/3\/4/)
		assert.match(sent[0], /PRESSED=1/)
	})
})

describe('WO-535/WO-547: the caller no longer touches Satellite at all', () => {
	const src = read('src/engine/timeline-playback.js')

	/* WO-547 (same day, 02.09): trying Satellite before HTTP was itself the bug, not just the
	 * unconditional-true reporting fixed here. Satellite's KEY-STATE is not a real Companion
	 * trigger command — this project's own architecture reference
	 * (docs/reference/companion-satellite-api.md) says pressing stays HTTP-only, and WO-75
	 * explicitly rejected Satellite for triggering ("adds connection state; HTTP is the
	 * established show trigger"). The write succeeded silently and nothing was ever pressed —
	 * confirmed live via journalctl ("sent via Satellite", no error, no press). `_fireCompanionPress`
	 * is HTTP-only again, matching WO-24's original design; `pressButton()` itself is untouched
	 * and still correctly reports its own connection state (tests above), it's just never called
	 * from the timeline press path any more. */
	it('never references pressButton / satelliteOk / getSatellitePreviewClient', () => {
		assert.doesNotMatch(src, /pressButton\(page, row, col\)/)
		assert.doesNotMatch(src, /satelliteOk/)
		assert.doesNotMatch(src, /getSatellitePreviewClient/)
	})

	it('_fireCompanionPress goes straight to fetch(...) with no Satellite branch first', () => {
		const start = src.indexOf('_fireCompanionPress(flag)')
		assert.ok(start > 0, 'found _fireCompanionPress')
		const body = src.slice(start, src.indexOf('_processTimelineFlags', start))
		assert.match(body, /fetch\(url, \{/)
		assert.doesNotMatch(body, /require\('\.\.\/companion\/satellite-preview-client'\)/)
	})

	it('the HTTP fallback resolves its host/port the same way everything else does', () => {
		assert.match(src, /const \{ host, port \} = resolveCompanionConfig\(this\.self\?\.config\)/)
		assert.doesNotMatch(src, /comp\.port \|\| 8000/, 'a second, drifting default')
	})

	it('and that resolver is what the status probe and Test press agree on', () => {
		// The live box runs Companion on 8001; the shared resolver is the only reason all three
		// surfaces reach it.
		assert.equal(resolveCompanionConfig({ companion: { port: 8001 } }).port, 8001)
		assert.equal(resolveCompanionConfig({}).port, 8000, 'default unchanged')
	})
})

describe('WO-535: the flag inspector preview is cache-busted like the flag thumb', () => {
	it('the mtime the thumb busts on is exported', () => {
		assert.match(
			read('client/lib/companion-button-preview-url.js'),
			/export function latestCompanionButtonPreviewMtime\(page, row, column\)/,
		)
	})

	it('the inspector passes it into its first src', () => {
		assert.match(
			read('client/components/inspector-panel-timeline-flag.js'),
			/previewImg\.src = companionButtonPreviewUrl\(\s*coords\.page,\s*coords\.row,\s*coords\.column,\s*latestCompanionButtonPreviewMtime\(coords\.page, coords\.row, coords\.column\),\s*\)/,
			'a bare url is served from the browser cache — the stale button',
		)
	})
})

describe('WO-535: the unavailable message names what is actually missing', () => {
	const src = read('client/components/inspector-panel-timeline-flag.js')

	it('the blanket "enable Satellite + Subscriptions" sentence is gone', () => {
		assert.doesNotMatch(src, /Enable Satellite \+ Button Subscriptions API in Companion Settings/)
		assert.match(src, /companionPreviewUnavailableText\(st\?\.reason\)/)
	})

	it('a connected-but-unsubscribed Satellite is not blamed for being off', () => {
		const m = src.match(/case 'subscriptions_disabled':\s*\n\s*return '([^']*)'/)
		assert.ok(m, 'the reason is handled explicitly')
		assert.match(m[1], /Satellite is connected/)
	})

	it('a reconnect is described as a reconnect, not a misconfiguration', () => {
		const m = src.match(/case 'satellite_reconnecting':\s*\n\s*return '([^']*)'/)
		assert.ok(m)
		assert.doesNotMatch(m[1], /Settings/)
	})
})

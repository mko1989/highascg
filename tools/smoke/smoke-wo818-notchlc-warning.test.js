'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

describe('WO-818 NotchLC warning mark in the media list', () => {
	it('isNotchLcMedia: the probed codec decides, case-insensitive', async () => {
		const { isNotchLcMedia } = await import('../../client/lib/media-notchlc.js')
		assert.equal(isNotchLcMedia({ id: 'mhp_harder/VISUALE.mov', codec: 'notchlc' }), true)
		assert.equal(isNotchLcMedia({ id: 'a.mov', codec: 'NotchLC' }), true)
		assert.equal(isNotchLcMedia({ id: 'NOTCH/AKT_1/WIZYTOWKA_L_1_1_HAP.mov', codec: 'hap' }), false)
		assert.equal(isNotchLcMedia({ id: 'clips/intro_notchlc.mov', codec: 'hap' }), false, 'a known codec beats the name')
	})

	it('isNotchLcMedia: the file name only when no codec is known', async () => {
		const { isNotchLcMedia } = await import('../../client/lib/media-notchlc.js')
		assert.equal(isNotchLcMedia({ id: 'clips/intro_NotchLC.mov' }), true)
		assert.equal(isNotchLcMedia({ id: 'clips/intro_notchlc.mov', codec: null }), true)
		assert.equal(isNotchLcMedia({ label: 'x/notchlc_loop.mov', codec: '' }), true)
		assert.equal(isNotchLcMedia({ id: 'projects/NOTCHLC/clip.mov' }), false, 'a folder name is not the file')
		assert.equal(isNotchLcMedia({ id: 'clips/intro.mov' }), false)
		assert.equal(isNotchLcMedia(undefined), false)
	})

	it('tooltip is two lines and matches the Godot text', async () => {
		const { NOTCHLC_WARNING } = await import('../../client/lib/media-notchlc.js')
		assert.equal(NOTCHLC_WARNING.split('\n').length, 2)
		assert.ok(NOTCHLC_WARNING.includes('transcode it to HAP in HighAsCG'), 'points at the in-app HAP transcode')
		assert.ok(NOTCHLC_WARNING.includes('GPU') && NOTCHLC_WARNING.includes('CPU'), 'WO-820: GPU on the HighAsCG build, CPU on stock')
		assert.ok(!NOTCHLC_WARNING.includes('ffmpeg'), 'no command line: HighAsCG transcodes to HAP itself')
		const gd = fs.readFileSync(path.join(__dirname, '../../godot/client/features/live/media_ops.gd'), 'utf8')
		assert.ok(gd.includes(JSON.stringify(NOTCHLC_WARNING)), 'Godot NOTCHLC_TIP is the same text')
	})

	it('the media row renders the mark next to the label', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../client/components/sources-panel-media.js'), 'utf8')
		assert.match(src, /isNotchLcMedia\(item\) \? `<span class="source-item__warn" title="\$\{escapeHtml\(NOTCHLC_WARNING\)\}">⚠<\/span>`/)
	})
})

'use strict'

/**
 * WO-779 — HDMI/DP audio PCMs ("HDMI n" even on DisplayPort) are labelled with what is plugged in: ELD + jack from
 * `amixer contents`, connector from the EDID that matches the ELD and declares audio. Fixtures = the box on 26.10
 * (switcher "P80" on DP-4 = hw:1,3, same EDID name on DP-0 without audio). No hardware touched.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { parseEld, parseAmixerContents, edidHasAudio, annotateHdmiSinks } = require('../../src/audio/hdmi-sinks')

const P80_ELD =
	'0x10,0x00,0x07,0x00,0x63,0x24,0x00,0x00,0x00,0x10,0x00,0x00,0x00,0x00,0x00,0x00,0x39,0xf6,0x5e,0xe4,0x50,0x38,0x30,0x0f,0x07,0x07,0x4d,0x07,0x00,0x00'

const AMIXER = [
	"numid=1,iface=CARD,name='HDMI/DP,pcm=3 Jack'",
	'  ; type=BOOLEAN,access=r------,values=1',
	'  : values=on',
	"numid=7,iface=CARD,name='HDMI/DP,pcm=7 Jack'",
	'  ; type=BOOLEAN,access=r------,values=1',
	'  : values=off',
	"numid=5,iface=MIXER,name='IEC958 Playback Switch'",
	'  : values=on',
	"numid=6,iface=PCM,name='ELD',device=3",
	'  ; type=BYTES,access=r--v----,values=95',
	`  : values=${P80_ELD}`,
	"numid=12,iface=PCM,name='ELD',device=7",
	'  ; type=BYTES,access=r--v----,values=0',
	'  : values=',
].join('\n')

/** 256-byte EDID: NOV/0xe45e "P80", CEA extension with or without the basic-audio flag. */
function edid(audio) {
	const b = Buffer.alloc(256)
	Buffer.from([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00, 0x39, 0xf6, 0x5e, 0xe4]).copy(b)
	b[126] = 1
	b[128] = 0x02
	b[129] = 3
	b[130] = 4
	b[131] = audio ? 0x40 : 0x00
	return b.toString('hex')
}

const CATALOG = {
	byXrandr: new Map([
		[
			'DP-0',
			{ raw: edid(false), parsed: { pnpId: 'NOV', productCode: 0xe45e }, source: 'xrandr-verbose', xrandrName: 'DP-0' },
		],
		[
			'DP-4',
			{ raw: edid(true), parsed: { pnpId: 'NOV', productCode: 0xe45e }, source: 'xrandr-verbose', xrandrName: 'DP-4' },
		],
		// sysfs alias of DP-4 (NVIDIA DRM numbering) — ignored while xrandr rows exist
		['DP-3', { raw: edid(true), parsed: { pnpId: 'NOV', productCode: 0xe45e }, source: 'sysfs', xrandrName: 'DP-3' }],
	]),
}

const DEVICES = [
	{ id: 'hw:0,0', name: 'PCH [HDA Intel PCH] — ALC1220 Analog [ALC1220 Analog]', maxOutputChannels: 16 },
	{ id: 'hw:1,3', name: 'NVidia [HDA NVidia] — HDMI 0 [HDMI 0 *]', maxOutputChannels: 16 },
	{ id: 'hw:1,7', name: 'NVidia [HDA NVidia] — HDMI 1 [HDMI 1]', maxOutputChannels: 16 },
]

describe('WO-779 HDMI/DP sink labels', () => {
	it('parses the ELD: monitor, DisplayPort, LPCM 8 ch, EDID manufacturer/product', () => {
		const e = parseEld(P80_ELD.split(',').map((x) => parseInt(x, 16)))
		assert.equal(e.monitorName, 'P80')
		assert.equal(e.connection, 'DisplayPort')
		assert.equal(e.channels, 8)
		assert.equal(e.pnpId, 'NOV')
		assert.equal(e.productCode, 0xe45e)
		assert.deepEqual(
			e.sads.map((s) => s.format),
			['LPCM', 'DSD']
		)
	})

	it('reads jack + ELD per PCM device from amixer contents (empty ELD = null)', () => {
		const m = parseAmixerContents(AMIXER)
		assert.equal(m.get(3).jack, true)
		assert.equal(m.get(3).eld.length, 30)
		assert.equal(m.get(7).jack, false)
		assert.equal(m.get(7).eld, null)
	})

	it('only the EDID with a CEA audio declaration counts', () => {
		assert.equal(edidHasAudio(edid(true)), true)
		assert.equal(edidHasAudio(edid(false)), false)
	})

	it('labels the connected sink with its connector, keeps id/name, real channel count; empty port says so', () => {
		const out = annotateHdmiSinks(DEVICES, { run: () => AMIXER, catalog: CATALOG })
		assert.equal(out[0], DEVICES[0], 'non-HDMI device untouched')
		assert.equal(out[1].id, 'hw:1,3')
		assert.equal(out[1].name, DEVICES[1].name)
		assert.equal(out[1].label, 'HDMI 0 → DP-4 · P80 (DisplayPort, 8 ch)')
		assert.equal(out[1].maxOutputChannels, 8)
		assert.equal(out[2].label, 'HDMI 1 — nothing connected')
		assert.equal(out[2].maxOutputChannels, 16)
	})

	it('both device pickers show the label', () => {
		const root = path.join(__dirname, '..', '..')
		const web = fs.readFileSync(path.join(root, 'client/components/device-view-inspector-audio.js'), 'utf8')
		assert.match(web, /opt\.textContent = d\?\.label \? String\(d\.label\)/)
		const gd = fs.readFileSync(path.join(root, 'godot/client/features/devices/vcam_audio_model.gd'), 'utf8')
		assert.match(gd, /if H\.truthy\(dd\.get\("label"\)\):/)
	})
})

'use strict'

/**
 * WO-779 follow-up (owner 29.10) — the pre-launch unmute turns on ONLY the IEC958 Playback Switch of the audio output
 * set in Devices (audio_outputs.json); other switches stay as the operator left them, non-HDMI outputs touch nothing,
 * and an unresolvable mapping switches nothing (never "all on"). Fixtures = `amixer -c 1 controls` on the box (26.10).
 * amixer is a stub (HIGHASCG_AMIXER) that logs cset calls — no real mixer is touched.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..', '..')
const sel = require('../../src/audio/hdmi-iec958-select')

/** The box's NVIDIA card: per HDMI PCM jack → IEC958 set (index = rank) → ELD. */
const NVIDIA = [
	[1, 'CARD', 'HDMI/DP,pcm=3 Jack', ''],
	[7, 'CARD', 'HDMI/DP,pcm=7 Jack', ''],
	[13, 'CARD', 'HDMI/DP,pcm=8 Jack', ''],
	[19, 'CARD', 'HDMI/DP,pcm=9 Jack', ''],
	[2, 'MIXER', 'IEC958 Playback Con Mask', ''],
	[5, 'MIXER', 'IEC958 Playback Switch', ''],
	[11, 'MIXER', 'IEC958 Playback Switch', ',index=1'],
	[17, 'MIXER', 'IEC958 Playback Switch', ',index=2'],
	[23, 'MIXER', 'IEC958 Playback Switch', ',index=3'],
	[6, 'PCM', 'ELD', ',device=3'],
	[12, 'PCM', 'ELD', ',device=7'],
	[18, 'PCM', 'ELD', ',device=8'],
	[24, 'PCM', 'ELD', ',device=9'],
	[25, 'PCM', 'Playback Channel Map', ',device=3'],
]
	.map(([n, i, name, rest]) => `numid=${n},iface=${i},name='${name}'${rest}`)
	.join('\n')
/** Onboard codec: an S/PDIF switch, no HDMI jack. */
const PCH = ["numid=40,iface=MIXER,name='IEC958 Playback Switch'", "numid=36,iface=CARD,name='Front Headphone Jack'"].join('\n')
const USB = "numid=7,iface=MIXER,name='Speaker Playback Switch'"
const CARDS = [
	' 0 [PCH            ]: HDA-Intel - HDA Intel PCH',
	' 1 [NVidia         ]: HDA-Intel - HDA NVidia',
	' 2 [Lync           ]: USB-Audio - Sennheiser SC60 for Lync',
].join('\n')
const CONTROLS = { 0: PCH, 1: NVIDIA, 2: USB }

const pa = (deviceName, extra = {}) => ({ id: 'audio_1', type: 'portaudio', enabled: true, deviceName, ...extra })
const MONITOR = { id: 'audio_2', type: 'system-audio', enabled: true, deviceName: 'sc60mon', role: 'monitor' }

describe('WO-779 follow-up: selected output → its IEC958 switch only (offline)', () => {
	const ctl = sel.parseAmixerControls(NVIDIA)

	it('maps each HDMI PCM to its own switch (index = rank, inside the PCM’s jack…ELD block)', () => {
		assert.deepEqual(
			[3, 7, 8, 9].map((pcm) => sel.switchForPcm(ctl, { pcm })),
			[
				{ ok: true, pcm: 3, index: 0, numid: 5 },
				{ ok: true, pcm: 7, index: 1, numid: 11 },
				{ ok: true, pcm: 8, index: 2, numid: 17 },
				{ ok: true, pcm: 9, index: 3, numid: 23 },
			]
		)
		assert.equal(sel.switchForPcm(ctl, { hdmiRank: 2 }).numid, 17)
		assert.equal(sel.switchForPcm(ctl, { pcm: 0 }).notHdmi, true)
	})

	it('refuses when numid order contradicts the index (all jacks first) or counts differ', () => {
		const jacksFirst = sel.parseAmixerControls(
			[1, 2, 3, 4]
				.map((n, i) => `numid=${n},iface=CARD,name='HDMI/DP,pcm=${[3, 7, 8, 9][i]} Jack'`)
				.concat([5, 6, 7, 8].map((n, i) => `numid=${n},iface=MIXER,name='IEC958 Playback Switch'${i ? `,index=${i}` : ''}`))
				.join('\n')
		)
		assert.equal(sel.switchForPcm(jacksFirst, { pcm: 3 }).ok, false)
		const short = sel.parseAmixerControls(NVIDIA.replace(/numid=23,[^\n]*\n/, ''))
		assert.match(/** @type {any} */ (sel.switchForPcm(short, { pcm: 3 })).reason, /4 HDMI jack\(s\) vs 3/)
	})

	it('reads hw:/plughw:/naudiodon/CARD= names; unknown names stay unresolved', () => {
		const ids = sel.parseAsoundCards(CARDS)
		assert.deepEqual(sel.parseDeviceName('hw:1,3', ids), { card: 1, pcm: 3 })
		assert.deepEqual(sel.parseDeviceName('plughw:1,7', ids), { card: 1, pcm: 7 })
		assert.deepEqual(sel.parseDeviceName('HDA NVidia: HDMI 1 (hw:1,7)', ids), { card: 1, pcm: 7 })
		assert.deepEqual(sel.parseDeviceName('hw:CARD=NVidia,DEV=8', ids), { card: 1, pcm: 8 })
		assert.deepEqual(sel.parseDeviceName('hdmi:CARD=NVidia,DEV=1', ids), { card: 1, hdmiRank: 1 })
		assert.equal(sel.parseDeviceName('sc60mon', ids), null)
		assert.equal(sel.parseDeviceName('', ids), null)
	})

	it('selected = the server’s one PortAudio row (WO-683) + enabled system-audio rows', () => {
		const rows = [pa('hw:1,3'), pa('hw:1,9', { id: 'audio_3' }), { ...MONITOR, id: 'audio_4', enabled: false }, MONITOR]
		assert.deepEqual(sel.selectedAudioOutputs(rows), [
			{ id: 'audio_1', deviceName: 'hw:1,3' },
			{ id: 'audio_2', deviceName: 'sc60mon' },
		])
	})

	it('resolve: one switch for the PortAudio output, a note for the monitor', () => {
		const r = sel.resolveSelectedIec958({ audioOutputs: [pa('hw:1,8'), MONITOR], cardsText: CARDS, controls: (c) => CONTROLS[c] })
		assert.deepEqual(r.on, [{ card: 1, numid: 17, index: 2, what: 'audio_1:hw:1,8' }])
		assert.equal(r.notes.length, 1)
		assert.match(r.notes[0], /audio_2 sc60mon: not an ALSA hw device/)
	})
})

describe('WO-779 follow-up: unmute-hdmi-audio.sh end to end with a stub amixer', () => {
	let dir
	const script = path.join(ROOT, 'tools', 'runtime', 'unmute-hdmi-audio.sh')

	before(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo779-iec958-'))
		for (const [c, text] of Object.entries(CONTROLS)) fs.writeFileSync(path.join(dir, `controls-${c}.txt`), text + '\n')
		fs.writeFileSync(path.join(dir, 'cards'), CARDS + '\n')
		const stub = [
			'#!/bin/sh',
			`D='${dir}'`,
			'echo "$*" >> "$D/calls.log"',
			'[ "$1" = "-q" ] && shift',
			'[ "$1" = "-c" ] || exit 1',
			'case "$3" in controls) cat "$D/controls-$2.txt" ;; cset) exit 0 ;; *) exit 1 ;; esac',
		].join('\n')
		fs.writeFileSync(path.join(dir, 'amixer'), stub + '\n', { mode: 0o755 })
	})
	after(() => fs.rmSync(dir, { recursive: true, force: true }))

	function run(audioOutputs) {
		const cfg = path.join(dir, 'config')
		fs.rmSync(cfg, { recursive: true, force: true })
		fs.mkdirSync(cfg)
		if (audioOutputs) fs.writeFileSync(path.join(cfg, 'audio_outputs.json'), JSON.stringify(audioOutputs))
		fs.rmSync(path.join(dir, 'calls.log'), { force: true })
		const env = { ...process.env, HIGHASCG_AMIXER: path.join(dir, 'amixer'), HIGHASCG_ASOUND_CARDS: path.join(dir, 'cards') }
		const r = spawnSync('sh', [script, cfg], { encoding: 'utf8', env, timeout: 15000 })
		assert.equal(r.status, 0, r.stderr)
		const log = fs.existsSync(path.join(dir, 'calls.log')) ? fs.readFileSync(path.join(dir, 'calls.log'), 'utf8') : ''
		return { out: r.stdout.trim(), csets: log.split('\n').filter((l) => / cset /.test(l)) }
	}

	it('selected HDMI 1 (hw:1,7): only numid 11 is set on, others untouched; one summary line', () => {
		const { out, csets } = run([pa('hw:1,7'), MONITOR])
		assert.deepEqual(csets, ['-q -c 1 cset numid=11 on'])
		assert.equal(out.split('\n').length, 1)
		assert.match(out, /^\[unmute-hdmi-audio\] on: audio_1:hw:1,7 \(card 1 numid 11\) — audio_2 sc60mon: not an ALSA hw device/)
	})

	it('USB headset or onboard S/PDIF selected: no switch is touched', () => {
		for (const dev of ['hw:2,0', 'hw:0,1']) {
			const { out, csets } = run([pa(dev)])
			assert.deepEqual(csets, [], dev)
			assert.match(out, /on: none — audio_1 hw:\d,\d: not HDMI\/DP — HDMI switches untouched/)
		}
	})

	it('no audio_outputs.json / nothing set: nothing is switched, never "all on"', () => {
		let r = run(null)
		assert.deepEqual(r.csets, [])
		assert.match(r.out, /on: none — cannot read audio outputs/)
		r = run([])
		assert.deepEqual(r.csets, [])
		assert.match(r.out, /on: none — no audio output set in Devices/)
	})

	it('run.sh passes the HighAsCG config dir to the script', () => {
		const src = fs.readFileSync(path.join(ROOT, 'run.sh'), 'utf8')
		assert.match(src, /unmute-hdmi-audio\.sh" "\$\{HIGHASCG_CONFIG_PATH:-\$CASPAR_ROOT\/config\}"/)
	})
})

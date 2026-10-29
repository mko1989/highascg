#!/usr/bin/env node
'use strict'

/**
 * WO-779 follow-up — unmute-hdmi-audio.sh asks this which IEC958 Playback Switch(es) belong to the audio output(s)
 * set in the Devices tab (src/audio/hdmi-iec958-select.js). Read-only: runs `amixer -c C controls`, never cset.
 *
 *   node tools/runtime/selected-hdmi-iec958.js [<config dir | config .json>]
 *
 * stdout, one per line:  `on <card> <numid> <index> <what>`  — the switch to turn on
 *                        `note <text>`                       — why nothing is switched for an output
 * Test seams: HIGHASCG_AMIXER (amixer binary), HIGHASCG_ASOUND_CARDS (/proc/asound/cards path).
 * Best-effort by contract: any failure prints a note and exits 0.
 */

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { resolveSelectedIec958 } = require('../../src/audio/hdmi-iec958-select')

function readAudioOutputs(cfg) {
	const st = fs.statSync(cfg)
	if (st.isDirectory()) return JSON.parse(fs.readFileSync(path.join(cfg, 'audio_outputs.json'), 'utf8'))
	return JSON.parse(fs.readFileSync(cfg, 'utf8')).audioOutputs
}

function main(argv, env) {
	const cfg = argv[0] || path.join(__dirname, '..', '..', 'config')
	let audioOutputs
	try {
		audioOutputs = readAudioOutputs(cfg)
	} catch (e) {
		return [`note cannot read audio outputs from ${cfg}: ${e.code || e.message} — HDMI switches untouched`]
	}
	let cardsText = ''
	try {
		cardsText = fs.readFileSync(env.HIGHASCG_ASOUND_CARDS || '/proc/asound/cards', 'utf8')
	} catch {}
	const amixer = env.HIGHASCG_AMIXER || 'amixer'
	const controls = (card) => {
		const r = spawnSync(amixer, ['-c', String(card), 'controls'], { encoding: 'utf8', timeout: 2000 })
		return r.status === 0 ? r.stdout : ''
	}
	const r = resolveSelectedIec958({ audioOutputs, cardsText, controls })
	return [
		...r.on.map((s) => `on ${s.card} ${s.numid} ${s.index} ${s.what.replace(/\s+/g, '_')}`),
		...r.notes.map((n) => `note ${n.replace(/\s+/g, ' ')}`),
	]
}

if (require.main === module) {
	let lines
	try {
		lines = main(process.argv.slice(2), process.env)
	} catch (e) {
		lines = [`note error: ${e.message} — HDMI switches untouched`]
	}
	if (lines.length) console.log(lines.join('\n'))
	process.exit(0)
}

module.exports = { main }

'use strict'

/**
 * WO-779: what is actually plugged into each HDMI/DP audio PCM. NVIDIA (and other HDA HDMI codecs) name every PCM
 * "HDMI n" — DisplayPort included — and bind PCMs to pins dynamically, so the name says nothing about the connector.
 * The card's per-PCM `ELD` control (the sink's audio EDID: monitor name, HDMI/DP, LPCM channels) and the
 * `HDMI/DP,pcm=N Jack` control say what is connected; the EDID (manufacturer + product + CEA audio) ties it to the
 * xrandr output (DP-4…). One `amixer -c C contents` per card; the EDID catalog is the cached gpu-edid-probe one.
 */

const { spawnSync } = require('child_process')
const { decodePnpId } = require('../utils/edid-parse')

const SAD_FORMATS = { 1: 'LPCM', 2: 'AC-3', 7: 'DTS', 9: 'DSD', 10: 'E-AC-3', 11: 'DTS-HD', 12: 'TrueHD' }

/**
 * ELD v2 (HDA spec 7.3.3.34.1): baseline at byte 4 — [4] cea ver | MNL, [5] SAD count | conn type, [16..19] the EDID's
 * manufacturer + product bytes, [20..] monitor name, then 3-byte SADs.
 * @param {number[] | Buffer} b
 */
function parseEld(b) {
	if (!b || b.length < 20) return null
	const mnl = b[4] & 0x1f
	const sadCount = (b[5] >> 4) & 0x0f
	const conn = (b[5] >> 2) & 0x03
	const name = Buffer.from(Array.from(b).slice(20, 20 + mnl))
		.toString('latin1')
		.replace(/\0+$/, '')
		.trim()
	const sads = []
	for (let i = 0; i < sadCount; i++) {
		const o = 20 + mnl + i * 3
		if (o + 2 >= b.length) break
		const code = (b[o] >> 3) & 0x0f
		sads.push({ format: SAD_FORMATS[code] || `code ${code}`, channels: (b[o] & 0x07) + 1 })
	}
	const lpcm = sads.filter((s) => s.format === 'LPCM').map((s) => s.channels)
	return {
		monitorName: name,
		connection: conn === 1 ? 'DisplayPort' : conn === 0 ? 'HDMI' : 'unknown',
		pnpId: decodePnpId(b[16], b[17]),
		productCode: b[18] | (b[19] << 8),
		sads,
		channels: lpcm.length ? Math.max(...lpcm) : 2,
	}
}

/**
 * `amixer -c C contents` → per PCM device: ELD bytes and jack state.
 * @param {string} text
 * @returns {Map<number, { eld: number[] | null, jack: boolean | null }>}
 */
function parseAmixerContents(text) {
	/** @type {Map<number, { eld: number[] | null, jack: boolean | null }>} */
	const out = new Map()
	const at = (d) => {
		if (!out.has(d)) out.set(d, { eld: null, jack: null })
		return out.get(d)
	}
	let cur = null
	for (const line of String(text || '').split('\n')) {
		const head = line.match(/^numid=\d+,iface=(\w+),name='([^']*)'(?:,device=(\d+))?/)
		if (head) {
			const jack = head[2].match(/^HDMI\/DP,pcm=(\d+) Jack$/)
			if (jack) cur = { kind: 'jack', dev: parseInt(jack[1], 10) }
			else if (head[1] === 'PCM' && head[2] === 'ELD' && head[3] != null) cur = { kind: 'eld', dev: parseInt(head[3], 10) }
			else cur = null
			continue
		}
		const vals = line.match(/^\s*: values=(.*)$/)
		if (!vals || !cur) continue
		const row = at(cur.dev)
		if (cur.kind === 'jack') row.jack = vals[1].trim() === 'on'
		else {
			const bytes = vals[1]
				.split(',')
				.map((x) => parseInt(x, 16))
				.filter((n) => Number.isFinite(n))
			row.eld = bytes.length ? bytes : null
		}
		cur = null
	}
	return out
}

/** The EDID's CEA-861 extension declares audio (basic-audio flag or an audio data block). */
function edidHasAudio(rawHex) {
	const b = Buffer.from(String(rawHex || '').replace(/[^0-9a-fA-F]/g, ''), 'hex')
	for (let off = 128; off + 128 <= b.length; off += 128) {
		if (b[off] !== 0x02) continue
		if (b[off + 3] & 0x40) return true
		const end = off + Math.min(b[off + 2] || 4, 127)
		for (let p = off + 4; p < end; p += (b[p] & 0x1f) + 1) if (b[p] >> 5 === 1) return true
	}
	return false
}

/**
 * xrandr outputs whose EDID is this sink's (same manufacturer + product) and declares audio — the switcher "P80" sends
 * the same EDID name on its operator and audio inputs, only the audio one carries a CEA audio block. sysfs/modetest
 * rows are only used when xrandr gave nothing (their DRM port numbers differ from xrandr's on NVIDIA).
 * @param {ReturnType<typeof parseEld>} eld
 * @param {{ byXrandr: Map<string, { raw: string, parsed: any, source: string, xrandrName: string }> } | null} catalog
 */
function matchConnectors(eld, catalog) {
	if (!eld || !catalog?.byXrandr) return []
	const rows = [...catalog.byXrandr.values()]
	const xr = rows.filter((r) => r.source === 'xrandr-verbose')
	const pool = xr.length ? xr : rows
	return pool
		.filter((r) => r.parsed && r.parsed.pnpId === eld.pnpId && r.parsed.productCode === eld.productCode)
		.filter((r) => edidHasAudio(r.raw))
		.map((r) => r.xrandrName)
		.sort()
}

/**
 * @param {number[]} cards ALSA card indices to probe
 * @param {{ run?: (card: number) => string, catalog?: any }} [opts] test seams
 * @returns {Map<string, { connected: boolean, monitorName: string, connection: string, channels: number, sads: any[], connectors: string[] }>} keyed `hw:C,D`
 */
function probeHdmiSinks(cards, opts = {}) {
	const run =
		opts.run ||
		((c) => {
			const r = spawnSync('amixer', ['-c', String(c), 'contents'], { encoding: 'utf8', timeout: 2000 })
			return r.status === 0 ? r.stdout : ''
		})
	let catalog = opts.catalog
	const out = new Map()
	for (const c of cards) {
		for (const [dev, row] of parseAmixerContents(run(c))) {
			if (row.jack == null && row.eld == null) continue
			const eld = row.eld ? parseEld(row.eld) : null
			if (eld && catalog === undefined) {
				try {
					catalog = require('../utils/gpu-edid-probe').probeGpuEdidCatalog()
				} catch {
					catalog = null
				}
			}
			out.set(`hw:${c},${dev}`, {
				connected: row.jack === true || !!eld,
				monitorName: eld?.monitorName || '',
				connection: eld?.connection || '',
				channels: eld?.channels || 0,
				sads: eld?.sads || [],
				connectors: matchConnectors(eld, catalog),
			})
		}
	}
	return out
}

/**
 * "HDMI 0 → DP-4 · P80 (DisplayPort, 8 ch)" / "HDMI 1 — nothing connected".
 * @param {string} pcmName short ALSA PCM name, e.g. "HDMI 0"
 * @param {ReturnType<typeof probeHdmiSinks> extends Map<string, infer V> ? V : never} sink
 */
function sinkLabel(pcmName, sink) {
	if (!sink.connected) return `${pcmName} — nothing connected`
	const to = sink.connectors.length ? ` → ${sink.connectors.join(' / ')}` : ''
	const mon = sink.monitorName ? ` · ${sink.monitorName}` : ''
	const det = [sink.connection, sink.channels ? `${sink.channels} ch` : ''].filter(Boolean).join(', ')
	return `${pcmName}${to}${mon}${det ? ` (${det})` : ''}`
}

/**
 * Adds `label` + `sink` to HDMI/DP PCM entries of a PortAudio/ALSA device list (id `hw:C,D`, or naudiodon's
 * "… (hw:C,D)" name); a connected sink's LPCM channel count replaces the placeholder maxOutputChannels. `id`/`name`
 * stay untouched — they are what gets saved and what Caspar matches.
 * @template {{ id: any, name: string, maxOutputChannels: number }} D
 * @param {D[]} devices
 * @param {Parameters<typeof probeHdmiSinks>[1]} [opts]
 * @returns {D[]}
 */
function annotateHdmiSinks(devices, opts = {}) {
	const hwOf = (d) => {
		const m = `${d.id} ${d.name}`.match(/hw:(\d+),(\d+)/)
		return m ? `hw:${m[1]},${m[2]}` : ''
	}
	const hdmi = devices.filter((d) => /hdmi|displayport|\bdp\b/i.test(d.name) && hwOf(d))
	if (!hdmi.length) return devices
	const cards = [...new Set(hdmi.map((d) => parseInt(hwOf(d).slice(3), 10)))]
	let sinks
	try {
		sinks = probeHdmiSinks(cards, opts)
	} catch {
		return devices
	}
	return devices.map((d) => {
		const sink = hdmi.includes(d) ? sinks.get(hwOf(d)) : null
		if (!sink) return d
		const pcm = (d.name.match(/(?:—|:)\s*((?:HDMI|DP)[^[(]*?)\s*(?:\[|\(|$)/i) || [])[1] || hwOf(d)
		return {
			...d,
			label: sinkLabel(pcm, sink),
			sink,
			...(sink.connected && sink.channels ? { maxOutputChannels: sink.channels } : {}),
		}
	})
}

module.exports = {
	annotateHdmiSinks,
	parseEld,
	parseAmixerContents,
	edidHasAudio,
	matchConnectors,
	probeHdmiSinks,
	sinkLabel,
}

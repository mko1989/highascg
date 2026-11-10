'use strict'

/**
 * WO-1029 apply harness — the playback and consumer model of the fake Caspar (fake-caspar.js), split out so both files
 * stay readable. Pure functions over plain objects; the fake owns the state and the clock.
 *
 * A clip on a layer: { source, kind, args, playing, loop, length (s), at (s: position at `since`), since (ms) }.
 *   position now = paused ? at : at + (now - since) / 1000, wrapped modulo `length` when looping, held at `length`
 *   (last frame, still "playing" like a real producer) when not. Only kind 'clip' has a position.
 * This build: `SEEK n` (the PLAY / LOADBG / LOAD argument and `CALL ch-l SEEK n`) = n CHANNEL frames, so the seconds are
 * n / fps of the channel the layer is on (see src/engine/timeline-scrub-gate.js, memory "SEEK = channel frames").
 *
 * INFO <ch> mirrors the real server's state tree (src-v2 core/video_channel.cpp, av_producer.cpp update_state,
 * output.cpp): channel.{format, framerate, stage.layer.layer_N.{foreground,background}, output.port.port_N.consumer};
 * a clip's foreground: producer, file.{name, path, time(position), time(length), clip(in), clip(duration)}, loop, paused.
 */

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Channel frame rate from a Caspar video-mode name: 1080p5000 → 50, 720p2500 → 25, 1080i5000 → 25 (frames), PAL → 25. */
function fpsOfMode(mode) {
	const m = /(\d+)([pi])(\d{4})$/i.exec(String(mode || ''))
	if (m) return Number(m[3]) / 100 / (m[2].toLowerCase() === 'i' ? 2 : 1)
	if (/^pal$/i.test(mode)) return 25
	if (/^ntsc$/i.test(mode)) return 29.97
	return 50
}

/** `LOOP`, `SEEK n` (channel frames → seconds) out of a PLAY / LOADBG / LOAD argument tail. */
function parseArgs(args, fps) {
	const s = String(args || '')
	const seek = /\bSEEK\s+(\d+)/i.exec(s)
	return { loop: /\bLOOP\b/i.test(s), seekS: seek ? Number(seek[1]) / fps : 0 }
}

function makeClip({ source, kind, args, fps, length, now, playing, at }) {
	const a = parseArgs(args, fps)
	return { source, kind, args, playing: !!playing, loop: a.loop, length, at: at ?? a.seekS, since: now }
}

/** Position in seconds right now (null = not a clip). */
function positionOf(fg, now) {
	if (!fg || fg.kind !== 'clip') return null
	let p = fg.playing ? fg.at + (now - fg.since) / 1000 : fg.at
	if (fg.loop && fg.length > 0) p %= fg.length
	return Math.min(p, fg.length)
}

/** Freeze / resume / move without losing the position (the clip object is mutated). */
function setPlaying(fg, playing, now) {
	if (!fg || fg.playing === playing) return
	fg.at = positionOf(fg, now) ?? 0
	fg.since = now
	fg.playing = playing
}

function seekTo(fg, seconds, now) {
	if (!fg || fg.kind !== 'clip') return
	fg.at = Math.max(0, Math.min(seconds, fg.length))
	fg.since = now
}

/** The consumer name the real server reports (`screen`, `ffmpeg[udp://…]`, `shm[NAME]`…) from an ADD line's tail. */
function consumerName(spec) {
	const [kind, ...rest] = String(spec || '').trim().split(/\s+/)
	const k = String(kind || '').toUpperCase()
	if (k === 'STREAM' || k === 'FILE') return `ffmpeg[${rest.find((t) => !/^-/.test(t)) || ''}]`
	if (k === 'SHM') return `shm[${rest[rest.indexOf('NAME') + 1] || ''}]`
	return k.toLowerCase() || 'unknown'
}

function layerXml(num, L, { now, fps }) {
	const fgXml = L.fg
		? L.fg.kind === 'clip'
			? `<foreground><file><name>${xmlEscape(L.fg.source)}</name><path>${xmlEscape(L.fg.source)}</path>` +
				`<time>${positionOf(L.fg, now).toFixed(3)}</time><time>${L.fg.length.toFixed(3)}</time>` +
				`<clip>0</clip><clip>${L.fg.length.toFixed(3)}</clip></file>` +
				`<loop>${!!L.fg.loop}</loop><paused>${!L.fg.playing}</paused><producer>ffmpeg</producer></foreground>`
			: L.fg.kind === 'route'
				? `<foreground><producer>route</producer><route>${routeXml(L.fg.source)}</route></foreground>`
				: `<foreground><producer>${L.fg.kind}</producer></foreground>`
		: L.cg
			? '<foreground><producer>html</producer></foreground>'
			: '<foreground><producer>empty</producer></foreground>'
	const bgXml = L.bg
		? `<background><file><name>${xmlEscape(L.bg.source)}</name></file><producer>ffmpeg</producer></background>`
		: '<background><producer>empty</producer></background>'
	void fps
	return `<layer_${num}>${bgXml}${fgXml}</layer_${num}>`
}

/** `route://5-10` → `<channel>5</channel><layer>10</layer>` (the shape foregroundProducerOnLayer reads). */
function routeXml(src) {
	const m = /^route:\/\/(\d+)(?:-(\d+))?/i.exec(String(src))
	return m ? `<channel>${m[1]}</channel>${m[2] ? `<layer>${m[2]}</layer>` : ''}` : ''
}

/** The whole `INFO <ch>` document. */
function channelXml({ mode, fps, layers, consumers, now }) {
	let stage = ''
	for (const [num, L] of [...layers.entries()].sort((a, b) => a[0] - b[0])) stage += layerXml(num, L, { now, fps })
	let ports = ''
	for (const [idx, c] of [...consumers.entries()].sort((a, b) => a[0] - b[0])) ports += `<port_${idx}><consumer>${xmlEscape(c.name)}</consumer></port_${idx}>`
	return `<?xml version="1.0" encoding="utf-8"?><channel><format>${mode}</format><framerate>${fps}</framerate><stage><layer>${stage}</layer></stage><output><port>${ports}</port></output></channel>`
}

module.exports = { xmlEscape, fpsOfMode, parseArgs, makeClip, positionOf, setPlaying, seekTo, consumerName, channelXml }

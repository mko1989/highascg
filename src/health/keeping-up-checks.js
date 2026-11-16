'use strict'

/**
 * WO-1088 — the keeping-up checks, pure: one sample (built ~1×/s by keeping-up-service.js from data that already
 * flows) → raw results for keeping-up-model.js. Every check names its target, the measured value, a plain-language
 * label for the header ("Dioda output dropping frames") and a one-line hint of what it usually means.
 *
 * Thresholds (level 1 = behind, 2 = failing; F = the channel's fps from Caspar's own OSC `framerate`):
 *   screen output      presented/s < 0.94 F or any dropped frame → 1;  < 0.8 F or ≥ 0.1 F dropped/s → 2
 *   shm source layer   new frames/s < 0.9 T → 1;  < 0.5 T → 2        (T = min(F, the ring's own fps))
 *   preview feed       Caspar's shm consumer dropping or publishing < 0.9 F → 1 (never 2: on air is unaffected)
 *   audio output       ≥ 3 portaudio fifo under/overruns in the ~2 s window → 1;  ≥ 10 → 2 (a lone one is the
 *                      card / channel clock drift this box shows every few minutes — WO-1088 §1 — not a burst)
 *   server loop        p99 ≥ 100 ms or a stall ≥ 500 ms → 1;  mean ≥ 50 ms → 2
 *   DMX follow         a tick gap ≥ 4 ticks or a tick longer than its 23 ms budget → 1;  mean tick ≥ budget → 2
 *   tracking camera    detection fps < 0.8 T while each step takes ≥ 0.8 interval → 1;  < 0.5 T → 2
 *   LTC out            device missing / busy / error, under-runs or repeated drift re-aligns → 1 (keeping-up-ltc.js)
 *   client WS backlog  ≥ 1 MiB queued → 1;  ≥ 6 MiB → 2 (the server drops a client at 8 MiB)
 *   box                CPU ≥ 90 % → 1, ≥ 98 % → 2;  RAM ≥ 90 / 96 %;  VRAM ≥ 90 / 97 %;  GPU ≥ 95 % → 1;
 *                      GPU or CPU thermal throttling → 1
 * Not applicable → no result (the model drops the check): preshow, Caspar down (only the link check speaks), an output or
 * layer that is not there (screen gate, nothing played), a paused shm layer, features off, an idle box.
 */

const { OK, BEHIND, FAILING } = require('./keeping-up-model')
const { ltcChecks } = require('./keeping-up-ltc')

const MiB = 1024 * 1024
const r1 = (n) => Math.round(n * 10) / 10

function ratePerS(cur, old, field, dtS) {
	const a = Number(old?.[field])
	const b = Number(cur?.[field])
	if (!Number.isFinite(a) || !Number.isFinite(b) || dtS <= 0 || b < a) return null // b < a: Caspar restarted, counters reset
	return (b - a) / dtS
}

function byKey(list) {
	return new Map((list || []).map((e) => [`${e.ch}/${e.port ?? e.layer}`, e]))
}

function ringTitle(name) {
	return name === 'visuals' ? 'Visuals' : `shm://${name}`
}

/** Caspar link + OSC flow. */
function casparChecks(s) {
	if (!s.caspar) return []
	if (!s.caspar.connected) {
		return [{ key: 'caspar', group: 'caspar', name: 'CasparCG', level: FAILING, rise: 2, fall: 2, target: 'connected', measured: 'down',
			text: 'not connected', label: 'Caspar not connected — outputs unwatched', severity: 1,
			hint: 'CasparCG is down or restarting: nothing is played out, and no output can be measured.' }]
	}
	if (s.oscEnabled === false) return []
	const silentS = s.osc?.lastAt ? (s.at - s.osc.lastAt) / 1000 : null
	const silent = silentS == null || silentS > 5
	return [{ key: 'caspar-osc', group: 'caspar', name: 'Caspar OSC', level: silent ? BEHIND : OK, rise: 3, fall: 2, target: 'flowing',
		measured: silent ? 'silent' : 'flowing', text: silent ? (silentS == null ? 'nothing received' : `silent ${Math.round(silentS)} s`) : 'flowing',
		label: 'No OSC from Caspar — outputs unwatched', severity: silentS ?? 999,
		hint: "Caspar's OSC stream to the server stopped: the output and source checks are blind until it is back." }]
}

/** Caspar outputs (screen, shm preview feed, portaudio) from counter deltas over the window. */
function outputChecks(s) {
	if (!s.caspar?.connected || !s.osc || !s.oscPrev) return []
	const out = []
	const prev = byKey(s.oscPrev.outputs)
	for (const o of s.osc.outputs) {
		const p = prev.get(`${o.ch}/${o.port}`)
		const F = Number(s.osc.channels?.[o.ch]) || 0
		const dt = p ? (o.at - p.at) / 1000 : 0 // between the bundles the counters came in, not between samples
		if (!p || !F || dt < 0.5) continue
		const where = s.names?.[o.ch] || `Channel ${o.ch}`
		const key = `out:${o.ch}:${o.port}`
		if (o.consumer === 'screen' && o.presented != null) {
			const rate = ratePerS(o, p, 'presented', dt)
			const drops = Math.max(0, (Number(o.dropped) || 0) - (Number(p.dropped) || 0))
			if (rate == null) continue
			const dropRate = drops / dt
			const level = rate < 0.8 * F || dropRate >= 0.1 * F ? FAILING : rate < 0.94 * F || drops > 0 ? BEHIND : OK
			out.push({ key, group: 'output', name: `${where} output`, level, rise: drops > 0 ? 1 : 2, target: F, measured: r1(rate), unit: 'fps',
				text: `${Math.round(rate)} / ${F} fps${drops ? ` · ${drops} dropped` : ''}`,
				label: drops > 0 ? `${where} output dropping frames` : `${where} output at ${Math.round(rate)} of ${F} fps`,
				severity: (F - rate) / F + dropRate / F,
				hint: 'Caspar could not show every frame on this screen: the GPU or the channel is overloaded, or the display refresh does not match the channel rate.' })
		} else if (o.consumer === 'shm' && o.published != null) {
			const rate = ratePerS(o, p, 'published', dt)
			const drops = Math.max(0, (Number(o.shmDropped) || 0) - (Number(p.shmDropped) || 0))
			if (rate == null) continue
			const level = drops > 0 || rate < 0.9 * F ? BEHIND : OK
			out.push({ key, group: 'output', name: `Preview feed ${o.name || where}`, level, target: F, measured: r1(rate), unit: 'fps',
				text: `${Math.round(rate)} / ${F} fps${drops ? ` · ${drops} dropped` : ''}`, label: `Preview feed ${o.name || where} dropping frames`,
				severity: (F - rate) / F + drops / F,
				hint: "Caspar's shared-memory copy for the operator client skipped frames: the client's previews stutter; what is on air is not affected." })
		} else if (o.consumer === 'portaudio' && (o.underruns != null || o.overruns != null)) {
			const glitches = Math.max(0, (Number(o.underruns) || 0) - (Number(p.underruns) || 0)) +
				Math.max(0, (Number(o.overruns) || 0) - (Number(p.overruns) || 0))
			out.push({ key, group: 'output', name: `${where} audio out`, level: glitches >= 10 ? FAILING : glitches >= 3 ? BEHIND : OK,
				target: 0, measured: glitches, unit: 'glitches', text: glitches ? `${glitches} under/overruns` : 'no under/overruns',
				label: `${where} audio output glitching`, severity: glitches,
				hint: 'The sound card ran dry or overflowed: audible clicks. Usually the channel or the box is overloaded.' })
		}
	}
	return out
}

/** Sources Caspar takes from shared memory (the Godot Visuals ring and any other shm layer), playing and not paused. */
function sourceChecks(s) {
	if (!s.caspar?.connected || !s.osc || !s.oscPrev) return []
	const out = []
	const prev = byKey(s.oscPrev.layers)
	for (const l of s.osc.layers) {
		const p = prev.get(`${l.ch}/${l.layer}`)
		const F = Number(s.osc.channels?.[l.ch]) || 0
		const dt = p ? (l.at - p.at) / 1000 : 0
		if (!p || !F || dt < 0.5 || l.frames == null || l.type !== 'shm' || l.paused === true) continue
		const ring = Number(s.ringFps?.[l.name]) || 0
		const T = ring > 0 ? Math.min(F, ring) : F
		const rate = ratePerS(l, p, 'frames', dt)
		if (rate == null) continue
		const level = rate < 0.5 * T ? FAILING : rate < 0.9 * T ? BEHIND : OK
		const title = ringTitle(l.name || `layer ${l.layer}`)
		out.push({ key: `src:${l.ch}:${l.layer}`, group: 'source', name: title, level, rise: 2, target: T, measured: r1(rate), unit: 'fps',
			text: `${Math.round(rate)} / ${T} fps`, severity: (T - rate) / T,
			label: rate < 0.5 ? `${title} not arriving (0 of ${T} fps)` : `${title} at ${Math.round(rate)} of ${T} fps`,
			hint: l.name === 'visuals'
				? 'The Godot client renders the visuals slower than the channel shows them, so they judder on air: see the client fps and the GPU.'
				: 'The source writing this shared-memory ring delivers fewer frames than the channel shows.' })
	}
	return out
}

/** The node server's own loop, the DMX follow clock, tracking detection and the WS backlog to clients. */
function serverChecks(s) {
	const out = []
	const L = s.loop
	if (L && Number.isFinite(L.maxMs)) {
		const level = L.meanMs >= 50 ? FAILING : L.p99Ms >= 100 || L.maxMs >= 500 ? BEHIND : OK
		out.push({ key: 'server-loop', group: 'server', name: 'Server', level, rise: L.maxMs >= 500 ? 1 : 2, target: 100, measured: Math.round(L.maxMs),
			unit: 'ms', text: `max ${Math.round(L.maxMs)} ms · p99 ${Math.round(L.p99Ms)} ms`, severity: L.maxMs,
			label: L.maxMs >= 500 ? `Server stalled ${Math.round(L.maxMs)} ms` : `Server lagging (p99 ${Math.round(L.p99Ms)} ms)`,
			hint: 'The HighAsCG server was busy: DMX follow, timers and client updates paused for that long.' })
	}
	const f = s.follow
	if (f && f.fixtures > 0 && f.ticks > 0) {
		const level = f.meanWorkMs >= f.tickMs ? FAILING : f.maxGapMs >= 4 * f.tickMs || f.maxWorkMs >= f.tickMs ? BEHIND : OK
		out.push({ key: 'dmx-follow', group: 'server', name: 'DMX follow', level, target: f.tickMs, measured: Math.round(f.maxGapMs), unit: 'ms',
			text: `gap ≤ ${Math.round(f.maxGapMs)} ms · tick ≤ ${r1(f.maxWorkMs)} ms`, severity: f.maxGapMs + f.maxWorkMs,
			label: f.maxWorkMs >= f.tickMs ? `DMX follow too slow (${r1(f.maxWorkMs)} ms ticks)` : `DMX follow late (gap ${Math.round(f.maxGapMs)} ms)`,
			hint: `The follow engine missed its ${f.tickMs} ms clock: moving heads and pixel maps step instead of gliding.` })
	}
	const t = s.tracking
	if (t && t.intervalMs > 0) {
		const T = r1(1000 / t.intervalMs)
		for (const c of t.cameras || []) {
			if (c.state !== 'ok' || !Number.isFinite(c.fps)) continue
			const bound = Number(c.ms) >= 0.8 * t.intervalMs // the detection itself is the bottleneck, not a slow camera
			const level = bound && c.fps < 0.5 * T ? FAILING : bound && c.fps < 0.8 * T ? BEHIND : OK
			out.push({ key: `tracking:${c.id}`, group: 'server', name: `Tracking ${c.id}`, level, rise: 3, target: T, measured: c.fps, unit: 'fps',
				text: `${c.fps} / ${T} fps · ${Math.round(c.ms)} ms per frame`, severity: T - c.fps,
				label: `Tracking ${Math.max(1, Math.round(T - c.fps))} fps behind`,
				hint: 'Person detection takes longer than its frame budget, so tracking lags the stage: fewer cameras, a smaller model or a longer interval help.' })
		}
	}
	for (const w of s.ws || []) {
		const b = Number(w.buffered) || 0
		const level = b >= 6 * MiB ? FAILING : b >= MiB ? BEHIND : OK
		if (level === OK && !w.always) continue // only a backed-up client is listed
		out.push({ key: `ws:${w.id}`, group: 'server', name: `Client ${w.addr}`, level, target: 1, measured: r1(b / MiB), unit: 'MiB',
			text: `${r1(b / MiB)} MiB queued`, severity: b, label: `Updates to client ${w.addr} backing up`,
			hint: "This client reads the server's updates slower than they are sent (slow network or a stalled client); at 8 MiB the server drops it." })
	}
	return out
}

/** The box: CPU, RAM, GPU, VRAM, thermal throttling. */
function boxChecks(s) {
	const h = s.host
	if (!h) return []
	const out = []
	const pct = (key, name, v, warn, alarm, label, hint, rise = 3) => {
		if (!Number.isFinite(v)) return
		out.push({ key, group: 'box', name, level: alarm != null && v >= alarm ? FAILING : v >= warn ? BEHIND : OK, rise, fall: 5,
			target: warn, measured: Math.round(v), unit: '%', text: `${Math.round(v)} %`, severity: v, label: `${label} (${Math.round(v)} %)`, hint })
	}
	pct('cpu', 'CPU', h.cpuPct, 90, 98, 'CPU saturated', 'All cores are busy: Caspar, the client and the server compete for time.')
	pct('ram', 'RAM', h.memPct, 90, 96, 'RAM nearly full', 'The box is close to swapping: everything slows down, Caspar may fail to load media.')
	pct('gpu', 'GPU', h.gpu?.util, 95, null, 'GPU saturated', "The GPU is at its limit: Caspar's mixer and the client's render compete; outputs drop frames next.")
	pct('vram', 'VRAM', h.gpu?.vramPct, 90, 97, 'VRAM nearly full', 'GPU memory is almost used up: new media, shaders or channels may fail to start.')
	if (h.gpu && h.gpu.thermal != null) {
		out.push({ key: 'gpu-thermal', group: 'box', name: 'GPU temperature', level: h.gpu.thermal ? BEHIND : OK, rise: 1, fall: 10, target: 'no throttle',
			measured: h.gpu.thermal ? 'throttling' : 'ok', text: h.gpu.thermal ? 'thermal slowdown active' : 'no throttle', severity: h.gpu.tempC || 1,
			label: 'GPU thermal throttling', hint: 'The GPU slows itself down because it is too hot: check airflow and fans.' })
	}
	if (Number.isFinite(h.cpuThrottleDelta)) {
		out.push({ key: 'cpu-thermal', group: 'box', name: 'CPU temperature', level: h.cpuThrottleDelta > 0 ? BEHIND : OK, rise: 1, fall: 10,
			target: 'no throttle', measured: h.cpuThrottleDelta, text: h.cpuThrottleDelta > 0 ? `${h.cpuThrottleDelta} throttle events` : 'no throttle',
			severity: h.cpuThrottleDelta, label: 'CPU thermal throttling', hint: 'The CPU slows itself down because it is too hot: check airflow and fans.' })
	}
	return out
}

/** Checks a client reported for itself (POST /api/health/keeping-up/report) — already debounced on the client. */
function reportedChecks(s) {
	return (s.reported || []).map((c) => ({ ...c, rise: 1, fall: 1 }))
}

function evaluate(s) {
	if (s.offline) return []
	return [...casparChecks(s), ...outputChecks(s), ...sourceChecks(s), ...serverChecks(s), ...ltcChecks(s), ...boxChecks(s), ...reportedChecks(s)]
}

module.exports = { evaluate }

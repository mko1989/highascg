/**
 * WO-266 — Shader FX shared runtime (plain browser script, no modules).
 *
 * Loaded by every exported `template/shaders/sh-*.html` after `ShaderToyLite.js` and the inline
 * `window.__SHADERFX_CONFIG__` (built by src/shaderfx/shader-template-export.js). Renders the
 * shader full-window and drives a Shadertoy-style audio texture (512×2, row 0 = FFT bytes,
 * row 1 = waveform bytes, sample `.x`/`.r`) bound to any pass channel wired to `'audio'`.
 *
 * Audio tiers (all initialized; priority per frame, freshest real data wins):
 *  B) WS `audio_fft` frames — ALWAYS preferred while fresh (< 1.5s). In Caspar's CEF a
 *     file:// page is a secure context, so getUserMedia auto-grants on the silent default
 *     mic — tier A must never shadow the WS feed (WO-333c).
 *  A) getUserMedia + AnalyserNode — fallback real spectrum. Works in the WO-258
 *     browser_display Firefox (pick an ALSA monitor/loopback device; `?audioDev=` overrides).
 *  B') WS OSC levels (`type:'osc'`, per-channel dBFS from src/osc/osc-state.js) — coarse
 *     synthesized spectrum when neither real source is live.
 *     `?ch=<caspar channel>` picks the OSC meter source (default 1), `?api=` overrides the API
 *     base (default: same origin, or http://127.0.0.1:4200 when loaded from file://).
 *  C) silence — shader still renders, texture stays zeroed.
 *
 * Caspar template contract (docs/wiki/api/cg.md): window.update/play/stop/next. Autoplays on
 * load so `PLAY [HTML] <url>` (no CG handshake) also renders.
 */

/* global ShaderToyLite */
(() => {
	'use strict'

	const config = window.__SHADERFX_CONFIG__ || { passes: {}, audio: { enabled: false }, opts: {} }
	const canvas = document.getElementById('shaderfx-canvas')

	// WO-268: the Caspar template contract MUST exist even when rendering can't start (no
	// WebGL2 in CEF with <enable-gpu>false, missing canvas, shader compile throw…) — otherwise
	// follow-up CG UPDATE/STOP calls raise ReferenceErrors. Defined first, inert until start()
	// swaps in the real implementations.
	let toyRef = null
	document.body.style.transition = 'opacity 300ms ease'
	window.play = () => {
		document.body.style.opacity = '1'
		if (toyRef) toyRef.play()
	}
	window.stop = () => {
		document.body.style.opacity = '0'
		setTimeout(() => {
			if (toyRef) toyRef.pause()
		}, 350)
	}
	window.next = () => {}
	window.update = (raw) => {
		// v1: config is baked into the exported template; update() accepts { paused } only.
		try {
			const data = typeof raw === 'string' ? JSON.parse(raw) : raw || {}
			if (!toyRef) return
			if (data.paused === true) toyRef.pause()
			else if (data.paused === false) toyRef.play()
		} catch {
			/* malformed update payloads are ignored */
		}
	}
	if (!canvas) return

	const query = new URLSearchParams(location.search)
	const AUDIO_W = 512

	function apiBase() {
		const q = query.get('api')
		if (q) return q.replace(/\/$/, '')
		if (location.protocol === 'file:') return 'http://127.0.0.1:4200'
		return ''
	}

	function sizeCanvas() {
		canvas.width = Math.max(1, window.innerWidth)
		canvas.height = Math.max(1, window.innerHeight)
	}
	sizeCanvas()
	window.addEventListener('resize', sizeCanvas)

	// Claim the context FIRST when transparency is wanted — ShaderToyLite requests alpha:false,
	// but context attributes are fixed by whoever calls getContext first on the canvas. This is
	// also the WO-268 WebGL2 probe: with Caspar's <html><enable-gpu>false</enable-gpu> this CEF
	// build has NO WebGL at all — bail before ShaderToyLite dereferences the null context.
	const gl = canvas.getContext(
		'webgl2',
		config.opts && config.opts.alpha
			? { alpha: true, premultipliedAlpha: true, depth: false, stencil: false, antialias: true }
			: undefined,
	)
	if (!gl) {
		console.error(
			'Shader FX: WebGL2 unavailable — on the Caspar CG path this needs <html><enable-gpu>true</enable-gpu> ' +
				'(config operatorTools.cefEnableGpu, WO-268), or play this page as a browser_display source instead.',
		)
		return
	}

	const toy = new ShaderToyLite('shaderfx-canvas')

	// --- audio texture (row 0 FFT, row 1 waveform) -------------------------------------------
	const freqBytes = new Uint8Array(AUDIO_W)
	const waveBytes = new Uint8Array(AUDIO_W)
	waveBytes.fill(128)
	let audioTexture = null
	let audioMode = 'none'

	function createAudioTexture() {
		const tex = gl.createTexture()
		gl.bindTexture(gl.TEXTURE_2D, tex)
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, AUDIO_W, 2, 0, gl.RED, gl.UNSIGNED_BYTE, null)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		return tex
	}

	function uploadAudioTexture() {
		if (!audioTexture) return
		gl.bindTexture(gl.TEXTURE_2D, audioTexture)
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, AUDIO_W, 1, gl.RED, gl.UNSIGNED_BYTE, freqBytes)
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 1, AUDIO_W, 1, gl.RED, gl.UNSIGNED_BYTE, waveBytes)
	}

	// --- tier A: real spectrum via getUserMedia ----------------------------------------------
	let analyser = null
	let analyserFreq = null
	let analyserWave = null

	async function pickAudioDevice() {
		const want = query.get('audioDev')
		try {
			const devices = await navigator.mediaDevices.enumerateDevices()
			const inputs = devices.filter((d) => d.kind === 'audioinput')
			if (want) {
				const hit = inputs.find((d) => d.deviceId === want || (d.label || '').toLowerCase().includes(want.toLowerCase()))
				if (hit) return hit.deviceId
			}
			const monitor = inputs.find((d) => /monitor|loopback/i.test(d.label || ''))
			return monitor ? monitor.deviceId : undefined
		} catch {
			return undefined
		}
	}

	async function initTierA() {
		if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') return false
		try {
			const deviceId = await pickAudioDevice()
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: deviceId ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } : { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
			})
			const ac = new (window.AudioContext || window.webkitAudioContext)()
			const src = ac.createMediaStreamSource(stream)
			analyser = ac.createAnalyser()
			analyser.fftSize = AUDIO_W * 2
			analyser.smoothingTimeConstant = 0.6
			src.connect(analyser)
			analyserFreq = new Uint8Array(analyser.frequencyBinCount)
			analyserWave = new Uint8Array(analyser.fftSize)
			if (ac.state === 'suspended') void ac.resume()
			audioMode = 'analyser'
			return true
		} catch {
			return false
		}
	}

	function sampleTierA() {
		analyser.getByteFrequencyData(analyserFreq)
		analyser.getByteTimeDomainData(analyserWave)
		for (let i = 0; i < AUDIO_W; i++) {
			freqBytes[i] = analyserFreq[i] || 0
			waveBytes[i] = analyserWave[i] || 128
		}
	}

	// --- tier B: playout WS — real audio_fft frames (WO-333), OSC levels as fallback ---------
	let wsLevel = 0 // 0..1 linear from dBFS
	let wsPhase = 0
	let lastFftAt = 0 // ms epoch of the last real audio_fft frame
	const FFT_FRESH_MS = 1500

	function dbfsToUnit(dbfs) {
		const v = (Number(dbfs) + 60) / 60 // -60 dBFS floor → 0, 0 dBFS → 1
		return Math.max(0, Math.min(1, v))
	}

	function b64ToBytes(b64, out) {
		const bin = atob(b64)
		const n = Math.min(bin.length, out.length)
		for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i)
		return n
	}

	function initTierB() {
		let url
		try {
			const base = apiBase()
			const origin = base || location.origin
			url = origin.replace(/^http/, 'ws') + '/api/ws'
		} catch {
			return false
		}
		const casparCh = String(query.get('ch') || '1')
		try {
			const ws = new WebSocket(url)
			ws.onmessage = (ev) => {
				try {
					const msg = JSON.parse(ev.data)
					if (msg.type === 'audio_fft' && msg.data && msg.data.freq) {
						// Real spectrum from the node's ALSA capture — write straight into the
						// texture rows (same AnalyserNode byte semantics as tier A).
						b64ToBytes(msg.data.freq, freqBytes)
						if (msg.data.wave) b64ToBytes(msg.data.wave, waveBytes)
						lastFftAt = Date.now()
						return
					}
					if (msg.type !== 'osc' || !msg.data) return
					const ch = msg.data.channels?.[casparCh] || msg.data.channels?.[Number(casparCh)]
					const levels = ch?.audio?.levels
					if (!Array.isArray(levels) || !levels.length) return
					let sum = 0
					for (const l of levels) sum += dbfsToUnit(l?.dBFS ?? -120)
					wsLevel = sum / levels.length
				} catch {
					/* non-JSON or shape mismatch — ignore */
				}
			}
			ws.onerror = () => {}
			audioMode = 'ws-levels'
			return true
		} catch {
			return false
		}
	}

	function sampleTierB() {
		// Synthesize a plausible falling spectrum + a level-scaled sine waveform from one RMS
		// value. Coarse by design — real FFT comes from fresh audio_fft frames or tier A.
		wsPhase += 0.35
		const amp = wsLevel
		for (let i = 0; i < AUDIO_W; i++) {
			const rolloff = 1 - i / AUDIO_W
			freqBytes[i] = Math.round(255 * amp * rolloff * rolloff)
			waveBytes[i] = Math.round(128 + 127 * amp * Math.sin((i / AUDIO_W) * Math.PI * 8 + wsPhase))
		}
	}

	function updateAudio() {
		if (Date.now() - lastFftAt < FFT_FRESH_MS) {
			// freqBytes/waveBytes already hold the latest WS audio_fft frame — use verbatim.
		} else if (analyser) {
			sampleTierA()
		} else if (audioMode === 'ws-levels') {
			sampleTierB()
		} else {
			return
		}
		uploadAudioTexture()
	}

	// --- wire passes -------------------------------------------------------------------------
	function passConfig(p) {
		const cfg = { source: p.source }
		for (let i = 0; i < 4; i++) {
			if (p.channels && p.channels[i]) cfg['iChannel' + i] = p.channels[i]
		}
		return cfg
	}

	function usesAudioChannel() {
		const passes = config.passes || {}
		return Object.keys(passes).some((k) => passes[k] && (passes[k].channels || []).includes('audio'))
	}

	async function start() {
		if (config.audio && config.audio.enabled && usesAudioChannel()) {
			audioTexture = createAudioTexture()
			toy.addTexture(audioTexture, 'audio')
			// WS tier is always on and outranks the analyser while frames are fresh; tier A
			// runs in the background as the fallback (don't block first paint on getUserMedia).
			initTierB()
			void initTierA()
		}
		if (config.common) toy.setCommon(config.common)
		const p = config.passes || {}
		if (p.bufferA) toy.setBufferA(passConfig(p.bufferA))
		if (p.bufferB) toy.setBufferB(passConfig(p.bufferB))
		if (p.bufferC) toy.setBufferC(passConfig(p.bufferC))
		if (p.bufferD) toy.setBufferD(passConfig(p.bufferD))
		if (p.image) toy.setImage(passConfig(p.image))
		toy.setOnDraw(updateAudio)
		toy.play()
	}

	toyRef = toy
	// Any throw past this point (shader compile, audio init, GL loss) must not take out the
	// already-installed contract functions — log and leave the layer black instead.
	void start().catch((e) => console.error('Shader FX: init failed:', e && e.message ? e.message : e))
})()

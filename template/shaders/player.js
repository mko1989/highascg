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
		/* { paused } — pause/resume. WO-345: { common?, passes?: { <key>: { source } } } — live
		 * source replacement: patch the baked config and re-run the pass setters, which RECOMPILES
		 * in place on the running producer (same canvas + audio texture, iTime keeps counting; no
		 * restart, no black frame). Channels never change here — they stay as exported. */
		try {
			const data = typeof raw === 'string' ? JSON.parse(raw) : raw || {}
			if (!toyRef) return
			if (data.paused === true) toyRef.pause()
			else if (data.paused === false) toyRef.play()
			if (data.common != null || (data.passes && typeof data.passes === 'object')) {
				applyLiveSourceUpdate(data)
			}
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
			// WO-335: no monitor/loopback match and no explicit ?audioDev → don't open a default
			// device at all. It's a silent mic on this box (CEF file:// auto-grants), and a dead
			// analyser would still outrank the OSC synth fallback when the WS feed is down.
			if (!deviceId) return false
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
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

	/* WO-344 — thumbnail mode (`?shaderThumb=1`). The look-deck thumb is rendered headless with
	 * nothing on air, so every real audio tier is silent and an audio-reactive shader thumbs as
	 * flat meters and empty space — the owner's complaint. This synthesizes ONE plausible static
	 * spectrum (no animation: the capture is a single frame) so bars/meters have content, and it
	 * suppresses getUserMedia, which has no device in headless Chrome and only costs time. It is
	 * opt-in by query param: playout never passes it. */
	const THUMB_MODE = query.get('shaderThumb') === '1'

	function sampleThumbSpectrum() {
		for (let i = 0; i < AUDIO_W; i++) {
			const t = i / AUDIO_W
			// Music-like falling spectrum with a few peaks, deterministic so thumbs are stable.
			const base = Math.pow(1 - t, 1.7)
			const peaks = 0.22 * Math.sin(t * 37) * Math.sin(t * 11) + 0.12 * Math.sin(t * 83)
			const v = Math.max(0, Math.min(1, base * 0.92 + peaks * base))
			freqBytes[i] = Math.round(255 * v)
			waveBytes[i] = Math.round(128 + 110 * Math.sin(t * Math.PI * 6) * (0.35 + 0.65 * base))
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
		if (THUMB_MODE && Date.now() - lastFftAt >= FFT_FRESH_MS) {
			// WO-344: real frames still win if something IS on air while the thumb renders.
			sampleThumbSpectrum()
			uploadAudioTexture()
			return
		}
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

	/* WO-376 — the `camera` channel (the virtual camera as a live texture) lives in the lazily
	 * loaded companion `player-camera.js`: it is only needed when a pass binds `camera`, and
	 * player.js is at the repo's 500-line limit. If the file is missing (an old export served from
	 * elsewhere) the channel simply stays black — the same fail-soft contract as a denied device. */
	let cameraFeed = null

	function usesCameraChannel() {
		const passes = config.passes || {}
		return Object.keys(passes).some((k) => passes[k] && (passes[k].channels || []).includes('camera'))
	}

	function loadCameraCompanion() {
		return new Promise((resolve) => {
			if (window.__SHADERFX_CAMERA__) return resolve(window.__SHADERFX_CAMERA__)
			const el = document.createElement('script')
			// Relative to the template, i.e. next to player.js — works from file:// and http://.
			el.src = 'player-camera.js'
			el.onload = () => resolve(window.__SHADERFX_CAMERA__ || null)
			el.onerror = () => resolve(null)
			document.head.appendChild(el)
		})
	}

	async function initCameraChannel() {
		const mod = await loadCameraCompanion()
		if (!mod) return
		cameraFeed = mod.create({ gl, toy, apiBase, query, thumbMode: THUMB_MODE })
	}

	// --- wire passes -------------------------------------------------------------------------

	/* todos28.07.26 (owner): "when audio reactive is ticked on a shader audio must be chosen in
	 * image iCh0". Ticking the box only sets audio.enabled; the audio TEXTURE is created below
	 * only when a pass actually BINDS 'audio' to a channel, so tick-and-forget produced a shader
	 * that was silently not reactive while still wearing the ♪ badge in the library. The store
	 * binds it on save (src/shaderfx/shader-store.js), and this does the same at load time so
	 * ALREADY-EXPORTED templates start working without being re-exported — player.js is shared
	 * and loaded fresh by every sh-*.html. Never displaces an existing binding. */
	function ensureAudioChannelBinding() {
		if (!config.audio || !config.audio.enabled) return
		const passes = config.passes || {}
		const bound = Object.keys(passes).some((k) => passes[k] && (passes[k].channels || []).includes('audio'))
		if (bound) return
		const img = passes.image
		if (!img) return
		if (!Array.isArray(img.channels)) img.channels = [null, null, null, null]
		const free = img.channels.findIndex((c) => !c)
		if (free >= 0) img.channels[free] = 'audio'
	}

	/* todos28.07.26 (owner): "alpha doesnt work on shaders."
	 *
	 * The transparent PAGE and the alpha-claimed WebGL2 context were both already correct — what
	 * is opaque is the shader itself. Shadertoy shaders are written for an opaque canvas and end
	 * with `fragColor = vec4(col, 1.0)`; every alpha-enabled shader in this library does exactly
	 * that (sh-matrix, sh-bubles, sh-mirrors), so there is nothing for the transparency to show
	 * through. Alpha could never have worked without touching the shader source.
	 *
	 * So when the Alpha flag is on, the image pass is wrapped: the author's mainImage is renamed
	 * and called by ours, which keys near-black to transparent and PREMULTIPLIES (the context is
	 * claimed premultipliedAlpha:true). A shader that DOES author real alpha keeps it — the key
	 * only applies where the author wrote a fully opaque pixel.
	 *
	 * Fail-safe: if the source does not contain exactly one `void mainImage(` the wrap is skipped
	 * and behaviour is exactly as before. Turning the Alpha flag off also restores it. */
	const ALPHA_KEY_SOFT = 0.06
	function alphaKeyImageSource(src) {
		const decls = String(src).match(/\bvoid\s+mainImage\s*\(/g) || []
		if (decls.length !== 1) return null
		const renamed = String(src).replace(/\bvoid\s+mainImage\s*\(/, 'void mainImageAuthor(')
		return (
			renamed +
			'\n\n// injected by player.js — Alpha flag (todos28.07.26)\n' +
			'void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n' +
			'  vec4 c;\n' +
			'  mainImageAuthor(c, fragCoord);\n' +
			'  float key = max(c.r, max(c.g, c.b));\n' +
			'  float a = c.a < 1.0 ? c.a : smoothstep(0.0, ' + ALPHA_KEY_SOFT.toFixed(3) + ', key);\n' +
			'  fragColor = vec4(c.rgb * a, a);\n' +
			'}\n'
		)
	}

	function passConfig(p, key) {
		const cfg = { source: p.source }
		if (key === 'image' && config.opts && config.opts.alpha) {
			const keyed = alphaKeyImageSource(p.source)
			if (keyed) cfg.source = keyed
		}
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
		ensureAudioChannelBinding()
		if (config.audio && config.audio.enabled && usesAudioChannel()) {
			audioTexture = createAudioTexture()
			toy.addTexture(audioTexture, 'audio', AUDIO_W, 2)
			// WS tier is always on and outranks the analyser while frames are fresh; tier A
			// runs in the background as the fallback (don't block first paint on getUserMedia).
			initTierB()
			// WO-344: no capture device in headless Chrome — asking only delays first paint.
			if (!THUMB_MODE) void initTierA()
		}
		if (usesCameraChannel()) {
			// The companion registers a black 1×1 immediately so the pass compiles and samples
			// something from frame 1, then fills it if the device opens.
			await initCameraChannel()
		}
		if (config.common) toy.setCommon(config.common)
		const p = config.passes || {}
		if (p.bufferA) toy.setBufferA(passConfig(p.bufferA))
		if (p.bufferB) toy.setBufferB(passConfig(p.bufferB))
		if (p.bufferC) toy.setBufferC(passConfig(p.bufferC))
		if (p.bufferD) toy.setBufferD(passConfig(p.bufferD))
		if (p.image) toy.setImage(passConfig(p.image, 'image'))
		toy.setOnDraw(() => {
			updateAudio()
			if (cameraFeed) cameraFeed.update()
		})
		toy.play()
	}

	/* WO-345 — live source replacement (see window.update above). A compile error inside a
	 * setter must not kill the running visual: ShaderToyLite logs the failure and keeps the
	 * previous program for keys it could not rebuild. */
	function applyLiveSourceUpdate(data) {
		if (data.common != null) {
			config.common = String(data.common)
			toy.setCommon(config.common)
		}
		const incoming = data.passes && typeof data.passes === 'object' ? data.passes : {}
		const setters = { image: 'setImage', bufferA: 'setBufferA', bufferB: 'setBufferB', bufferC: 'setBufferC', bufferD: 'setBufferD' }
		for (const key of Object.keys(setters)) {
			const src = incoming[key] && typeof incoming[key].source === 'string' ? incoming[key].source : null
			if (src == null) continue
			if (!config.passes) config.passes = {}
			if (!config.passes[key]) config.passes[key] = { source: src, channels: [] }
			else config.passes[key].source = src
			// WO-345 hot-recompile must keep the Alpha keying (todos28.07.26) — pass the key through.
			toy[setters[key]](passConfig(config.passes[key], key))
		}
	}

	toyRef = toy
	// Any throw past this point (shader compile, audio init, GL loss) must not take out the
	// already-installed contract functions — log and leave the layer black instead.
	void start().catch((e) => console.error('Shader FX: init failed:', e && e.message ? e.message : e))
})()

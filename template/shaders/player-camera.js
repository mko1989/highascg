/**
 * player-camera.js — WO-376: the `camera` shader channel (the virtual camera as a live texture).
 *
 * Split out of `player.js`, which hit the repo's 500-line limit. Loaded LAZILY and only when a
 * pass actually binds `camera`, which has a second benefit: an already-exported `sh-*.html` (they
 * only reference `player.js`) still works — the loader is relative to player.js's own directory,
 * and if this file is somehow absent the camera texture simply stays black, exactly like a denied
 * or missing device. Nothing about the Caspar template contract depends on it.
 *
 * Exposes ONE global, matching how ShaderToyLite.js is already loaded as a plain script:
 *   window.__SHADERFX_CAMERA__ = { create(ctx) -> { texture, update() } }
 */

/* global */
window.__SHADERFX_CAMERA__ = (() => {
	'use strict'

	/**
	 * @param {{ gl: WebGL2RenderingContext, toy: object, apiBase: () => string,
	 *           query: URLSearchParams, thumbMode: boolean }} ctx
	 */
	function create(ctx) {
		const { gl, toy, apiBase, query, thumbMode } = ctx
		const THUMB_MODE = thumbMode
		/* WO-376 (owner): "i need to be able to choose camera from a drop down in shader channels the
		 * same way audio is now implemented. maybe a tick in the virtual camera output inspector to
		 * send to shaders as camera."
		 *
		 * So `camera` is a channel exactly like `audio`: chosen per pass in the shader modal, fed here
		 * at runtime. The source is the VIRTUAL CAMERA — and after WO-377 that is whatever the operator
		 * cabled to the virtual-cam output in Device View, not necessarily PGM, which is what makes
		 * this safe from feedback without a hard guard.
		 *
		 * Two gates before a device is ever opened:
		 *   1. a pass actually binds 'camera' (no binding → no getUserMedia at all);
		 *   2. `virtualCamera.shaderCamera` is ON in its inspector — the owner's tick.
		 * Everything fails soft: no device, denied permission, or headless → the texture stays black
		 * and the shader still renders (WO-268's rule that nothing may break the Caspar contract).
		 */
		let cameraTexture = null
		let cameraVideo = null
		let cameraReady = false

		function createCameraTexture() {
			const tex = gl.createTexture()
			gl.bindTexture(gl.TEXTURE_2D, tex)
			// 1×1 black until the first frame — sampling an incomplete texture renders nothing at all.
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
			return tex
		}

		/** @returns {Promise<{ enabled: boolean, label: string }>} the owner's tick + the device label */
		async function fetchShaderCameraConfig() {
			try {
				const res = await fetch(`${apiBase()}/api/virtual-camera`)
				if (!res.ok) return { enabled: false, label: '' }
				const j = await res.json()
				const vc = j?.config || {}
				return { enabled: vc.shaderCamera === true, label: String(vc.label || 'Virtual cam') }
			} catch {
				return { enabled: false, label: '' }
			}
		}

		async function initCamera() {
			if (THUMB_MODE) return false // no capture device in the headless thumbnail renderer (WO-344)
			if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') return false
			const { enabled, label } = await fetchShaderCameraConfig()
			if (!enabled) return false
			try {
				// Match by LABEL like pickAudioDevice does — a browser deviceId is not the /dev path.
				let deviceId
				try {
					const devices = await navigator.mediaDevices.enumerateDevices()
					const want = String(query.get('camDev') || label).toLowerCase()
					const hit = devices.find((d) => d.kind === 'videoinput' && (d.label || '').toLowerCase().includes(want))
					if (hit) deviceId = hit.deviceId
				} catch {
					/* enumeration needs permission on some paths — fall through to the default device */
				}
				const stream = await navigator.mediaDevices.getUserMedia({
					video: deviceId ? { deviceId: { exact: deviceId } } : true,
				})
				cameraVideo = document.createElement('video')
				cameraVideo.autoplay = true
				cameraVideo.muted = true
				cameraVideo.playsInline = true
				cameraVideo.srcObject = stream
				await cameraVideo.play().catch(() => {})
				cameraReady = true
				return true
			} catch {
				return false // denied / busy / absent — the texture simply stays black
			}
		}

		let cameraSize = [0, 0]
		function updateCamera() {
			if (!cameraTexture || !cameraReady || !cameraVideo) return
			if (cameraVideo.readyState < 2 || !cameraVideo.videoWidth) return
			/* Keep iChannelResolution truthful: it is registered 1×1 (black) so the pass compiles
			 * before the device arrives, and shaders that correct aspect from iChannelResolution[i].xy
			 * would otherwise square the image forever. addTexture is idempotent — re-registering just
			 * updates the recorded size (ShaderToyLite.js WO-335 patch). */
			if (cameraVideo.videoWidth !== cameraSize[0] || cameraVideo.videoHeight !== cameraSize[1]) {
				cameraSize = [cameraVideo.videoWidth, cameraVideo.videoHeight]
				toy.addTexture(cameraTexture, 'camera', cameraSize[0], cameraSize[1])
			}
			gl.bindTexture(gl.TEXTURE_2D, cameraTexture)
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cameraVideo)
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
		}

		cameraTexture = createCameraTexture()
		toy.addTexture(cameraTexture, 'camera', 1, 1)
		void initCamera()
		return { texture: cameraTexture, update: updateCamera }
	}

	return { create }
})()

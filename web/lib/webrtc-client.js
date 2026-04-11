/**
 * @file webrtc-client.js
 * Client-side WebRTC (WHEP-style): POST SDP to **same origin** `/api/go2rtc/webrtc?src=…`
 * (HighAsCG proxies to local go2rtc). Direct calls to port 1984 fail CORS from the web UI origin.
 *
 * **Dev / remote (e.g. Tailscale):** in the browser console:
 *   `localStorage.setItem('highascg_dev_remote_preview', '1')` then reload.
 *   (`setItem` returns `undefined` — that is normal. Confirm with `getItem` or the startup log below.)
 * Uses a longer reconnect delay and slightly richer `RTCPeerConnection` options.
 * Disable: `localStorage.removeItem('highascg_dev_remote_preview')`
 */

import { getApiBase } from './api-client.js'

function devRemotePreviewEnabled() {
	try {
		return typeof localStorage !== 'undefined' && localStorage.getItem('highascg_dev_remote_preview') === '1'
	} catch {
		return false
	}
}

function createPeerConnection() {
	const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]
	if (devRemotePreviewEnabled()) {
		return new RTCPeerConnection({
			iceServers,
			iceCandidatePoolSize: 10,
			bundlePolicy: 'max-bundle',
			rtcpMuxPolicy: 'require',
		})
	}
	return new RTCPeerConnection({ iceServers })
}

function reconnectDelayMs() {
	return devRemotePreviewEnabled() ? 6500 : 3000
}

/** Log once per page load when dev remote mode is on (setItem returns undefined — this confirms it worked). */
let devRemotePreviewLogged = false

/** Poll until go2rtc is up (Caspar ADD STREAM may finish slightly after go2rtc starts). */
async function waitForGo2rtcRunning(maxMs = 20000) {
	const base = typeof location !== 'undefined' ? getApiBase() : ''
	const url = `${location.origin}${base}/api/streams`
	const t0 = Date.now()
	while (Date.now() - t0 < maxMs) {
		try {
			const r = await fetch(url)
			if (r.ok) {
				const j = await r.json()
				if (j.isRunning) return
			}
		} catch {
			/* retry */
		}
		await new Promise((r) => setTimeout(r, 400))
	}
}

/**
 * @deprecated No longer used; negotiation is always same-origin. Kept for stream-state compatibility.
 * @param {number} _port
 */
export function setGo2rtcApiPort(_port) {}

/**
 * Creates a WebRTC connection to go2rtc for a specific stream name,
 * and attaches it to a newly created <video> element inside `containerEl`.
 *
 * @param {string} streamName e.g. "pgm_1"
 * @param {HTMLElement} containerEl
 * @param {Object} opts
 * @param {boolean} [opts.audioEnabled=false]
 * @returns {Object} { video, destroy, setAudioEnabled }
 */
export function createLiveView(streamName, containerEl, opts = {}) {
	if (devRemotePreviewEnabled() && !devRemotePreviewLogged) {
		devRemotePreviewLogged = true
		console.info(
			'[WebRTC] Dev remote preview enabled (localStorage highascg_dev_remote_preview=1). Longer reconnect, extra ICE options.',
		)
	}
	/** Mutable: updated by setAudioEnabled + initLiveView streamState subscription */
	let audioEnabled = !!opts.audioEnabled
	const video = document.createElement('video')
	video.autoplay = true
	video.playsInline = true
	// Start muted until the first frame plays; unmuted autoplay is often blocked (PGM vs PRV in compose).
	video.muted = true
	video.style.width = '100%'
	video.style.height = '100%'
	video.style.objectFit = 'contain'
	video.style.backgroundColor = '#000'

	containerEl.appendChild(video)

	function attachRemoteStream(stream) {
		if (video.srcObject === stream) return
		video.srcObject = stream
		video.muted = true
		void video
			.play()
			.then(() => {
				video.muted = !audioEnabled
				return video.play()
			})
			.catch((err) => {
				console.warn(`[WebRTC] ${streamName} play() (autoplay policy):`, err)
				video.muted = true
				return video.play()
			})
			.catch(() => {})
	}

	function onTrack(event) {
		attachRemoteStream(event.streams[0])
	}

	let pc = createPeerConnection()
	let reconnectTimer = null

	pc.addTransceiver('video', { direction: 'recvonly' })
	pc.addTransceiver('audio', { direction: 'recvonly' })

	pc.ontrack = onTrack

	pc.onconnectionstatechange = () => {
		if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
			console.warn(`[WebRTC] Stream ${streamName} lost. Reconnecting...`)
			scheduleReconnect()
		}
	}

	async function negotiate() {
		try {
			const offer = await pc.createOffer()
			await pc.setLocalDescription(offer)

			const base = typeof location !== 'undefined' ? getApiBase() : ''
			const url = `${location.origin}${base}/api/go2rtc/webrtc?src=${encodeURIComponent(streamName)}`

			const res = await fetch(url, {
				method: 'POST',
				body: offer.sdp,
				headers: { 'Content-Type': 'application/sdp' },
			})

			if (!res.ok) {
				throw new Error(`WebRTC negotiation failed with status ${res.status}`)
			}

			const answerSdp = await res.text()
			const answer = new RTCSessionDescription({ type: 'answer', sdp: answerSdp })
			await pc.setRemoteDescription(answer)
		} catch (e) {
			console.error(`[WebRTC] Negotiation error for ${streamName}:`, e)
			scheduleReconnect()
		}
	}

	function scheduleReconnect() {
		if (reconnectTimer) return
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null
			renegotiate()
		}, reconnectDelayMs())
	}

	function renegotiate() {
		if (!pc) return
		console.log(`[WebRTC] Renegotiating ${streamName}...`)
		pc.close()
		pc = createPeerConnection()
		pc.addTransceiver('video', { direction: 'recvonly' })
		pc.addTransceiver('audio', { direction: 'recvonly' })
		pc.ontrack = onTrack
		pc.onconnectionstatechange = () => {
			if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
				scheduleReconnect()
			}
		}
		negotiate()
	}

	// Wait for go2rtc, then negotiate (avoids go2rtc decoding before Caspar UDP MPEG-TS is live).
	void waitForGo2rtcRunning().then(() => negotiate())

	return {
		video,
		destroy: () => {
			if (reconnectTimer) clearTimeout(reconnectTimer)
			if (pc) {
				pc.close()
				pc = null
			}
			if (video.parentNode) {
				video.parentNode.removeChild(video)
			}
		},
		setAudioEnabled: (enabled) => {
			audioEnabled = !!enabled
			if (!video.srcObject) return
			video.muted = !audioEnabled
			void video.play().catch(() => {})
		}
	}
}

/**
 * @file webrtc-client.js
 * Client-side WebRTC (WHEP-style): POST SDP to **same origin** `/api/go2rtc/webrtc?src=…`
 * (HighAsCG proxies to local go2rtc). Direct calls to port 1984 fail CORS from the web UI origin.
 */

import { getApiBase } from './api-client.js'

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

	let pc = new RTCPeerConnection({
		iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
	})
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
		}, 3000)
	}

	function renegotiate() {
		if (!pc) return
		console.log(`[WebRTC] Renegotiating ${streamName}...`)
		pc.close()
		pc = new RTCPeerConnection({
			iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
		})
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

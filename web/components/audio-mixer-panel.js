/**
 * Collapsible audio mixer: program master faders (MIXER MASTERVOLUME).
 * Per-layer output pairs (ch 1+2, 3+4, …) are set in the layer inspector (dashboard / scenes).
 */

import { api } from '../lib/api-client.js'
import * as audioMixerState from '../lib/audio-mixer-state.js'
import { getVariableStore } from '../lib/variable-state.js'
import { ws } from '../app.js'

/** @param {import('../lib/state-store.js').StateStore} stateStore */
export function initAudioMixerPanel(stateStore) {
	const root = document.createElement('div')
	root.className = 'audio-mixer'
	root.innerHTML = `
		<button type="button" class="audio-mixer__tab" aria-expanded="false" title="Program audio (MASTERVOLUME)">Audio</button>
		<div class="audio-mixer__panel" hidden>
			<div class="audio-mixer__head">
				<span class="audio-mixer__title">Program</span>
				<p class="audio-mixer__hint">Faders: <code>MIXER MASTERVOLUME</code> on each program channel. Route each layer to a stereo pair (e.g. ch 1+2, 3+4) in the layer inspector.</p>
				<p class="audio-mixer__hint audio-mixer__hint--warn">Meters show relative level from faders — not measured loudness (Caspar has no AMCP VU).</p>
			</div>
			<div class="audio-mixer__buses"></div>
		</div>
	`
	document.body.appendChild(root)

	const tab = root.querySelector('.audio-mixer__tab')
	const panel = root.querySelector('.audio-mixer__panel')
	const busesEl = root.querySelector('.audio-mixer__buses')
	/** @type {ReturnType<typeof requestAnimationFrame> | null} */
	let raf = null
	/** @type {Map<string, HTMLDivElement>} */
	const meterFills = new Map()
	/** @type {Map<string, number>} fader position 0..1 (visual meter target) */
	const meterTargets = new Map()
	/** @type {Map<string, number>} smoothed meter */
	const meterSmooth = new Map()

	function getChannelMap() {
		return stateStore.getState()?.channelMap || {}
	}

	function renderBuses() {
		meterFills.clear()
		meterSmooth.clear()
		meterTargets.clear()
		const cm = getChannelMap()
		const programChannels = cm.programChannels || [1]
		busesEl.innerHTML = ''

		const rows = []
		programChannels.forEach((ch, i) => {
			const key = `pgm:${ch}`
			const v = audioMixerState.getMasterVolume(key)
			rows.push({ key, ch, label: `PGM ${i + 1} (ch ${ch})`, v })
		})

		for (const r of rows) {
			const row = document.createElement('div')
			row.className = 'audio-mixer__bus'
			row.innerHTML = `
				<div class="audio-mixer__bus-label">${escapeHtml(r.label)}</div>
				<div class="audio-mixer__meter-col">
					<div class="audio-mixer__meter" aria-hidden="true"><div class="audio-mixer__meter-fill"></div></div>
				</div>
				<div class="audio-mixer__fader-col">
					<input type="range" class="audio-mixer__fader" min="0" max="100" value="${Math.round(r.v * 100)}" data-ch="${r.ch}" data-key="${escapeAttr(r.key)}" />
					<span class="audio-mixer__fader-val">${Math.round(r.v * 100)}%</span>
				</div>
			`
			busesEl.appendChild(row)
			const fill = row.querySelector('.audio-mixer__meter-fill')
			meterFills.set(r.key, fill)
			const fader = row.querySelector('.audio-mixer__fader')
			const valEl = row.querySelector('.audio-mixer__fader-val')
			fader.addEventListener('input', () => {
				const x = parseInt(fader.value, 10) / 100
				valEl.textContent = `${fader.value}%`
				audioMixerState.setMasterVolume(r.key, x)
				meterTargets.set(r.key, x)
			})
			fader.addEventListener('change', async () => {
				const x = parseInt(fader.value, 10) / 100
				try {
					await api.post('/api/audio/volume', { channel: r.ch, master: true, volume: x })
				} catch (e) {
					console.warn('MASTERVOLUME failed:', e?.message || e)
				}
			})
			meterTargets.set(r.key, r.v)
		}

		if (!raf && meterFills.size) startMeterLoop()
	}

	function startMeterLoop() {
		if (raf) return
		const vars = getVariableStore(ws)
		const tick = () => {
			const t = performance.now() / 1000
			for (const [key, fill] of meterFills) {
				const [, ch] = key.split(':') // 'pgm:1'
				const faderVal = meterTargets.get(key) ?? 0
				
				// Try real OSC data first
				const vL = parseFloat(vars.get(`osc_ch${ch}_audio_L`))
				const vR = parseFloat(vars.get(`osc_ch${ch}_audio_R`))
				let level = -99
				if (Number.isFinite(vL) || Number.isFinite(vR)) {
					level = Math.max(Number.isFinite(vL) ? vL : -99, Number.isFinite(vR) ? vR : -99)
				}

				let s = meterSmooth.get(key) ?? 0
				let aim = 0

				if (level > -90) {
					// Real data: map -60..0 dBFS to 0..1
					aim = Math.max(0, Math.min(1, (level + 60) / 60))
				} else {
					// Simulated motion if silent or no data (subtle breathing)
					const wobble = 0.04 * Math.sin(t * 6.2 + key.length)
					aim = Math.max(0, Math.min(1, faderVal * (0.88 + 0.12 * Math.sin(t * 2.1)) + wobble * faderVal))
					// If fader is 0, stay at 0
					if (faderVal <= 0.01) aim = 0
				}

				s += (aim - s) * 0.35 // Smooth ease
				meterSmooth.set(key, s)
				fill.style.height = `${Math.round(s * 100)}%`
				
				// Optional: Set clipping color if > -1dB
				if (level > -1) fill.style.background = 'var(--accent-red)'
				else fill.style.background = 'var(--accent-green)'
			}
			raf = requestAnimationFrame(tick)
		}
		raf = requestAnimationFrame(tick)
	}

	tab.addEventListener('click', () => {
		const open = panel.hidden
		panel.hidden = !open
		tab.setAttribute('aria-expanded', open ? 'true' : 'false')
		if (open) {
			renderBuses()
		}
	})

	stateStore.on('*', () => {
		if (!panel.hidden) {
			renderBuses()
		}
	})
}

function escapeHtml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}

function escapeAttr(s) {
	return String(s).replace(/"/g, '&quot;')
}

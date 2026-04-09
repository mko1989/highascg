/**
 * Program master faders (MIXER MASTERVOLUME) — collapsible section at the bottom of the Inspector.
 * Per-layer output pairs (ch 1+2, 3+4, …) are set in the layer inspector (dashboard / scenes).
 */

import { api } from '../lib/api-client.js'
import * as audioMixerState from '../lib/audio-mixer-state.js'
import { getVariableStore } from '../lib/variable-state.js'
import { ws } from '../app.js'

const LS_EXPANDED = 'highascg_inspector_program_audio_expanded'

/** @param {import('../lib/state-store.js').StateStore} stateStore */
export function initAudioMixerPanel(stateStore, mountEl) {
	if (!mountEl) return

	const root = document.createElement('div')
	root.className = 'audio-mixer audio-mixer--inspector'
	root.innerHTML = `
		<button type="button" class="audio-mixer__section-toggle" aria-expanded="false" title="Program audio (MASTERVOLUME)">
			<span class="audio-mixer__section-chevron" aria-hidden="true">▶</span>
			<span class="audio-mixer__section-label">Program audio</span>
		</button>
		<div class="audio-mixer__panel" hidden>
			<div class="audio-mixer__head">
				<span class="audio-mixer__title">Program</span>
				<p class="audio-mixer__hint">Faders: <code>MIXER MASTERVOLUME</code> on each program channel. Route each layer to a stereo pair (e.g. ch 1+2, 3+4) in the layer inspector.</p>
				<p class="audio-mixer__hint">Meters: when OSC sends channel levels, the bar is that level scaled by this fader; otherwise the bar follows the fader (applied gain).</p>
			</div>
			<div class="audio-mixer__buses"></div>
		</div>
	`
	mountEl.appendChild(root)

	const toggle = root.querySelector('.audio-mixer__section-toggle')
	const panel = root.querySelector('.audio-mixer__panel')
	const chevron = root.querySelector('.audio-mixer__section-chevron')
	const busesEl = root.querySelector('.audio-mixer__buses')
	/** @type {ReturnType<typeof requestAnimationFrame> | null} */
	let raf = null
	/** @type {Map<string, HTMLDivElement>} */
	const meterFills = new Map()
	/** @type {Map<string, number>} fader position 0..1 (visual meter target) */
	const meterTargets = new Map()
	/** @type {Map<string, number>} smoothed meter */
	const meterSmooth = new Map()

	function stopMeterLoop() {
		if (raf) {
			cancelAnimationFrame(raf)
			raf = null
		}
	}

	function getChannelMap() {
		return stateStore.getState()?.channelMap || {}
	}

	function renderBuses() {
		stopMeterLoop()
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
					<input type="range" class="audio-mixer__fader" min="0" max="100" value="${Math.round(r.v * 100)}" aria-orientation="vertical" data-ch="${r.ch}" data-key="${escapeAttr(r.key)}" />
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

		if (meterFills.size) startMeterLoop()
	}

	function startMeterLoop() {
		if (raf) return
		const vars = getVariableStore(ws)
		const tick = () => {
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
					// OSC dBFS → 0..1, then apply master fader (same staging as the mix)
					const raw = Math.max(0, Math.min(1, (level + 60) / 60))
					aim = raw * faderVal
				} else {
					// No OSC: show applied gain (fader position)
					aim = faderVal
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

	function applyExpanded(expanded) {
		panel.hidden = !expanded
		toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false')
		if (chevron) chevron.textContent = expanded ? '▼' : '▶'
		if (expanded) {
			renderBuses()
		} else {
			stopMeterLoop()
		}
	}

	let initialExpanded = false
	try {
		initialExpanded = localStorage.getItem(LS_EXPANDED) === '1'
	} catch {
		/* ignore */
	}
	applyExpanded(initialExpanded)

	toggle.addEventListener('click', () => {
		const next = panel.hidden
		try {
			localStorage.setItem(LS_EXPANDED, next ? '1' : '0')
		} catch {
			/* ignore */
		}
		applyExpanded(next)
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

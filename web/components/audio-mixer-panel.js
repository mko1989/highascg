/**
 * Program master faders (MIXER MASTERVOLUME) — collapsible section at the bottom of the Inspector.
 * Per-layer output pairs (ch 1+2, 3+4, …) are set in the layer inspector (dashboard / scenes).
 */

import { api } from '../lib/api-client.js'
import * as audioMixerState from '../lib/audio-mixer-state.js'
import { getVariableStore } from '../lib/variable-state.js'
import { getOscClient, ws } from '../app.js'

/** @param {unknown[]} [levels] */
function peakDbfsFromLevels(levels) {
	if (!Array.isArray(levels) || levels.length === 0) return NaN
	const L = levels[0]?.dBFS
	const R = levels[1]?.dBFS
	if (!Number.isFinite(L) && !Number.isFinite(R)) return NaN
	return Math.max(Number.isFinite(L) ? L : -99, Number.isFinite(R) ? R : -99)
}

/** @param {Record<string, string> | undefined} obj */
function peakDbfsFromVarStrings(obj, chNum) {
	if (!obj || typeof obj !== 'object') return NaN
	const fromStr = (s) => {
		const t = String(s ?? '').trim()
		if (t === '') return NaN
		const n = parseFloat(t)
		return Number.isFinite(n) ? n : NaN
	}
	const vL = fromStr(obj[`osc_ch${chNum}_audio_L`])
	const vR = fromStr(obj[`osc_ch${chNum}_audio_R`])
	if (!Number.isFinite(vL) && !Number.isFinite(vR)) return NaN
	return Math.max(Number.isFinite(vL) ? vL : -99, Number.isFinite(vR) ? vR : -99)
}

/**
 * Peak dBFS: merge OscClient + state variables + VariableStore.
 * Use Math.min across sources so a fresh quiet reading (-120) wins over a stale high peak
 * (WS delta merge can keep old `audio.levels` when a tick omits `audio`).
 * @param {number} chNum
 * @param {import('../lib/variable-state.js').VariableStore | null} vars
 * @param {import('../lib/osc-client.js').OscClient | null} oscClient
 * @param {import('../lib/state-store.js').StateStore} stateStore
 */
function readBusPeakDbfs(chNum, vars, oscClient, stateStore) {
	const key = String(chNum)
	const chState = oscClient?.channels?.[key] ?? oscClient?.channels?.[chNum]
	const pOsc = peakDbfsFromLevels(chState?.audio?.levels)
	const pSt = peakDbfsFromVarStrings(stateStore?.getState?.()?.variables, chNum)
	const pVs = vars ? peakDbfsFromVarStrings(vars.variables, chNum) : NaN
	const cands = [pOsc, pSt, pVs].filter((x) => Number.isFinite(x))
	if (cands.length === 0) return -99
	return Math.min(...cands)
}

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
				<p class="audio-mixer__hint">Meters: incoming level (dBFS) when OSC reports above ~−90 dBFS; silence or no OSC shows an empty bar. Fader sets Caspar MASTERVOLUME only.</p>
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
		const cm = getChannelMap()
		// `[]` is truthy — without length check we render zero buses and never start the meter loop.
		const programChannels =
			Array.isArray(cm.programChannels) && cm.programChannels.length > 0 ? cm.programChannels : [1]
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
			})
			fader.addEventListener('change', async () => {
				const x = parseInt(fader.value, 10) / 100
				try {
					await api.post('/api/audio/volume', { channel: r.ch, master: true, volume: x })
				} catch (e) {
					console.warn('MASTERVOLUME failed:', e?.message || e)
				}
			})
		}

		if (meterFills.size) startMeterLoop()
	}

	function startMeterLoop() {
		if (raf) return
		const vars = getVariableStore(ws)
		const tick = () => {
			const oscClient = getOscClient()
			for (const [key, fill] of meterFills) {
				const [, chStr] = key.split(':') // 'pgm:1'
				const chNum = parseInt(chStr, 10)

				const level = Number.isFinite(chNum) ? readBusPeakDbfs(chNum, vars, oscClient, stateStore) : -99

				let s = meterSmooth.get(key) ?? 0
				let aim = 0

				if (level > -90) {
					// dBFS → 0..1 bar height (noise floor ~-90; below that treated as silence)
					const raw = Math.max(0, Math.min(1, (level + 60) / 60))
					aim = raw
				} else {
					// No signal / no meter: empty bar (fader is separate; mirroring it read as “full + clipping” when silent)
					aim = 0
				}

				s += (aim - s) * 0.35 // Smooth ease
				meterSmooth.set(key, s)
				fill.style.height = `${Math.round(s * 100)}%`

				if (level > -90) {
					// Clip only when we have a real meter reading above ~full-scale
					if (level > -1) fill.style.background = 'var(--accent-red)'
					else fill.style.background = 'var(--accent-green)'
				} else {
					fill.style.removeProperty('background')
				}
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

	// Default expanded so users see buses/meters; collapse only if explicitly saved off
	let initialExpanded = true
	try {
		const v = localStorage.getItem(LS_EXPANDED)
		if (v === '0') initialExpanded = false
		else if (v === '1') initialExpanded = true
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

	stateStore.on('*', (path) => {
		if (panel.hidden) return
		// setState emits path '*'. Do not re-DOM on every variables merge (live meter reads state in rAF).
		if (path === 'variables') return
		if (path === '*' || path == null || path === 'channelMap' || path === 'channels') renderBuses()
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

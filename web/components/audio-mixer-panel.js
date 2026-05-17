/**
 * Program master faders (MIXER MASTERVOLUME) — collapsible section at the bottom of the Inspector.
 * Per-layer output pairs (ch 1+2, 3+4, …) are set in the layer inspector (looks / scenes).
 */

import { api } from '../lib/api-client.js'
import * as audioMixerState from '../lib/audio-mixer-state.js'
import { getVariableStore } from '../lib/variable-state.js'
import { getOscClient, ws } from '../app.js'
import { isMediaOrFileSource } from './scenes-shared.js'
import { audioOutputRoutesForLayout } from '../lib/audio-routes.js'

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
 * Bus peak dBFS: read OSC first (freshest, ~50ms tick), fall back to variables (10Hz throttle).
 * Do NOT take Math.min across sources — stale or out-of-phase samples would falsely pin the meter low.
 * @param {number} chNum
 * @param {import('../lib/variable-state.js').VariableStore | null} vars
 * @param {import('../lib/osc-client.js').OscClient | null} oscClient
 * @param {import('../lib/state-store.js').StateStore} stateStore
 */
function readBusPeakDbfs(chNum, vars, oscClient, stateStore) {
	const key = String(chNum)
	const chState = oscClient?.channels?.[key] ?? oscClient?.channels?.[chNum]
	const pOsc = peakDbfsFromLevels(chState?.audio?.levels)
	if (Number.isFinite(pOsc)) return pOsc
	const pSt = peakDbfsFromVarStrings(stateStore?.getState?.()?.variables, chNum)
	if (Number.isFinite(pSt)) return pSt
	const pVs = vars ? peakDbfsFromVarStrings(vars.variables, chNum) : NaN
	if (Number.isFinite(pVs)) return pVs
	return -99
}

/**
 * Layer dBFS estimate: CasparCG OSC does **not** expose per-layer meters (only `/mixer/audio/`
 * post-mix on the channel). For a layer row we approximate by reading the channel master and
 * attenuating by the layer fader (so the bar still moves with audio + reflects fader changes).
 * When the layer is paused/empty we force silence.
 *
 * @param {number} chNum
 * @param {number} layerNum
 * @param {import('../lib/osc-client.js').OscClient | null} oscClient
 * @param {import('../lib/state-store.js').StateStore} stateStore
 * @param {{ volume?: number, paused?: boolean }} layerMeta
 */
function readLayerPeakDbfs(chNum, layerNum, oscClient, stateStore, layerMeta) {
	if (layerMeta?.paused) return -99
	const key = String(chNum)
	const chState = oscClient?.channels?.[key] ?? oscClient?.channels?.[chNum]
	const oscLayer = chState?.layers?.[layerNum] ?? chState?.layers?.[String(layerNum)]
	// Empty/no foreground producer → silence (avoids meter activity on layers without media).
	const lt = String(oscLayer?.type || '')
	if (lt === 'empty' || oscLayer?.paused === true) return -99
	const master = peakDbfsFromLevels(chState?.audio?.levels)
	if (!Number.isFinite(master)) return -99
	const vol = Number.isFinite(layerMeta?.volume) ? Math.max(0, Math.min(1, layerMeta.volume)) : 1
	if (vol <= 0) return -99
	// Apply fader as a linear gain on amplitude → dBFS: 20·log10(vol).
	return master + 20 * Math.log10(vol)
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
	/** @type {Map<string, { volume: number, paused: boolean }>} per-layer meta for layer rows */
	const meterLayerMeta = new Map()

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
		meterLayerMeta.clear()
		const cm = getChannelMap()
		// `[]` is truthy — without length check we render zero buses and never start the meter loop.
		const programChannels =
			Array.isArray(cm.programChannels) && cm.programChannels.length > 0 ? cm.programChannels : [1]
		busesEl.innerHTML = ''

		const rows = []
		programChannels.forEach((ch, i) => {
			const key = `pgm:${ch}`
			const v = audioMixerState.getMasterVolume(key)
			rows.push({ key, ch, label: `PGM ${i + 1} (ch ${ch})`, v, isMaster: true })

			const liveScenes = stateStore.getState()?.scene?.live || {}
			const liveSceneData = liveScenes[ch] || liveScenes[String(ch)]
			if (liveSceneData?.scene?.layers) {
				liveSceneData.scene.layers.forEach((layer) => {
					if (isMediaOrFileSource(layer.source)) {
						const ln = layer.layerNumber
						const fullName = String(layer.source.value || '').split('/').pop() || ''
						const shortName = shortenMediaName(fullName)
						const lKey = `pgm:${ch}:layer:${ln}`
						rows.push({
							key: lKey,
							ch,
							layer: ln,
							label: `L${ln} · ${shortName}`,
							labelTitle: `L${ln}: ${fullName}`,
							v: layer.volume != null ? layer.volume : 1,
							isMaster: false,
							audioRoute: layer.audioRoute || '1+2',
							sceneId: liveSceneData.sceneId,
						})
					}
				})
			}
		})

		for (const r of rows) {
			const row = document.createElement('div')
			row.className = 'audio-mixer__bus' + (r.isMaster ? ' audio-mixer__bus--master' : ' audio-mixer__bus--layer')
			
			let routeHtml = ''
			let soloHtml = ''
			if (!r.isMaster) {
				const masterLayout = stateStore.getState()?.settings?.audioRouting?.programLayout || 'stereo'
				const routes = audioOutputRoutesForLayout(masterLayout)
				let options = routes.map((rt) => `<option value="${escapeAttr(rt.value)}"${rt.value === r.audioRoute ? ' selected' : ''}>${escapeHtml(rt.label)}</option>`).join('')
				routeHtml = `<select class="audio-mixer__route-sel" data-ch="${r.ch}" data-layer="${r.layer}" data-scene="${escapeAttr(r.sceneId)}" aria-label="Audio Route" title="Audio routing destination">${options}</select>`
				
				const isSolo = audioMixerState.isSoloed(r.key)
				soloHtml = `<button type="button" class="audio-mixer__solo-btn${isSolo ? ' audio-mixer__solo-btn--active' : ''}" data-key="${escapeAttr(r.key)}" title="Solo this layer to monitor (Cmd/Ctrl+Click for multi)">S</button>`
			}

			const labelTitle = r.labelTitle || r.label
			row.innerHTML = `
				<div class="audio-mixer__meter-stack">
					<div class="audio-mixer__bus-label" title="${escapeAttr(labelTitle)}">${escapeHtml(r.label)}</div>
					${soloHtml}
					${routeHtml}
					<div class="audio-mixer__meter" aria-hidden="true"><div class="audio-mixer__meter-fill"></div></div>
				</div>
				<div class="audio-mixer__fader-col">
					<input type="range" class="audio-mixer__fader" min="0" max="100" value="${Math.round(r.v * 100)}" aria-orientation="vertical" data-ch="${r.ch}" data-key="${escapeAttr(r.key)}" aria-label="Volume" />
					<span class="audio-mixer__fader-val">${Math.round(r.v * 100)}%</span>
				</div>
			`
			busesEl.appendChild(row)

			if (!r.isMaster) {
				const soloBtn = row.querySelector('.audio-mixer__solo-btn')
				if (soloBtn) {
					soloBtn.onclick = async (e) => {
						const multi = e.metaKey || e.ctrlKey
						audioMixerState.toggleSolo(r.key, multi)
						
						// Update all solo buttons in the UI
						const allSoloBtns = busesEl.querySelectorAll('.audio-mixer__solo-btn')
						allSoloBtns.forEach(btn => {
							const k = btn.dataset.key
							if (audioMixerState.isSoloed(k)) btn.classList.add('audio-mixer__solo-btn--active')
							else btn.classList.remove('audio-mixer__solo-btn--active')
						})

						// Send to backend
						try {
							const solos = audioMixerState.getSoloedLayers().map(k => {
								const parts = k.split(':')
								return { channel: parseInt(parts[1], 10), layer: parseInt(parts[3], 10) }
							})
							await api.post('/api/audio/solo', { solos })
						} catch (err) {
							console.error('Failed to set solo:', err)
						}
					}
				}
			}

			const fill = row.querySelector('.audio-mixer__meter-fill')
			meterFills.set(r.key, fill)
			if (!r.isMaster) {
				meterLayerMeta.set(r.key, { volume: r.v, paused: false })
			}
			const fader = row.querySelector('.audio-mixer__fader')
			const valEl = row.querySelector('.audio-mixer__fader-val')
			
			if (r.isMaster) {
				fader.addEventListener('input', () => {
					const x = parseInt(fader.value, 10) / 100
					valEl.textContent = `${fader.value}%`
					audioMixerState.setMasterVolume(r.key, x)
				})
			} else {
				fader.addEventListener('input', () => {
					const x = parseInt(fader.value, 10) / 100
					valEl.textContent = `${fader.value}%`
					const meta = meterLayerMeta.get(r.key)
					if (meta) meta.volume = x
				})
			}
			
			fader.addEventListener('change', async () => {
				const x = parseInt(fader.value, 10) / 100
				try {
					if (r.isMaster) {
						await api.post('/api/audio/volume', { channel: r.ch, master: true, volume: x })
					} else {
						await api.post('/api/audio/volume', { channel: r.ch, layer: r.layer, volume: x })
					}
				} catch (e) {
					console.warn('VOLUME failed:', e?.message || e)
				}
			})

			if (!r.isMaster) {
				const routeSel = row.querySelector('.audio-mixer__route-sel')
				if (routeSel) {
					routeSel.addEventListener('change', () => {
						import('../lib/scene-state.js').then(({ sceneState }) => {
							const scene = sceneState.getScene(r.sceneId)
							if (scene) {
								const idx = scene.layers.findIndex((l) => l.layerNumber === r.layer)
								if (idx >= 0) {
									sceneState.patchLayer(r.sceneId, idx, { audioRoute: routeSel.value })
									import('./scenes-editor-support.js').then(({ showScenesToast }) => {
										showScenesToast('Route changed. Re-take the look to apply to output.', 'info')
									})
								}
							}
						})
					})
				}
			}
		}

		if (meterFills.size) startMeterLoop()
	}

	function startMeterLoop() {
		if (raf) return
		const vars = getVariableStore(ws)
		const tick = () => {
			const oscClient = getOscClient()
			for (const [key, fill] of meterFills) {
				let level = -99
				if (key.includes(':layer:')) {
					const [, chStr, , lnStr] = key.split(':')
					const chNum = parseInt(chStr, 10)
					const lnNum = parseInt(lnStr, 10)
					const meta = meterLayerMeta.get(key)
					level =
						Number.isFinite(chNum) && Number.isFinite(lnNum)
							? readLayerPeakDbfs(chNum, lnNum, oscClient, stateStore, meta)
							: -99
				} else {
					const [, chStr] = key.split(':') // 'pgm:1'
					const chNum = parseInt(chStr, 10)
					level = Number.isFinite(chNum) ? readBusPeakDbfs(chNum, vars, oscClient, stateStore) : -99
				}

				let s = meterSmooth.get(key) ?? 0
				let aim = 0

				if (level > -90) {
					// dBFS → 0..1 bar height (noise floor ~-90; below that treated as silence)
					aim = Math.max(0, Math.min(1, (level + 60) / 60))
				}

				// Classic VU behaviour: fast attack (snap up to peak), slow release (~250 ms).
				// Previous symmetric smoothing made loud transients feel "laggy" / unresponsive.
				if (aim >= s) s = aim
				else s += (aim - s) * 0.18
				meterSmooth.set(key, s)
				const pct = (s * 100).toFixed(1)
				if (fill._lastPct !== pct) {
					fill.style.height = `${pct}%`
					fill._lastPct = pct
				}

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
		// Re-render when channels/map change or when a new look is taken (so layer rows reflect the current live scene).
		if (
			path === '*' ||
			path == null ||
			path === 'channelMap' ||
			path === 'channels' ||
			path === 'scene.live' ||
			(typeof path === 'string' && path.startsWith('scene.live'))
		) {
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

/**
 * Shorten a media filename for the narrow audio-mixer label column.
 * - Strip extension
 * - Drop common technical suffix tokens (resolution, fps, codec, colorspace, dates, etc.)
 * - Cap to ~22 chars with an ellipsis in the middle so both ends stay readable
 * The full name is kept in the row's `title` tooltip.
 */
function shortenMediaName(raw) {
	const s = String(raw || '').trim()
	if (!s) return ''
	const noExt = s.replace(/\.[a-z0-9]{2,4}$/i, '')
	const tokens = noExt.split(/[_\s.-]+/).filter(Boolean)
	const KEEP = []
	for (const tok of tokens) {
		// Drop tokens that look like technical metadata rather than a human title.
		if (/^\d{6,}$/.test(tok)) continue                       // long date/serial
		if (/^\d{1,4}(fps|hz|k|p|i)$/i.test(tok)) continue       // 25fps, 48k, 1080p
		if (/^(hd|uhd|sd|4k|8k|hdr|sdr)$/i.test(tok)) continue
		if (/^(r709|r2020|p3|rec709|rec2020|srgb)$/i.test(tok)) continue
		if (/^(hap|prores|h264|h265|hevc|dnxhd|dnxhr|mxf|mov)$/i.test(tok)) continue
		if (/^(master|final|preview|proxy|mezz|mezzanine)$/i.test(tok)) continue
		if (/^\d+dfx?$/i.test(tok)) continue                     // 20DFX
		if (/^[A-Z]{2}-[A-Z]{2,}$/.test(tok)) continue           // PL-XX language tag
		KEEP.push(tok)
	}
	const cleaned = (KEEP.length ? KEEP.join('_') : noExt)
	const MAX = 22
	if (cleaned.length <= MAX) return cleaned
	const head = cleaned.slice(0, MAX - 4)
	const tail = cleaned.slice(-3)
	return `${head}…${tail}`
}

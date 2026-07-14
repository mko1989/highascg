/**
 * Scene layer — Countdown / timer template inspector (WO-169).
 * Clones the inspector-html-template.js / inspector-lower-third.js pattern: string-match on
 * `countdown` in the source path, patch `layer.source.countdownConfig` (+ `layer.cgData` for
 * extractTemplateCgData / scene take, see src/engine/scene-template-cg.js:71), debounce a live
 * CG UPDATE to the layer's host layer, and provide Start/Pause/Reset transport controls.
 * @see template/countdown/countdown.html (window.update contract), src/api/routes-countdown.js
 */

import { api } from '../lib/api-client.js'
import { sceneState } from '../lib/scene-state.js'
import { resolveLookStackChannelForBus, resolveMainIndexForScene } from '../lib/look-stack-amcp-channel.js'
import { escapeAttr } from '../lib/dom-escape.js'
import { attachMathInput } from '../lib/math-input.js'
import { createHmsInput, hmsToSeconds, secondsToHms } from '../lib/duration-hms-input.js'

/** Debounced CG UPDATE from inspector edits (ms) — matches lower-third's cadence. */
export const COUNTDOWN_CG_UPDATE_DEBOUNCE_MS = 450

export const DEFAULT_COUNTDOWN_CONFIG = {
	mode: 'duration',
	durationSec: 300,
	targetTime: '18:00:00',
	format: 'auto',
	amberThresholdSec: 60,
	redThresholdSec: 15,
	position: 'center',
	hideTimer: false,
	timerFontSize: 15,
	auxFontSize: 5,
	timerColor: '#ffffff',
	amberColor: '#ffb300',
	redColor: '#ff3b30',
	auxColor: '#ffffff',
	auxTop: '',
	auxMiddle: '',
	auxBottom: '',
}

const POSITION_OPTIONS = [
	['top-left', 'Top Left'],
	['top-middle', 'Top Middle'],
	['top-right', 'Top Right'],
	['bottom-left', 'Bottom Left'],
	['bottom-middle', 'Bottom Middle'],
	['bottom-right', 'Bottom Right'],
	['center', 'Center'],
]

/**
 * @param {object|null|undefined} source
 * @returns {boolean}
 */
export function isCountdownSource(source) {
	if (!source?.value) return false
	const v = String(source.value).toLowerCase().replace(/\\/g, '/')
	return v.includes('countdown/countdown')
}

/**
 * @param {object} layer
 * @returns {typeof DEFAULT_COUNTDOWN_CONFIG}
 */
function resolveLayerCountdownConfig(layer) {
	const cfg = layer?.source?.countdownConfig
	return { ...DEFAULT_COUNTDOWN_CONFIG, ...(cfg && typeof cfg === 'object' ? cfg : {}) }
}

/**
 * @param {HTMLElement} root
 * @param {object} opts
 * @param {string} opts.sceneId
 * @param {number} opts.layerIndex
 * @param {object} opts.layer
 * @param {object} opts.stateStore
 */
export function appendCountdownGroup(root, { sceneId, layerIndex, layer, stateStore }) {
	const src = layer?.source
	if (!isCountdownSource(src)) return

	let cgUpdateTimer = null
	let cgUpdateInFlight = false
	let cgUpdateQueued = false

	const cfg = resolveLayerCountdownConfig(layer)

	const grp = document.createElement('div')
	grp.className = 'inspector-group inspector-countdown-group'
	// WO-196 T196.4: add help text documenting timer identity and continuity.
	const helpText = 'Timer identity = screen + layer number. Reuse the same layer number across looks to carry one timer through them; use another layer number for an independent timer.'
	grp.innerHTML = `<div class="inspector-group__title" title="${escapeAttr(helpText)}">Countdown / Timer</div>`

	/* ── mode ─────────────────────────────────────────────── */
	const modeField = document.createElement('div')
	modeField.className = 'inspector-field'
	modeField.innerHTML = `
		<label class="inspector-field__label">Mode
			<select class="inspector-field__select" id="cd-mode">
				<option value="duration"${cfg.mode === 'duration' ? ' selected' : ''}>Countdown (duration)</option>
				<option value="clock"${cfg.mode === 'clock' ? ' selected' : ''}>Countdown to clock time</option>
				<option value="countup"${cfg.mode === 'countup' ? ' selected' : ''}>Count up</option>
			</select>
		</label>
	`
	grp.appendChild(modeField)
	const modeSelect = modeField.querySelector('#cd-mode')

	/* ── duration in HH:MM:SS (mode = duration) ──────────────────── */
	const durationField = document.createElement('div')
	durationField.className = 'inspector-field'
	durationField.innerHTML = '<label class="inspector-field__label">Duration (HH:MM:SS)</label>'
	grp.appendChild(durationField)
	const { wrap: durationHmsWrap, setValue: setDurationHms } = createHmsInput({
		value: cfg.durationSec ?? 300,
		onChange: (seconds) => onFieldChange({ durationSec: seconds }),
	})
	durationField.appendChild(durationHmsWrap)

	/* ── target time (mode = clock) ──────────────────────────── */
	const targetField = document.createElement('div')
	targetField.className = 'inspector-field'
	targetField.innerHTML = `
		<label class="inspector-field__label">Target time (HH:MM[:SS], local)
			<input type="text" class="inspector-field__input" id="cd-target" value="${escapeAttr(cfg.targetTime || '')}" placeholder="18:00:00" />
		</label>
	`
	grp.appendChild(targetField)
	targetField.querySelector('#cd-target').addEventListener('input', (e) => onFieldChange({ targetTime: e.target.value }))

	function syncModeVisibility() {
		const mode = modeSelect.value || cfg.mode
		durationField.style.display = mode === 'duration' ? '' : 'none'
		targetField.style.display = mode === 'clock' ? '' : 'none'
	}
	syncModeVisibility()
	modeSelect.addEventListener('change', (e) => {
		syncModeVisibility()
		onFieldChange({ mode: e.target.value })
	})

	/* ── display format ──────────────────────────────────────── */
	const formatField = document.createElement('div')
	formatField.className = 'inspector-field'
	formatField.innerHTML = `
		<label class="inspector-field__label">Display format
			<select class="inspector-field__select" id="cd-format">
				<option value="auto"${cfg.format === 'auto' ? ' selected' : ''}>Auto (HH:MM:SS / MM:SS)</option>
				<option value="hms"${cfg.format === 'hms' ? ' selected' : ''}>HH:MM:SS</option>
				<option value="ms"${cfg.format === 'ms' ? ' selected' : ''}>MM:SS</option>
			</select>
		</label>
	`
	grp.appendChild(formatField)
	formatField.querySelector('#cd-format').addEventListener('change', (e) => onFieldChange({ format: e.target.value }))

	/* ── amber / red thresholds ──────────────────────────────── */
	const thresholdRow = document.createElement('div')
	thresholdRow.className = 'inspector-row'
	thresholdRow.style.display = 'flex'
	thresholdRow.style.gap = '8px'
	thresholdRow.innerHTML = `
		<div class="inspector-field" style="flex:1">
			<label class="inspector-field__label">Amber at (s)
				<input type="text" class="inspector-field__input" id="cd-amber" value="${escapeAttr(String(cfg.amberThresholdSec ?? 60))}" />
			</label>
		</div>
		<div class="inspector-field" style="flex:1">
			<label class="inspector-field__label">Red at (s)
				<input type="text" class="inspector-field__input" id="cd-red" value="${escapeAttr(String(cfg.redThresholdSec ?? 15))}" />
			</label>
		</div>
	`
	grp.appendChild(thresholdRow)
	const amberInput = thresholdRow.querySelector('#cd-amber')
	const redInput = thresholdRow.querySelector('#cd-red')
	amberInput.addEventListener('input', (e) => onFieldChange({ amberThresholdSec: readNum(e.target.value, cfg.amberThresholdSec) }))
	redInput.addEventListener('input', (e) => onFieldChange({ redThresholdSec: readNum(e.target.value, cfg.redThresholdSec) }))
	attachMathInput(amberInput, { decimals: 0, min: 0 })
	attachMathInput(redInput, { decimals: 0, min: 0 })

	/* ── position ─────────────────────────────────────────────── */
	const posField = document.createElement('div')
	posField.className = 'inspector-field'
	posField.innerHTML = `
		<label class="inspector-field__label">Position
			<select class="inspector-field__select" id="cd-position">
				${POSITION_OPTIONS.map(([id, label]) => `<option value="${id}"${cfg.position === id ? ' selected' : ''}>${label}</option>`).join('')}
			</select>
		</label>
	`
	grp.appendChild(posField)
	posField.querySelector('#cd-position').addEventListener('change', (e) => onFieldChange({ position: e.target.value }))

	/* ── hide timer (show 3rd aux line instead) ──────────────────── */
	const hideField = document.createElement('div')
	hideField.className = 'inspector-field'
	hideField.innerHTML = `
		<label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer">
			<input type="checkbox" id="cd-hide-timer" ${cfg.hideTimer ? 'checked' : ''} />
			Hide timer (show middle aux line instead)
		</label>
	`
	grp.appendChild(hideField)
	hideField.querySelector('#cd-hide-timer').addEventListener('change', (e) => onFieldChange({ hideTimer: !!e.target.checked }))

	/* ── font sizes ───────────────────────────────────────────── */
	const sizeRow = document.createElement('div')
	sizeRow.className = 'inspector-row'
	sizeRow.style.display = 'flex'
	sizeRow.style.gap = '8px'
	sizeRow.innerHTML = `
		<div class="inspector-field" style="flex:1">
			<label class="inspector-field__label">Timer size (vw)
				<input type="text" class="inspector-field__input" id="cd-timer-size" value="${escapeAttr(String(cfg.timerFontSize ?? 15))}" />
			</label>
		</div>
		<div class="inspector-field" style="flex:1">
			<label class="inspector-field__label">Aux size (vw)
				<input type="text" class="inspector-field__input" id="cd-aux-size" value="${escapeAttr(String(cfg.auxFontSize ?? 5))}" />
			</label>
		</div>
	`
	grp.appendChild(sizeRow)
	const timerSizeInput = sizeRow.querySelector('#cd-timer-size')
	const auxSizeInput = sizeRow.querySelector('#cd-aux-size')
	timerSizeInput.addEventListener('input', (e) => onFieldChange({ timerFontSize: readNum(e.target.value, cfg.timerFontSize) }))
	auxSizeInput.addEventListener('input', (e) => onFieldChange({ auxFontSize: readNum(e.target.value, cfg.auxFontSize) }))
	attachMathInput(timerSizeInput, { decimals: 1, min: 1, max: 100 })
	attachMathInput(auxSizeInput, { decimals: 1, min: 1, max: 50 })

	/* ── colors ───────────────────────────────────────────────── */
	const colorRow = document.createElement('div')
	colorRow.className = 'inspector-row'
	colorRow.style.display = 'flex'
	colorRow.style.gap = '8px'
	colorRow.style.flexWrap = 'wrap'
	colorRow.innerHTML = `
		<label class="inspector-field" style="flex:1 1 80px"><span class="inspector-field__label">Normal</span>
			<input type="color" class="inspector-field__color" id="cd-color-normal" value="${escapeAttr(cfg.timerColor || '#ffffff')}" /></label>
		<label class="inspector-field" style="flex:1 1 80px"><span class="inspector-field__label">Amber</span>
			<input type="color" class="inspector-field__color" id="cd-color-amber" value="${escapeAttr(cfg.amberColor || '#ffb300')}" /></label>
		<label class="inspector-field" style="flex:1 1 80px"><span class="inspector-field__label">Red</span>
			<input type="color" class="inspector-field__color" id="cd-color-red" value="${escapeAttr(cfg.redColor || '#ff3b30')}" /></label>
		<label class="inspector-field" style="flex:1 1 80px"><span class="inspector-field__label">Aux text</span>
			<input type="color" class="inspector-field__color" id="cd-color-aux" value="${escapeAttr(cfg.auxColor || '#ffffff')}" /></label>
	`
	grp.appendChild(colorRow)
	colorRow.querySelector('#cd-color-normal').addEventListener('input', (e) => onFieldChange({ timerColor: e.target.value }))
	colorRow.querySelector('#cd-color-amber').addEventListener('input', (e) => onFieldChange({ amberColor: e.target.value }))
	colorRow.querySelector('#cd-color-red').addEventListener('input', (e) => onFieldChange({ redColor: e.target.value }))
	colorRow.querySelector('#cd-color-aux').addEventListener('input', (e) => onFieldChange({ auxColor: e.target.value }))

	/* ── aux text lines (up to 3) ─────────────────────────────── */
	const auxKeys = [
		['auxTop', 'Aux line — top'],
		['auxMiddle', 'Aux line — middle'],
		['auxBottom', 'Aux line — bottom'],
	]
	auxKeys.forEach(([key, label]) => {
		const f = document.createElement('div')
		f.className = 'inspector-field'
		const id = 'cd-' + key
		f.innerHTML = `
			<label class="inspector-field__label">${label}
				<input type="text" class="inspector-field__input" id="${id}" value="${escapeAttr(cfg[key] || '')}" />
			</label>
		`
		grp.appendChild(f)
		f.querySelector('#' + id).addEventListener('input', (e) => onFieldChange({ [key]: e.target.value }))
	})

	/* ── transport ────────────────────────────────────────────── */
	const actRow = document.createElement('div')
	actRow.className = 'inspector-row'
	actRow.style.display = 'flex'
	actRow.style.gap = '8px'
	actRow.style.marginTop = '8px'
	actRow.innerHTML = `
		<button type="button" class="inspector-btn inspector-btn-sm" data-cd-action="start" title="Start / resume the countdown">▶ Start</button>
		<button type="button" class="inspector-btn inspector-btn-sm" data-cd-action="pause" title="Pause the countdown">⏸ Pause</button>
		<button type="button" class="inspector-btn inspector-btn-sm" data-cd-action="reset" title="Reset to the configured start value">⟲ Reset</button>
	`
	grp.appendChild(actRow)
	actRow.querySelectorAll('[data-cd-action]').forEach((btn) => {
		btn.addEventListener('click', async () => {
			const action = btn.getAttribute('data-cd-action')
			const buttons = Array.from(actRow.querySelectorAll('button'))
			buttons.forEach((b) => { b.disabled = true })
			try {
				await flushCgUpdate()
				await api.post(`/api/countdown/${action}`, getRouting())
			} catch (err) {
				console.warn(`[countdown] ${action} failed:`, err?.message || err)
			} finally {
				buttons.forEach((b) => { b.disabled = false })
			}
		})
	})

	root.appendChild(grp)

	const obs = new MutationObserver(() => {
		if (!grp.isConnected) {
			if (cgUpdateTimer) clearTimeout(cgUpdateTimer)
			obs.disconnect()
		}
	})
	obs.observe(root, { childList: true })

	function readNum(raw, fallback) {
		const n = parseFloat(String(raw))
		return Number.isFinite(n) ? n : fallback
	}

	/**
	 * Same routing as inspector-lower-third.js's getRouting(): the mapped preview/edit bus
	 * channel for this look's main + the layer's logical layerNumber. `templateHostLayer` is
	 * pinned to 0 to match the CG sub-layer scene take always ADDs template layers at (see
	 * module header) — NOT the 1 that routes-lower-thirds.js's separate standalone flow uses.
	 */
	function getRouting() {
		const cm = stateStore?.getState?.()?.channelMap || {}
		const scene = sceneState.getScene(sceneId)
		const mIdx = resolveMainIndexForScene(scene, sceneState)
		const targetCh =
			resolveLookStackChannelForBus(cm, sceneState, scene, 'edit', mIdx) ??
			Number(cm.programChannels?.[mIdx] ?? cm.playbackChannels?.[mIdx])
		if (!Number.isFinite(targetCh) || targetCh <= 0) {
			console.warn('[countdown] No Caspar channel for main', mIdx + 1)
		}
		return {
			channel: Number.isFinite(targetCh) && targetCh > 0 ? targetCh : Number(cm.programChannels?.[0] ?? 1),
			layer: layer.layerNumber || 10,
			templateHostLayer: 0,
		}
	}

	function getCurrentConfig() {
		return {
			mode: modeSelect.value || cfg.mode,
			durationSec: readNum(grp.querySelector('#cd-duration')?.value, cfg.durationSec),
			targetTime: grp.querySelector('#cd-target')?.value ?? cfg.targetTime,
			format: grp.querySelector('#cd-format')?.value ?? cfg.format,
			amberThresholdSec: readNum(grp.querySelector('#cd-amber')?.value, cfg.amberThresholdSec),
			redThresholdSec: readNum(grp.querySelector('#cd-red')?.value, cfg.redThresholdSec),
			position: grp.querySelector('#cd-position')?.value ?? cfg.position,
			hideTimer: !!grp.querySelector('#cd-hide-timer')?.checked,
			timerFontSize: readNum(grp.querySelector('#cd-timer-size')?.value, cfg.timerFontSize),
			auxFontSize: readNum(grp.querySelector('#cd-aux-size')?.value, cfg.auxFontSize),
			timerColor: grp.querySelector('#cd-color-normal')?.value ?? cfg.timerColor,
			amberColor: grp.querySelector('#cd-color-amber')?.value ?? cfg.amberColor,
			redColor: grp.querySelector('#cd-color-red')?.value ?? cfg.redColor,
			auxColor: grp.querySelector('#cd-color-aux')?.value ?? cfg.auxColor,
			auxTop: grp.querySelector('#cd-auxTop')?.value ?? cfg.auxTop,
			auxMiddle: grp.querySelector('#cd-auxMiddle')?.value ?? cfg.auxMiddle,
			auxBottom: grp.querySelector('#cd-auxBottom')?.value ?? cfg.auxBottom,
		}
	}

	/**
	 * Mirrors inspector-lower-third.js's persistLocalConfig: keeps a structured, inspector-
	 * facing `source.countdownConfig` AND a flat `layer.cgData` (the key extractTemplateCgData
	 * actually reads — src/engine/scene-template-cg.js:71 — so scene take's CG ADD/UPDATE carries
	 * the configured countdown, not `{}`).
	 */
	function persistLocalConfig(partial) {
		Object.assign(cfg, partial)
		const scene = sceneState.getScene(sceneId)
		const currentSrc = scene?.layers?.[layerIndex]?.source || src
		const nextConfig = getCurrentConfig()
		sceneState.patchLayer(sceneId, layerIndex, {
			source: { ...currentSrc, countdownConfig: nextConfig },
			cgData: { ...nextConfig },
		})
		document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
	}

	function onFieldChange(partial) {
		persistLocalConfig(partial)
		queueCgUpdate()
	}

	function queueCgUpdate() {
		if (cgUpdateTimer) clearTimeout(cgUpdateTimer)
		cgUpdateTimer = setTimeout(() => {
			cgUpdateTimer = null
			flushCgUpdate()
		}, COUNTDOWN_CG_UPDATE_DEBOUNCE_MS)
	}

	async function flushCgUpdate() {
		if (cgUpdateInFlight) {
			cgUpdateQueued = true
			return
		}
		cgUpdateInFlight = true
		try {
			await api.post('/api/countdown/set', { ...getRouting(), ...getCurrentConfig() })
		} catch (err) {
			console.warn('[countdown] auto-update failed:', err?.message || err)
		} finally {
			cgUpdateInFlight = false
			if (cgUpdateQueued) {
				cgUpdateQueued = false
				await flushCgUpdate()
			}
		}
	}
}

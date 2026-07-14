/**
 * Scene layer — Lower Third template inspector.
 * Edits debounce to a single CG UPDATE; Play animates in (or out if already on air); Delete removes CG.
 */

import { api } from '../lib/api-client.js'
import { sceneState } from '../lib/scene-state.js'
import { resolveLookStackChannelForBus, resolveMainIndexForScene } from '../lib/look-stack-amcp-channel.js'
import {
	isLowerThirdSource,
	deriveTemplateId,
	buildLowerThirdApiPayload,
	buildLowerThirdCasparCgData,
	resolveLayerLowerThirdConfig,
	DEFAULT_LOWER_THIRD_CONFIG,
	LOWER_THIRD_CG_UPDATE_DEBOUNCE_MS,
	LOWER_THIRD_FONT_OPTIONS,
} from '../lib/lower-third-cg-data.js'
import { escapeAttr } from '../lib/dom-escape.js'
import { fetchLowerThirdTemplates } from './inspector-lower-third-templates.js'
import { appendLowerThirdRoster } from './inspector-lower-third-roster.js'
import { attachMathInput } from '../lib/math-input.js'


/**
 * @param {HTMLElement} root
 * @param {object} opts
 */
export function appendLowerThirdGroup(root, { sceneId, layerIndex, layer, stateStore }) {
	const src = layer?.source
	if (!isLowerThirdSource(src)) return

	let cgUpdateTimer = null
	let cgUpdateInFlight = false
	let cgUpdateQueued = false

	const cfg = resolveLayerLowerThirdConfig(layer) || { ...DEFAULT_LOWER_THIRD_CONFIG }

	const grp = document.createElement('div')
	grp.className = 'inspector-group inspector-lower-third-group'
	grp.innerHTML = '<div class="inspector-group__title">Lower Third</div>'

	const tplField = document.createElement('div')
	tplField.className = 'inspector-field inspector-field--muted'
	tplField.innerHTML = `<span class="inspector-field__label" style="cursor:default">Template: <strong id="lt-template-name">…</strong></span>`
	grp.appendChild(tplField)

	const derivedTemplateId = deriveTemplateId(src.value)
	fetchLowerThirdTemplates().then((templates) => {
		const found = templates.find((t) => t.id === derivedTemplateId)
		const nameSpan = tplField.querySelector('#lt-template-name')
		if (nameSpan) nameSpan.textContent = found ? found.name : derivedTemplateId || '(none)'
	})

	const titleField = document.createElement('div')
	titleField.className = 'inspector-field'
	titleField.innerHTML = `
		<label class="inspector-field__label">Title
			<input type="text" class="inspector-field__input" id="lt-title" value="${escapeAttr(cfg.title)}" placeholder="Primary line" style="flex:1;min-width:0;max-width:100%" />
		</label>
	`
	grp.appendChild(titleField)
	titleField.querySelector('#lt-title').addEventListener('input', (e) => onFieldChange({ title: e.target.value }))

	const subField = document.createElement('div')
	subField.className = 'inspector-field'
	subField.innerHTML = `
		<label class="inspector-field__label">Subtitle
			<input type="text" class="inspector-field__input" id="lt-subtitle" value="${escapeAttr(cfg.subtitle)}" placeholder="Secondary line" style="flex:1;min-width:0;max-width:100%" />
		</label>
	`
	grp.appendChild(subField)
	subField.querySelector('#lt-subtitle').addEventListener('input', (e) => onFieldChange({ subtitle: e.target.value }))

	const rosterCtl = appendLowerThirdRoster(grp, {
		sceneId,
		layerIndex,
		src,
		onApplyRow: ({ title, subtitle }) => onFieldChange({ title, subtitle }),
	})

	const fontField = document.createElement('div')
	fontField.className = 'inspector-field'
	const activeFont = String(cfg.fontFamily || 'arial').toLowerCase()
	const fontOpts = LOWER_THIRD_FONT_OPTIONS.map(
		(f) => `<option value="${escapeAttr(f.id)}"${activeFont === f.id ? ' selected' : ''}>${escapeAttr(f.label)}</option>`,
	).join('')
	fontField.innerHTML = `
		<label class="inspector-field__label inspector-lt-label--stacked">Font
			<select class="inspector-field__select inspector-lt-font-select" id="lt-font-family">${fontOpts}</select>
		</label>
	`
	grp.appendChild(fontField)
	fontField.querySelector('#lt-font-family').addEventListener('change', (e) => onFieldChange({ fontFamily: e.target.value }))

	const posField = document.createElement('div')
	posField.className = 'inspector-field'
	const pos = cfg.position || 'left'
	posField.innerHTML = `
		<label class="inspector-field__label inspector-lt-label--stacked">Position
			<select class="inspector-field__select inspector-lt-font-select" id="lt-position">
				<option value="left"${pos === 'left' ? ' selected' : ''}>Left</option>
				<option value="center"${pos === 'center' ? ' selected' : ''}>Center</option>
				<option value="right"${pos === 'right' ? ' selected' : ''}>Right</option>
			</select>
		</label>
	`
	grp.appendChild(posField)
	posField.querySelector('#lt-position').addEventListener('change', (e) => onFieldChange({ position: e.target.value }))

	const metricsRow = document.createElement('div')
	metricsRow.className = 'inspector-lt-metrics'
	metricsRow.innerHTML = `
		<label class="inspector-lt-metric">
			<span class="inspector-lt-metric__label">Title px</span>
			<input type="number" class="inspector-lt-num" id="lt-title-size" min="8" max="200" step="1" value="${escapeAttr(String(cfg.titleFontSize ?? 46))}" />
		</label>
		<label class="inspector-lt-metric">
			<span class="inspector-lt-metric__label">Sub px</span>
			<input type="number" class="inspector-lt-num" id="lt-subtitle-size" min="8" max="120" step="1" value="${escapeAttr(String(cfg.subtitleFontSize ?? 27))}" />
		</label>
		<label class="inspector-lt-metric">
			<span class="inspector-lt-metric__label">Scale %</span>
			<input type="number" class="inspector-lt-num" id="lt-render-scale" min="25" max="300" step="5" value="${escapeAttr(String(cfg.renderScale ?? 100))}" />
		</label>
		<label class="inspector-lt-metric">
			<span class="inspector-lt-metric__label">Hold s</span>
			<input type="number" class="inspector-lt-num" id="lt-display-sec" min="0" step="0.5" value="${escapeAttr(String(cfg.displayDurationSec ?? 10))}" />
		</label>
	`
	grp.appendChild(metricsRow)
	metricsRow.querySelector('#lt-title-size').addEventListener('input', (e) => onFieldChange({ titleFontSize: readNum(e.target.value, cfg.titleFontSize) }))
	metricsRow.querySelector('#lt-subtitle-size').addEventListener('input', (e) => onFieldChange({ subtitleFontSize: readNum(e.target.value, cfg.subtitleFontSize) }))
	metricsRow.querySelector('#lt-render-scale').addEventListener('input', (e) => onFieldChange({ renderScale: readNum(e.target.value, cfg.renderScale) }))
	metricsRow.querySelector('#lt-display-sec').addEventListener('input', (e) => {
		const n = parseFloat(String(e.target.value))
		onFieldChange({ displayDurationSec: Number.isFinite(n) ? Math.max(0, n) : 10 })
	})
	attachMathInput(metricsRow.querySelector('#lt-title-size'), { decimals: 0 })
	attachMathInput(metricsRow.querySelector('#lt-subtitle-size'), { decimals: 0 })
	attachMathInput(metricsRow.querySelector('#lt-render-scale'), { decimals: 0 })
	attachMathInput(metricsRow.querySelector('#lt-display-sec'), { decimals: 1 })

	const colorRow = document.createElement('div')
	colorRow.className = 'inspector-lt-colors'
	colorRow.innerHTML = `
		<label class="inspector-lt-color">
			<span class="inspector-lt-color__label">Text</span>
			<input type="color" class="inspector-field__color" id="lt-text-color" value="${escapeAttr(cfg.textColor || '#ffffff')}" />
		</label>
		<label class="inspector-lt-color">
			<span class="inspector-lt-color__label">Accent</span>
			<input type="color" class="inspector-field__color" id="lt-primary-color" value="${escapeAttr(cfg.primaryColor || '#4fc3f7')}" />
		</label>
	`
	grp.appendChild(colorRow)
	colorRow.querySelector('#lt-text-color').addEventListener('input', (e) => onFieldChange({ textColor: e.target.value }))
	colorRow.querySelector('#lt-primary-color').addEventListener('input', (e) => onFieldChange({ primaryColor: e.target.value }))

	const actRow = document.createElement('div')
	actRow.className = 'inspector-lt-actions'
	actRow.innerHTML = `
		<button type="button" class="inspector-btn inspector-lt-btn inspector-lt-btn--primary" data-lt-action="play" title="Animate in (or out if already on program)">▶ Play</button>
		<button type="button" class="inspector-btn inspector-lt-btn inspector-btn--danger" data-lt-action="delete" title="Remove CG from output">Delete</button>
	`
	grp.appendChild(actRow)

	const playBtn = actRow.querySelector('[data-lt-action="play"]')
	const deleteBtn = actRow.querySelector('[data-lt-action="delete"]')

	playBtn.addEventListener('click', async () => {
		playBtn.disabled = true
		deleteBtn.disabled = true
		try {
			await flushCgUpdate()
			await runPlayAction()
		} catch (err) {
			console.warn('[lower-third] play failed:', err?.message || err)
		} finally {
			playBtn.disabled = false
			deleteBtn.disabled = false
		}
	})

	deleteBtn.addEventListener('click', async () => {
		playBtn.disabled = true
		deleteBtn.disabled = true
		try {
			const routing = getRouting()
			const res = await api.post('/api/lower-thirds/clear', routing)
			if (res?.state) {
				window.dispatchEvent(new CustomEvent('highascg-lower-third-state', { detail: res.state }))
			}
		} catch (err) {
			console.warn('[lower-third] delete failed:', err?.message || err)
		} finally {
			playBtn.disabled = false
			deleteBtn.disabled = false
		}
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

	function getRouting() {
		const cm = stateStore?.getState?.()?.channelMap || {}
		const scene = sceneState.getScene(sceneId)
		const mIdx = resolveMainIndexForScene(scene, sceneState)
		const targetCh =
			resolveLookStackChannelForBus(cm, sceneState, scene, 'edit', mIdx) ??
			Number(cm.programChannels?.[mIdx] ?? cm.playbackChannels?.[mIdx])
		if (!Number.isFinite(targetCh) || targetCh <= 0) {
			console.warn('[lower-third] No Caspar channel for main', mIdx + 1)
		}
		return {
			channel: Number.isFinite(targetCh) && targetCh > 0 ? targetCh : Number(cm.programChannels?.[0] ?? 1),
			layer: layer.layerNumber || 20,
			templateHostLayer: 1,
		}
	}

	function getCurrentConfig() {
		return {
			templateId: derivedTemplateId,
			title: grp.querySelector('#lt-title')?.value ?? cfg.title,
			subtitle: grp.querySelector('#lt-subtitle')?.value ?? cfg.subtitle,
			titleFontSize: readNum(grp.querySelector('#lt-title-size')?.value, cfg.titleFontSize ?? 46),
			subtitleFontSize: readNum(grp.querySelector('#lt-subtitle-size')?.value, cfg.subtitleFontSize ?? 27),
			renderScale: readNum(grp.querySelector('#lt-render-scale')?.value, cfg.renderScale ?? 100),
			fontFamily: grp.querySelector('#lt-font-family')?.value ?? cfg.fontFamily ?? 'arial',
			position: grp.querySelector('#lt-position')?.value ?? cfg.position ?? 'left',
			primaryColor: grp.querySelector('#lt-primary-color')?.value ?? cfg.primaryColor,
			textColor: grp.querySelector('#lt-text-color')?.value ?? cfg.textColor,
			displayDurationSec: readNum(grp.querySelector('#lt-display-sec')?.value, cfg.displayDurationSec ?? 10),
			...getRouting(),
		}
	}

	function persistLocalConfig(partial) {
		Object.assign(cfg, partial)
		const scene = sceneState.getScene(sceneId)
		const currentSrc = scene?.layers?.[layerIndex]?.source || src
		const patch = {
			source: { ...currentSrc, lowerThirdConfig: { ...cfg } },
			cgData: buildLowerThirdCasparCgData(cfg),
		}
		const roster = rosterCtl?.cloneRosterForPersist?.()
		if (roster) patch.source.lowerThirdRoster = roster
		sceneState.patchLayer(sceneId, layerIndex, patch)
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
		}, LOWER_THIRD_CG_UPDATE_DEBOUNCE_MS)
	}

	async function flushCgUpdate() {
		if (cgUpdateInFlight) {
			cgUpdateQueued = true
			return
		}
		cgUpdateInFlight = true
		try {
			const payload = buildLowerThirdApiPayload(getCurrentConfig(), getRouting())
			const res = await api.post('/api/lower-thirds/update', payload)
			if (res?.state) {
				window.dispatchEvent(new CustomEvent('highascg-lower-third-state', { detail: res.state }))
			}
		} catch (err) {
			console.warn('[lower-third] auto-update failed:', err?.message || err)
		} finally {
			cgUpdateInFlight = false
			if (cgUpdateQueued) {
				cgUpdateQueued = false
				await flushCgUpdate()
			}
		}
	}

	async function fetchActiveOnLayer(routing) {
		try {
			const st = await api.get('/api/lower-thirds/active')
			if (!st || st.templateId == null) return null
			const ch = Number(st.channel)
			const ly = Number(st.layer)
			if (ch === routing.channel && ly === routing.layer) return st
			return null
		} catch {
			return null
		}
	}

	async function runPlayAction() {
		const target = getCurrentConfig()
		const routing = getRouting()
		const payload = buildLowerThirdApiPayload(target, routing)
		const active = await fetchActiveOnLayer(routing)

		if (active?.playing) {
			const res = await api.post('/api/lower-thirds/stop', routing)
			if (res?.state) {
				window.dispatchEvent(new CustomEvent('highascg-lower-third-state', { detail: res.state }))
			}
			return
		}

		if (active?.templateId) {
			await api.post('/api/lower-thirds/update', payload)
			const res = await api.post('/api/lower-thirds/play', payload)
			if (res?.state) {
				window.dispatchEvent(new CustomEvent('highascg-lower-third-state', { detail: res.state }))
			}
			return
		}

		await api.post('/api/lower-thirds/load', {
			templateId: target.templateId,
			...payload,
		})
		await api.post('/api/lower-thirds/update', payload)
		const res = await api.post('/api/lower-thirds/play', payload)
		if (res?.state) {
			window.dispatchEvent(new CustomEvent('highascg-lower-third-state', { detail: res.state }))
		}
	}
}

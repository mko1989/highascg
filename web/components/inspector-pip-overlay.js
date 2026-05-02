/**
 * Inspector — PIP overlay section for scene layers.
 * Stacked HTML overlays (border + shadow, etc.) — Caspar CG on the PIP layer when z allows (see resolvePipOverlayCasparLayer).
 *
 * @see 25_WO_PIP_OVERLAY_EFFECTS.md T5
 * @see pip-overlay-registry.js
 */

import { createDragInput } from './inspector-common.js'
import { api } from '../lib/api-client.js'
import {
	PIP_OVERLAYS,
	PIP_OVERLAY_MAP,
	PIP_OVERLAY_MAX_STACK,
	createPipOverlayInstance,
} from '../lib/pip-overlay-registry.js'

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const _pipLiveTimers = new Map()
/** @type {Map<string, { struct: string, len: number }>} */
const _pipLiveShape = new Map()

const PIP_LIVE_DEBOUNCE_MS = 200

/**
 * @param {Array<{ layerNumber?: number }> | undefined} layers
 * @param {number} contentLayer
 */
function nextPipContentLayerInScene(layers, contentLayer) {
	const pl = Number(contentLayer)
	if (!Number.isFinite(pl)) return 10000
	const m = (layers || [])
		.map((l) => Number(l.layerNumber))
		.filter((n) => Number.isFinite(n) && n > pl)
	if (m.length === 0) return 10000
	return Math.min(...m)
}

/**
 * When the edited look is **on program**, push PIP overlay param / stack changes to Caspar (CG UPDATE or re-apply).
 * @param {{ sceneState: import('../lib/scene-state.js').SceneState, stateStore: object, sceneId: string, layerIndex: number }} ctx
 * @param {{ type: string, params: object }[]} pipOverlays
 */
export function scheduleLivePipOverlayPush(ctx, pipOverlays) {
	if (!ctx?.sceneState || !ctx?.stateStore || ctx.sceneId == null || ctx.layerIndex == null) return
	if (ctx.sceneState.liveSceneId !== ctx.sceneId) return

	const key = `${ctx.sceneId}:${ctx.layerIndex}`
	const prevT = _pipLiveTimers.get(key)
	if (prevT) clearTimeout(prevT)
	_pipLiveTimers.set(
		key,
		setTimeout(() => {
			_pipLiveTimers.delete(key)
			void pushLivePipOverlaysToProgram(ctx, pipOverlays)
		}, PIP_LIVE_DEBOUNCE_MS),
	)
}

/**
 * @param {{ sceneState: object, stateStore: object, sceneId: string, layerIndex: number }} ctx
 * @param {{ type: string, params: object }[]} pipOverlays
 */
async function pushLivePipOverlaysToProgram(ctx, pipOverlays) {
	const { sceneState, stateStore, sceneId, layerIndex } = ctx
	if (sceneState.liveSceneId !== sceneId) return

	const scene = sceneState.getScene(sceneId)
	const layer = scene?.layers?.[layerIndex]
	if (!layer) return

	const screenIdx = sceneState.activeScreenIndex ?? 0
	const cm = stateStore.getState()?.channelMap || {}
	const programChannels = cm.programChannels || [1]
	const programCh =
		programChannels[Math.min(screenIdx, Math.max(0, programChannels.length - 1))] ?? 1
	const contentLayer = layer.layerNumber ?? 10
	const fill = layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }
	const nextContentLayer = nextPipContentLayerInScene(scene?.layers, contentLayer)

	const list = Array.isArray(pipOverlays) ? pipOverlays.filter((o) => o && o.type) : []
	const key = `${sceneId}:${layerIndex}`
	const struct = list.map((o) => o.type).join('|')
	const prevShape = _pipLiveShape.get(key)
	const sameShape = prevShape && prevShape.struct === struct && prevShape.len === list.length

	try {
		if (list.length === 0) {
			if (prevShape && prevShape.len > 0) {
				await api.post('/api/pip-overlay/remove', { channel: programCh, layer: contentLayer, nextContentLayer })
			}
			_pipLiveShape.set(key, { struct: '', len: 0 })
			return
		}

		if (sameShape) {
			for (let i = 0; i < list.length; i++) {
				await api.post('/api/pip-overlay/update', {
					channel: programCh,
					layer: contentLayer,
					stackIndex: i,
					overlay: list[i],
					fill,
					nextContentLayer,
				})
			}
		} else {
			await api.post('/api/pip-overlay/remove', { channel: programCh, layer: contentLayer, nextContentLayer })
			for (let i = 0; i < list.length; i++) {
				await api.post('/api/pip-overlay/apply', {
					channel: programCh,
					layer: contentLayer,
					stackIndex: i,
					overlay: list[i],
					fill,
					nextContentLayer,
				})
			}
		}
		_pipLiveShape.set(key, { struct, len: list.length })
	} catch (e) {
		console.warn('[pip-overlay] live program sync:', e?.message || e)
	}
}

/**
 * Render a single parameter editor (mirrors inspector-effects.js renderParamEditor but adds color type).
 */
function renderParamEditor(container, schema, currentValue, onChange) {
	if (schema.type === 'color') {
		const wrap = document.createElement('div')
		wrap.className = 'inspector-field inspector-row'
		const lab = document.createElement('label')
		lab.className = 'inspector-field__label'
		lab.textContent = schema.label
		const inp = document.createElement('input')
		inp.type = 'color'
		inp.className = 'inspector-field__color'
		inp.value = currentValue || schema.default || '#ffffff'
		function clearColorSuppress() {
			window.__hacgSuppressSceneLayerInspectorRefresh = false
		}
		inp.addEventListener('input', () => {
			window.__hacgSuppressSceneLayerInspectorRefresh = true
			onChange(inp.value)
		})
		inp.addEventListener('change', clearColorSuppress)
		inp.addEventListener('blur', () => {
			setTimeout(clearColorSuppress, 350)
		})
		lab.appendChild(inp)
		wrap.appendChild(lab)
		container.appendChild(wrap)
		return
	}

	if (schema.type === 'select') {
		const wrap = document.createElement('div')
		wrap.className = 'inspector-field'
		const lab = document.createElement('label')
		lab.className = 'inspector-field__label'
		lab.textContent = schema.label
		const sel = document.createElement('select')
		sel.className = 'inspector-field__select'
		for (const opt of schema.options) {
			const o = document.createElement('option')
			o.value = opt
			o.textContent = opt
			if (String(opt) === String(currentValue)) o.selected = true
			sel.appendChild(o)
		}
		sel.addEventListener('change', () => onChange(sel.value))
		lab.appendChild(sel)
		wrap.appendChild(lab)
		container.appendChild(wrap)
		return
	}

	if (schema.type === 'bool') {
		const wrap = document.createElement('div')
		wrap.className = 'inspector-field inspector-row'
		const cb = document.createElement('input')
		cb.type = 'checkbox'
		const uid = `inspector-pip-${schema.key}-${Math.random().toString(36).slice(2, 8)}`
		cb.id = uid
		cb.checked = !!currentValue
		const lab = document.createElement('label')
		lab.htmlFor = uid
		lab.textContent = schema.label
		cb.addEventListener('change', () => onChange(cb.checked))
		wrap.appendChild(cb)
		wrap.appendChild(lab)
		container.appendChild(wrap)
		return
	}

	const v = currentValue != null ? Number(currentValue) : (schema.default ?? 0)
	const di = createDragInput({
		label: schema.label,
		value: v,
		min: schema.min ?? -Infinity,
		max: schema.max ?? Infinity,
		step: schema.step ?? 0.01,
		decimals: schema.decimals ?? 2,
		onChange: (val) => onChange(val),
	})
	container.appendChild(di.wrap)
}

/**
 * One stacked overlay card (type + params + remove + reorder).
 * @param {HTMLElement} container
 * @param {{ type: string, params: object }} overlay
 * @param {number} index
 * @param {number} total
 * @param {(overlay: { type: string, params: object }) => void} onChangeOverlay
 * @param {() => void} onRemove
 * @param {() => void} onMoveUp
 * @param {() => void} onMoveDown
 */
function renderPipOverlayCard(
	container,
	overlay,
	index,
	total,
	onChangeOverlay,
	onRemove,
	onMoveUp,
	onMoveDown,
) {
	const def = PIP_OVERLAY_MAP.get(overlay.type)
	if (!def) return

	const card = document.createElement('div')
	card.className = 'inspector-effect-card'

	const header = document.createElement('div')
	header.className = 'inspector-effect-card__header'

	const title = document.createElement('span')
	title.className = 'inspector-effect-card__title'
	title.textContent = `${def.icon} ${def.label}`
	header.appendChild(title)

	const reorder = document.createElement('div')
	reorder.style.display = 'flex'
	reorder.style.alignItems = 'center'
	reorder.style.gap = '2px'

	const upBtn = document.createElement('button')
	upBtn.type = 'button'
	upBtn.className = 'inspector-effect-card__remove'
	upBtn.textContent = '↑'
	upBtn.title = 'Move earlier (drawn behind overlays below)'
	upBtn.disabled = index <= 0
	upBtn.addEventListener('click', (e) => {
		e.stopPropagation()
		onMoveUp()
	})
	const downBtn = document.createElement('button')
	downBtn.type = 'button'
	downBtn.className = 'inspector-effect-card__remove'
	downBtn.textContent = '↓'
	downBtn.title = 'Move later (drawn on top)'
	downBtn.disabled = index >= total - 1
	downBtn.addEventListener('click', (e) => {
		e.stopPropagation()
		onMoveDown()
	})
	reorder.appendChild(upBtn)
	reorder.appendChild(downBtn)

	const removeBtn = document.createElement('button')
	removeBtn.type = 'button'
	removeBtn.className = 'inspector-effect-card__remove'
	removeBtn.textContent = '✕'
	removeBtn.title = `Remove ${def.label}`
	removeBtn.addEventListener('click', (e) => {
		e.stopPropagation()
		onRemove()
	})

	header.appendChild(reorder)
	header.appendChild(removeBtn)
	card.appendChild(header)

	const typeRow = document.createElement('div')
	typeRow.className = 'inspector-field'
	typeRow.style.marginBottom = '4px'
	const typeLab = document.createElement('label')
	typeLab.className = 'inspector-field__label'
	typeLab.textContent = 'Type'
	const typeSel = document.createElement('select')
	typeSel.className = 'inspector-field__select'
	for (const od of PIP_OVERLAYS) {
		const o = document.createElement('option')
		o.value = od.type
		o.textContent = od.label
		if (od.type === overlay.type) o.selected = true
		typeSel.appendChild(o)
	}
	typeSel.addEventListener('change', () => {
		const v = typeSel.value
		const next =
			v === overlay.type
				? overlay
				: createPipOverlayInstance(v)
		if (next) onChangeOverlay(next)
	})
	typeLab.appendChild(typeSel)
	typeRow.appendChild(typeLab)
	card.appendChild(typeRow)

	const paramsBlock = document.createElement('div')
	paramsBlock.className = 'inspector-effect-card__params'
	for (const schema of def.schema) {
		const curVal = overlay.params?.[schema.key] ?? schema.default
		renderParamEditor(paramsBlock, schema, curVal, (newVal) => {
			onChangeOverlay({
				type: overlay.type,
				params: { ...overlay.params, [schema.key]: newVal },
			})
		})
	}
	card.appendChild(paramsBlock)
	container.appendChild(card)
}

/**
 * Render the PIP Overlay inspector group.
 * @param {HTMLElement} root
 * @param {object} opts
 * @param {{ type: string, params: object }[]} opts.pipOverlays
 * @param {(pipOverlays: { type: string, params: object }[]) => void} opts.onUpdate
 * @param {{ sceneState: object, stateStore: object, sceneId: string, layerIndex: number }} [opts.livePushContext]
 */
export function renderPipOverlayGroup(root, { pipOverlays, onUpdate, livePushContext }) {
	const grp = document.createElement('div')
	grp.className = 'inspector-group inspector-pip-overlay-group'
	grp.innerHTML = '<div class="inspector-group__title">PIP Overlays</div>'

	const list = Array.isArray(pipOverlays) ? pipOverlays : []

	for (let i = 0; i < list.length; i++) {
		const ov = list[i]
		renderPipOverlayCard(
			grp,
			ov,
			i,
			list.length,
			(next) => {
				const updated = [...list]
				updated[i] = next
				onUpdate(updated)
				if (livePushContext) scheduleLivePipOverlayPush(livePushContext, updated)
			},
			() => {
				const updated = list.filter((_, idx) => idx !== i)
				onUpdate(updated)
				if (livePushContext) scheduleLivePipOverlayPush(livePushContext, updated)
			},
			() => {
				if (i <= 0) return
				const updated = [...list]
				;[updated[i - 1], updated[i]] = [updated[i], updated[i - 1]]
				onUpdate(updated)
				if (livePushContext) scheduleLivePipOverlayPush(livePushContext, updated)
			},
			() => {
				if (i >= list.length - 1) return
				const updated = [...list]
				;[updated[i], updated[i + 1]] = [updated[i + 1], updated[i]]
				onUpdate(updated)
				if (livePushContext) scheduleLivePipOverlayPush(livePushContext, updated)
			},
		)
	}

	const addRow = document.createElement('div')
	addRow.className = 'inspector-field'
	addRow.style.display = 'flex'
	addRow.style.flexWrap = 'wrap'
	addRow.style.alignItems = 'center'
	addRow.style.gap = '8px'
	addRow.style.marginTop = '6px'

	const addLab = document.createElement('label')
	addLab.className = 'inspector-field__label'
	addLab.textContent = 'Add overlay'
	const addSel = document.createElement('select')
	addSel.className = 'inspector-field__select'
	addSel.setAttribute('aria-label', 'Add PIP overlay')
	const placeholder = document.createElement('option')
	placeholder.value = ''
	placeholder.textContent = 'Choose type…'
	addSel.appendChild(placeholder)
	for (const def of PIP_OVERLAYS) {
		const o = document.createElement('option')
		o.value = def.type
		o.textContent = `${def.icon} ${def.label}`
		addSel.appendChild(o)
	}
	addSel.disabled = list.length >= PIP_OVERLAY_MAX_STACK
	addSel.title =
		list.length >= PIP_OVERLAY_MAX_STACK ? `At most ${PIP_OVERLAY_MAX_STACK} overlays per layer` : ''
	addLab.appendChild(addSel)
	addRow.appendChild(addLab)

	addSel.addEventListener('change', () => {
		const v = addSel.value
		addSel.value = ''
		if (!v) return
		if (list.length >= PIP_OVERLAY_MAX_STACK) return
		const inst = createPipOverlayInstance(v)
		if (inst) {
			const updated = [...list, inst]
			onUpdate(updated)
			if (livePushContext) scheduleLivePipOverlayPush(livePushContext, updated)
		}
	})

	grp.appendChild(addRow)

	if (list.length === 0) {
		const hint = document.createElement('p')
		hint.className = 'inspector-field inspector-field--hint'
		hint.style.fontSize = '0.75rem'
		hint.style.color = 'var(--text-muted, #8b949e)'
		hint.textContent =
			'Add one or more overlays (border, drop shadow, glow, edge strip). First in the list is drawn behind; last is on top — e.g. shadow first, then border.'
		grp.appendChild(hint)
	}

	root.appendChild(grp)
}

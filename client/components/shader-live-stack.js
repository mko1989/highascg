/**
 * shader-live-stack.js — Shader Live PGM layer stack (owner 2026-07-27): the empty space right
 * of the parameters shows the active main's look-band layers 10–20. While the selected instance
 * is on PRV, clicking layer 10 EXCHANGES it with what's on PGM (MIX), clicking 11–20 lands the
 * shader on that layer — stacking shaders. Minimal: one thin column, number + occupant name.
 */

import { api } from '../lib/api-client.js'
import { escapeHtml } from '../lib/dom-escape.js'
import { sceneState } from '../lib/scene-state.js'

const LAYERS = Array.from({ length: 11 }, (_, i) => 10 + i)

function occupantLabel(layer) {
	const v = String(layer?.source?.value || '')
	if (!v) return ''
	const base = v.replace(/\\/g, '/').split('/').pop() || v
	return base.replace(/\.[a-z0-9]+$/i, '')
}

/**
 * @param {{ stateStore: object, getSelected: () => object | null }} deps
 * @returns {{ mount: (el: HTMLElement) => void, render: () => void }}
 */
export function createShaderLiveStack(deps) {
	const { stateStore, getSelected } = deps
	let host = null

	function pgmScene() {
		const st = stateStore.getState() || {}
		const cm = st.channelMap || {}
		const mIdx = Math.max(0, Number(sceneState.activeScreenIndex) || 0)
		const ch = cm.programChannels?.[mIdx]
		const live = st.scene?.live || {}
		return { mIdx, ch, scene: ch != null ? live[String(ch)]?.scene || live[ch]?.scene : null }
	}

	async function land(layerNumber) {
		const inst = getSelected()
		if (!inst) return
		if (!inst.isPrv) {
			window.showToast?.('Select the PRV instance of the shader first (or audition one from Templates)', 'info')
			return
		}
		const { mIdx } = pgmScene()
		const t = sceneState.getResolvedGlobalDefaultTransition?.() || { type: 'MIX', duration: 12 }
		try {
			const r = await api.post('/api/shader-stack', {
				mainIndex: mIdx,
				layerNumber,
				value: inst.cgName,
				transition: { type: t.type || 'MIX', duration: t.duration ?? 12 },
			})
			if (r?.error || r?.ok === false) throw new Error(r?.error || 'failed')
			window.showToast?.(`${inst.shaderId} → PGM L${layerNumber}`, 'success')
		} catch (e) {
			window.showToast?.(`Stack failed: ${e?.message || e}`, 'error')
		}
	}

	function render() {
		if (!host) return
		const { ch, scene } = pgmScene()
		const byNum = new Map((scene?.layers || []).map((l) => [Number(l.layerNumber), l]))
		const rows = LAYERS.map((n) => {
			const occ = occupantLabel(byNum.get(n))
			const cls = `shader-live__stack-row${occ ? ' shader-live__stack-row--live' : ''}`
			const title = occ
				? `Exchange PGM L${n} (${occ}) with the PRV shader — deck transition`
				: `Land the PRV shader on PGM L${n} — fades in`
			return `<button type="button" class="${cls}" data-stack="${n}" title="${escapeHtml(title)}"><span class="shader-live__stack-n">${n}</span><span class="shader-live__stack-name">${escapeHtml(occ || '—')}</span></button>`
		}).join('')
		const html =
			`<div class="shader-live__group-title">PGM stack${ch != null ? ` ch${ch}` : ''}</div>` + rows
		if (host.dataset.stackHtml !== html) {
			host.dataset.stackHtml = html
			host.innerHTML = html
		}
	}

	function mount(el) {
		host = el
		host.addEventListener('click', (e) => {
			const btn = e.target instanceof HTMLElement ? e.target.closest('[data-stack]') : null
			if (btn) void land(Number(btn.dataset.stack))
		})
		render()
	}

	return { mount, render }
}

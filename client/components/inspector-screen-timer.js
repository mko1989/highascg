/**
 * Screen-timer Inspector view — replaces the WO-226 timer-inspector MODAL (user 2026-07-17:
 * "the countdown options shouldn't be in a new modal but in inspector, with size, position,
 * opacity and other layer specific settings"). Selected via the per-screen ⏱ icon in the looks
 * deck (scene-list-column.js → 'screen-timer-select' → inspector-panel.js).
 *
 * Multi-timer aware: a screen can hold up to 10 timers (AMCP layer band 980-989,
 * src/engine/screen-timers.js) — every timer assigned to the selected screen gets its own
 * section, and "+ Add timer" assigns another.
 */

import { api } from '../lib/api-client.js'
import { escapeHtml } from '../lib/dom-escape.js'
import { buildTimerSettings } from './timer-control-panel-settings-form.js'
import { computeDisplayTime, formatDisplayTime } from './timer-control-panel-display.js'
import { createTimerForScreen, dispatchTimersChanged } from '../lib/screen-timer-create.js'
import { uiIcon } from './ui-icons.js'

const FADE_FRAMES = 25

/**
 * @param {HTMLElement} root - inspector panel root (content is replaced)
 * @param {{ screenIdx: number, screenLabel?: string }} sel
 */
export function renderScreenTimerInspector(root, sel) {
	const { screenIdx, screenLabel } = sel || {}
	if (!Number.isFinite(screenIdx)) return

	root.innerHTML = `
		<div class="inspector-screen-timer">
			<h3 class="inspector-screen-timer__title">Timers — ${escapeHtml(screenLabel || `Screen ${screenIdx + 1}`)}</h3>
			<div class="inspector-screen-timer__list"><p class="inspector-screen-timer__loading">Loading…</p></div>
			<button type="button" class="timer-control-panel__btn inspector-screen-timer__add">＋ Add timer</button>
		</div>
	`
	const container = root.querySelector('.inspector-screen-timer')
	const listEl = container.querySelector('.inspector-screen-timer__list')

	let records = []

	// Live countdown readout — client-side math off the fetched records, self-cleans when this
	// view is replaced (inspector renderers swap root.innerHTML; `container.isConnected` flips).
	const ticker = setInterval(() => {
		if (!container.isConnected) {
			clearInterval(ticker)
			return
		}
		for (const timer of records) {
			const el = listEl.querySelector(`[data-timer-time="${timer.timerId}"]`)
			if (!el) continue
			const remaining = computeDisplayTime(timer)
			el.textContent = formatDisplayTime(remaining)
			const cfg = timer.config || {}
			const red = Number(cfg.redThresholdSec) || 0
			const amber = Number(cfg.amberThresholdSec) || 0
			el.classList.toggle('inspector-screen-timer__time--red', remaining <= red)
			el.classList.toggle('inspector-screen-timer__time--amber', remaining > red && remaining <= amber)
		}
	}, 250)

	async function reload() {
		let timers = []
		try {
			const res = await api.get('/api/timers/list')
			if (res?.ok && Array.isArray(res.timers)) timers = res.timers
		} catch (err) {
			listEl.innerHTML = `<p>Failed to load timers: ${escapeHtml(err?.message || String(err))}</p>`
			return
		}
		records = timers.filter((t) => t?.screens?.[String(screenIdx)])
		listEl.innerHTML = ''
		if (records.length === 0) {
			listEl.innerHTML = '<p class="inspector-screen-timer__empty">No timer on this screen yet.</p>'
			return
		}
		for (const timer of records) buildTimerSection(timer)
	}

	function buildTimerSection(timer) {
		const entry = timer.screens[String(screenIdx)]
		const section = document.createElement('div')
		section.className = 'inspector-screen-timer__section'

		// Header: name + live readout
		const head = document.createElement('div')
		head.className = 'inspector-screen-timer__head'
		const nameEl = document.createElement('span')
		nameEl.className = 'inspector-screen-timer__name'
		nameEl.textContent = timer.name || `Timer ${String(timer.timerId).slice(0, 8)}`
		const timeEl = document.createElement('span')
		timeEl.className = 'inspector-screen-timer__time'
		timeEl.dataset.timerTime = timer.timerId
		timeEl.textContent = formatDisplayTime(computeDisplayTime(timer))
		head.append(nameEl, timeEl)
		section.appendChild(head)

		// Transport row: start/pause/reset + show/hide + fades
		const transport = document.createElement('div')
		transport.className = 'inspector-screen-timer__transport'
		for (const [cmd, icon, title] of [
			['start', 'play', 'Start'],
			['pause', 'pause', 'Pause'],
			['reset', 'reset', 'Reset'],
		]) {
			const btn = document.createElement('button')
			btn.type = 'button'
			btn.className = 'timer-control-panel__btn'
			btn.innerHTML = uiIcon(icon)
			btn.title = title
			btn.addEventListener('click', async () => {
				try {
					await api.post('/api/timers/cmd', { timerId: timer.timerId, cmd })
					dispatchTimersChanged()
				} catch (err) {
					console.warn(`[inspector-screen-timer] ${cmd} failed:`, err?.message || err)
				}
			})
			transport.appendChild(btn)
		}
		const visBtn = document.createElement('button')
		visBtn.type = 'button'
		visBtn.className = 'timer-control-panel__btn'
		visBtn.textContent = entry.visible ? 'Hide' : 'Show'
		visBtn.title = entry.visible ? 'Hide timer (cut)' : 'Show timer (cut)'
		visBtn.addEventListener('click', () => void postVisible(!entry.visible, 0))
		transport.appendChild(visBtn)
		for (const [label, visible] of [
			['Fade In', true],
			['Fade Out', false],
		]) {
			const btn = document.createElement('button')
			btn.type = 'button'
			btn.className = 'timer-control-panel__btn'
			btn.textContent = label
			btn.addEventListener('click', () => void postVisible(visible, FADE_FRAMES))
			transport.appendChild(btn)
		}
		section.appendChild(transport)

		async function postVisible(visible, fadeFrames, opacity) {
			try {
				const body = { timerId: timer.timerId, screenIdx, visible }
				if (fadeFrames) body.fadeFrames = fadeFrames
				if (Number.isFinite(opacity)) body.opacity = opacity
				await api.post('/api/timers/visible', body)
				dispatchTimersChanged()
			} catch (err) {
				console.warn('[inspector-screen-timer] visible/opacity failed:', err?.message || err)
			}
		}

		// Layer opacity slider (MIXER OPACITY while visible, persisted per screen entry)
		const opacityRow = document.createElement('div')
		opacityRow.className = 'inspector-screen-timer__opacity'
		const opacityLabel = document.createElement('span')
		opacityLabel.className = 'timer-control-panel__settings-label'
		opacityLabel.textContent = 'Opacity'
		const opacitySlider = document.createElement('input')
		opacitySlider.type = 'range'
		opacitySlider.min = '0'
		opacitySlider.max = '100'
		opacitySlider.step = '1'
		opacitySlider.value = String(Math.round((Number.isFinite(entry.opacity) ? entry.opacity : 1) * 100))
		const opacityVal = document.createElement('span')
		opacityVal.className = 'inspector-screen-timer__opacity-val'
		opacityVal.textContent = `${opacitySlider.value}%`
		opacitySlider.addEventListener('input', () => {
			opacityVal.textContent = `${opacitySlider.value}%`
		})
		opacitySlider.addEventListener('change', () => {
			void postVisible(entry.visible, 0, parseInt(opacitySlider.value, 10) / 100)
		})
		opacityRow.append(opacityLabel, opacitySlider, opacityVal)
		section.appendChild(opacityRow)

		// Full settings form (duration / mode / target time / size / position) — shared with the
		// corner panel. Its Cancel handler hides settingsWrap (containerEl.parentElement), which
		// is scoped to this section only.
		const settingsWrap = document.createElement('div')
		settingsWrap.className = 'inspector-screen-timer__settings-wrap'
		const settingsEl = document.createElement('div')
		settingsEl.className = 'inspector-screen-timer__settings'
		settingsWrap.appendChild(settingsEl)
		buildTimerSettings(settingsEl, timer, {
			refreshTimerList: () => {
				dispatchTimersChanged()
				void reload()
			},
		})
		section.appendChild(settingsWrap)

		// Remove from screen
		const removeBtn = document.createElement('button')
		removeBtn.type = 'button'
		removeBtn.className = 'timer-control-panel__btn inspector-screen-timer__remove'
		removeBtn.textContent = 'Remove from screen'
		removeBtn.title = 'Remove this timer from the screen (CG CLEAR on its layer)'
		removeBtn.addEventListener('click', async () => {
			if (!confirm('Remove this timer from the screen?')) return
			removeBtn.disabled = true
			try {
				await api.post('/api/timers/unassign', { timerId: timer.timerId, screenIdx })
				dispatchTimersChanged()
				void reload()
			} catch (err) {
				console.warn('[inspector-screen-timer] unassign failed:', err?.message || err)
				removeBtn.disabled = false
			}
		})
		section.appendChild(removeBtn)

		listEl.appendChild(section)
	}

	container.querySelector('.inspector-screen-timer__add').addEventListener('click', async (e) => {
		const btn = e.currentTarget
		btn.disabled = true
		try {
			const n = records.length + 1
			await createTimerForScreen({
				name: `Timer ${screenLabel || `Screen ${screenIdx + 1}`}${n > 1 ? ` #${n}` : ''}`,
				screenIdx,
			})
			void reload()
		} catch (err) {
			console.warn('[inspector-screen-timer] add failed:', err?.message || err)
		} finally {
			btn.disabled = false
		}
	})

	// External changes (compact menu, drop-assign, other clients) re-render this view — but not
	// while the operator is typing in a settings field.
	const onChanged = () => {
		if (!container.isConnected) {
			window.removeEventListener('screen-timers-changed', onChanged)
			return
		}
		if (root.querySelector('input:focus, select:focus, textarea:focus')) return
		void reload()
	}
	window.addEventListener('screen-timers-changed', onChanged)

	void reload()
}

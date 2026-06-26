/**
 * Audio Mixer "+" modal — the only UI for adding/configuring ALSA live inputs.
 * Capture runs on dedicated Caspar input channels; PGM uses route:// from those channels.
 */
import { api } from '../lib/api-client.js'
import { settingsState } from '../lib/settings-state.js'
import { refreshLiveAudioConfigured } from '../lib/live-audio-state.js'
import { markCasparRestartDirty } from '../lib/caspar-restart-hint.js'
import {
	alsaCaptureDeviceOptions,
	buildLiveAudioConfigBody,
	LIVE_AUDIO_MAX_SLOTS,
	readLiveAudioCasparSettings,
} from '../lib/live-audio-inputs.js'
import {
	clearMultiPlayTargets,
	clearPlayTarget,
	getMultiPlayTargets,
	setMultiPlayTargets,
	setPlayTarget,
} from '../lib/live-audio-play-targets.js'
import { liveAudioInputForSlot } from '../lib/input-channels.js'
import {
	applyLiveAudioCapture,
	applyPgmRoutesForSlot,
	clearRouteFromChannel,
	dedicatedInputRoute,
	pgmDestLayerForSlot,
} from '../lib/live-audio-routing.js'

function esc(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

/**
 * @param {import('../lib/state-store.js').StateStore} stateStore
 */
export async function showLiveAudioMixerModal(stateStore) {
	if (document.getElementById('live-audio-mixer-modal')) return

	const modal = document.createElement('div')
	modal.id = 'live-audio-mixer-modal'
	modal.className = 'modal-overlay'
	modal.innerHTML = `
		<div class="modal-content live-audio-modal">
			<div class="modal-header">
				<h2>Live Audio Inputs</h2>
				<button type="button" class="modal-close" id="live-audio-mixer-close" aria-label="Close">×</button>
			</div>
			<div class="modal-body live-audio-modal__body" id="live-audio-mixer-container">
				<p class="settings-note">Loading…</p>
			</div>
		</div>
	`
	document.body.appendChild(modal)

	const container = modal.querySelector('#live-audio-mixer-container')
	const close = () => modal.remove()
	modal.querySelector('#live-audio-mixer-close').onclick = close
	modal.addEventListener('click', (e) => {
		if (e.target === modal) close()
	})
	const onKey = (e) => {
		if (e.key === 'Escape') {
			close()
			document.removeEventListener('keydown', onKey)
		}
	}
	document.addEventListener('keydown', onKey)

	try {
		await mountLiveAudioMixerPanel(container, stateStore)
	} catch (e) {
		container.innerHTML = `<p class="status-error">Error: ${esc(e?.message || e)}</p>`
	}
}

/**
 * @param {HTMLElement} container
 * @param {import('../lib/state-store.js').StateStore} stateStore
 */
async function mountLiveAudioMixerPanel(container, stateStore) {
	let captureDevices = []

	function programChannels() {
		const cm = stateStore.getState()?.channelMap || {}
		return Array.isArray(cm.programChannels) && cm.programChannels.length ? cm.programChannels : [1]
	}

	async function loadDevices(refresh = false) {
		const q = refresh ? '?refresh=1' : ''
		const hw = await api.get(`/api/audio/devices${q}`)
		captureDevices = Array.isArray(hw?.devices) ? hw.devices : []
	}

	function readUiFromDom() {
		const cs = settingsState.getSettings()?.casparServer || {}
		const base = readLiveAudioCasparSettings(cs)
		const countEl = container.querySelector('#live-audio-mixer-count')
		const count = countEl ? parseInt(String(countEl.value || '0'), 10) || 0 : base.count
		const slots = []
		const labels = []
		const routeTargets = []
		const cm = stateStore.getState()?.channelMap || {}
		const destLayerFor = (slot) => pgmDestLayerForSlot(slot, base)

		for (let i = 1; i <= LIVE_AUDIO_MAX_SLOTS; i++) {
			const sel = container.querySelector(`#live-audio-mixer-slot-${i}-device`)
			slots.push(sel ? String(sel.value || '').trim() : base.slots[i - 1] || '')
			const labelEl = container.querySelector(`#live-audio-mixer-slot-${i}-label`)
			labels.push(labelEl ? String(labelEl.value || '').trim() : '')

			const destLayer = destLayerFor(i)
			const targets = []
			for (const pgmCh of programChannels()) {
				const ch = Number(pgmCh)
				if (!Number.isFinite(ch) || ch < 1) continue
				const btn = container.querySelector(`#live-audio-mixer-slot-${i}-route-${ch}`)
				if (btn?.classList.contains('audio-mixer__live-route-btn--active')) {
					targets.push({ channel: ch, layer: destLayer })
				}
			}
			routeTargets.push(targets.length ? targets : getMultiPlayTargets(i))
		}

		return {
			...base,
			count: Math.max(0, Math.min(LIVE_AUDIO_MAX_SLOTS, count)),
			slots,
			labels,
			routeTargets,
			hostChannelEnabled: false,
		}
	}

	function renderSlotRows(ui) {
		const wrap = container.querySelector('#live-audio-mixer-slots')
		if (!wrap) return
		const opts = alsaCaptureDeviceOptions(captureDevices)
		const cm = stateStore.getState()?.channelMap || {}
		const pgmChs = programChannels()
		let html = ''
		for (let i = 1; i <= LIVE_AUDIO_MAX_SLOTS; i++) {
			const show = i <= ui.count
			const cur = ui.slots[i - 1] || ''
			const label = ui.labels?.[i - 1] || ''
			const entry = liveAudioInputForSlot(cm, i)
			const route = entry?.route
			const dedicatedHint = route
				? `Dedicated input: ch ${entry.channel} · capture on <code>${esc(route)}</code>`
				: '<span class="status-warn">No dedicated channel yet — save, then Apply + restart Caspar in Device View.</span>'
			const destLayer = pgmDestLayerForSlot(i, ui)
			const enabledTargets = ui.routeTargets?.[i - 1] || getMultiPlayTargets(i)
			const enabledChannels = new Set(enabledTargets.map((t) => Number(t.channel)))

			let optHtml = opts
				.map((o) => `<option value="${esc(o.value)}"${o.value === cur ? ' selected' : ''}>${esc(o.label)}</option>`)
				.join('')
			if (cur && !opts.some((o) => o.value === cur)) {
				optHtml += `<option value="${esc(cur)}" selected>${esc(cur)} (saved)</option>`
			}

			const routeBtns = pgmChs
				.map((pc) => {
					const ch = Number(pc)
					if (!Number.isFinite(ch) || ch < 1) return ''
					const active = enabledChannels.has(ch)
					return `<button type="button" class="audio-mixer__live-route-btn${active ? ' audio-mixer__live-route-btn--active' : ''}" id="live-audio-mixer-slot-${i}-route-${ch}" data-slot="${i}" data-ch="${ch}" ${!cur ? 'disabled' : ''}>PGM ch ${ch}</button>`
				})
				.join('')

			html += `
				<div class="settings-group live-audio-slot-row" data-slot="${i}" style="display:${show ? 'block' : 'none'};margin-bottom:0.85rem;padding-bottom:0.85rem;border-bottom:1px solid rgba(255,255,255,0.06)">
					<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem">
						<strong>Input ${i}</strong>
						<button type="button" class="btn btn--secondary live-audio-mixer-remove" data-slot-index="${i - 1}" style="padding:4px 10px;font-size:0.75rem">Remove</button>
					</div>
					<label>Label</label>
					<input type="text" id="live-audio-mixer-slot-${i}-label" value="${esc(label)}" placeholder="Live audio ${i}" style="width:100%;margin-bottom:0.5rem" />
					<label>Capture device</label>
					<select id="live-audio-mixer-slot-${i}-device" style="width:100%;margin-bottom:0.5rem">${optHtml}</select>
					<p class="settings-note small" style="margin:0 0 0.5rem">${dedicatedHint}</p>
					<label>Route to program</label>
					<div class="audio-mixer__live-route-buttons" style="display:flex;flex-wrap:wrap;gap:0.35rem;margin-bottom:0.25rem">${routeBtns}</div>
					<p class="settings-note small" style="margin:0">PGM layers: <code>*-${destLayer}</code> (audio-only route from dedicated input).</p>
				</div>
			`
		}
		wrap.innerHTML = html

		wrap.querySelectorAll('.audio-mixer__live-route-btn').forEach((btn) => {
			btn.addEventListener('click', () => {
				btn.classList.toggle('audio-mixer__live-route-btn--active')
			})
		})
	}

	function renderPanel() {
		const cs = settingsState.getSettings()?.casparServer || {}
		const ui = readLiveAudioCasparSettings(cs)
		const labels = []
		const routeTargets = []
		for (let i = 1; i <= LIVE_AUDIO_MAX_SLOTS; i++) {
			routeTargets.push(getMultiPlayTargets(i))
			labels.push('')
		}
		container.innerHTML = `
			<p class="settings-note" style="margin-bottom:0.75rem">
				Add ALSA/USB capture here. Each input gets a <strong>dedicated Caspar channel</strong> after Device View Apply + restart.
				Audio reaches program outputs via <code>route://</code> — never direct <code>alsa://</code> on PGM channels.
			</p>
			<input type="hidden" id="live-audio-mixer-count" value="${ui.count}" />
			<div id="live-audio-mixer-slots"></div>
			<div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin:0.75rem 0">
				<button type="button" class="btn btn--secondary" id="live-audio-mixer-add"${ui.count >= LIVE_AUDIO_MAX_SLOTS ? ' disabled' : ''}>+ Add Live Audio Input</button>
				<button type="button" class="btn btn--secondary" id="live-audio-mixer-refresh-devices">Refresh devices</button>
			</div>
			<div style="display:flex;flex-wrap:wrap;gap:0.5rem">
				<button type="button" class="btn btn--primary" id="live-audio-mixer-save">Save &amp; Apply</button>
			</div>
			<p class="settings-note" id="live-audio-mixer-status" style="margin-top:0.5rem"></p>
		`
		renderSlotRows({ ...ui, labels, routeTargets })
		bindPanel(ui)
	}

	function bindPanel(initialUi) {
		const statusLine = container.querySelector('#live-audio-mixer-status')
		const setStatus = (msg, ok = true) => {
			if (statusLine) {
				statusLine.textContent = msg || ''
				statusLine.className = ok ? 'settings-note status-ok' : 'settings-note status-error'
			}
		}

		container.querySelector('#live-audio-mixer-add')?.addEventListener('click', () => {
			const currentUi = readUiFromDom()
			if (currentUi.count >= LIVE_AUDIO_MAX_SLOTS) return
			currentUi.count += 1
			const countEl = container.querySelector('#live-audio-mixer-count')
			if (countEl) countEl.value = String(currentUi.count)
			renderSlotRows(currentUi)
			const addBtn = container.querySelector('#live-audio-mixer-add')
			if (addBtn) addBtn.disabled = currentUi.count >= LIVE_AUDIO_MAX_SLOTS
		})

		container.querySelector('#live-audio-mixer-slots')?.addEventListener('click', async (e) => {
			const btn = e.target.closest('.live-audio-mixer-remove')
			if (!btn) return
			const idx = parseInt(String(btn.dataset.slotIndex || ''), 10)
			if (!Number.isFinite(idx) || idx < 0) return
			const currentUi = readUiFromDom()
			const slotNum = idx + 1
			const prevTargets = getMultiPlayTargets(slotNum)
			for (const t of prevTargets) {
				await clearRouteFromChannel(t.channel, t.layer).catch(() => {})
			}
			clearMultiPlayTargets(slotNum)
			clearPlayTarget(slotNum)

			const newSlots = []
			const newLabels = []
			const newRouteTargets = []
			for (let i = 0; i < currentUi.count; i++) {
				if (i === idx) continue
				newSlots.push(currentUi.slots[i] || '')
				newLabels.push(currentUi.labels[i] || '')
				newRouteTargets.push(currentUi.routeTargets[i] || [])
			}
			for (let i = 1; i <= LIVE_AUDIO_MAX_SLOTS; i++) clearPlayTarget(i)
			for (let i = 0; i < newSlots.length; i++) {
				setMultiPlayTargets(i + 1, newRouteTargets[i] || [])
			}

			const nextUi = {
				...currentUi,
				count: newSlots.length,
				slots: Array.from({ length: LIVE_AUDIO_MAX_SLOTS }, (_, i) => newSlots[i] || ''),
				labels: newLabels,
				routeTargets: newRouteTargets,
			}
			const countEl = container.querySelector('#live-audio-mixer-count')
			if (countEl) countEl.value = String(nextUi.count)
			renderSlotRows(nextUi)
			const addBtn = container.querySelector('#live-audio-mixer-add')
			if (addBtn) addBtn.disabled = nextUi.count >= LIVE_AUDIO_MAX_SLOTS
			setStatus('Removed. Click Save & Apply to persist.', true)
		})

		container.querySelector('#live-audio-mixer-refresh-devices')?.addEventListener('click', async () => {
			setStatus('Refreshing devices…', true)
			try {
				await loadDevices(true)
				renderSlotRows(readUiFromDom())
				setStatus('Device list updated.', true)
			} catch (err) {
				setStatus(err?.message || String(err), false)
			}
		})

		container.querySelector('#live-audio-mixer-save')?.addEventListener('click', async () => {
			const ui = readUiFromDom()
			const cm = stateStore.getState()?.channelMap || {}
			const prevCount = readLiveAudioCasparSettings(settingsState.getSettings()?.casparServer || {}).count
			setStatus('Saving…', true)
			try {
				for (let i = 1; i <= ui.count; i++) {
					setMultiPlayTargets(i, ui.routeTargets[i - 1] || [])
					const entry = liveAudioInputForSlot(cm, i)
					setPlayTarget(i, {
						channel: entry?.channel ?? 0,
						layer: entry?.layer ?? pgmDestLayerForSlot(i, ui),
						label: ui.labels[i - 1] || undefined,
					})
				}
				for (let i = ui.count + 1; i <= LIVE_AUDIO_MAX_SLOTS; i++) {
					clearMultiPlayTargets(i)
					clearPlayTarget(i)
				}

				await api.post('/api/audio/live-inputs/config', buildLiveAudioConfigBody(ui))
				await settingsState.load()
				if (ui.count !== prevCount) markCasparRestartDirty()

				const errors = []
				const hasDedicated =
					ui.count > 0 &&
					Array.from({ length: ui.count }, (_, i) => dedicatedInputRoute(cm, i + 1)).some(Boolean)
				if (hasDedicated) {
					try {
						await applyLiveAudioCapture()
					} catch (err) {
						errors.push(`Apply capture: ${err?.message || err}`)
					}
					for (let i = 1; i <= ui.count; i++) {
						const device = ui.slots[i - 1]
						const targets = ui.routeTargets[i - 1] || []
						if (!device || targets.length === 0) continue
						try {
							await applyPgmRoutesForSlot(i, cm, ui, targets)
						} catch (err) {
							errors.push(`Slot ${i} routes: ${err?.message || err}`)
						}
					}
				} else if (ui.count > 0) {
					setStatus(
						'Saved. Apply Device View config and restart Caspar to allocate dedicated channels, then open this dialog again and Save & Apply.',
						true,
					)
					await refreshLiveAudioConfigured(stateStore)
					document.dispatchEvent(new CustomEvent('highascg-settings-applied'))
					return
				}

				await refreshLiveAudioConfigured(stateStore)
				document.dispatchEvent(new CustomEvent('highascg-settings-applied'))
				renderPanel()
				if (errors.length) {
					setStatus(`Saved with issues: ${errors.join('; ')}`, false)
				} else if (ui.count === 0) {
					setStatus('Saved (no live inputs).', true)
				} else {
					setStatus('Saved. Capture on dedicated channel(s); PGM routing via route://.', true)
				}
			} catch (err) {
				setStatus(err?.message || String(err), false)
			}
		})

		if (initialUi.count === 0) {
			setStatus('No live inputs configured. Click + Add to create one.', true)
		}
	}

	await Promise.all([loadDevices(false), settingsState.load()])
	renderPanel()
}

/**
 * ALSA hardware mixer — alsamixer-style sliders in Settings (Linux / ALSA cards).
 */
import { api } from '../lib/api-client.js'
import {
	alsaControlMatchesView,
	alsaControlPercent,
	debounceAlsaSet,
	fetchAlsaMixer,
	normalizeAlsaMixerPayload,
	setAlsaMixerControl,
} from '../lib/alsa-mixer-api.js'

function esc(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

/**
 * @param {HTMLElement} container
 * @param {{ getLaunchPassword?: () => string }} [opts]
 */
export async function mountAlsaMixerPanel(container, opts = {}) {
	container.innerHTML = `
		<h4 class="settings-category" style="margin-top:1rem">ALSA mixer</h4>
		<p class="settings-note small">Hardware mixer for the sound card (like <code>alsamixer</code> in the terminal). Adjust capture gain before live inputs reach Caspar.</p>
		<div class="alsa-mixer-panel__toolbar">
			<label class="alsa-mixer-panel__field">
				<span>Card</span>
				<select id="alsa-mixer-card" class="alsa-mixer-panel__select"></select>
			</label>
			<label class="alsa-mixer-panel__field">
				<span>View</span>
				<select id="alsa-mixer-view" class="alsa-mixer-panel__select">
					<option value="playback">Playback</option>
					<option value="capture">Capture</option>
					<option value="all">All</option>
				</select>
			</label>
			<button type="button" class="btn btn--secondary" id="alsa-mixer-refresh">Refresh</button>
			<button type="button" class="btn btn--secondary" id="alsa-mixer-launch" title="Open alsamixer on the server display (:0)">Launch alsamixer</button>
		</div>
		<p class="settings-note" id="alsa-mixer-status" style="margin:0.5rem 0"></p>
		<div id="alsa-mixer-controls" class="alsa-mixer-panel__controls"></div>
	`

	const cardSel = container.querySelector('#alsa-mixer-card')
	const viewSel = container.querySelector('#alsa-mixer-view')
	const statusEl = container.querySelector('#alsa-mixer-status')
	const controlsEl = container.querySelector('#alsa-mixer-controls')

	let currentCard = 0
	let lastPayload = null

	const setStatus = (msg, ok = true) => {
		if (!statusEl) return
		statusEl.textContent = msg || ''
		statusEl.className = ok ? 'settings-note status-ok' : 'settings-note status-error'
	}

	function populateCardSelect(cards, selected) {
		if (!cardSel) return
		const list =
			cards.length > 0
				? cards
				: [{ card: selected, name: `Card ${selected}` }]
		cardSel.innerHTML = list
			.map((c) => `<option value="${c.card}"${Number(c.card) === Number(selected) ? ' selected' : ''}>${esc(c.name)} (${c.card})</option>`)
			.join('')
	}

	function renderControls() {
		if (!controlsEl) return
		const view = String(viewSel?.value || 'playback')
		const { controls } = normalizeAlsaMixerPayload(lastPayload)
		const visible = controls.filter((c) => alsaControlMatchesView(c, view))
		if (!visible.length) {
			controlsEl.innerHTML = `<p class="settings-note">No ${esc(view)} controls on this card.</p>`
			return
		}

		let html = ''
		for (const ctrl of visible) {
			const name = String(ctrl.name || ctrl.id || 'Control')
			const ty = String(ctrl.type || 'volume').toLowerCase()
			const muted = !!(ctrl.muted ?? ctrl.mute)
			const dB = ctrl.dB != null ? `${Number(ctrl.dB).toFixed(1)} dB` : ''
			const channels = Array.isArray(ctrl.channels) ? ctrl.channels.join(', ') : ''

			if (ty === 'enum' || ty === 'enumerated') {
				const items = Array.isArray(ctrl.items) ? ctrl.items : []
				const cur = String(ctrl.item ?? ctrl.value ?? '')
				html += `
					<div class="alsa-mixer-panel__row" data-name="${esc(name)}">
						<div class="alsa-mixer-panel__label" title="${esc(channels)}">${esc(name)}</div>
						<select class="alsa-mixer-panel__enum" data-name="${esc(name)}">
							${items
								.map((it) => {
									const v = String(typeof it === 'object' ? it.value ?? it.name : it)
									const label = String(typeof it === 'object' ? it.label ?? it.name ?? v : it)
									return `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`
								})
								.join('')}
						</select>
					</div>`
				continue
			}

			if (ty === 'boolean' || ty === 'switch') {
				const on = !!(ctrl.value ?? ctrl.on)
				html += `
					<div class="alsa-mixer-panel__row" data-name="${esc(name)}">
						<div class="alsa-mixer-panel__label">${esc(name)}</div>
						<label class="alsa-mixer-panel__bool">
							<input type="checkbox" class="alsa-mixer-panel__switch" data-name="${esc(name)}" ${on ? 'checked' : ''} />
							<span>${on ? 'On' : 'Off'}</span>
						</label>
					</div>`
				continue
			}

			const pct = alsaControlPercent(ctrl)
			html += `
				<div class="alsa-mixer-panel__row alsa-mixer-panel__row--volume" data-name="${esc(name)}">
					<div class="alsa-mixer-panel__label" title="${esc(channels)}">${esc(name)}</div>
					<button type="button" class="alsa-mixer-panel__mute${muted ? ' alsa-mixer-panel__mute--active' : ''}" data-name="${esc(name)}" title="Mute">${muted ? 'M' : '—'}</button>
					<input type="range" class="alsa-mixer-panel__slider" min="0" max="100" value="${pct}" data-name="${esc(name)}" aria-label="${esc(name)} volume" />
					<span class="alsa-mixer-panel__val">${pct}%${dB ? ` · ${esc(dB)}` : ''}</span>
				</div>`
		}
		controlsEl.innerHTML = html
		bindControlHandlers()
	}

	function bindControlHandlers() {
		controlsEl.querySelectorAll('.alsa-mixer-panel__slider').forEach((slider) => {
			const name = slider.dataset.name || ''
			const valEl = slider.closest('.alsa-mixer-panel__row')?.querySelector('.alsa-mixer-panel__val')
			const post = debounceAlsaSet(async () => {
				try {
					await setAlsaMixerControl({ card: currentCard, name, percent: parseInt(String(slider.value), 10) || 0 })
				} catch (e) {
					setStatus(e?.message || String(e), false)
				}
			})
			slider.addEventListener('input', () => {
				if (valEl) valEl.textContent = `${slider.value}%`
				post()
			})
			slider.addEventListener('change', async () => {
				try {
					await setAlsaMixerControl({ card: currentCard, name, percent: parseInt(String(slider.value), 10) || 0 })
				} catch (e) {
					setStatus(e?.message || String(e), false)
				}
			})
		})

		controlsEl.querySelectorAll('.alsa-mixer-panel__mute').forEach((btn) => {
			btn.addEventListener('click', async () => {
				const name = btn.dataset.name || ''
				const next = !btn.classList.contains('alsa-mixer-panel__mute--active')
				btn.classList.toggle('alsa-mixer-panel__mute--active', next)
				btn.textContent = next ? 'M' : '—'
				try {
					await setAlsaMixerControl({ card: currentCard, name, mute: next })
				} catch (e) {
					setStatus(e?.message || String(e), false)
					btn.classList.toggle('alsa-mixer-panel__mute--active', !next)
					btn.textContent = next ? '—' : 'M'
				}
			})
		})

		controlsEl.querySelectorAll('.alsa-mixer-panel__enum').forEach((sel) => {
			sel.addEventListener('change', async () => {
				const name = sel.dataset.name || ''
				try {
					await setAlsaMixerControl({ card: currentCard, name, item: sel.value })
				} catch (e) {
					setStatus(e?.message || String(e), false)
				}
			})
		})

		controlsEl.querySelectorAll('.alsa-mixer-panel__switch').forEach((chk) => {
			chk.addEventListener('change', async () => {
				const name = chk.dataset.name || ''
				const label = chk.closest('label')?.querySelector('span')
				if (label) label.textContent = chk.checked ? 'On' : 'Off'
				try {
					await setAlsaMixerControl({ card: currentCard, name, value: chk.checked ? 1 : 0 })
				} catch (e) {
					setStatus(e?.message || String(e), false)
					chk.checked = !chk.checked
					if (label) label.textContent = chk.checked ? 'On' : 'Off'
				}
			})
		})
	}

	async function load(refresh = false) {
		setStatus(refresh ? 'Refreshing…' : 'Loading…', true)
		try {
			const raw = await fetchAlsaMixer(currentCard, { refresh })
			lastPayload = raw
			const norm = normalizeAlsaMixerPayload(raw)
			currentCard = norm.card
			populateCardSelect(norm.cards, currentCard)
			renderControls()
			setStatus(`${norm.controls.length} control(s) on card ${currentCard}.`, true)
		} catch (e) {
			const msg = e?.message || String(e)
			lastPayload = null
			if (controlsEl) {
				controlsEl.innerHTML = `
					<p class="settings-note status-warn">
						Could not load ALSA mixer (${esc(msg)}).
						If the playout server is older, use <strong>Launch alsamixer</strong> or run <code>alsamixer</code> on the host.
					</p>`
			}
			setStatus(msg, false)
		}
	}

	cardSel?.addEventListener('change', () => {
		currentCard = parseInt(String(cardSel.value || '0'), 10) || 0
		void load(false)
	})
	viewSel?.addEventListener('change', () => renderControls())
	container.querySelector('#alsa-mixer-refresh')?.addEventListener('click', () => void load(true))
	container.querySelector('#alsa-mixer-launch')?.addEventListener('click', async () => {
		setStatus('Launching alsamixer…', true)
		try {
			const password = opts.getLaunchPassword?.() || ''
			const res = await api.post('/api/system/gui-launch', {
				action: 'alsamixer',
				...(password ? { password } : {}),
			})
			setStatus(res?.exe ? `Started: ${res.exe}` : 'alsamixer started on :0.', true)
		} catch (e) {
			setStatus(e?.message || String(e), false)
		}
	})

	await load(false)

	return async function refresh() {
		await load(true)
	}
}

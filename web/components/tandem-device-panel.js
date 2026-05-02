/**
 * Caspar + PixelHue device / routing view (symbiosis topology).
 * One **destination** row = one PixelHue **layer** for the full Caspar bus (PGM/PRV), not one PH layer per stacked clip.
 */
import { api } from '../lib/api-client.js'
import { settingsState } from '../lib/settings-state.js'

/**
 * @param {HTMLElement} root
 */
export async function mountTandemDevicePanel(root) {
	root.innerHTML = `
		<h3 class="settings-category">Caspar + PixelHue topology</h3>
		<p class="settings-note" style="margin-top:0">
			Map <strong>which physical switcher input</strong> carries <strong>which Caspar output</strong> (cabling), then assign
			<strong>which PixelHue layer</strong> shows that feed on an LED surface. Stacked clips in Caspar still use <strong>one</strong>
			PH layer for that bus. Add separate signal paths for cameras; layer them above the Caspar background in PixelFlow.
		</p>
		<div class="settings-group" style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center">
			<button type="button" class="btn btn--secondary" id="tandem-refresh">Refresh live devices</button>
			<span class="settings-note" id="tandem-status" style="margin:0"></span>
		</div>
		<div id="tandem-live-caspar" class="tandem-live-block"></div>
		<div id="tandem-live-ph" class="tandem-live-block"></div>
		<h4 class="settings-category" style="margin-top:1rem">EDID / handshaking</h4>
		<p class="settings-note">PixelFlow EDID tools are on the device; note labels here for crew.</p>
		<textarea id="tandem-edid-notes" rows="3" style="width:100%;max-width:40rem;font-size:12px" placeholder="e.g. LED1 ↔ Input 3 matched 3840×2160@50"></textarea>
		<h4 class="settings-category" style="margin-top:1rem">Signal paths (cabling)</h4>
		<p class="settings-note">Set <code>phInterfaceId</code> from the live interface list after refresh (or from the device UI).</p>
		<div id="tandem-paths"></div>
		<button type="button" class="btn btn--secondary" id="tandem-add-path">Add path</button>
		<h4 class="settings-category" style="margin-top:1rem">Destinations (logical LED / surface)</h4>
		<p class="settings-note">Each row: one PH layer for the Caspar mix for that main. <code>signalPathId</code> links to a row above.</p>
		<div id="tandem-dest"></div>
		<button type="button" class="btn btn--secondary" id="tandem-add-dest">Add destination</button>
		<div class="settings-group" style="margin-top:1rem">
			<button type="button" class="btn btn--primary" id="tandem-save">Save topology</button>
		</div>
		<h4 class="settings-category" style="margin-top:1rem">Test bind</h4>
		<p class="settings-note">Send <code>PUT /unico/v1/layers/source</code> for one layer (uses signal path to resolve interface types).</p>
		<div class="settings-group" style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center">
			<label>PH layer # <input type="number" id="tandem-test-layer" min="1" value="1" style="width:5rem" /></label>
			<label>Path id <input type="text" id="tandem-test-path" placeholder="caspar_pgm1_in" style="width:12rem" /></label>
			<button type="button" class="btn btn--secondary" id="tandem-test-bind">Bind now</button>
		</div>
		<pre id="tandem-raw" class="tandem-raw" style="display:none;font-size:11px;max-height:180px;overflow:auto;margin-top:8px"></pre>
	`

	/** @type {any} */
	let lastLive = null
	/** @type {any} */
	let editTopo = { version: 1, edidNotes: '', destinations: [], signalPaths: [] }

	function esc(s) {
		return String(s ?? '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
	}

	function renderLive() {
		const st = root.querySelector('#tandem-status')
		const cEl = root.querySelector('#tandem-live-caspar')
		const pEl = root.querySelector('#tandem-live-ph')
		if (!lastLive) {
			if (st) st.textContent = ''
			return
		}
		const cas = lastLive.caspar
		if (cEl) {
			const cm = cas?.channelMap || {}
			const ch = (cm.programChannels || []).map((c, i) => `M${i + 1} PGM: ch ${c}`).join(' · ')
			cEl.innerHTML = `<h4 class="settings-note" style="margin:0.5rem 0 0.25rem">Caspar</h4>
				<p class="settings-note" style="margin:0">${
					cas?.connected ? 'Connected' : 'Not connected'
				} — ${esc(cas?.host)}:${esc(cas?.port)}</p>
				<p class="settings-note" style="margin:0.25rem 0 0"><code>${esc(ch) || '—'}</code></p>`
		}
		const ph = lastLive.pixelhue
		if (pEl) {
			if (ph && ph.available) {
				const il = ph.interfaces?.data?.list || ph.interfaces?.list || []
				const n = Array.isArray(il) ? il.length : 0
				pEl.innerHTML = `<h4 class="settings-note" style="margin:0.5rem 0 0.25rem">PixelHue (live)</h4>
					<p class="settings-note" style="margin:0">API port ${esc(ph.apiPort)} · SN <code>${esc(ph.sn)}</code> — ${n} interface(s)</p>
					<ul class="tandem-if-list" style="margin:0.35rem 0 0 1rem;font-size:12px;max-height:120px;overflow:auto">
					${(il || [])
						.slice(0, 32)
						.map(
							(x) =>
								`<li><code>iface ${esc(x.interfaceId)}</code> — ${esc(x.general?.name || '')} (type ${esc(
									x?.auxiliaryInfo?.connectorInfo?.interfaceType
								)})</li>`
						)
						.join('')}
					</ul>`
			} else {
				pEl.innerHTML = `<h4 class="settings-note" style="margin:0.5rem 0 0.25rem">PixelHue</h4>
					<p class="settings-note" style="margin:0">Unavailable: ${esc(ph?.error || 'off')}</p>`
			}
		}
		if (st) st.textContent = 'Live data loaded.'
	}

	function rowPaths() {
		const wrap = root.querySelector('#tandem-paths')
		if (!wrap) return
		wrap.innerHTML = (editTopo.signalPaths || [])
			.map(
				(p, idx) => `
			<div class="tandem-row" data-path-idx="${idx}" style="display:grid;grid-template-columns:minmax(4rem,0.8fr) 1fr 4.5rem 6.5rem 2.5rem 1fr;gap:6px;margin:8px 0;align-items:center;font-size:12px">
				<input type="text" class="t-path-id" placeholder="id" value="${esc(p.id)}" />
				<input type="text" class="t-path-label" placeholder="label" value="${esc(p.label)}" />
				<input type="number" class="t-path-iface" placeholder="iface" value="${p.phInterfaceId != null ? esc(p.phInterfaceId) : ''}" title="phInterfaceId" />
				<select class="t-path-kind">
					<option value="caspar_in" ${p.kind === 'caspar_in' || !p.kind ? 'selected' : ''}>caspar_in</option>
					<option value="caspar_out" ${p.kind === 'caspar_out' ? 'selected' : ''}>caspar_out</option>
					<option value="camera_in" ${p.kind === 'camera_in' ? 'selected' : ''}>camera_in</option>
				</select>
				<input type="number" class="t-path-midx" min="0" max="3" value="${p.caspar?.mainIndex ?? 0}" title="main index" />
				<input type="text" class="t-path-edid" placeholder="EDID note" value="${esc(p.edidLabel)}" />
			</div>
		`
			)
			.join('')
		for (const b of wrap.querySelectorAll('.t-path-id, .t-path-label, .t-path-iface, .t-path-kind, .t-path-midx, .t-path-edid')) {
			b.addEventListener('change', () => syncPathsFromDom())
		}
	}

	function rowDest() {
		const wrap = root.querySelector('#tandem-dest')
		if (!wrap) return
		wrap.innerHTML = (editTopo.destinations || [])
			.map(
				(d, idx) => `
			<div class="tandem-row" data-dest-idx="${idx}" style="display:grid;grid-template-columns:1fr 1fr 3rem 5rem 1fr;gap:6px;margin:6px 0;align-items:center">
				<input type="text" class="t-dest-id" placeholder="id" value="${esc(d.id)}" />
				<input type="text" class="t-dest-label" placeholder="label" value="${esc(d.label)}" />
				<input type="number" class="t-dest-midx" min="0" max="3" value="${d.mainScreenIndex ?? 0}" title="main" />
				<input type="number" class="t-dest-layer" placeholder="PH layer" value="${d.pixelhue?.layerId != null ? esc(d.pixelhue.layerId) : ''}" />
				<input type="text" class="t-dest-sp" placeholder="signalPathId" value="${esc(d.signalPathId)}" />
			</div>
		`
			)
			.join('')
		for (const b of wrap.querySelectorAll(
			'.t-dest-id, .t-dest-label, .t-dest-midx, .t-dest-layer, .t-dest-sp'
		)) {
			b.addEventListener('change', () => syncDestFromDom())
		}
	}

	function syncPathsFromDom() {
		const rows = root.querySelectorAll('#tandem-paths [data-path-idx]')
		/** @type {any[]} */
		const out = []
		for (const r of rows) {
			out.push({
				id: r.querySelector('.t-path-id')?.value?.trim() || 'path',
				label: r.querySelector('.t-path-label')?.value?.trim() || '',
				kind: r.querySelector('.t-path-kind')?.value || 'caspar_in',
				phInterfaceId: (() => {
					const v = r.querySelector('.t-path-iface')?.value
					const n = parseInt(String(v), 10)
					return Number.isFinite(n) ? n : null
				})(),
				caspar: {
					bus: 'pgm',
					mainIndex: Math.min(
						3,
						Math.max(0, parseInt(String(r.querySelector('.t-path-midx')?.value || '0'), 10) || 0)
					),
				},
				edidLabel: r.querySelector('.t-path-edid')?.value?.trim() || '',
				notes: '',
			})
		}
		editTopo.signalPaths = out
	}

	function syncDestFromDom() {
		const rows = root.querySelectorAll('#tandem-dest [data-dest-idx]')
		/** @type {any[]} */
		const out = []
		for (const r of rows) {
			const lid = r.querySelector('.t-dest-layer')?.value
			const li = parseInt(String(lid), 10)
			out.push({
				id: r.querySelector('.t-dest-id')?.value?.trim() || 'dest',
				label: r.querySelector('.t-dest-label')?.value?.trim() || '',
				mainScreenIndex: Math.min(3, Math.max(0, parseInt(String(r.querySelector('.t-dest-midx')?.value || '0'), 10) || 0)),
				caspar: { bus: 'pgm' },
				pixelhue: {
					layerId: Number.isFinite(li) ? li : null,
					screenGuid: '',
					role: 'caspar_pgm',
				},
				signalPathId: r.querySelector('.t-dest-sp')?.value?.trim() || '',
				edidLabel: '',
			})
		}
		editTopo.destinations = out
	}

	function gatherTopoFromUi() {
		syncPathsFromDom()
		syncDestFromDom()
		const ta = root.querySelector('#tandem-edid-notes')
		editTopo.edidNotes = ta ? String(ta.value) : ''
		return editTopo
	}

	async function refresh() {
		const st = root.querySelector('#tandem-status')
		if (st) st.textContent = 'Loading…'
		try {
			lastLive = await api.get('/api/tandem-device')
			editTopo = JSON.parse(
				JSON.stringify(lastLive.topology || { version: 1, edidNotes: '', destinations: [], signalPaths: [] })
			)
			const ta = root.querySelector('#tandem-edid-notes')
			if (ta) ta.value = editTopo.edidNotes || ''
			renderLive()
			rowPaths()
			rowDest()
			const raw = root.querySelector('#tandem-raw')
			if (raw) {
				raw.style.display = 'block'
				raw.textContent = JSON.stringify(lastLive, null, 0).slice(0, 4000)
			}
		} catch (e) {
			if (st) st.textContent = e?.message || 'Failed'
		}
	}

	root.querySelector('#tandem-refresh')?.addEventListener('click', () => void refresh())
	root.querySelector('#tandem-add-path')?.addEventListener('click', () => {
		gatherTopoFromUi()
		editTopo.signalPaths.push({
			id: `path_${Date.now()}`,
			label: 'New path',
			kind: 'caspar_in',
			phInterfaceId: null,
			caspar: { bus: 'pgm', mainIndex: 0 },
			edidLabel: '',
			notes: '',
		})
		rowPaths()
	})
	root.querySelector('#tandem-add-dest')?.addEventListener('click', () => {
		gatherTopoFromUi()
		editTopo.destinations.push({
			id: `led_${Date.now()}`,
			label: 'New surface',
			mainScreenIndex: 0,
			caspar: { bus: 'pgm' },
			pixelhue: { layerId: null, screenGuid: '', role: 'caspar_pgm' },
			signalPathId: (editTopo.signalPaths && editTopo.signalPaths[0] && editTopo.signalPaths[0].id) || '',
			edidLabel: '',
		})
		rowDest()
	})
	root.querySelector('#tandem-save')?.addEventListener('click', async () => {
		const top = gatherTopoFromUi()
		const st = root.querySelector('#tandem-status')
		try {
			await api.post('/api/tandem-device', { tandemTopology: top })
			if (st) st.textContent = 'Topology saved.'
			try {
				await settingsState.load()
			} catch {
				/* ignore */
			}
		} catch (e) {
			if (st) st.textContent = e?.message || 'Save failed'
		}
	})
	root.querySelector('#tandem-test-bind')?.addEventListener('click', async () => {
		const layerId = parseInt(String(root.querySelector('#tandem-test-layer')?.value || '0'), 10)
		const signalPathId = String(root.querySelector('#tandem-test-path')?.value || '').trim()
		if (!Number.isFinite(layerId) || layerId < 1) {
			alert('Set layer #')
			return
		}
		try {
			const r = await api.post('/api/tandem-device/bind-input', { layerId, signalPathId, mainIndex: 0, bus: 'pgm' })
			alert(r?.ok ? 'Bind sent — check device' : (r && r.data) || 'See console')
		} catch (e) {
			alert(e?.message || 'Bind failed')
		}
	})

	await refresh()
}

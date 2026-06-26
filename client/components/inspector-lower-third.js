/**
 * Scene layer — Lower Third template inspector.
 * Edits debounce to a single CG UPDATE; Play animates in (or out if already on air); Delete removes CG.
 */

import { api } from '../lib/api-client.js'
import { sceneState } from '../lib/scene-state.js'
import { resolveLookStackChannelForBus } from '../lib/look-stack-amcp-channel.js'
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
import {
	buildRosterFromParsed,
	filterRosterRows,
	guessRosterMapping,
	mapRowToLowerThirdConfig,
	normalizeLowerThirdRoster,
	parseSpreadsheetFile,
} from '../lib/lower-third-roster-import.js'

/** @type {{ id: string, name: string, htmlPath: string, available: boolean }[] | null} */
let _cachedTemplates = null
let _cacheExpiry = 0

async function fetchTemplates() {
	if (_cachedTemplates && Date.now() < _cacheExpiry) return _cachedTemplates
	try {
		const res = await api.get('/api/lower-thirds/templates')
		_cachedTemplates = res?.templates || []
		_cacheExpiry = Date.now() + 30_000
	} catch (e) {
		console.warn('[lower-third] Failed to fetch templates:', e?.message || e)
		_cachedTemplates = _cachedTemplates || []
	}
	return _cachedTemplates
}

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
	fetchTemplates().then((templates) => {
		const found = templates.find((t) => t.id === derivedTemplateId)
		const nameSpan = tplField.querySelector('#lt-template-name')
		if (nameSpan) nameSpan.textContent = found ? found.name : derivedTemplateId || '(none)'
	})

	const titleField = document.createElement('div')
	titleField.className = 'inspector-field'
	titleField.innerHTML = `
		<label class="inspector-field__label">Title
			<input type="text" class="inspector-field__input" id="lt-title" value="${escAttr(cfg.title)}" placeholder="Primary line" style="flex:1;min-width:0;max-width:100%" />
		</label>
	`
	grp.appendChild(titleField)
	titleField.querySelector('#lt-title').addEventListener('input', (e) => onFieldChange({ title: e.target.value }))

	const subField = document.createElement('div')
	subField.className = 'inspector-field'
	subField.innerHTML = `
		<label class="inspector-field__label">Subtitle
			<input type="text" class="inspector-field__input" id="lt-subtitle" value="${escAttr(cfg.subtitle)}" placeholder="Secondary line" style="flex:1;min-width:0;max-width:100%" />
		</label>
	`
	grp.appendChild(subField)
	subField.querySelector('#lt-subtitle').addEventListener('input', (e) => onFieldChange({ subtitle: e.target.value }))

	let roster = normalizeLowerThirdRoster(src.lowerThirdRoster)
	let rosterFilter = ''
	let rosterSelectedIndex = -1

	const rosterDetails = document.createElement('details')
	rosterDetails.className = 'inspector-lt-roster'
	rosterDetails.open = !!roster
	rosterDetails.innerHTML = '<summary class="inspector-lt-roster__summary">Data sheet</summary>'
	const rosterBody = document.createElement('div')
	rosterBody.className = 'inspector-lt-roster__body'
	rosterDetails.appendChild(rosterBody)

	const rosterToolbar = document.createElement('div')
	rosterToolbar.className = 'inspector-lt-roster__toolbar'
	const importLabel = document.createElement('label')
	importLabel.className = 'inspector-btn inspector-lt-btn inspector-lt-roster__import'
	importLabel.textContent = 'Import Excel / CSV'
	const importInput = document.createElement('input')
	importInput.type = 'file'
	importInput.accept = '.xlsx,.xls,.csv,.txt'
	importInput.className = 'inspector-lt-roster__file'
	importLabel.appendChild(importInput)
	const rosterMeta = document.createElement('span')
	rosterMeta.className = 'inspector-lt-roster__meta'
	rosterToolbar.append(importLabel, rosterMeta)
	rosterBody.appendChild(rosterToolbar)

	const mappingRow = document.createElement('div')
	mappingRow.className = 'inspector-lt-roster__mapping'
	rosterBody.appendChild(mappingRow)

	const filterField = document.createElement('div')
	filterField.className = 'inspector-field'
	filterField.innerHTML = `
		<label class="inspector-field__label">Search
			<input type="search" class="inspector-field__input inspector-lt-roster__filter" placeholder="Filter rows…" />
		</label>
	`
	rosterBody.appendChild(filterField)
	const filterInput = filterField.querySelector('.inspector-lt-roster__filter')

	const tableWrap = document.createElement('div')
	tableWrap.className = 'inspector-lt-roster__table-wrap'
	rosterBody.appendChild(tableWrap)

	grp.appendChild(rosterDetails)

	importInput.addEventListener('change', async () => {
		const file = importInput.files?.[0]
		importInput.value = ''
		if (!file) return
		importLabel.classList.add('inspector-lt-roster__import--busy')
		try {
			const { headers, rows } = await parseSpreadsheetFile(file)
			if (!headers.length || !rows.length) {
				rosterMeta.textContent = 'No data rows found'
				return
			}
			roster = buildRosterFromParsed(file.name, headers, rows)
			rosterFilter = ''
			rosterSelectedIndex = -1
			if (filterInput) filterInput.value = ''
			persistRoster()
			rosterDetails.open = true
			renderRosterUi()
		} catch (err) {
			console.warn('[lower-third] roster import failed:', err)
			rosterMeta.textContent = 'Import failed'
		} finally {
			importLabel.classList.remove('inspector-lt-roster__import--busy')
		}
	})

	filterInput?.addEventListener('input', (e) => {
		rosterFilter = String(e.target.value || '')
		renderRosterTable()
	})

	function persistRoster() {
		const scene = sceneState.getScene(sceneId)
		const currentSrc = scene?.layers?.[layerIndex]?.source || src
		sceneState.patchLayer(sceneId, layerIndex, {
			source: { ...currentSrc, lowerThirdRoster: roster ? JSON.parse(JSON.stringify(roster)) : null },
		})
	}

	function mappingSelect(label, key, value) {
		const headers = roster?.headers || []
		const opts = [`<option value="">— ${label} —</option>`]
		for (const h of headers) {
			opts.push(`<option value="${escAttr(h)}"${value === h ? ' selected' : ''}>${escAttr(h)}</option>`)
		}
		return `<label class="inspector-lt-roster__map-field">
			<span class="inspector-lt-roster__map-label">${label}</span>
			<select class="inspector-field__select inspector-lt-roster__map-select" data-roster-map="${key}">${opts.join('')}</select>
		</label>`
	}

	function renderRosterMapping() {
		if (!roster) {
			mappingRow.innerHTML = '<p class="inspector-field inspector-field--hint">Import a spreadsheet to map columns to Title and Subtitle.</p>'
			return
		}
		const m = roster.mapping || guessRosterMapping(roster.headers)
		mappingRow.innerHTML = mappingSelect('First name', 'firstName', m.firstName || '') +
			mappingSelect('Surname', 'surname', m.surname || '') +
			mappingSelect('Title / role', 'subtitle', m.subtitle || '')
		for (const sel of mappingRow.querySelectorAll('[data-roster-map]')) {
			sel.addEventListener('change', () => {
				const k = sel.getAttribute('data-roster-map')
				if (!k || !roster) return
				roster.mapping = { ...roster.mapping, [k]: sel.value || '' }
				persistRoster()
				renderRosterTable()
			})
		}
	}

	function applyRowToEditor(row) {
		if (!roster?.mapping) return
		const mapped = mapRowToLowerThirdConfig(row, roster.mapping)
		const titleEl = grp.querySelector('#lt-title')
		const subEl = grp.querySelector('#lt-subtitle')
		if (titleEl) titleEl.value = mapped.title
		if (subEl) subEl.value = mapped.subtitle
		onFieldChange({ title: mapped.title, subtitle: mapped.subtitle })
	}

	function renderRosterTable() {
		tableWrap.innerHTML = ''
		if (!roster?.rows?.length) {
			tableWrap.innerHTML = '<p class="inspector-field inspector-field--hint">No rows loaded.</p>'
			return
		}
		const visible = filterRosterRows(roster, rosterFilter)
		rosterMeta.textContent = `${roster.fileName || 'Sheet'} · ${visible.length}/${roster.rows.length} rows`
		if (!visible.length) {
			tableWrap.innerHTML = '<p class="inspector-field inspector-field--hint">No rows match filter.</p>'
			return
		}
		const m = roster.mapping || {}
		const cols = [m.firstName, m.surname, m.subtitle].filter(Boolean)
		const showCols = cols.length ? cols : roster.headers.slice(0, 4)

		const table = document.createElement('table')
		table.className = 'inspector-lt-roster__table'
		const thead = document.createElement('thead')
		const headTr = document.createElement('tr')
		for (const c of showCols) {
			const th = document.createElement('th')
			th.textContent = c
			headTr.appendChild(th)
		}
		thead.appendChild(headTr)
		table.appendChild(thead)

		const tbody = document.createElement('tbody')
		for (const row of visible) {
			const srcIndex = roster.rows.indexOf(row)
			const tr = document.createElement('tr')
			tr.tabIndex = 0
			if (srcIndex === rosterSelectedIndex) tr.classList.add('inspector-lt-roster__row--selected')
			tr.title = 'Click to fill Title and Subtitle'
			for (const c of showCols) {
				const td = document.createElement('td')
				td.textContent = row[c] ?? ''
				tr.appendChild(td)
			}
			const pick = () => {
				rosterSelectedIndex = srcIndex
				applyRowToEditor(row)
				renderRosterTable()
			}
			tr.addEventListener('click', pick)
			tr.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter' || ev.key === ' ') {
					ev.preventDefault()
					pick()
				}
			})
			tbody.appendChild(tr)
		}
		table.appendChild(tbody)
		tableWrap.appendChild(table)
	}

	function renderRosterUi() {
		renderRosterMapping()
		renderRosterTable()
	}

	renderRosterUi()

	const fontField = document.createElement('div')
	fontField.className = 'inspector-field'
	const activeFont = String(cfg.fontFamily || 'arial').toLowerCase()
	const fontOpts = LOWER_THIRD_FONT_OPTIONS.map(
		(f) => `<option value="${escAttr(f.id)}"${activeFont === f.id ? ' selected' : ''}>${escAttr(f.label)}</option>`,
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
			<input type="number" class="inspector-lt-num" id="lt-title-size" min="8" max="200" step="1" value="${escAttr(String(cfg.titleFontSize ?? 46))}" />
		</label>
		<label class="inspector-lt-metric">
			<span class="inspector-lt-metric__label">Sub px</span>
			<input type="number" class="inspector-lt-num" id="lt-subtitle-size" min="8" max="120" step="1" value="${escAttr(String(cfg.subtitleFontSize ?? 27))}" />
		</label>
		<label class="inspector-lt-metric">
			<span class="inspector-lt-metric__label">Scale %</span>
			<input type="number" class="inspector-lt-num" id="lt-render-scale" min="25" max="300" step="5" value="${escAttr(String(cfg.renderScale ?? 100))}" />
		</label>
		<label class="inspector-lt-metric">
			<span class="inspector-lt-metric__label">Hold s</span>
			<input type="number" class="inspector-lt-num" id="lt-display-sec" min="0" step="0.5" value="${escAttr(String(cfg.displayDurationSec ?? 10))}" />
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

	const colorRow = document.createElement('div')
	colorRow.className = 'inspector-lt-colors'
	colorRow.innerHTML = `
		<label class="inspector-lt-color">
			<span class="inspector-lt-color__label">Text</span>
			<input type="color" class="inspector-field__color" id="lt-text-color" value="${escAttr(cfg.textColor || '#ffffff')}" />
		</label>
		<label class="inspector-lt-color">
			<span class="inspector-lt-color__label">Accent</span>
			<input type="color" class="inspector-field__color" id="lt-primary-color" value="${escAttr(cfg.primaryColor || '#4fc3f7')}" />
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
		const targetCh = resolveLookStackChannelForBus(cm, sceneState, scene, 'edit') || 1
		return {
			channel: targetCh,
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
		if (roster) patch.source.lowerThirdRoster = JSON.parse(JSON.stringify(roster))
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

function escAttr(s) {
	return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

import globalBorderFixtureText from '../fixtures/global-border.txt?raw'
import {
	GLOBAL_BORDER_ARTNET_CHANNEL_DEFS,
	normalizeArtnetChannelMap,
} from '../lib/global-border-artnet-map.js'
import { showScenesToast } from './scenes-editor-support.js'
import { scheduleGlobalBorderConfigSave } from './inspector-global-border-events.js'

/**
 * @param {HTMLElement} root
 * @param {() => import('../lib/scene-state.js').GlobalBorderConfig | null | undefined} gbNow
 * @param {(patch: object) => void} patchGlobalBorder
 */
export function appendGlobalBorderArtnetSection(root, gbNow, patchGlobalBorder) {
	const gb = gbNow()
	if (!gb) return

	const patchGrp = document.createElement('div')
	patchGrp.className = 'inspector-group'
	patchGrp.innerHTML = '<div class="inspector-group__title">Art-Net</div>'

	const patchBlock = document.createElement('div')
	patchBlock.className = 'inspector-effect-card__params'

	const listenWrap = document.createElement('div')
	listenWrap.className = 'inspector-field'
	const listenLab = document.createElement('label')
	listenLab.className = 'inspector-field__label'
	listenLab.style.display = 'flex'
	listenLab.style.alignItems = 'center'
	listenLab.style.gap = '8px'
	const listenChk = document.createElement('input')
	listenChk.type = 'checkbox'
	listenChk.checked = gb.artnetListenEnabled !== false
	listenChk.addEventListener('change', () => {
		patchGlobalBorder({ artnetListenEnabled: listenChk.checked })
		scheduleGlobalBorderConfigSave()
	})
	const listenTxt = document.createElement('span')
	listenTxt.textContent =
		'Listen for Art-Net on this screen (uncheck to freeze border from DMX; UI controls still work)'
	listenLab.appendChild(listenChk)
	listenLab.appendChild(listenTxt)
	listenWrap.appendChild(listenLab)
	patchBlock.appendChild(listenWrap)

	let patchStartCh = Number(gb.artnetPatch?.startChannel) || 1

	const scWrap = document.createElement('div')
	scWrap.className = 'inspector-field'
	const scLab = document.createElement('label')
	scLab.className = 'inspector-field__label'
	scLab.textContent = 'Start Channel'
	const scInp = document.createElement('input')
	scInp.type = 'number'
	scInp.className = 'inspector-field__input'
	scInp.style.width = '60px'
	scInp.min = 1
	scInp.max = 512
	scInp.value = patchStartCh
	scInp.addEventListener('change', () => {
		const val = parseInt(scInp.value, 10)
		const cur = gbNow()
		if (!cur) return
		patchStartCh = isNaN(val) ? 1 : val
		patchGlobalBorder({
			artnetPatch: { ...cur.artnetPatch, startChannel: patchStartCh },
		})
		scheduleGlobalBorderConfigSave()
		rebuildMappingTable()
	})
	scLab.appendChild(scInp)
	scWrap.appendChild(scLab)
	patchBlock.appendChild(scWrap)

	const uniWrap = document.createElement('div')
	uniWrap.className = 'inspector-field'
	const uniLab = document.createElement('label')
	uniLab.className = 'inspector-field__label'
	uniLab.textContent = 'Universe'
	const uniInp = document.createElement('input')
	uniInp.type = 'number'
	uniInp.className = 'inspector-field__input'
	uniInp.style.width = '60px'
	uniInp.min = 0
	uniInp.max = 16
	uniInp.value = gb.artnetPatch?.universe ?? 0
	uniInp.addEventListener('change', () => {
		const val = parseInt(uniInp.value, 10)
		const cur = gbNow()
		if (!cur) return
		patchGlobalBorder({
			artnetPatch: { ...cur.artnetPatch, universe: isNaN(val) ? 0 : val },
		})
		scheduleGlobalBorderConfigSave()
	})
	uniLab.appendChild(uniInp)
	uniWrap.appendChild(uniLab)
	patchBlock.appendChild(uniWrap)

	const channelMapHint = document.createElement('p')
	channelMapHint.className = 'inspector-field inspector-field--hint'
	channelMapHint.style.marginTop = '8px'
	channelMapHint.textContent =
		'Uncheck a row to keep that parameter under UI control while Art-Net is on (server must honor artnetChannelMap).'
	patchBlock.appendChild(channelMapHint)

	const setChannelMap = (nextMap) => {
		patchGlobalBorder({ artnetChannelMap: nextMap })
		scheduleGlobalBorderConfigSave()
	}

	const table = document.createElement('table')
	table.className = 'inspector-mapping-table'
	table.style.width = '100%'
	table.style.marginTop = '10px'
	table.style.fontSize = '0.8rem'
	table.style.borderCollapse = 'collapse'

	table.addEventListener('change', (e) => {
		if (e.target && e.target.type === 'checkbox' && e.target.dataset.offset != null) {
			const offset = parseInt(e.target.dataset.offset, 10)
			const cur = normalizeArtnetChannelMap(gbNow()?.artnetChannelMap)
			cur[offset] = e.target.checked
			setChannelMap(cur)
		}
	})

	function rebuildMappingTable() {
		const tbody = table.querySelector('tbody')
		if (!tbody) return
		const channelMap = normalizeArtnetChannelMap(gbNow()?.artnetChannelMap)
		tbody.innerHTML = GLOBAL_BORDER_ARTNET_CHANNEL_DEFS.map((def) => {
			const ch = patchStartCh + def.offset
			const checked = channelMap[def.offset] !== false ? 'checked' : ''
			return `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
				<td style="padding: 4px;">${def.label}</td>
				<td style="padding: 4px;">${ch}</td>
				<td style="padding: 4px; text-align: center;">
					<input type="checkbox" data-offset="${def.offset}" ${checked} style="cursor: pointer; vertical-align: middle;" />
				</td>
			</tr>`
		}).join('')
	}

	table.innerHTML = `
		<thead>
			<tr style="text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1);">
				<th style="padding: 4px;">Parameter</th>
				<th style="padding: 4px;">DMX channel</th>
				<th style="padding: 4px; text-align: center;">Art-Net</th>
			</tr>
		</thead>
		<tbody></tbody>
	`
	rebuildMappingTable()
	patchBlock.appendChild(table)

	const dlBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'header-btn',
		textContent: 'Download fixture file',
	})
	dlBtn.style.display = 'block'
	dlBtn.style.marginTop = '15px'
	dlBtn.addEventListener('click', () => {
		try {
			const blob = new Blob([globalBorderFixtureText], { type: 'text/plain;charset=utf-8' })
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = 'global-border.txt'
			document.body.appendChild(a)
			a.click()
			a.remove()
			URL.revokeObjectURL(url)
		} catch (e) {
			showScenesToast(`Download failed: ${e?.message || e}`, 'warn')
		}
	})
	patchBlock.appendChild(dlBtn)

	patchGrp.appendChild(patchBlock)
	root.appendChild(patchGrp)
}

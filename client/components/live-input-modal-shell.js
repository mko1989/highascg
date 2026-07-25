/**
 * Live input modal DOM shell.
 */
import { attachMathInput } from '../lib/math-input.js'
import { buildV4l2Section } from './live-input-modal-shell-v4l2.js'

export function createLiveInputModalShell(defaultCh = 5) {
	const modal = document.createElement('div')
	modal.id = 'live-input-modal'
	modal.className = 'modal-overlay'

	const content = document.createElement('div')
	content.className = 'modal-content live-input-modal'
	content.setAttribute('role', 'dialog')
	content.setAttribute('aria-labelledby', 'live-input-modal-title')
	modal.appendChild(content)

	const header = document.createElement('div')
	header.className = 'modal-header'
	const title = document.createElement('h2')
	title.id = 'live-input-modal-title'
	title.textContent = 'Add live input'
	const closeBtn = document.createElement('button')
	closeBtn.type = 'button'
	closeBtn.className = 'modal-close'
	closeBtn.id = 'live-input-close'
	closeBtn.setAttribute('aria-label', 'Close')
	closeBtn.textContent = '×'
	header.appendChild(title)
	header.appendChild(closeBtn)
	content.appendChild(header)

	const body = document.createElement('div')
	body.className = 'modal-body'
	content.appendChild(body)

	const hintEl = document.createElement('p')
	hintEl.className = 'settings-note live-input-modal__hint'
	hintEl.id = 'live-input-hint'
	body.appendChild(hintEl)

	const typeGroup = document.createElement('div')
	typeGroup.className = 'settings-group'
	const typeLabel = document.createElement('label')
	typeLabel.textContent = 'Type'
	const kindSel = document.createElement('select')
	kindSel.id = 'live-input-kind'
	const typeOptions = [
		['decklink', 'Decklink'],
		['ndi', 'NDI'],
		['browser_display', 'Web Browser (system)'],
		['browser', 'Web Browser (CG template)'],
		['live_audio', 'Live Audio'],
		['usb_video', 'USB Video (V4L2)'],
	]
	for (const [value, label] of typeOptions) {
		const option = document.createElement('option')
		option.value = value
		option.textContent = label
		kindSel.appendChild(option)
	}
	typeGroup.appendChild(typeLabel)
	typeGroup.appendChild(kindSel)
	body.appendChild(typeGroup)

	const chRow = document.createElement('div')
	chRow.className = 'settings-group'
	chRow.id = 'live-input-ch-row'
	chRow.style.display = 'none'
	chRow.style.flexWrap = 'wrap'
	chRow.style.gap = '0.75rem'
	chRow.style.alignItems = 'flex-end'
	const chCol = document.createElement('div')
	const chLabel = document.createElement('label')
	chLabel.textContent = 'Channel'
	const chInput = document.createElement('input')
	chInput.type = 'number'
	chInput.id = 'live-input-ch'
	chInput.min = '1'
	chInput.max = '999'
	chInput.value = String(defaultCh)
	chInput.style.width = '5rem'
	attachMathInput(chInput, { decimals: 0 })
	chCol.appendChild(chLabel)
	chCol.appendChild(chInput)
	const layerCol = document.createElement('div')
	const layerLabel = document.createElement('label')
	layerLabel.textContent = 'Layer'
	const layerInput = document.createElement('input')
	layerInput.type = 'number'
	layerInput.id = 'live-input-layer'
	layerInput.min = '0'
	layerInput.max = '999'
	layerInput.value = '1'
	layerInput.style.width = '5rem'
	attachMathInput(layerInput, { decimals: 0 })
	layerCol.appendChild(layerLabel)
	layerCol.appendChild(layerInput)
	chRow.appendChild(chCol)
	chRow.appendChild(layerCol)
	body.appendChild(chRow)

	const dlChFixed = document.createElement('div')
	dlChFixed.className = 'settings-group'
	dlChFixed.id = 'live-input-decklink-ch-fixed'
	dlChFixed.style.display = 'none'
	const dlChFixedText = document.createElement('p')
	dlChFixedText.className = 'settings-note'
	dlChFixedText.style.margin = '0'
	dlChFixedText.textContent = 'Caspar host channel: '
	const chFixedVal = document.createElement('strong')
	chFixedVal.id = 'live-input-ch-fixed-val'
	const chPlannedNote = document.createElement('span')
	chPlannedNote.id = 'live-input-ch-planned-note'
	chPlannedNote.className = 'settings-note'
	dlChFixedText.appendChild(chFixedVal)
	dlChFixedText.appendChild(chPlannedNote)
	dlChFixed.appendChild(dlChFixedText)
	body.appendChild(dlChFixed)

	const dlWrap = document.createElement('div')
	dlWrap.className = 'settings-group'
	dlWrap.id = 'live-input-decklink-wrap'
	const dlLabel = document.createElement('label')
	dlLabel.textContent = 'SDI port'
	const decklinkPortRow = document.createElement('div')
	decklinkPortRow.style.display = 'flex'
	decklinkPortRow.style.flexWrap = 'wrap'
	decklinkPortRow.style.gap = '0.5rem'
	decklinkPortRow.style.alignItems = 'center'
	const decklinkSlotSel = document.createElement('select')
	decklinkSlotSel.id = 'live-input-decklink-slot'
	decklinkSlotSel.style.minWidth = '10rem'
	decklinkSlotSel.style.maxWidth = '100%'
	const decklinkPortStatus = document.createElement('span')
	decklinkPortStatus.id = 'live-input-decklink-port-status'
	decklinkPortStatus.className = 'settings-note'
	decklinkPortRow.appendChild(decklinkSlotSel)
	decklinkPortRow.appendChild(decklinkPortStatus)
	const decklinkLayerInput = document.createElement('input')
	decklinkLayerInput.type = 'hidden'
	decklinkLayerInput.id = 'live-input-layer-dl'
	decklinkLayerInput.value = '1'
	dlWrap.appendChild(dlLabel)
	dlWrap.appendChild(decklinkPortRow)
	dlWrap.appendChild(decklinkLayerInput)
	body.appendChild(dlWrap)

	const ndiWrap = document.createElement('div')
	ndiWrap.className = 'settings-group'
	ndiWrap.id = 'live-input-ndi-wrap'
	ndiWrap.style.display = 'none'
	const ndiLabel = document.createElement('label')
	ndiLabel.textContent = 'NDI source'
	const ndiDiscoverRow = document.createElement('div')
	ndiDiscoverRow.style.display = 'flex'
	ndiDiscoverRow.style.flexWrap = 'wrap'
	ndiDiscoverRow.style.gap = '0.5rem'
	ndiDiscoverRow.style.alignItems = 'center'
	ndiDiscoverRow.style.marginBottom = '0.35rem'
	const ndiDiscoverBtn = document.createElement('button')
	ndiDiscoverBtn.type = 'button'
	ndiDiscoverBtn.className = 'btn btn--secondary'
	ndiDiscoverBtn.id = 'live-input-ndi-discover'
	ndiDiscoverBtn.textContent = 'Discover NDI sources'
	const ndiDiscoverStatus = document.createElement('span')
	ndiDiscoverStatus.id = 'live-input-ndi-discover-status'
	ndiDiscoverStatus.className = 'settings-note'
	ndiDiscoverRow.appendChild(ndiDiscoverBtn)
	ndiDiscoverRow.appendChild(ndiDiscoverStatus)
	const ndiSelect = document.createElement('select')
	ndiSelect.id = 'live-input-ndi-select'
	ndiSelect.style.width = '100%'
	ndiSelect.style.maxWidth = '100%'
	ndiSelect.style.marginBottom = '0.35rem'
	const ndiManualLabel = document.createElement('label')
	ndiManualLabel.style.fontSize = '12px'
	ndiManualLabel.textContent = 'Or type name manually'
	const ndiManual = document.createElement('input')
	ndiManual.type = 'text'
	ndiManual.id = 'live-input-ndi-manual'
	ndiManual.placeholder = 'Exact NDI source name'
	ndiManual.style.width = '100%'
	const ndiAttrHost = document.createElement('div')
	ndiAttrHost.id = 'live-input-ndi-attribution'
	ndiWrap.appendChild(ndiLabel)
	ndiWrap.appendChild(ndiDiscoverRow)
	ndiWrap.appendChild(ndiSelect)
	ndiWrap.appendChild(ndiManualLabel)
	ndiWrap.appendChild(ndiManual)
	ndiWrap.appendChild(ndiAttrHost)
	body.appendChild(ndiWrap)

	const browserDisplayWrap = document.createElement('div')
	browserDisplayWrap.className = 'settings-group'
	browserDisplayWrap.id = 'live-input-browser-display-wrap'
	browserDisplayWrap.style.display = 'none'

	const bdUrlLabel = document.createElement('label')
	bdUrlLabel.textContent = 'URL'
	const bdUrl = document.createElement('input')
	bdUrl.type = 'text'
	bdUrl.id = 'live-input-browser-display-url'
	bdUrl.placeholder = 'https://example.com/'
	bdUrl.style.width = '100%'
	bdUrl.style.marginBottom = '0.5rem'

	const bdDimsRow = document.createElement('div')
	bdDimsRow.style.display = 'flex'
	bdDimsRow.style.flexWrap = 'wrap'
	bdDimsRow.style.gap = '0.75rem'
	bdDimsRow.style.marginBottom = '0.5rem'

	const bdWidthCol = document.createElement('div')
	bdWidthCol.style.flex = '1'
	bdWidthCol.style.minWidth = '120px'
	const bdWidthLabel = document.createElement('label')
	bdWidthLabel.textContent = 'Width (px)'
	const bdWidth = document.createElement('input')
	bdWidth.type = 'number'
	bdWidth.id = 'live-input-browser-display-width'
	bdWidth.min = '160'
	bdWidth.max = '3840'
	bdWidth.value = '1152'
	bdWidth.style.width = '100%'
	attachMathInput(bdWidth, { decimals: 0 })
	bdWidthCol.appendChild(bdWidthLabel)
	bdWidthCol.appendChild(bdWidth)

	const bdHeightCol = document.createElement('div')
	bdHeightCol.style.flex = '1'
	bdHeightCol.style.minWidth = '120px'
	const bdHeightLabel = document.createElement('label')
	bdHeightLabel.textContent = 'Height (px)'
	const bdHeight = document.createElement('input')
	bdHeight.type = 'number'
	bdHeight.id = 'live-input-browser-display-height'
	bdHeight.min = '120'
	bdHeight.max = '2160'
	bdHeight.value = '648'
	bdHeight.style.width = '100%'
	attachMathInput(bdHeight, { decimals: 0 })
	bdHeightCol.appendChild(bdHeightLabel)
	bdHeightCol.appendChild(bdHeight)

	const bdFpsCol = document.createElement('div')
	bdFpsCol.style.flex = '0 0 auto'
	bdFpsCol.style.minWidth = '80px'
	const bdFpsLabel = document.createElement('label')
	bdFpsLabel.textContent = 'FPS'
	const bdFps = document.createElement('input')
	bdFps.type = 'number'
	bdFps.id = 'live-input-browser-display-fps'
	bdFps.min = '1'
	bdFps.max = '60'
	bdFps.value = '25'
	bdFps.style.width = '100%'
	attachMathInput(bdFps, { decimals: 0 })
	bdFpsCol.appendChild(bdFpsLabel)
	bdFpsCol.appendChild(bdFps)

	bdDimsRow.appendChild(bdWidthCol)
	bdDimsRow.appendChild(bdHeightCol)
	bdDimsRow.appendChild(bdFpsCol)

	const bdHint = document.createElement('p')
	bdHint.className = 'settings-note'
	bdHint.id = 'live-input-browser-display-hint'
	bdHint.style.margin = '0.5rem 0 0'
	bdHint.textContent = 'Browser runs off-screen; max size = free desktop area (1920x648 on this box). Create, then use the Inspector to toggle operator screen.'

	browserDisplayWrap.appendChild(bdUrlLabel)
	browserDisplayWrap.appendChild(bdUrl)
	browserDisplayWrap.appendChild(bdDimsRow)
	browserDisplayWrap.appendChild(bdHint)
	body.appendChild(browserDisplayWrap)

	const browserWrap = document.createElement('div')
	browserWrap.className = 'settings-group'
	browserWrap.id = 'live-input-browser-wrap'
	browserWrap.style.display = 'none'

	// Template checkbox row
	const templateCheckRow = document.createElement('div')
	templateCheckRow.style.display = 'flex'
	templateCheckRow.style.alignItems = 'center'
	templateCheckRow.style.gap = '0.35rem'
	templateCheckRow.style.marginBottom = '0.5rem'
	const browserUseTemplate = document.createElement('input')
	browserUseTemplate.type = 'checkbox'
	browserUseTemplate.id = 'live-input-browser-use-template'
	templateCheckRow.appendChild(browserUseTemplate)
	templateCheckRow.appendChild(document.createTextNode('Template'))

	const browserLabel = document.createElement('label')
	browserLabel.textContent = 'URL'
	const browserUrl = document.createElement('input')
	browserUrl.type = 'text'
	browserUrl.id = 'live-input-browser-url'
	browserUrl.placeholder = 'https://...'
	browserUrl.style.width = '100%'

	// Template select (hidden by default)
	const templateSelectLabel = document.createElement('label')
	templateSelectLabel.textContent = 'Template'
	templateSelectLabel.style.display = 'none'
	templateSelectLabel.id = 'live-input-template-label'
	const browserTemplate = document.createElement('select')
	browserTemplate.id = 'live-input-browser-template'
	browserTemplate.style.width = '100%'
	browserTemplate.style.display = 'none'
	const placeholderOpt = document.createElement('option')
	placeholderOpt.value = ''
	placeholderOpt.textContent = '— Select a template —'
	browserTemplate.appendChild(placeholderOpt)

	const browserCgLabel = document.createElement('label')
	browserCgLabel.style.marginTop = '0.5rem'
	browserCgLabel.style.display = 'flex'
	browserCgLabel.style.alignItems = 'center'
	browserCgLabel.style.gap = '0.35rem'
	browserCgLabel.style.fontWeight = 'normal'
	browserCgLabel.style.cursor = 'pointer'
	const browserAsCg = document.createElement('input')
	browserAsCg.type = 'checkbox'
	browserAsCg.id = 'live-input-browser-as-cg'
	browserCgLabel.appendChild(browserAsCg)
	browserCgLabel.appendChild(document.createTextNode('Add as CG template (plays highascg_browser_url + passes URL via CG UPDATE)'))

	browserWrap.appendChild(templateCheckRow)
	browserWrap.appendChild(browserLabel)
	browserWrap.appendChild(browserUrl)
	browserWrap.appendChild(templateSelectLabel)
	browserWrap.appendChild(browserTemplate)
	browserWrap.appendChild(browserCgLabel)
	body.appendChild(browserWrap)

	const liveAudioWrap = document.createElement('div')
	liveAudioWrap.className = 'settings-group'
	liveAudioWrap.id = 'live-input-live-audio-wrap'
	liveAudioWrap.style.display = 'none'
	const liveAudioLabel = document.createElement('label')
	liveAudioLabel.textContent = 'ALSA / USB capture device'
	const liveAudioDiscoverRow = document.createElement('div')
	liveAudioDiscoverRow.style.display = 'flex'
	liveAudioDiscoverRow.style.flexWrap = 'wrap'
	liveAudioDiscoverRow.style.gap = '0.5rem'
	liveAudioDiscoverRow.style.alignItems = 'center'
	liveAudioDiscoverRow.style.marginBottom = '0.35rem'
	const audioRefreshBtn = document.createElement('button')
	audioRefreshBtn.type = 'button'
	audioRefreshBtn.className = 'btn btn--secondary'
	audioRefreshBtn.id = 'live-input-audio-refresh'
	audioRefreshBtn.textContent = 'Refresh devices'
	const audioDiscoverStatus = document.createElement('span')
	audioDiscoverStatus.id = 'live-input-audio-discover-status'
	audioDiscoverStatus.className = 'settings-note'
	liveAudioDiscoverRow.appendChild(audioRefreshBtn)
	liveAudioDiscoverRow.appendChild(audioDiscoverStatus)
	const audioSelect = document.createElement('select')
	audioSelect.id = 'live-input-audio-select'
	audioSelect.style.width = '100%'
	audioSelect.style.maxWidth = '100%'
	audioSelect.style.marginBottom = '0.35rem'
	const audioManualLabel = document.createElement('label')
	audioManualLabel.style.fontSize = '12px'
	audioManualLabel.textContent = 'Or type ALSA URI manually'
	const audioManual = document.createElement('input')
	audioManual.type = 'text'
	audioManual.id = 'live-input-audio-manual'
	audioManual.placeholder = 'alsa://hw:1,0'
	audioManual.style.width = '100%'
	const audioSlotHint = document.createElement('p')
	audioSlotHint.className = 'settings-note'
	audioSlotHint.id = 'live-input-audio-slot-hint'
	audioSlotHint.style.margin = '0.5rem 0 0'
	liveAudioWrap.appendChild(liveAudioLabel)
	liveAudioWrap.appendChild(liveAudioDiscoverRow)
	liveAudioWrap.appendChild(audioSelect)
	liveAudioWrap.appendChild(audioManualLabel)
	liveAudioWrap.appendChild(audioManual)
	liveAudioWrap.appendChild(audioSlotHint)
	body.appendChild(liveAudioWrap)

	const {
		v4l2Wrap,
		v4l2RefreshBtn,
		v4l2DiscoverStatus,
		v4l2Select,
		v4l2Manual,
		v4l2DeviceInput,
		v4l2Format,
		v4l2Fps,
		v4l2AudioSelect,
		v4l2AudioManual,
		v4l2SlotHint,
	} = buildV4l2Section()
	body.appendChild(v4l2Wrap)

	const footerRow = document.createElement('div')
	footerRow.style.display = 'flex'
	footerRow.style.flexWrap = 'wrap'
	footerRow.style.gap = '0.5rem'
	footerRow.style.alignItems = 'center'
	const playBtn = document.createElement('button')
	playBtn.type = 'button'
	playBtn.className = 'btn btn--primary'
	playBtn.id = 'live-input-play'
	playBtn.textContent = 'Add live source'
	const statusEl = document.createElement('span')
	statusEl.id = 'live-input-status'
	statusEl.className = 'settings-note'
	footerRow.appendChild(playBtn)
	footerRow.appendChild(statusEl)
	body.appendChild(footerRow)

	document.body.appendChild(modal)

	return {
		modal,
		elements: {
			hintEl,
			kindSel,
			dlWrap,
			ndiWrap,
			browserDisplayWrap,
			browserWrap,
			liveAudioWrap,
			v4l2Wrap,
			chRow,
			dlChFixed,
			chFixedVal,
			chPlannedNote,
			closeBtn,
			playBtn,
			statusEl,
			decklinkSlotSel,
			decklinkPortStatus,
			decklinkLayerInput,
			browserAsCg,
			browserUseTemplate,
			browserTemplate,
			templateSelectLabel,
			audioRefreshBtn,
			audioDiscoverStatus,
			audioSelect,
			audioManual,
			audioSlotHint,
			v4l2RefreshBtn,
			v4l2DiscoverStatus,
			v4l2Select,
			v4l2Manual,
			v4l2Label: v4l2DeviceInput,
			v4l2Format,
			v4l2Fps,
			v4l2AudioSelect,
			v4l2AudioManual,
			v4l2SlotHint,
			ndiDiscoverBtn,
			ndiDiscoverStatus,
			ndiSelect,
			ndiManual,
			ndiAttrHost,
			browserDisplayUrl: bdUrl,
			browserDisplayWidth: bdWidth,
			browserDisplayHeight: bdHeight,
			browserDisplayFps: bdFps,
			browserUrl,
			chInput,
			layerInput,
			statusText: statusEl,
		}
	}
}

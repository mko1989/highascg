window.play = function () {}
window.stop = function () {}

var BLINK_PHASE_MS = 250
var BLINK_INTERVAL_MS = 30000
function ledTestAssetUrl(filename) {
	// Keep test assets side-by-side with this template.
	return './' + String(filename || '').replace(/^\.\//, '')
}
var blinkInterval = null

function parsePayload(raw) {
	if (raw == null) return null
	try {
		if (typeof raw === 'string') {
			var s = raw.trim()
			if (!s) return null
			if (s.indexOf('\\"') !== -1) s = s.replace(/\\"/g, '"')
			if (s.charAt(0) === '"' && s.length > 1 && s.charAt(s.length - 1) === '"') s = s.slice(1, -1)
			if (s.charAt(0) === '"') { s = s.slice(1).replace(/\\"/g, '"'); s = s.replace(/"\s*$/, '') }
			return JSON.parse(s)
		}
		if (typeof raw === 'object') return raw
	} catch (e) {}
	return null
}

function stopEyeBlink() {
	if (blinkInterval) {
		clearInterval(blinkInterval)
		blinkInterval = null
	}
}

function startEyeBlink(imgId, wrapId) {
	stopEyeBlink()
	var eyeWrap = document.getElementById(wrapId || 'ledTestEye')
	var img = document.getElementById(imgId || 'ledTestEyeImg')
	if (!eyeWrap || !img) return

	function resolveSrc() {
		var blinkL = eyeWrap.classList.contains('blink-l')
		var blinkR = eyeWrap.classList.contains('blink-r')
		if (blinkL) return ledTestAssetUrl('ch_left_closed_green.svg')
		if (blinkR) return ledTestAssetUrl('ch_right_closed_green.svg')
		return ledTestAssetUrl('ch_both_open_green.svg')
	}

	function updateImgSrc() {
		var next = resolveSrc()
		if (img.getAttribute('src') !== next) img.setAttribute('src', next)
	}
	img.onerror = function () {
		img.onerror = null
		img.alt = 'HighAsCG'
		img.style.display = 'none'
		if (!eyeWrap.querySelector('.led-test-eye__fallback')) {
			var fb = document.createElement('span')
			fb.className = 'led-test-eye__fallback'
			fb.style.cssText = 'font-size:clamp(2rem,8vw,4rem);font-weight:800;letter-spacing:0.12em;color:rgba(200,220,255,0.95);text-shadow:0 0 24px rgba(100,160,255,0.35)'
			fb.textContent = 'H'
			eyeWrap.appendChild(fb)
		}
	}

	function triggerBlink() {
		if (eyeWrap.classList.contains('blink-l') || eyeWrap.classList.contains('blink-r')) return
		eyeWrap.classList.add('blink-l')
		updateImgSrc()
		setTimeout(function () {
			eyeWrap.classList.remove('blink-l')
			eyeWrap.classList.add('blink-r')
			updateImgSrc()
			setTimeout(function () {
				eyeWrap.classList.remove('blink-r')
				updateImgSrc()
			}, BLINK_PHASE_MS)
		}, BLINK_PHASE_MS)
	}

	updateImgSrc()
	blinkInterval = setInterval(triggerBlink, BLINK_INTERVAL_MS)
}

function showCenterWanted(data) {
	var v = data.showCenterCharacter
	if (v === false || v === 'false') return false
	return true
}

/** mode: 'screens' (solid bg + optional eye) | 'grid-overlay' (transparent; resolution + patterns only) */
function fillBrandMetaAndPatterns(data, mode) {
	var showCross = data.showCross !== false && data.showCross !== 'false'
	var showCircle = data.showCircle !== false && data.showCircle !== 'false'
	document.getElementById('patternCross').style.display = showCross ? '' : 'none'
	document.getElementById('patternCircle').style.display = showCircle ? '' : 'none'

	var title = data.centerLabel != null ? String(data.centerLabel) : 'HighAsCG'
	document.getElementById('brandTitle').textContent = title

	var meta = document.getElementById('brandMeta')
	meta.innerHTML = ''
	var resText = data.resolutionLabel != null && String(data.resolutionLabel).trim()
		? String(data.resolutionLabel).trim()
		: ''
	if (!resText && data.resolutionWidth > 0 && data.resolutionHeight > 0) {
		resText = data.resolutionWidth + '×' + data.resolutionHeight
		if (data.videoMode) resText += ' · ' + data.videoMode
	}
	if (resText) {
		var lr = document.createElement('span')
		lr.className = 'brand-meta__line'
		lr.textContent = resText
		meta.appendChild(lr)
	}
	var connText = data.connectorLabel != null ? String(data.connectorLabel).trim() : ''
	if (connText) {
		var lc = document.createElement('span')
		lc.className = 'brand-meta__line'
		lc.textContent = 'Output: ' + connText
		meta.appendChild(lc)
	}
	var lines = data.ipLines
	if (typeof lines === 'string') {
		try { lines = JSON.parse(lines) } catch (e) { lines = [lines] }
	}
	if (!Array.isArray(lines)) lines = []
	if (lines.length > 0) {
		var lip = document.createElement('span')
		lip.className = 'brand-meta__line brand-meta__line--ips'
		lip.textContent = lines.join('  ·  ')
		meta.appendChild(lip)
	} else if (!resText) {
		var lip2 = document.createElement('span')
		lip2.className = 'brand-meta__line brand-meta__line--ips'
		lip2.textContent = '—'
		meta.appendChild(lip2)
	}

	var eyeWrap = document.getElementById('ledTestEyeScreens')
	if (mode === 'screens' && showCenterWanted(data)) {
		eyeWrap.style.display = ''
		var imgScr = document.getElementById('ledTestEyeImgScreens')
		var fb = document.querySelector('#ledTestEyeScreens .led-test-eye__fallback')
		if (fb) fb.remove()
		if (imgScr) {
			imgScr.style.display = ''
			imgScr.alt = ''
		}
		startEyeBlink('ledTestEyeImgScreens', 'ledTestEyeScreens')
	} else {
		eyeWrap.style.display = 'none'
		stopEyeBlink()
	}
}

function buildScreensMode(data) {
	var sm = document.getElementById('screensMode')
	var root = document.getElementById('root')
	var center = document.getElementById('center')
	var spec = document.getElementById('spec')
	root.style.display = 'none'
	center.style.display = 'none'
	spec.style.display = 'none'
	sm.classList.add('screens-mode--on')
	sm.classList.remove('screens-mode--grid-overlay')
	sm.style.background = ''
	fillBrandMetaAndPatterns(data, 'screens')
}

function buildGridMode(data) {
	var sm = document.getElementById('screensMode')
	sm.classList.add('screens-mode--on', 'screens-mode--grid-overlay')
	fillBrandMetaAndPatterns(data, 'grid-overlay')
	document.getElementById('root').style.display = ''

	var cols = Math.max(1, parseInt(data.cols, 10) || 4)
	var rows = Math.max(1, parseInt(data.rows, 10) || 3)
	var pw = Math.max(0, parseInt(data.panelWidth, 10) || 0)
	var ph = Math.max(0, parseInt(data.panelHeight, 10) || 0)
	var centerLabel = data.centerLabel != null ? String(data.centerLabel) : 'HighAsCG'
	var showCenter = showCenterWanted(data)
	var showLabels = data.showPanelLabels !== false
	var showSpec = data.showSpecLine !== false

	var root = document.getElementById('root')
	root.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)'
	root.style.gridTemplateRows = 'repeat(' + rows + ', 1fr)'
	root.innerHTML = ''

	var r, c, panel, idx, cross
	for (r = 1; r <= rows; r++) {
		for (c = 1; c <= cols; c++) {
			panel = document.createElement('div')
			panel.className = 'panel'
			if (showLabels) {
				idx = document.createElement('div')
				idx.className = 'panel__idx'
				idx.textContent = 'R' + r + '×C' + c
				panel.appendChild(idx)
			}
			cross = document.createElement('div')
			cross.className = 'panel__cross'
			panel.appendChild(cross)
			root.appendChild(panel)
		}
	}

	var center = document.getElementById('center')
	var cap = document.getElementById('centerCaption')
	if (showCenter) {
		center.style.display = 'flex'
		cap.textContent = centerLabel || ''
		cap.style.display = centerLabel ? 'block' : 'none'
		stopEyeBlink()
		var img = document.getElementById('ledTestEyeImg')
		var fb = document.querySelector('#ledTestEye .led-test-eye__fallback')
		if (fb) fb.remove()
		if (img) {
			img.style.display = ''
			img.alt = ''
		}
		startEyeBlink('ledTestEyeImg', 'ledTestEye')
	} else {
		center.style.display = 'none'
		stopEyeBlink()
	}

	var spec = document.getElementById('spec')
	if (showSpec && pw > 0 && ph > 0) {
		var tw = cols * pw
		var th = rows * ph
		spec.textContent = tw + '×' + th + ' px  ·  ' + cols + '×' + rows + ' panels  ·  ' + pw + '×' + ph + ' px each'
		spec.style.display = 'block'
	} else if (showSpec) {
		spec.textContent = cols + '×' + rows + ' panels' + (pw && ph ? '  ·  ' + pw + '×' + ph + ' px (set both for total)' : '')
		spec.style.display = 'block'
	} else {
		spec.style.display = 'none'
	}
}

function resetPatternLayer(layer) {
	layer.style.background = '#0a0a0f'
	layer.innerHTML = ''
}

function setPatternBackground(layer, bg) {
	layer.style.background = bg
}

function renderBouncingCharacter(layer, count) {
	setPatternBackground(layer, '#000')
	var n = Math.max(1, Math.min(99, parseInt(count, 10) || 1))
	var bounceAssets = [
		'ch_both_open_green.svg',
		'ch_left_closed_green.svg',
		'ch_right_closed_green.svg',
		'ch_both_open_red.svg',
		'ch_left_closed_red.svg',
		'ch_right_closed_red.svg'
	]
	for (var i = 0; i < n; i++) {
		var node = document.createElement('div')
		node.className = 'bouncing-character'
		node.style.setProperty('--bounce-size', '250px')
		
		// Randomize animation to make them unique
		var durX = (3 + Math.random() * 2.5).toFixed(2) + 's'
		var durY = (2 + Math.random() * 2.5).toFixed(2) + 's'
		var delay = (Math.random() * -10).toFixed(2) + 's'
		node.style.animationDuration = durX + ', ' + durY
		node.style.animationDelay = delay + ', ' + delay
		node.style.animationDelay = delay + ', ' + delay

		var img = document.createElement('img')
		img.className = 'bouncing-character__img'
		var curIdx = Math.floor(Math.random() * bounceAssets.length)
		img.src = ledTestAssetUrl(bounceAssets[curIdx])
		
		// Optional: individual blink/swap per character on iteration
		node.addEventListener('animationiteration', (function(imgEl) {
			return function() {
				var nextIdx = Math.floor(Math.random() * bounceAssets.length)
				imgEl.src = ledTestAssetUrl(bounceAssets[nextIdx])
			}
		})(img))

		node.appendChild(img)
		layer.appendChild(node)
	}
}

function applyPattern(data) {
	var pat = data.pattern || 'grid-white'
	var layer = document.getElementById('patternLayer')
	resetPatternLayer(layer)

	if (pat === 'smpte-bars') {
		setPatternBackground(layer, '#000')
		layer.innerHTML = '<div style="display:flex; flex-direction:column; height:100%; width:100%;">' +
			'<div style="flex: 0 0 67%; display:flex;">' +
				'<div style="flex:1; background:#c0c0c0"></div><div style="flex:1; background:#c0c000"></div><div style="flex:1; background:#00c0c0"></div><div style="flex:1; background:#00c000"></div><div style="flex:1; background:#c000c0"></div><div style="flex:1; background:#c00000"></div><div style="flex:1; background:#0000c0"></div>' +
			'</div>' +
			'<div style="flex: 0 0 8%; display:flex;">' +
				'<div style="flex:1; background:#0000c0"></div><div style="flex:1; background:#101010"></div><div style="flex:1; background:#c000c0"></div><div style="flex:1; background:#101010"></div><div style="flex:1; background:#00c0c0"></div><div style="flex:1; background:#101010"></div><div style="flex:1; background:#c0c0c0"></div>' +
			'</div>' +
			'<div style="flex: 0 0 25%; display:flex;">' +
				'<div style="flex:1; background:#00214c"></div><div style="flex:1; background:#ffffff"></div><div style="flex:1; background:#32006a"></div><div style="flex:1; background:#101010"></div><div style="flex:1; background:#101010"></div>' +
				'<div style="flex:1; display:flex;">' +
					'<div style="flex:1; background:#101010"></div><div style="flex:1; background:#000000"></div><div style="flex:1; background:#101010"></div><div style="flex:1; background:#202020"></div><div style="flex:1; background:#101010"></div>' +
				'</div>' +
				'<div style="flex:1; background:#101010"></div>' +
			'</div>' +
		'</div>'
	} else if (pat === 'gradient-h') {
		setPatternBackground(layer, 'linear-gradient(to right, #000, #fff)')
	} else if (pat === 'gradient-v') {
		setPatternBackground(layer, 'linear-gradient(to bottom, #000, #fff)')
	} else if (pat === 'checkerboard') {
		setPatternBackground(layer, 'conic-gradient(#fff 90deg, #000 90deg 180deg, #fff 180deg 270deg, #000 270deg) 0 0 / 100px 100px')
	} else if (pat === 'solid-red') {
		setPatternBackground(layer, '#f00')
	} else if (pat === 'solid-green') {
		setPatternBackground(layer, '#0f0')
	} else if (pat === 'solid-blue') {
		setPatternBackground(layer, '#00f')
	} else if (pat === 'solid-white') {
		setPatternBackground(layer, '#fff')
	} else if (pat === 'solid-black') {
		setPatternBackground(layer, '#000')
	} else if (pat === 'animated-radar') {
		setPatternBackground(layer, '#001a00')
		layer.innerHTML = '<div class="radar-grid"></div><div class="radar-sweep"></div>'
	} else if (pat === 'animated-stripes') {
		setPatternBackground(layer, '#000')
		layer.innerHTML = '<div class="animated-stripes"></div>'
	} else if (pat === 'animated-pulse') {
		setPatternBackground(layer, '#000')
		layer.innerHTML = '<div class="pulse-circle"></div><div class="pulse-circle" style="animation-delay: -1s"></div>'
	} else if (pat === 'animated-noise') {
		setPatternBackground(layer, '#000')
		layer.innerHTML = '<div class="animated-noise"></div>'
	} else if (pat === 'bouncing-element') {
		renderBouncingCharacter(layer, data.charCount || 1)
	}

	var root = document.getElementById('root')
	if (pat !== 'grid-white') {
		root.classList.add('root--transparent-panels')
	} else {
		root.classList.remove('root--transparent-panels')
	}
}

function build(data) {
	if (!data) data = {}
	applyPattern(data)
	var ledGrid = data.showLedGrid === true
	if (ledGrid) {
		buildGridMode(data)
	} else {
		buildScreensMode(data)
	}
}

function update(raw) {
	var data = parsePayload(raw)
	if (!data) data = {}
	build(data)
}

window.update = update
build({
	showLedGrid: false,
	showCircle: true,
	showCross: true,
	resolutionLabel: '—',
	ipLines: [],
	centerLabel: 'HighAsCG'
})

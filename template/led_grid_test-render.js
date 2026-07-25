function resetPatternLayer(layer) {
	if (animId) {
		cancelAnimationFrame(animId)
		animId = null
	}
	layer.style.background = '#0a0a0f'
	layer.innerHTML = ''
}

function setPatternBackground(layer, bg) {
	layer.style.background = bg
}

function renderBouncingCharacter(layer, count) {
	if (animId) {
		cancelAnimationFrame(animId)
		animId = null
	}
	setPatternBackground(layer, '#000')
	var n = Math.max(1, Math.min(99, parseInt(count, 10) || 1))
	
	var canvas = document.createElement('canvas')
	canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; display:block;'
	layer.innerHTML = ''
	layer.appendChild(canvas)
	
	var width = window.innerWidth || 1920
	var height = window.innerHeight || 1080
	canvas.width = width
	canvas.height = height
	
	var ctx = canvas.getContext('2d', { alpha: false })
	
	var bounceAssets = [
		'ch_both_open_green.svg',
		'ch_left_closed_green.svg',
		'ch_right_closed_green.svg',
		'both_open.svg',
		'left_closed.svg',
		'right_closed.svg'
	]
	
	var images = []
	var loadedCount = 0
	
	function checkStart() {
		loadedCount++
		if (loadedCount === bounceAssets.length) {
			startLoop()
		}
	}
	
	for (var idx = 0; idx < bounceAssets.length; idx++) {
		var img = new Image()
		img.onload = checkStart
		img.onerror = checkStart
		img.src = ledTestAssetUrl(bounceAssets[idx])
		images.push(img)
	}
	
	var bounceSize = 250
	var baseSpeed = 250
	
	var characters = []
	for (var i = 0; i < n; i++) {
		var travelX = Math.max(10, width - bounceSize)
		var travelY = Math.max(10, height - bounceSize)
		
		var speedX = baseSpeed * (0.8 + Math.random() * 0.4)
		var speedY = baseSpeed * (0.8 + Math.random() * 0.4)
		
		var vx = speedX * (Math.random() > 0.5 ? 1 : -1)
		var vy = speedY * (Math.random() > 0.5 ? 1 : -1)
		
		var x = Math.random() * travelX
		var y = Math.random() * travelY
		
		var imgIndex = Math.floor(Math.random() * images.length)
		
		characters.push({
			x: x,
			y: y,
			vx: vx,
			vy: vy,
			imgIndex: imgIndex
		})
	}
	
	var lastTime = performance.now()
	
	function startLoop() {
		function tick(now) {
			var dt = (now - lastTime) / 1000
			lastTime = now
			
			if (dt > 0.1) dt = 0.1
			
			ctx.fillStyle = '#000000'
			ctx.fillRect(0, 0, width, height)
			
			var maxW = width - bounceSize
			var maxH = height - bounceSize
			
			for (var j = 0; j < characters.length; j++) {
				var ch = characters[j]
				ch.x += ch.vx * dt
				ch.y += ch.vy * dt
				
				var bounced = false
				
				if (ch.x < 0) {
					ch.x = 0
					ch.vx = -ch.vx
					bounced = true
				} else if (ch.x > maxW) {
					ch.x = maxW
					ch.vx = -ch.vx
					bounced = true
				}
				
				if (ch.y < 0) {
					ch.y = 0
					ch.vy = -ch.vy
					bounced = true
				} else if (ch.y > maxH) {
					ch.y = maxH
					ch.vy = -ch.vy
					bounced = true
				}
				
				if (bounced) {
					ch.imgIndex = Math.floor(Math.random() * images.length)
				}
				
				var imgEl = images[ch.imgIndex]
				if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
					var drawW = bounceSize
					var drawH = bounceSize
					var ratio = imgEl.naturalWidth / imgEl.naturalHeight
					if (ratio > 1) {
						drawH = bounceSize / ratio
					} else {
						drawW = bounceSize * ratio
					}
					var offsetX = (bounceSize - drawW) / 2
					var offsetY = (bounceSize - drawH) / 2
					ctx.drawImage(imgEl, ch.x + offsetX, ch.y + offsetY, drawW, drawH)
				} else {
					ctx.fillStyle = '#00ff00'
					ctx.fillRect(ch.x, ch.y, bounceSize, bounceSize)
				}
			}
			
			animId = requestAnimationFrame(tick)
		}
		
		animId = requestAnimationFrame(tick)
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

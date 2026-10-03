/*
 * WO-588 — "Bunny builds the wall" LED test pattern (full LED grid only).
 *
 * The HighAsCG bunny walks in from outside the canvas carrying an LED panel, slides it into its
 * cell, and walks back out for the next one. The wall starts in the default dark-gray panel look;
 * every panel is replaced with the phase colour, and once the whole wall is done the next colour
 * starts (red → green → blue → red …). `charCount` = number of bunnies working at once,
 * `builderSpeed` 1–10 = pace (10 = the original pace, which the owner found way too quick).
 *
 * Two canvases: the panel colours sit in #patternLayer UNDER the #root grid (so R×C labels and
 * seams stay on top, like every other pattern); bunnies + carried panels + drop flashes sit on a
 * transparent canvas ABOVE everything. Loaded between led_grid_test.js and -render.js.
 */

/* Half-level primaries: full red/white was too bright on the wall (owner, 03.10). */
var BUILDER_COLORS = ['#800000', '#008000', '#000080']
var BUILDER_MAX_WORKERS = 12
var BUILDER_PLACE_S = 0.28
var BUILDER_FLASH_S = 0.3
var BUILDER_PHASE_PAUSE_S = 1.2
var BUILDER_DEFAULT_SPEED = 3
var builderRaf = null

/** Speed setting 1–10 → pace multiplier 0.1–1 (missing/invalid = the default). */
function ledBuilderPace(level) {
	var n = parseInt(level, 10)
	if (!(n >= 1)) n = BUILDER_DEFAULT_SPEED
	return Math.min(10, n) / 10
}

/** Build order: bottom row first (walls go up), left → right. Returns [{ c, r }] (0-based). */
function ledBuilderOrder(cols, rows) {
	var out = []
	for (var r = rows - 1; r >= 0; r--) {
		for (var c = 0; c < cols; c++) out.push({ c: c, r: r })
	}
	return out
}

/** Enter from the nearer horizontal edge; the exact middle column alternates by row. */
function ledBuilderSide(c, r, cols) {
	var mid = (cols - 1) / 2
	if (c < mid) return -1
	if (c > mid) return 1
	return r % 2 === 0 ? -1 : 1
}

function stopBunnyBuilder() {
	if (builderRaf) {
		cancelAnimationFrame(builderRaf)
		builderRaf = null
	}
	var actors = document.getElementById('builderActors')
	if (actors) actors.remove()
}

function renderBunnyBuilder(layer, data) {
	stopBunnyBuilder()
	layer.style.background = '#000'
	layer.innerHTML = ''

	var W = window.innerWidth || 1920
	var H = window.innerHeight || 1080
	var cols = Math.max(1, parseInt(data.cols, 10) || 4)
	var rows = Math.max(1, parseInt(data.rows, 10) || 3)
	var cellW = W / cols
	var cellH = H / rows

	var wallCanvas = document.createElement('canvas')
	wallCanvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; display:block;'
	wallCanvas.width = W
	wallCanvas.height = H
	layer.appendChild(wallCanvas)
	var wall = wallCanvas.getContext('2d', { alpha: false })

	var actorCanvas = document.createElement('canvas')
	actorCanvas.id = 'builderActors'
	actorCanvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; display:block; z-index:150; pointer-events:none;'
	actorCanvas.width = W
	actorCanvas.height = H
	document.body.appendChild(actorCanvas)
	var act = actorCanvas.getContext('2d')

	var imgs = {}
	;['ch_both_open_green.png', 'ch_left_closed_green.png', 'ch_right_closed_green.png'].forEach(function (f) {
		var im = new Image()
		im.src = ledTestAssetUrl(f)
		imgs[f] = im
	})

	/* Bunny scales with the panel it carries, but never dwarfs (or vanishes from) the screen. */
	var bunnyH = Math.max(32, Math.min(cellH * 1.15, H * 0.4))
	var bunnyW = bunnyH * (512 / 666)
	var pace = ledBuilderPace(data.builderSpeed)
	var speed = Math.max(W * 0.45, cellW * 2.5) * pace
	var placeS = BUILDER_PLACE_S / pace
	var staggerS = 0.45 / pace
	var hopRate = 9 * Math.sqrt(pace)

	function cellRect(c, r) {
		var x0 = Math.round(c * cellW)
		var y0 = Math.round(r * cellH)
		return { x: x0, y: y0, w: Math.round((c + 1) * cellW) - x0, h: Math.round((r + 1) * cellH) - y0 }
	}

	/* Gray start = the default grid-white panel look (.panel gradient in led_grid_test.html). */
	function paintCell(c, r, color) {
		var b = cellRect(c, r)
		if (color) {
			wall.fillStyle = color
			wall.fillRect(b.x, b.y, b.w, b.h)
			return
		}
		var g = wall.createLinearGradient(0, b.y, 0, b.y + b.h)
		g.addColorStop(0, '#12141c')
		g.addColorStop(1, '#0c0e14')
		wall.fillStyle = g
		wall.fillRect(b.x, b.y, b.w, b.h)
		if ((r * cols + c) % 2 === 0) {
			wall.fillStyle = 'rgba(30, 32, 44, 0.35)'
			wall.fillRect(b.x, b.y, b.w, b.h)
		}
	}

	var order = ledBuilderOrder(cols, rows)
	var c0, r0
	for (r0 = 0; r0 < rows; r0++) for (c0 = 0; c0 < cols; c0++) paintCell(c0, r0, null)

	var phase = 0
	var nextIdx = 0
	var pauseLeft = 0
	var flashes = []
	var nWorkers = Math.max(1, Math.min(BUILDER_MAX_WORKERS, order.length, parseInt(data.charCount, 10) || 1))
	var workers = []
	for (var i = 0; i < nWorkers; i++) {
		workers.push({ state: 'idle', wait: i * staggerS, hop: Math.random() * 6, blinkIn: 2 + Math.random() * 5, blinkT: 0 })
	}

	function phaseColor() {
		return BUILDER_COLORS[phase % BUILDER_COLORS.length]
	}

	function claim(w) {
		if (nextIdx >= order.length) return false
		var cell = order[nextIdx++]
		var b = cellRect(cell.c, cell.r)
		w.cell = cell
		w.rect = b
		w.side = ledBuilderSide(cell.c, cell.r, cols)
		w.color = phaseColor()
		/* Panel's left edge; the bunny holds its trailing edge (left edge when coming from the left). */
		w.px = w.side < 0 ? -b.w - bunnyW : W + bunnyW
		w.state = 'in'
		return true
	}

	function bunnyX(w) {
		return w.side < 0 ? w.px : w.px + w.rect.w
	}

	function stepWorker(w, dt) {
		w.hop += dt * hopRate
		w.blinkIn -= dt
		if (w.blinkIn <= 0) {
			w.blinkT = 0.24
			w.blinkIn = 3 + Math.random() * 5
		}
		if (w.blinkT > 0) w.blinkT -= dt

		if (w.state === 'idle') {
			if (pauseLeft > 0) return
			w.wait -= dt
			if (w.wait > 0) return
			if (!claim(w)) w.state = 'done'
			return
		}
		if (w.state === 'in') {
			var tx = w.rect.x
			var step = speed * dt
			if (Math.abs(tx - w.px) <= step) {
				w.px = tx
				w.state = 'place'
				w.t = 0
			} else {
				w.px += w.side < 0 ? step : -step
			}
			return
		}
		if (w.state === 'place') {
			w.t += dt
			if (w.t >= placeS) {
				paintCell(w.cell.c, w.cell.r, w.color)
				flashes.push({ rect: w.rect, t: 0 })
				w.bx = bunnyX(w)
				w.state = 'out'
			}
			return
		}
		if (w.state === 'out') {
			var target = w.side < 0 ? -bunnyW : W + bunnyW
			var s2 = speed * 1.3 * dt
			if (Math.abs(target - w.bx) <= s2) {
				w.state = 'idle'
				w.wait = 0
			} else {
				w.bx += w.side < 0 ? -s2 : s2
			}
		}
	}

	function drawPanel(rect, x, y, color, lift) {
		var s = 1 + 0.05 * lift
		var w = rect.w * s
		var h = rect.h * s
		var px = x - (w - rect.w) / 2
		var py = y - (h - rect.h) / 2
		act.save()
		act.shadowColor = 'rgba(0, 0, 0, 0.6)'
		act.shadowBlur = 18 * lift
		act.shadowOffsetY = 8 * lift
		act.fillStyle = color
		act.fillRect(px, py, w, h)
		act.restore()
		act.strokeStyle = 'rgba(0, 0, 0, 0.55)'
		act.lineWidth = Math.max(1, Math.min(w, h) * 0.03)
		act.strokeRect(px, py, w, h)
	}

	function bunnyImg(w) {
		if (w.blinkT > 0.12) return imgs['ch_left_closed_green.png']
		if (w.blinkT > 0) return imgs['ch_right_closed_green.png']
		return imgs['ch_both_open_green.png']
	}

	function drawBunny(w, cx, cy, carrying) {
		var bob = Math.abs(Math.sin(w.hop)) * bunnyH * (carrying ? 0.06 : 0.12)
		var tilt = Math.sin(w.hop) * 0.09 + (carrying ? 0 : w.side * -0.05)
		var im = bunnyImg(w)
		act.save()
		act.translate(cx, cy - bob + bunnyH / 2)
		act.rotate(tilt)
		if (im.complete && im.naturalWidth > 0) {
			act.drawImage(im, -bunnyW / 2, -bunnyH, bunnyW, bunnyH)
		} else {
			act.fillStyle = '#111'
			act.fillRect(-bunnyW / 2, -bunnyH, bunnyW, bunnyH)
		}
		act.restore()
		return bob
	}

	function draw() {
		act.clearRect(0, 0, W, H)
		var j, f
		for (j = flashes.length - 1; j >= 0; j--) {
			f = flashes[j]
			act.fillStyle = 'rgba(255, 255, 255, ' + (0.3 * (1 - f.t / BUILDER_FLASH_S)).toFixed(3) + ')'
			act.fillRect(f.rect.x, f.rect.y, f.rect.w, f.rect.h)
		}
		for (j = 0; j < workers.length; j++) {
			var w = workers[j]
			if (w.state !== 'in' && w.state !== 'place') continue
			var settle = w.state === 'place' ? 1 - Math.min(1, w.t / placeS) : 1
			var bob = w.state === 'in' ? Math.abs(Math.sin(w.hop)) * bunnyH * 0.06 : 0
			drawPanel(w.rect, w.px, w.rect.y - bob - settle * cellH * 0.04, w.color, settle)
		}
		for (j = 0; j < workers.length; j++) {
			var wk = workers[j]
			var cy = wk.rect ? wk.rect.y + wk.rect.h / 2 : 0
			if (wk.state === 'in' || wk.state === 'place') drawBunny(wk, bunnyX(wk), cy, true)
			else if (wk.state === 'out') drawBunny(wk, wk.bx, cy, false)
		}
	}

	var last = performance.now()
	function tick(now) {
		var dt = Math.min(0.1, (now - last) / 1000)
		last = now
		if (pauseLeft > 0) pauseLeft -= dt
		for (var j = 0; j < workers.length; j++) stepWorker(workers[j], dt)
		for (j = flashes.length - 1; j >= 0; j--) {
			flashes[j].t += dt
			if (flashes[j].t >= BUILDER_FLASH_S) flashes.splice(j, 1)
		}
		/* Whole wall done in this colour → short pause, then the next colour. */
		var allDone = true
		for (j = 0; j < workers.length; j++) if (workers[j].state !== 'done') allDone = false
		if (allDone) {
			phase++
			nextIdx = 0
			pauseLeft = BUILDER_PHASE_PAUSE_S / pace
			for (j = 0; j < workers.length; j++) {
				workers[j].state = 'idle'
				workers[j].wait = j * staggerS
			}
		}
		draw()
		builderRaf = requestAnimationFrame(tick)
	}
	builderRaf = requestAnimationFrame(tick)
}

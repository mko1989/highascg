/**
 * Connection Eye Indicator — eye-only SVGs.
 * Green = Caspar AMCP TCP is connected. Red = AMCP down or `--no-caspar`.
 * Preshow/offline mode (`setOffline`) does not force green — use status line / tooltip for that.
 * Not the browser WebSocket to HighAsCG.
 * Blink: left closed → right closed → open (sequential).
 * For ~5s after AMCP connects, the green character uses random open / left / right frames at random
 * intervals (separate from the 30s blink), then normal blinking resumes.
 * Hover: panel with CPU load, GPU (nvidia-smi on server), media disk + folder usage.
 */
import { apiGet } from '../lib/api-client.js'

function formatBytes(n) {
	if (n == null || Number.isNaN(n)) return '—'
	const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
	let x = Number(n)
	let i = 0
	while (x >= 1024 && i < u.length - 1) {
		x /= 1024
		i++
	}
	const d = i === 0 ? 0 : x >= 100 ? 0 : x >= 10 ? 1 : 2
	return `${x.toFixed(d)} ${u[i]}`
}

function firstNonEmptyLine(s, max = 140) {
	if (!s) return null
	const line = s
		.split(/\r?\n/)
		.map((l) => l.trim())
		.find(Boolean)
	return line ? line.slice(0, max) : null
}

function buildTooltipText(data) {
	if (data?.mode === 'preshow') {
		return [
			data.message ||
				'Host stats are off in preshow (offline) mode. Use the CasparCG server for load, GPU, and disk.',
			'—',
			'Click for server logs',
		].join('\n')
	}

	const lines = []
	const cpu = data?.cpu
	if (cpu && cpu.cores) {
		const l1 = typeof cpu.load1 === 'number' ? cpu.load1.toFixed(2) : '?'
		lines.push(`CPU load (1m): ${l1} · ${cpu.cores} cores`)
	} else {
		lines.push('CPU: —')
	}

	const mem = data?.memory
	if (mem && mem.totalBytes) {
		lines.push(`RAM: ${formatBytes(mem.freeBytes)} free / ${formatBytes(mem.totalBytes)} total`)
	} else {
		lines.push('RAM: —')
	}

	const gpu = data?.gpu
	const glFallback = data?.caspar?.glInfo
	const gpuLine =
		(typeof gpu?.text === 'string' && gpu.text.trim()) ||
		firstNonEmptyLine(glFallback) ||
		(typeof gpu?.utilizationPct === 'number' ? `${gpu.utilizationPct}%` : null)
	lines.push(`GPU: ${gpuLine || '—'}`)

	const m = data?.media
	if (m?.disk) {
		const d = m.disk
		lines.push(
			`Media volume: ${formatBytes(d.usedBytes)} used · ${formatBytes(d.freeBytes)} free (${formatBytes(d.totalBytes)} total)`,
		)
	} else {
		lines.push('Media volume: —')
	}
	if (m?.folderUsedBytes != null) {
		lines.push(`Media folder: ${formatBytes(m.folderUsedBytes)} (${m.path || ''})`)
	} else if (data?.mode === 'production' && m?.path && m?.folderScanEnabled === false) {
		lines.push('Media folder size: off (enable on server if needed)')
	}

	lines.push('—')
	lines.push('Click for server logs')
	return lines.join('\n')
}

export function createConnectionEye(container) {
	if (!container) return null

	const wrap = document.createElement('div')
	wrap.className = 'connection-eye-wrap'

	const el = document.createElement('div')
	el.className = 'connection-eye'
	el.title = ''
	el.setAttribute('role', 'img')
	el.setAttribute('aria-label', 'Caspar AMCP connection status')

	const img = document.createElement('img')
	img.className = 'connection-eye__img'
	img.alt = ''
	img.decoding = 'async'
	img.width = 120
	img.height = 44
	el.appendChild(img)

	const tip = document.createElement('div')
	tip.className = 'connection-eye-tooltip'
	tip.hidden = true
	tip.setAttribute('role', 'tooltip')

	wrap.appendChild(el)
	wrap.appendChild(tip)
	container.appendChild(wrap)

	let isConnected = false
	let wasConnected = false
	let isOffline = false
	let blinkInterval = null
	let lastFetch = 0
	/** @type {'open' | 'left' | 'right' | null} */
	let celebrationEye = null
	let connectionCelebrationUntil = 0
	/** @type {ReturnType<typeof setTimeout> | null} */
	let celebrationTimer = null
	const BLINK_PHASE_MS = 250
	const FETCH_MIN_MS = 2500
	const CONNECTION_CELEBRATION_MS = 5000
	/** Random interval between random eye frames (moderate pace). */
	const CELEBRATION_DELAY_MIN_MS = 280
	const CELEBRATION_DELAY_MAX_MS = 780

	const ASSETS = {
		greenOpen: 'assets/both_open_green.svg',
		greenLeft: 'assets/left_closed_green.svg',
		greenRight: 'assets/right_closed_green.svg',
		redOpen: 'assets/red_eyes_open.svg',
		redLeft: 'assets/red_left_closed.svg',
		redRight: 'assets/red_right_closed.svg',
	}

	function inConnectionCelebration() {
		return isConnected && celebrationEye != null && Date.now() < connectionCelebrationUntil
	}

	function stopConnectionCelebration() {
		connectionCelebrationUntil = 0
		celebrationEye = null
		if (celebrationTimer) {
			clearTimeout(celebrationTimer)
			celebrationTimer = null
		}
	}

	function scheduleNextCelebrationFrame() {
		if (!isConnected || Date.now() >= connectionCelebrationUntil) {
			stopConnectionCelebration()
			updateImgSrc()
			return
		}
		const choices = /** @type {const} */ (['open', 'left', 'right'])
		celebrationEye = choices[Math.floor(Math.random() * choices.length)]
		updateImgSrc()
		const delay =
			CELEBRATION_DELAY_MIN_MS +
			Math.random() * (CELEBRATION_DELAY_MAX_MS - CELEBRATION_DELAY_MIN_MS)
		celebrationTimer = setTimeout(scheduleNextCelebrationFrame, delay)
	}

	/** First ~5s after connect: random green frame (open / left / right) at random intervals. */
	function startConnectionCelebration() {
		stopConnectionCelebration()
		connectionCelebrationUntil = Date.now() + CONNECTION_CELEBRATION_MS
		el.classList.remove('blink-l', 'blink-r')
		scheduleNextCelebrationFrame()
	}

	function resolveSrc() {
		const blinkL = el.classList.contains('blink-l')
		const blinkR = el.classList.contains('blink-r')

		if (isConnected) {
			if (inConnectionCelebration() && celebrationEye) {
				if (celebrationEye === 'left') return ASSETS.greenLeft
				if (celebrationEye === 'right') return ASSETS.greenRight
				return ASSETS.greenOpen
			}
			if (blinkL) return ASSETS.greenLeft
			if (blinkR) return ASSETS.greenRight
			return ASSETS.greenOpen
		}
		if (blinkL) return ASSETS.redLeft
		if (blinkR) return ASSETS.redRight
		return ASSETS.redOpen
	}

	function updateImgSrc() {
		const next = resolveSrc()
		if (img.getAttribute('src') !== next) img.setAttribute('src', next)
	}

	function triggerBlink() {
		if (inConnectionCelebration()) return
		if (el.classList.contains('blink-l') || el.classList.contains('blink-r')) return

		el.classList.add('blink-l')
		updateImgSrc()

		setTimeout(() => {
			el.classList.remove('blink-l')
			el.classList.add('blink-r')
			updateImgSrc()

			setTimeout(() => {
				el.classList.remove('blink-r')
				updateImgSrc()
			}, BLINK_PHASE_MS)
		}, BLINK_PHASE_MS)
	}

	/** Fixed position so the header layout does not shift; clamped to the viewport. */
	function positionTooltip() {
		if (tip.hidden) return
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				const rect = wrap.getBoundingClientRect()
				const margin = 8
				const tw = tip.offsetWidth || 280
				const th = tip.offsetHeight || 120
				// Right-align with the eye so the panel does not extend left over the headphones / PGM timer.
				let left = rect.right - tw
				left = Math.max(margin, Math.min(left, window.innerWidth - tw - margin))
				let top = rect.bottom + margin
				if (top + th > window.innerHeight - margin) {
					top = rect.top - th - margin
				}
				top = Math.max(margin, Math.min(top, window.innerHeight - th - margin))
				tip.style.position = 'fixed'
				tip.style.left = `${Math.round(left)}px`
				tip.style.top = `${Math.round(top)}px`
				tip.style.transform = 'none'
				tip.style.zIndex = '20000'
			})
		})
	}

	async function loadHostStats() {
		const now = Date.now()
		if (
			now - lastFetch < FETCH_MIN_MS &&
			tip.textContent &&
			tip.textContent !== 'Loading…' &&
			!tip.hidden
		) {
			return
		}
		lastFetch = now
		tip.textContent = 'Loading…'
		positionTooltip()
		try {
			const data = await apiGet('/api/host-stats')
			tip.textContent = buildTooltipText(data)
		} catch (e) {
			tip.textContent = `Stats unavailable\n${e?.message || String(e)}`
		}
		positionTooltip()
	}

	function onWinResize() {
		if (!tip.hidden) positionTooltip()
	}
	window.addEventListener('resize', onWinResize)

	wrap.addEventListener('mouseenter', () => {
		tip.hidden = false
		tip.textContent = 'Loading…'
		positionTooltip()
		void loadHostStats()
	})

	wrap.addEventListener('mouseleave', () => {
		tip.hidden = true
		tip.style.position = ''
		tip.style.left = ''
		tip.style.top = ''
		tip.style.transform = ''
	})

	function setConnected(status) {
		const nowOn = !!status
		if (!nowOn) {
			stopConnectionCelebration()
			wasConnected = false
			isConnected = false
			updateClasses()
			return
		}
		const becameConnected = !wasConnected
		wasConnected = true
		isConnected = true
		if (becameConnected) {
			startConnectionCelebration()
		}
		updateClasses()
	}

	function setOffline(offline) {
		isOffline = !!offline
		updateClasses()
	}

	function updateClasses() {
		el.classList.toggle('connected', isConnected)
		el.classList.toggle('disconnected', !isConnected)
		el.classList.toggle('offline', isOffline)
		updateImgSrc()
	}

	blinkInterval = setInterval(triggerBlink, 30000)

	setConnected(false)

	return {
		el: wrap,
		setConnected,
		setOffline,
		triggerBlink,
		destroy() {
			stopConnectionCelebration()
			if (blinkInterval) clearInterval(blinkInterval)
			window.removeEventListener('resize', onWinResize)
			wrap.remove()
		},
	}
}

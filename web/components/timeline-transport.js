/**
 * Timeline editor — transport bar UI, seek/play/stop, timecode, send-to, take.
 */

import { timelineState } from '../lib/timeline-state.js'
import { TRANSITION_TYPES, TRANSITION_TWEENS } from '../lib/dashboard-state.js'
import { api } from '../lib/api-client.js'
import { fmtSmpte, parseTcInput } from './timeline-canvas.js'
import { parseNumberInput } from '../lib/math-input.js'

/**
 * @param {object} deps
 * @param {HTMLElement} deps.transportEl
 * @param {import('../lib/state-store.js').StateStore} deps.stateStore
 * @param {object} deps.playback - mutated in place
 * @param {object} deps.view
 * @param {ReturnType<import('./timeline-canvas.js').initTimelineCanvas>} deps.canvas
 * @param {() => void} deps.redrawTimelineView
 * @param {() => void} deps.stopPlaybackLoop
 * @param {() => void} deps.startPlaybackLoop
 * @param {(n: number) => void} deps.setServerTick
 */
export function createTimelineTransport(deps) {
	const {
		transportEl,
		stateStore,
		playback,
		view,
		canvas,
		redrawTimelineView,
		stopPlaybackLoop,
		startPlaybackLoop,
		setServerTick,
	} = deps

	async function syncToServer(tl) {
		if (!tl) return
		try {
			await api.put(`/api/timelines/${tl.id}`, tl)
		} catch {
			try {
				await api.post('/api/timelines', tl)
			} catch {}
		}
	}

	async function updateSendTo() {
		const tl = timelineState.getActive()
		if (!tl) return
		await api.post(`/api/timelines/${tl.id}/sendto`, view.sendTo).catch(() => {})
	}

	function updateTimecode() {
		const tl = timelineState.getActive()
		const fps = tl?.fps || 25
		const tcCur = document.getElementById('tl-tc-cur')
		const tcTot = document.getElementById('tl-tc-tot')
		if (tcCur && !tcCur.matches(':focus')) tcCur.value = fmtSmpte(playback.position, fps)
		if (tcTot && !tcTot.matches(':focus')) tcTot.value = fmtSmpte(tl?.duration ?? 0, fps)
	}

	async function doSeek(ms) {
		const tl = timelineState.getActive()
		if (!tl) return
		playback.position = ms
		canvas.setPlayheadPosition(ms)
		updateTimecode()
		redrawTimelineView()
		await api.post(`/api/timelines/${tl.id}/seek`, { ms }).catch(() => {})
	}

	async function doSeekToStart() {
		await doSeek(0)
	}

	async function doSeekToEnd() {
		const tl = timelineState.getActive()
		if (tl) await doSeek(tl.duration)
	}

	async function togglePlay() {
		const tl = timelineState.getActive()
		if (!tl) return
		if (playback.playing) {
			playback.playing = false
			stopPlaybackLoop()
			buildTransport()
			redrawTimelineView()
			await api.post(`/api/timelines/${tl.id}/pause`).catch(() => {})
		} else {
			await syncToServer(tl)
			await api.post(`/api/timelines/${tl.id}/sendto`, view.sendTo).catch(() => {})
			setServerTick(playback.position)
			playback.playing = true
			playback.timelineId = tl.id
			buildTransport()
			startPlaybackLoop()
			redrawTimelineView()
			await api.post(`/api/timelines/${tl.id}/play`, { from: playback.position, sendTo: view.sendTo }).catch(() => {})
		}
	}

	async function doStop() {
		const tl = timelineState.getActive()
		if (!tl) return
		playback.playing = false
		stopPlaybackLoop()
		playback.position = 0
		canvas.setPlayheadPosition(0)
		buildTransport()
		redrawTimelineView()
		await api.post(`/api/timelines/${tl.id}/stop`).catch(() => {})
	}

	function buildTransport() {
		const tl = timelineState.getActive()
		const fps = tl?.fps || 25
		const tlSelector = timelineState.timelines.map((t) =>
			`<option value="${t.id}" ${t.id === timelineState.activeId ? 'selected' : ''}>${t.name}</option>`
		).join('')

		const state = stateStore.getState()
		const screenCount = state?.channelMap?.screenCount || 1
		const screenOpts = Array.from({ length: screenCount }, (_, i) =>
			`<option value="${i}" ${view.sendTo.screenIdx === i ? 'selected' : ''}>Screen ${i + 1}</option>`
		).join('')

		transportEl.innerHTML = `
			<div class="tl-tb">
				<div class="tl-tb-group">
					<select class="tl-select" id="tl-select">${tlSelector}</select>
					<button class="tl-btn" id="tl-new-tl" title="New timeline">+</button>
				</div>
				<div class="tl-tb-group tl-tb-transport">
					<button class="tl-btn" id="tl-to-start" title="To start">⏮</button>
					<button class="tl-btn tl-btn-play ${playback.playing ? 'active' : ''}" id="tl-play">
						${playback.playing ? '⏸' : '▶'}
					</button>
					<button class="tl-btn" id="tl-stop" title="Stop">⏹</button>
					<button class="tl-btn" id="tl-to-end" title="To end">⏭</button>
					<button class="tl-btn ${playback.loop ? 'active' : ''}" id="tl-loop" title="Loop">⟳</button>
				</div>
				<div class="tl-tb-group tl-timecode-group">
					<input type="text" class="tl-timecode tl-timecode-input" id="tl-tc-cur" value="${fmtSmpte(playback.position, fps)}" title="Current time (Enter to focus). ++500 / --500 for jump" />
					<span class="tl-timecode-sep">/</span>
					<input type="text" class="tl-timecode tl-timecode-input" id="tl-tc-tot" value="${fmtSmpte(tl?.duration ?? 0, fps)}" title="Total duration" />
				</div>
				<div class="tl-tb-group">
					<button class="tl-btn" id="tl-trim" title="Trim duration to last clip">Trim</button>
					<button class="tl-btn" id="tl-add-flag" title="Add timeline flag at playhead (pause / play / jump)">Flag</button>
					<button class="tl-btn" id="tl-zm" title="Zoom out">−</button>
					<button class="tl-btn" id="tl-zf" title="Fit to view">Fit</button>
					<button class="tl-btn" id="tl-zp" title="Zoom in">+</button>
				</div>
				<div class="tl-tb-group tl-tb-dest">
					<span class="tl-tb-label">Dest:</span>
					<select class="tl-select tl-select-sm" id="tl-screen">${screenOpts}</select>
					<label class="tl-chk"><input type="checkbox" id="tl-s-prev" ${view.sendTo.preview ? 'checked' : ''}> PRV</label>
					<label class="tl-chk"><input type="checkbox" id="tl-s-pgm" ${view.sendTo.program ? 'checked' : ''}> PGM</label>
				</div>
				<div class="tl-tb-group tl-tb-take">
					<select class="tl-select tl-select-sm" id="tl-take-trans" title="Take transition">
						${TRANSITION_TYPES.map((t) => `<option value="${t}" ${t === view.takeTransition.type ? 'selected' : ''}>${t}</option>`).join('')}
					</select>
					<input type="text" class="tl-input-sm inspector-math-input" id="tl-take-dur" value="${view.takeTransition.duration}" inputmode="decimal" title="Frames (supports e.g. 24/2)" placeholder="12" />
					<select class="tl-select tl-select-sm" id="tl-take-tween" title="Tween">${TRANSITION_TWEENS.map((tw) => `<option value="${tw}" ${tw === view.takeTransition.tween ? 'selected' : ''}>${tw}</option>`).join('')}</select>
					<button class="tl-btn tl-btn-take" id="tl-take" title="Take to program">Take</button>
				</div>
				<div class="tl-tb-group">
					<button class="tl-btn ${view.follow ? 'active' : ''}" id="tl-follow" title="Follow playhead">Follow</button>
				</div>
			</div>
		`

		transportEl.querySelector('#tl-select')?.addEventListener('change', (e) => {
			timelineState.setActive(e.target.value)
			canvas.zoomFit()
			redrawTimelineView()
		})
		transportEl.querySelector('#tl-new-tl')?.addEventListener('click', () => {
			timelineState.createTimeline({ name: `Timeline ${timelineState.timelines.length + 1}` })
			buildTransport()
			canvas.zoomFit()
		})
		transportEl.querySelector('#tl-to-start')?.addEventListener('click', doSeekToStart)
		transportEl.querySelector('#tl-to-end')?.addEventListener('click', doSeekToEnd)
		transportEl.querySelector('#tl-play')?.addEventListener('click', togglePlay)
		transportEl.querySelector('#tl-stop')?.addEventListener('click', doStop)
		transportEl.querySelector('#tl-loop')?.addEventListener('click', async () => {
			playback.loop = !playback.loop
			buildTransport()
			const t = timelineState.getActive()
			if (t) await api.post(`/api/timelines/${t.id}/loop`, { loop: playback.loop }).catch(() => {})
		})
		transportEl.querySelector('#tl-add-flag')?.addEventListener('click', () => {
			const t = timelineState.getActive()
			if (!t) return
			timelineState.addFlag(t.id, { timeMs: Math.round(playback.position), type: 'pause' })
			syncToServer(timelineState.getActive())
			redrawTimelineView()
		})
		transportEl.querySelector('#tl-trim')?.addEventListener('click', () => {
			const t = timelineState.getActive()
			if (!t) return
			let lastEnd = 0
			for (const layer of t.layers) {
				for (const clip of (layer.clips || [])) {
					const end = clip.startTime + clip.duration
					if (end > lastEnd) lastEnd = end
				}
			}
			if (lastEnd > 0) {
				timelineState.updateTimeline(t.id, { duration: lastEnd })
				syncToServer(timelineState.getActive())
				buildTransport()
				redrawTimelineView()
			}
		})
		transportEl.querySelector('#tl-zm')?.addEventListener('click', () => canvas.zoom(-1))
		transportEl.querySelector('#tl-zp')?.addEventListener('click', () => canvas.zoom(1))
		transportEl.querySelector('#tl-zf')?.addEventListener('click', () => canvas.zoomFit())
		transportEl.querySelector('#tl-follow')?.addEventListener('click', () => { view.follow = !view.follow; buildTransport() })
		transportEl.querySelector('#tl-screen')?.addEventListener('change', (e) => {
			view.sendTo.screenIdx = parseInt(e.target.value, 10)
			updateSendTo()
			redrawTimelineView()
		})
		transportEl.querySelector('#tl-s-prev')?.addEventListener('change', (e) => { view.sendTo.preview = e.target.checked; updateSendTo() })
		transportEl.querySelector('#tl-s-pgm')?.addEventListener('change', (e) => { view.sendTo.program = e.target.checked; updateSendTo() })
		transportEl.querySelector('#tl-take-trans')?.addEventListener('change', (e) => { view.takeTransition.type = e.target.value })
		transportEl.querySelector('#tl-take-dur')?.addEventListener('change', (e) => {
			view.takeTransition.duration = Math.max(0, Math.min(120, Math.round(parseNumberInput(e.target.value, 0))))
		})
		transportEl.querySelector('#tl-take-tween')?.addEventListener('change', (e) => { view.takeTransition.tween = e.target.value })
		transportEl.querySelector('#tl-take')?.addEventListener('click', async () => {
			const t = timelineState.getActive()
			if (t) {
				const trans = view.takeTransition || {}
				await api.post(`/api/timelines/${t.id}/take`, {
					transition: trans.type || 'CUT',
					duration: trans.duration ?? 12,
					tween: trans.tween || 'linear',
					screenIdx: view.sendTo.screenIdx ?? 0,
				}).catch(() => {})
			}
		})

		const tcCur = transportEl.querySelector('#tl-tc-cur')
		const tcTot = transportEl.querySelector('#tl-tc-tot')
		if (tcCur) {
			const onCurCommit = () => {
				const t = timelineState.getActive()
				if (!t) return
				const f = t.fps || 25
				const ms = parseTcInput(tcCur.value, playback.position, t.duration, f)
				if (ms != null) {
					void doSeek(ms)
					tcCur.value = fmtSmpte(playback.position, f)
				} else {
					tcCur.value = fmtSmpte(playback.position, f)
				}
			}
			tcCur.addEventListener('change', onCurCommit)
			tcCur.addEventListener('blur', onCurCommit)
			tcCur.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') { tcCur.blur(); e.preventDefault() }
			})
		}
		if (tcTot) {
			const onTotCommit = () => {
				const t = timelineState.getActive()
				if (!t) return
				const f = t.fps || 25
				const ms = parseTcInput(tcTot.value, 0, null, f)
				if (ms != null && ms >= 1000) {
					timelineState.updateTimeline(t.id, { duration: ms })
					syncToServer(timelineState.getActive())
					tcTot.value = fmtSmpte(ms, f)
					redrawTimelineView()
				} else {
					tcTot.value = fmtSmpte(t.duration, f)
				}
			}
			tcTot.addEventListener('change', onTotCommit)
			tcTot.addEventListener('blur', onTotCommit)
			tcTot.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') { tcTot.blur(); e.preventDefault() }
			})
		}
	}

	return {
		buildTransport,
		updateTimecode,
		doSeek,
		syncToServer,
		updateSendTo,
		togglePlay,
		doStop,
	}
}

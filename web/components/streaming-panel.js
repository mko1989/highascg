/**
 * Workspace tab: RTMP + record on dedicated Caspar streaming channel (WO-27).
 */

import { api } from '../lib/api-client.js'

let mounted = false
let pollTimer = null

function stopPoll() {
	if (pollTimer) {
		clearInterval(pollTimer)
		pollTimer = null
	}
}

async function refreshStatus(root) {
	const stEl = root.querySelector('#streaming-ch-status')
	const metaEl = root.querySelector('#streaming-ch-meta')
	try {
		const st = await api.get('/api/streaming-channel')
		if (!st.enabled) {
			if (stEl) {
				stEl.textContent =
					'Streaming is disabled. Enable it under Settings → Caspar → Streaming, then Write & restart Caspar if the generator changed.'
			}
			if (metaEl) metaEl.textContent = ''
			root.querySelectorAll('button, input, select').forEach((el) => {
				if (el.id === 'streaming-ch-refresh-status') return
				if (el.closest('#streaming-ch-actions')) el.disabled = true
			})
			return
		}
		root.querySelectorAll('#streaming-ch-actions button, #streaming-ch-actions input, #streaming-ch-actions select').forEach((el) => {
			el.disabled = false
		})
		const parts = []
		if (st.channel != null) parts.push(`Caspar ch ${st.channel}`)
		if (st.route) {
			parts.push(`video ${st.route}`)
			if (st.audioRoute && st.audioRoute !== st.route) {
				parts.push(`audio ${st.audioRoute} (see Settings when split)`)
			} else {
				parts.push(`audio ${st.route}`)
			}
		}
		if (st.splitAvRouted) {
			parts.push('split A/V layers (L−1 + L) — test levels on hardware')
		}
		if (metaEl) metaEl.textContent = parts.join(' · ')
		const rtmpOn = st.rtmp?.active
		const recOn = st.record?.active
		if (stEl) {
			stEl.textContent = `RTMP: ${rtmpOn ? 'live' : 'off'} · Record: ${recOn ? 'recording' : 'off'}`
		}
		const rtmpStop = root.querySelector('#streaming-ch-rtmp-stop')
		const rtmpStart = root.querySelector('#streaming-ch-rtmp-start')
		if (rtmpStop) rtmpStop.disabled = !rtmpOn
		if (rtmpStart) rtmpStart.disabled = rtmpOn
		const recStop = root.querySelector('#streaming-ch-rec-stop')
		const recStart = root.querySelector('#streaming-ch-rec-start')
		if (recStop) recStop.disabled = !recOn
		if (recStart) recStart.disabled = recOn
	} catch (e) {
		if (stEl) stEl.textContent = e?.message || String(e)
	}
}

export function initStreamingPanel(root) {
	if (!root || mounted) return
	mounted = true
	root.innerHTML = `
		<div class="streaming-panel">
			<h2 class="streaming-panel__title">Streaming</h2>
			<p class="streaming-panel__hint" id="streaming-ch-meta"></p>
			<p class="streaming-panel__status" id="streaming-ch-status"></p>
			<div class="streaming-panel__grid" id="streaming-ch-actions">
				<section class="streaming-panel__card">
					<h3>RTMP (YouTube, etc.)</h3>
					<label>Server URL</label>
					<input type="text" id="streaming-ch-rtmp-server" placeholder="rtmp://a.rtmp.youtube.com/live2" autocomplete="off" />
					<label>Stream key</label>
					<input type="text" id="streaming-ch-rtmp-key" placeholder="Paste stream key" autocomplete="off" autocapitalize="off" spellcheck="false" />
					<label>Quality</label>
					<select id="streaming-ch-rtmp-quality">
						<option value="low">Low</option>
						<option value="medium" selected>Medium</option>
						<option value="high">High</option>
					</select>
					<div class="streaming-panel__btns">
						<button type="button" class="btn btn--primary" id="streaming-ch-rtmp-start">Start RTMP</button>
						<button type="button" class="btn btn--secondary" id="streaming-ch-rtmp-stop" disabled>Stop RTMP</button>
					</div>
				</section>
				<section class="streaming-panel__card">
					<h3>Local record (MP4)</h3>
					<p class="settings-note">Writes into the Caspar media folder (same as program record).</p>
					<label>CRF (18–51)</label>
					<input type="number" id="streaming-ch-rec-crf" min="18" max="51" value="26" />
					<div class="streaming-panel__btns">
						<button type="button" class="btn btn--primary" id="streaming-ch-rec-start">Start record</button>
						<button type="button" class="btn btn--secondary" id="streaming-ch-rec-stop" disabled>Stop record</button>
					</div>
				</section>
			</div>
			<p class="streaming-panel__foot settings-note">Runtime controls use AMCP on the dedicated channel. Encoder errors appear in Caspar logs.</p>
		</div>
	`

	root.querySelector('#streaming-ch-rtmp-start')?.addEventListener('click', async () => {
		const server = root.querySelector('#streaming-ch-rtmp-server')?.value?.trim() || ''
		const key = root.querySelector('#streaming-ch-rtmp-key')?.value?.trim() || ''
		const quality = root.querySelector('#streaming-ch-rtmp-quality')?.value || 'medium'
		try {
			await api.post('/api/streaming-channel/rtmp', { action: 'start', rtmpServerUrl: server, streamKey: key, quality })
			await refreshStatus(root)
		} catch (e) {
			alert(e?.message || String(e))
		}
	})
	root.querySelector('#streaming-ch-rtmp-stop')?.addEventListener('click', async () => {
		try {
			await api.post('/api/streaming-channel/rtmp', { action: 'stop' })
			await refreshStatus(root)
		} catch (e) {
			alert(e?.message || String(e))
		}
	})
	root.querySelector('#streaming-ch-rec-start')?.addEventListener('click', async () => {
		const crf = parseInt(String(root.querySelector('#streaming-ch-rec-crf')?.value || '26'), 10)
		try {
			await api.post('/api/streaming-channel/record', { action: 'start', crf })
			await refreshStatus(root)
			try {
				window.dispatchEvent(new CustomEvent('highascg-streaming-record-done'))
			} catch {
				/* ignore */
			}
		} catch (e) {
			alert(e?.message || String(e))
		}
	})
	root.querySelector('#streaming-ch-rec-stop')?.addEventListener('click', async () => {
		try {
			await api.post('/api/streaming-channel/record', { action: 'stop' })
			await refreshStatus(root)
			try {
				window.dispatchEvent(new CustomEvent('highascg-streaming-record-done'))
			} catch {
				/* ignore */
			}
		} catch (e) {
			alert(e?.message || String(e))
		}
	})

	void refreshStatus(root)
	stopPoll()
	pollTimer = setInterval(() => void refreshStatus(root), 4000)
}

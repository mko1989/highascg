/* WO-734 — the show-timers strip of the served pages. Fills <div id="show-timers"> from /api/show-timers: the
 * presentation clock with slide n / total, the video playing inside the presentation, and each screen's main video
 * (looped clips are never timed). Nothing to time = nothing shown. */
/* global document */
;(function () {
	const box = document.getElementById('show-timers')
	if (!box) return
	const style = document.createElement('style')
	style.textContent =
		'#show-timers{display:grid;gap:6px;margin:0 0 12px}#show-timers:empty{display:none}' +
		'#show-timers .t{display:flex;align-items:baseline;gap:10px;padding:8px 12px;border:1px solid var(--line,#30363d);border-radius:6px;background:#161b22}' +
		'#show-timers .l{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dim,#8b949e);font-size:14px}' +
		'#show-timers .a{color:var(--dim,#8b949e);font-size:14px;font-variant-numeric:tabular-nums}' +
		'#show-timers .v{font-size:28px;font-weight:600;font-variant-numeric:tabular-nums}' +
		'#show-timers .sub{margin-left:18px}#show-timers .err{color:var(--dim,#8b949e);font-size:13px}'
	document.head.appendChild(style)

	const clock = (s) => {
		s = Math.max(0, Math.floor(s || 0))
		const h = Math.floor(s / 3600)
		const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')
		return (h ? h + ':' : '') + mm + ':' + String(s % 60).padStart(2, '0')
	}
	const row = (label, value, aux, cls) => {
		const d = document.createElement('div')
		d.className = 't' + (cls ? ' ' + cls : '')
		for (const [c, text] of [['l', label], ['a', aux], ['v', value]]) {
			const e = document.createElement('span')
			e.className = c
			e.textContent = text || ''
			d.appendChild(e)
		}
		return d
	}

	function render(t) {
		const rows = []
		for (const p of t.presentations || []) {
			const slide = p.slide != null ? 'slide ' + p.slide + (p.slides ? ' / ' + p.slides : '') : ''
			rows.push(row(p.name || p.source, clock(p.elapsed_s), slide))
			const v = p.video
			if (v) rows.push(row('Video in presentation', '−' + clock(v.remaining_s), (v.paused ? 'paused · ' : '') + clock(v.elapsed_s) + ' / ' + clock(v.duration_s), 'sub'))
		}
		for (const v of t.videos || []) {
			rows.push(row(v.screen + ' · ' + v.label, '−' + clock(v.remaining_s), (v.paused ? 'paused · ' : '') + clock(v.elapsed_s) + ' / ' + clock(v.duration_s)))
		}
		if (!rows.length && t.companion && t.companion.error) {
			const e = document.createElement('div')
			e.className = 'err'
			e.textContent = 'Presentation timer: ' + t.companion.error
			rows.push(e)
		}
		box.replaceChildren(...rows)
	}

	async function poll() {
		try {
			const r = await fetch('/api/show-timers', { cache: 'no-store' })
			if (r.ok) render(await r.json())
		} catch {
			/* server restarting: keep the last timers until it answers */
		}
		setTimeout(poll, 500)
	}
	poll()
})()

/**
 * Header bar config comparison strip.
 */

export function initConfigStrip(headerEl, serverBtn) {
	const strip = document.createElement('div')
	strip.className = 'server-config-strip'
	strip.hidden = true
	strip.innerHTML = `
		<div class="server-config-strip__summary"></div>
		<table class="server-config-strip__table"><thead><tr><th>#</th><th>Module expects</th><th>Server</th></tr></thead><tbody></tbody></table>
		<ul class="server-config-strip__issues"></ul>
		<p class="server-config-strip__hint"></p>
	`
	if (headerEl.parentNode) headerEl.parentNode.insertBefore(strip, headerEl.nextSibling)

	const sumEl = strip.querySelector('.server-config-strip__summary')
	const tbody = strip.querySelector('.server-config-strip__table tbody')
	const issuesEl = strip.querySelector('.server-config-strip__issues')
	const hintEl = strip.querySelector('.server-config-strip__hint')

	function renderConfigComparison(c) {
		if (!c || !sumEl) return
		const phys = c.serverPhysicalScreens || []
		const physIdx = phys.map((s) => s.index).join(', ')
		const physLine =
			phys.length > 0
				? ` Caspar screen outputs: ${phys.length} (ch ${physIdx}). App screens: ${c.moduleScreenCount ?? '—'}.`
				: ''
		const screenWarn = c.screensCountMismatch ? ' Screen count differs from app — check multiview or extra screen consumers.' : ''
		if (c.aligned) {
			sumEl.textContent = `Server config matches module settings (${c.serverChannelCount} channels).${physLine}`
			sumEl.className = 'server-config-strip__summary server-config-strip__summary--ok'
		} else if (!c.serverChannelCount) {
			sumEl.textContent = 'Connect to CasparCG or wait for INFO CONFIG to compare channel layout.'
			sumEl.className = 'server-config-strip__summary server-config-strip__summary--warn'
		} else {
			sumEl.textContent = `Mismatch: server has ${c.serverChannelCount} channel(s), module expects ${c.moduleChannelCount}.${physLine}${screenWarn}`
			sumEl.className = 'server-config-strip__summary server-config-strip__summary--warn'
		}
		tbody.innerHTML = ''
		const rows = Math.max(c.serverChannels?.length || 0, c.moduleChannels?.length || 0)
		for (let i = 0; i < rows; i++) {
			const s = c.serverChannels?.[i]
			const m = c.moduleChannels?.[i]
			const tr = document.createElement('tr')
			tr.innerHTML = `<td>${s?.index ?? m?.index ?? i + 1}</td><td>${m ? `${m.role}: ${m.videoMode || '—'}` : '—'}</td><td>${s ? `${s.videoMode || '—'}${s.hasScreen ? ' (screen)' : ''}` : '—'}</td>`
			tbody.appendChild(tr)
		}
		issuesEl.innerHTML = ''
		;(c.issues || []).forEach((msg) => {
			const li = document.createElement('li')
			li.textContent = msg
			issuesEl.appendChild(li)
		})
		hintEl.textContent = c.hint || ''
	}

	serverBtn.addEventListener('click', () => {
		strip.hidden = !strip.hidden
		serverBtn.textContent = strip.hidden ? 'Server ▾' : 'Server ▴'
	})

	return { renderConfigComparison }
}

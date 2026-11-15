/**
 * Join form + lobby panel of Stage Skirmish (WO-1081 §9): name and colour (remembered under `skgame.`), a full-screen
 * button; then the roster (team colours in `tdm`), the mode and arena, and "Warm up" — hide the panel and run / shoot
 * around while the host gets ready (nothing is scored in the lobby). "Change name / colour" goes back to the form.
 */
import { h, setText, show, storeGet, storeSet, COLORS, safeColor } from './dom.js'
import { sanitizeName, MAX_NAME } from './protocol.js'
import { fullscreenButton } from './kit/fullscreen.js'
import { TEAM_COLORS, TEAM_NAMES } from './sk-const.js'

export function createLobby(root, { onJoin, onRejoin, onWatch }) {
	root.textContent = ''
	let color = safeColor(storeGet('color'), COLORS[Math.floor(Math.random() * COLORS.length)])

	const nameIn = h('input.name-in', {
		type: 'text',
		maxlength: String(MAX_NAME),
		autocomplete: 'nickname',
		autocapitalize: 'words',
		spellcheck: 'false',
		placeholder: 'Your name',
		'aria-label': 'Your name',
		enterkeyhint: 'go',
	})
	nameIn.value = storeGet('name', '') || ''
	const swatches = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Soldier colour' })
	const paintSwatches = () => {
		swatches.textContent = ''
		for (const c of COLORS) {
			const b = h('button.swatch-btn', { type: 'button', role: 'radio', 'aria-checked': String(c === color), 'aria-label': c })
			b.style.background = c
			b.addEventListener('click', () => {
				color = c
				paintSwatches()
			})
			swatches.append(b)
		}
	}
	paintSwatches()
	const joinBtn = h('button.big', { type: 'button', text: 'Join the skirmish' })
	const doJoin = () => {
		const name = sanitizeName(nameIn.value)
		storeSet('name', name)
		storeSet('color', color)
		nameIn.blur()
		onJoin(name, color)
	}
	joinBtn.addEventListener('click', doJoin)
	nameIn.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') doJoin()
	})
	const watchBtn = h('button.ghost', { type: 'button', text: 'Just watch' })
	watchBtn.addEventListener('click', () => onWatch?.())
	const joinInfo = h('p.hint')
	const joinPanel = h(
		'div.panel.join',
		h('div.panel-head', h('h1', { text: 'Stage Skirmish' }), fullscreenButton('ghost sq')),
		h(
			'div.cols',
			h('div.col', h('label', { text: 'Name' }), nameIn, h('label', { text: 'Colour' }), swatches, h('div.actions', joinBtn, watchBtn)),
			h(
				'div.col.sk-howto',
				h('h2', { text: 'How to play' }),
				h('p.hint', { text: 'Keyboard: WASD to run, mouse to aim, click to shoot, 1–5 / wheel / Q for weapons, Tab for the scores.' }),
				h('p.hint', { text: 'Phone (sideways): left thumb runs, right thumb aims and shoots, the button switches weapons.' }),
				joinInfo
			)
		)
	)

	const lMode = h('div.track-name')
	const lArena = h('div.laps')
	const plist = h('ul.players')
	const lMsg = h('p.hint')
	const warmBtn = h('button.big.go', { type: 'button', text: 'Back to the warm-up' })
	const changeBtn = h('button.ghost', { type: 'button', text: 'Change name / colour' })
	changeBtn.addEventListener('click', () => onRejoin())
	const lobbyPanel = h(
		'div.panel.lobby',
		h(
			'div.cols',
			h('div.col', h('h2', { text: 'Waiting for the host to start' }), plist, lMsg),
			h('div.col.sk-lobby-info', lMode, lArena, h('p.hint', { text: 'Warm up: run, shoot and grab weapons — nothing counts until the match starts.' }))
		),
		h('div.actions', warmBtn, changeBtn, fullscreenButton('ghost sq'))
	)
	const openBtn = h('button.tool.lobby-open', { type: 'button', text: 'Lobby', title: 'Show the lobby' })
	root.append(joinPanel, lobbyPanel, openBtn)
	show(lobbyPanel, false)
	show(openBtn, false)
	warmBtn.addEventListener('click', () => {
		show(lobbyPanel, false)
		show(openBtn, true)
	})
	openBtn.addEventListener('click', () => {
		show(lobbyPanel, true)
		show(openBtn, false)
	})

	return {
		showJoin(info = '') {
			show(root, true)
			show(joinPanel, true)
			show(lobbyPanel, false)
			show(openBtn, false)
			setText(joinInfo, info)
		},
		/** Lobby phase. @param {object} state @param {any} meId @param {string} arenaName */
		showLobby(state, meId, arenaName) {
			show(root, true)
			show(joinPanel, false)
			// Owner 15.11: "cant roam and shoot before the match starts" — the panel covered the play and took the
			// mouse until "Warm up" was pressed. The lobby is the warm-up: the panel stays closed behind its button.
			if (lobbyPanel.hidden && openBtn.hidden) show(openBtn, true)
			const tdm = state.mode === 'tdm'
			const spot = state.mode === 'spot'
			setText(lMode, tdm ? 'Team match (red vs blue)' : spot ? 'Spotlight — stand in the light alone to score' : 'Free for all')
			const lim = state.limits || {}
			const goal = `${lim.frags ?? (tdm ? 40 : spot ? 60 : 20)} ${spot ? 'points' : 'frags'}`
			setText(lArena, `${arenaName || state.arenaId || ''} · ${goal} or ${lim.minutes ?? 5} min`)
			plist.textContent = ''
			const players = state.players || []
			for (const p of players) {
				const sw = h('span.swatch')
				sw.style.background = safeColor(tdm ? TEAM_COLORS[p.team | 0] : p.color)
				const li = h(
					'li',
					sw,
					h('span.pname', { text: String(p.name ?? '') + (p.id === meId ? ' (you)' : '') }),
					h('span.pready', { text: p.bot ? 'bot' : tdm ? TEAM_NAMES[p.team | 0] : '' })
				)
				li.classList.toggle('offline', p.connected === false)
				plist.append(li)
			}
			setText(lMsg, `${players.length}/${state.maxPlayers || 10} soldiers · the host starts the match`)
		},
		hide() {
			show(root, false)
		},
		get joinVisible() {
			return !root.hidden && !joinPanel.hidden
		},
	}
}

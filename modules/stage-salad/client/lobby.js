/**
 * Join form + lobby panel of Stage Salad (WO-1089 §8 / §11): name and colour (remembered under `saladgame.`), a
 * full-screen button; then the roster, the round length and mode, and "Practice while you wait" — the panel closes and
 * the player fires at the avatar while the host gets ready (flights and reactions, nothing scored). "Change name /
 * colour" goes back to the form. COPY-ADAPTED from the Skirmish lobby (modules/toy-skirmish/client/lobby.js).
 */
import { h, setText, show, storeGet, storeSet, COLORS, safeColor } from './dom.js'
import { sanitizeName, MAX_NAME } from './protocol.js'
import { fullscreenButton } from './kit/fullscreen.js'
import { TEAMS } from './hud-board.js'

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
	const swatches = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Slingshot colour' })
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
	const joinBtn = h('button.big', { type: 'button', text: 'Grab a slingshot' })
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
		h('div.panel-head', h('h1', { text: 'Stage Salad' }), fullscreenButton('ghost sq')),
		h(
			'div.cols',
			h('div.col', h('label', { text: 'Name' }), nameIn, h('label', { text: 'Colour' }), swatches, h('div.actions', joinBtn, watchBtn)),
			h(
				'div.col.salad-howto',
				h('h2', { text: 'How to play' }),
				h('p.hint', { text: 'Splat the presenter’s friendly stage avatar with vegetables from a big slingshot. Head 100, body 50, legs 30 — farther and in a row is worth more.' }),
				h('p.hint', { text: 'Phone (sideways): press anywhere, drag down to pull, sideways to aim, let go. Keyboard: hold Space, ← → aim, ↑ ↓ arc, 1–6 vegetables.' }),
				joinInfo
			)
		)
	)

	const lMode = h('div.track-name')
	const lInfo = h('div.laps')
	const plist = h('ul.players')
	const lMsg = h('p.hint')
	const lHead = h('h2', { text: 'Waiting for the host to start' })
	const practiceBtn = h('button.big.go', { type: 'button', text: 'Practice while you wait' })
	const changeBtn = h('button.ghost', { type: 'button', text: 'Change name / colour' })
	changeBtn.addEventListener('click', () => onRejoin())
	const sessionSlot = h('div.ctl-slot') // WO-1125: the self-service session panel is mounted here (session-panel.js)
	const lobbyPanel = h(
		'div.panel.lobby',
		h(
			'div.cols',
			h('div.col', lHead, plist, lMsg),
			h('div.col.salad-lobby-info', lMode, lInfo, h('p.hint', { text: 'Practice: throw as much as you like — nothing counts until the round starts.' }))
		),
		sessionSlot,
		h('div.actions', practiceBtn, changeBtn, fullscreenButton('ghost sq'))
	)
	const openBtn = h('button.tool.lobby-open', { type: 'button', text: 'Lobby', title: 'Show the lobby' })
	root.append(joinPanel, lobbyPanel, openBtn)
	show(lobbyPanel, false)
	show(openBtn, false)
	let seenLobby = false
	practiceBtn.addEventListener('click', () => {
		show(lobbyPanel, false)
		show(openBtn, true)
	})
	openBtn.addEventListener('click', () => {
		show(lobbyPanel, true)
		show(openBtn, false)
	})

	return {
		slot: sessionSlot,
		showJoin(info = '') {
			show(root, true)
			show(joinPanel, true)
			show(lobbyPanel, false)
			show(openBtn, false)
			setText(joinInfo, info)
			seenLobby = false
		},
		/** Lobby phase. */
		showLobby(state, meId) {
			show(root, true)
			show(joinPanel, false)
			if (!seenLobby) {
				seenLobby = true
				show(lobbyPanel, true) // once after joining; then it stays behind its button
				show(openBtn, false)
			} else if (lobbyPanel.hidden && openBtn.hidden) show(openBtn, true)
			setText(lMode, state.teams ? 'Teams: left side vs right side of the room' : 'Everyone for themselves')
			setText(lInfo, `Rounds of ${Math.round((state.secs || 90) / 6) / 10} min${state.bots ? ` · ${state.bots} bots` : ''}`)
			plist.textContent = ''
			const players = state.players || []
			for (const p of players) {
				const sw = h('span.swatch')
				sw.style.background = safeColor(state.teams ? TEAMS[p.team === 1 ? 1 : 0].color : p.color)
				const li = h(
					'li',
					sw,
					h('span.pname', { text: String(p.name ?? '') + (p.id === meId ? ' (you)' : '') }),
					h('span.pready', { text: p.bot ? 'bot' : state.teams ? TEAMS[p.team === 1 ? 1 : 0].name : '' })
				)
				li.classList.toggle('offline', p.connected === false)
				plist.append(li)
			}
			setText(lHead, state.self ? 'Waiting for the start' : 'Waiting for the host to start') // WO-1125: anyone seated may start
			setText(lMsg, `${players.length}/${state.maxPlayers || 20} slingshots · ${state.self ? 'anyone here can press Start' : 'the host starts the round'}`)
		},
		hide() {
			show(root, false)
			seenLobby = false
		},
		get joinVisible() {
			return !root.hidden && !joinPanel.hidden
		},
		get panelOpen() {
			return !root.hidden && (!joinPanel.hidden || !lobbyPanel.hidden)
		},
	}
}

/**
 * Join form + lobby panel (WO-1074): name (remembered), colour swatches, the track preview, players with their ready
 * state, a Ready toggle and a "Drive" button that hides the panel for free roam while waiting.
 */
import { h, setText, show, storeGet, storeSet, COLORS, safeColor } from './dom.js'
import { sanitizeName, MAX_NAME } from './protocol.js'
import { previewTrack } from './trackdraw.js'
import { fullscreenButton } from './fullscreen.js'

export function createLobby(root, { onJoin, onReady, onRejoin }) {
	root.textContent = ''
	let color = safeColor(storeGet('color'), COLORS[Math.floor(Math.random() * COLORS.length)])
	let ready = false

	/* ---------- join form ---------- */
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
	const swatches = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Car colour' })
	const paintSwatches = () => {
		swatches.textContent = ''
		for (const c of COLORS) {
			const b = h('button.swatch-btn', {
				type: 'button',
				role: 'radio',
				'aria-checked': String(c === color),
				'aria-label': c,
			})
			b.style.background = c
			b.addEventListener('click', () => {
				color = c
				paintSwatches()
			})
			swatches.append(b)
		}
	}
	paintSwatches()
	const joinBtn = h('button.big', { type: 'button', text: 'Join the race' })
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
	const joinTrack = h('div.track-name')
	const joinCanvas = h('canvas.track-preview', { width: 220, height: 140 })
	const joinPanel = h(
		'div.panel.join',
		h('div.panel-head', h('h1', { text: 'Stage Sprint RC' }), fullscreenButton()),
		h(
			'div.cols',
			h('div.col', h('label', { text: 'Name' }), nameIn, h('label', { text: 'Colour' }), swatches, joinBtn),
			h('div.col.preview', joinCanvas, joinTrack)
		)
	)

	/* ---------- lobby ---------- */
	const lTrack = h('div.track-name')
	const lCanvas = h('canvas.track-preview', { width: 220, height: 140 })
	const lLaps = h('div.laps')
	const plist = h('ul.players')
	const readyBtn = h('button.big.ready', { type: 'button', text: 'Ready' })
	readyBtn.addEventListener('click', () => {
		ready = !ready
		paintReady()
		onReady(ready)
	})
	const driveBtn = h('button.ghost', { type: 'button', text: 'Drive around' })
	const changeBtn = h('button.ghost', { type: 'button', text: 'Change name / colour' })
	changeBtn.addEventListener('click', () => onRejoin())
	const lMsg = h('p.hint')
	const sessionSlot = h('div.ctl-slot') // WO-1125: the self-service session panel is mounted here (session-panel.js)
	const lobbyPanel = h(
		'div.panel.lobby',
		h(
			'div.cols',
			h('div.col', h('h2', { text: 'Waiting for the start' }), plist, lMsg),
			h('div.col.preview', lCanvas, lTrack, lLaps)
		),
		sessionSlot,
		h('div.actions', readyBtn, driveBtn, changeBtn, fullscreenButton())
	)
	const openBtn = h('button.tool.lobby-open', { type: 'button', text: 'Lobby', title: 'Show the lobby' })

	root.append(joinPanel, lobbyPanel, openBtn)
	show(lobbyPanel, false)
	show(openBtn, false)
	driveBtn.addEventListener('click', () => {
		show(lobbyPanel, false)
		show(openBtn, true)
	})
	openBtn.addEventListener('click', () => {
		show(lobbyPanel, true)
		show(openBtn, false)
	})

	function paintReady() {
		readyBtn.classList.toggle('on', ready)
		setText(readyBtn, ready ? 'Ready ✓ (tap to undo)' : 'Ready')
	}
	paintReady()

	let lastTrackId = null
	function paintTrack(track, nameEl, canvas) {
		setText(nameEl, track ? track.name || track.id : 'No track')
		if (track) previewTrack(canvas, track)
	}

	return {
		slot: sessionSlot,
		/** Show the join form. */
		showJoin(track) {
			show(root, true)
			show(joinPanel, true)
			show(lobbyPanel, false)
			show(openBtn, false)
			paintTrack(track, joinTrack, joinCanvas)
		},
		/** Lobby phase. @param {object} state @param {any} meId @param {object|null} track */
		showLobby(state, meId, track, { reveal = false } = {}) {
			show(root, true)
			show(joinPanel, false)
			if (reveal || (lobbyPanel.hidden && openBtn.hidden)) {
				show(lobbyPanel, true)
				show(openBtn, false)
			}
			if (track && track.id !== lastTrackId) {
				lastTrackId = track.id
				paintTrack(track, lTrack, lCanvas)
			}
			setText(lLaps, `${state.laps || 3} laps`)
			plist.textContent = ''
			const players = state.players || []
			for (const p of players) {
				const sw = h('span.swatch')
				sw.style.background = safeColor(p.color)
				const li = h(
					'li',
					sw,
					h('span.pname', { text: p.name + (p.id === meId ? ' (you)' : '') }),
					h('span.pready', { text: p.ready ? 'ready' : '…' })
				)
				li.classList.toggle('is-ready', !!p.ready)
				li.classList.toggle('offline', p.connected === false)
				plist.append(li)
			}
			const me = players.find((p) => p.id === meId)
			if (me && me.ready !== ready) {
				ready = !!me.ready
				paintReady()
			}
			setText(lMsg, `${players.length}/${state.maxPlayers || 10} drivers · ${state.self ? 'anyone here can press Start' : 'the host starts the race'}`) // WO-1125
		},
		hide() {
			show(root, false)
		},
		resetReady() {
			ready = false
			paintReady()
		},
		get joinVisible() {
			return !root.hidden && !joinPanel.hidden
		},
	}
}

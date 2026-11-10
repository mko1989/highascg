'use strict'

/**
 * WO-1029 phase 2a — a fake CasparCG for the virtual box bed (virtual-boxes.js): a TCP AMCP server on a loopback alias
 * and an ephemeral port that answers what a HighAsCG node needs to count it as connected and to run takes, and that
 * REMEMBERS what it was told:
 *
 *   screen model  per channel and layer: the foreground / background source (clip, route://, colour, [HTML], DECKLINK…),
 *                 playing or not, the CG template on it, the MIXER values — updated from every mutating line
 *   write log     append-only { seq, t, from, who, channel, layer, line } of every mutating line, so a test can ask
 *                 "who wrote to box A's channel 2 between these two moments". `from` is the remote address:port; all
 *                 loopback connections come from 127.0.0.1 (the kernel picks it), so `who` names the PROCESS that
 *                 owns the other end (/proc/net/tcp → socket inode → /proc/<pid>/fd), mapped by `identify(pid)`.
 *
 *   const cg = await startFakeCaspar({ host: '127.0.2.11', identify: (pid) => labels[pid] })
 *   const m = cg.mark()
 *   … drive the node …
 *   cg.layer(1, 10)                       → { fg: { source, kind, playing }, bg, cg, mixer } | null
 *   cg.since(m, { channel: 1 })           → write-log entries after the mark
 *   cg.writers(1, m)                      → Set of `who` that wrote to channel 1 after the mark
 *   await cg.close()
 *
 * Never on port 5250 and never on a non-loopback address (WO-990: the live Caspar's AMCP acceptor dies when a
 * connection is opened and reset; WO-719: nothing of a test on the LAN). Protocol: plain AMCP lines and `REQ <id> …`
 * (answered `RES <id> …`, what casparcg-connection sends at connect); BEGIN…COMMIT answered per line then
 * `202 COMMIT OK`; `INFO <ch>` in the 2.6-dev stage XML that cluster-peer-info.js / live-scene-reconcile.js parse.
 */

const fs = require('fs')
const net = require('net')

const LOOPBACK = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/
const QUERY = new Set(['VERSION', 'INFO', 'CLS', 'TLS', 'FLS', 'CINF', 'DATA', 'THUMBNAIL', 'PING', 'DIAG', 'GL', 'HELP', 'LOG', 'LOCK', 'BYE'])
const LINE = /^(\S+)\s+(\d+)(?:-(\d+))?(?:\s+(.*))?$/

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The quoted or first-token source of a PLAY / LOAD / LOADBG argument list ('' = none). */
function sourceOf(rest) {
	const s = String(rest || '').trim()
	if (!s) return ''
	const q = /^"((?:[^"\\]|\\.)*)"/.exec(s)
	return q ? q[1] : s.split(/\s+/)[0]
}

/** clip | route | color | html | decklink | ndi | other — what kind of producer a source names. */
function kindOf(src) {
	const s = String(src || '')
	if (/^route:\/\//i.test(s)) return 'route'
	if (/^#|^(EMPTY|BLACK|WHITE|RED|GREEN|BLUE|TRANSPARENT)$/i.test(s)) return 'color'
	if (/^\[HTML\]|^https?:\/\//i.test(s)) return 'html'
	if (/^DECKLINK$/i.test(s)) return 'decklink'
	if (/^NDI/i.test(s)) return 'ndi'
	if (/^\[/.test(s)) return 'other'
	return 'clip'
}

/** True when this AMCP line changes what a channel shows (everything but the query verbs and query-shaped MIXER). */
function isMutating(line) {
	const m = LINE.exec(String(line || '').trim())
	const verb = String(line || '').trim().split(/\s+/)[0].toUpperCase()
	if (!verb || QUERY.has(verb) || verb === 'BEGIN' || verb === 'COMMIT' || verb === 'DISCARD') return false
	if (verb === 'MIXER' && m) {
		const args = String(m[4] || '').trim().split(/\s+/).filter(Boolean)
		return args.length > 1 || /^(CLEAR|COMMIT)$/i.test(args[0] || '') // `MIXER 1-10 OPACITY` alone is a query
	}
	return true
}

/** Linux: the pid owning the client end (local port `port`) of a loopback TCP connection to `serverPort`; 0 = unknown. */
function pidOfClientPort(port, serverPort, pids) {
	try {
		const hex = (n) => n.toString(16).toUpperCase().padStart(4, '0')
		const rows = fs.readFileSync('/proc/net/tcp', 'utf8').split('\n').slice(1)
		const row = rows.map((r) => r.trim().split(/\s+/)).find((c) => c[1]?.endsWith(':' + hex(port)) && c[2]?.endsWith(':' + hex(serverPort)))
		if (!row) return 0
		const want = `socket:[${row[9]}]`
		for (const pid of pids()) {
			let fds = []
			try {
				fds = fs.readdirSync(`/proc/${pid}/fd`)
			} catch {
				continue
			}
			for (const fd of fds) {
				try {
					if (fs.readlinkSync(`/proc/${pid}/fd/${fd}`) === want) return pid
				} catch {
					/* closed meanwhile */
				}
			}
		}
	} catch {
		/* not Linux / no /proc */
	}
	return 0
}

/**
 * @param {{ host?: string, port?: number, channels?: number, mode?: string,
 *   media?: string[], identify?: (pid: number) => string, pids?: () => number[], log?: (s: string) => void }} [opts]
 *   channels: how many channels `INFO` lists (all `mode`); media: clip names CLS lists; pids: candidate processes for
 *   `who` (default: none → `who` = from); identify: pid → a label ('sb-a node', …)
 */
async function startFakeCaspar(opts = {}) {
	const host = opts.host || '127.0.0.1'
	if (!LOOPBACK.test(host)) throw new Error(`fake Caspar must bind a loopback address (got ${host})`)
	if (Number(opts.port) === 5250) throw new Error('fake Caspar refuses port 5250 (the live Caspar\'s)')
	const mode = opts.mode || '1080p5000'
	const nCh = opts.channels || 16
	const media = (opts.media || ['E2E_BARS', 'E2E_STILL', 'LOOK_A', 'LOOK_B', 'LOOK_C']).map((s) => String(s).toUpperCase())
	const log = opts.log || (() => {})
	/** channel → Map<layer, { fg, bg, cg, mixer }> */
	const channels = new Map()
	const channelMixer = new Map()
	const writes = []
	const conns = []
	let seq = 0
	const sockets = new Set()

	const layerOf = (ch, l, create = true) => {
		if (!channels.has(ch)) channels.set(ch, new Map())
		const m = channels.get(ch)
		if (!m.has(l) && create) m.set(l, { fg: null, bg: null, cg: null, mixer: {} })
		return m.get(l) || null
	}
	const prune = (ch, l) => {
		const L = channels.get(ch)?.get(l)
		if (L && !L.fg && !L.bg && !L.cg && !Object.keys(L.mixer).length) channels.get(ch).delete(l)
	}

	/** Applies one mutating line to the screen model → '' or an error status for the reply. */
	function apply(line) {
		const s = String(line).trim()
		const verb = s.split(/\s+/)[0].toUpperCase()
		const m = LINE.exec(s)
		if (!m) return verb === 'MIXER' || verb === 'CLEAR' || verb === 'PLAY' ? `402 ${verb} FAILED` : ''
		const ch = Number(m[2])
		if (ch < 1 || ch > nCh) return `401 ${verb} ERROR`
		const l = m[3] === undefined ? null : Number(m[3])
		const rest = m[4] || ''
		const src = sourceOf(rest)
		if (verb === 'CLEAR') {
			if (l === null) {
				channels.delete(ch)
				channelMixer.delete(ch)
			} else channels.get(ch)?.delete(l)
			return ''
		}
		if (verb === 'MIXER') {
			const [prop, ...vals] = rest.trim().split(/\s+/)
			const P = String(prop || '').toUpperCase()
			if (P === 'CLEAR') {
				if (l === null) {
					channelMixer.delete(ch)
					for (const L of channels.get(ch)?.values() || []) L.mixer = {}
				} else if (layerOf(ch, l, false)) layerOf(ch, l).mixer = {}
				if (l !== null) prune(ch, l)
				return ''
			}
			if (P === 'COMMIT') return ''
			if (l === null) channelMixer.set(ch, { ...channelMixer.get(ch), [P]: vals.join(' ') })
			else layerOf(ch, l).mixer[P] = vals.join(' ')
			return ''
		}
		if (l === null) return '' // channel-wide forms (ADD / REMOVE consumers, SWAP, CALL…): logged, nothing on a layer
		const L = layerOf(ch, l)
		if (verb === 'LOADBG') {
			if (!src) return '402 LOADBG FAILED'
			if (kindOf(src) === 'clip' && !media.includes(src.toUpperCase())) return '404 LOADBG FAILED'
			L.bg = { source: src, kind: kindOf(src), args: rest }
		} else if (verb === 'LOAD' || (verb === 'PLAY' && src)) {
			if (kindOf(src) === 'clip' && !media.includes(src.toUpperCase())) return `404 ${verb} FAILED`
			L.fg = { source: src, kind: kindOf(src), playing: verb === 'PLAY', args: rest }
		} else if (verb === 'PLAY') {
			if (L.bg) {
				L.fg = { ...L.bg, playing: true }
				L.bg = null
			} else if (L.fg) L.fg.playing = true
		} else if (verb === 'PAUSE' || verb === 'RESUME') {
			if (L.fg) L.fg.playing = verb === 'RESUME'
		} else if (verb === 'STOP') L.fg = null
		else if (verb === 'CG') {
			const sub = rest.trim().split(/\s+/) // CG ch-l ADD <cg layer> "template" <play> "data"
			const op = String(sub[0] || '').toUpperCase()
			if (op === 'ADD') L.cg = { template: sourceOf(sub.slice(2).join(' ')), playing: true }
			else if (op === 'CLEAR' || op === 'REMOVE') L.cg = null
			else if (op === 'STOP' && L.cg) L.cg.playing = false
			else if (op === 'PLAY' && L.cg) L.cg.playing = true
		}
		prune(ch, l)
		return ''
	}

	function channelXml(ch) {
		let stage = ''
		for (const [num, L] of [...(channels.get(ch) || new Map()).entries()].sort((a, b) => a[0] - b[0])) {
			const fgXml = L.fg
				? L.fg.kind === 'clip'
					? `<foreground><file><name>${xmlEscape(L.fg.source)}</name><path>${xmlEscape(L.fg.source)}</path><time>0</time><time>10</time></file><paused>${!L.fg.playing}</paused><producer>ffmpeg</producer></foreground>`
					: `<foreground><producer>${L.fg.kind === 'route' ? 'route' : L.fg.kind === 'color' ? 'color' : L.fg.kind}</producer></foreground>`
				: L.cg
					? '<foreground><producer>html</producer></foreground>'
					: '<foreground><producer>empty</producer></foreground>'
			const bgXml = L.bg ? `<background><file><name>${xmlEscape(L.bg.source)}</name></file><producer>ffmpeg</producer></background>` : '<background><producer>empty</producer></background>'
			stage += `<layer_${num}>${bgXml}${fgXml}</layer_${num}>`
		}
		return `<?xml version="1.0" encoding="utf-8"?><channel><format>${mode}</format><framerate>50</framerate><stage><layer>${stage}</layer></stage></channel>`
	}

	const configXml = () =>
		`<?xml version="1.0" encoding="utf-8"?><configuration><paths><media-path>media/</media-path></paths><channels>${Array.from({ length: nCh }, () => `<channel><video-mode>${mode}</video-mode><consumers/></channel>`).join('')}</channels></configuration>`

	/** The reply lines for one command (without the RES prefix). */
	function answer(line, conn) {
		const s = String(line).trim()
		const verb = s.split(/\s+/)[0].toUpperCase()
		const rest = s.slice(verb.length).trim()
		if (verb === 'PING') return [`PONG${rest ? ' ' + rest : ''}`]
		if (verb === 'VERSION') return ['201 VERSION OK', '2.5.0 fake-caspar (WO-1029)']
		if (verb === 'INFO') {
			const sub = rest.split(/\s+/)[0] || ''
			if (!sub) return ['200 INFO OK', ...Array.from({ length: nCh }, (_, i) => `${i + 1} ${mode} PLAYING`), '']
			if (/^\d+$/.test(sub)) return Number(sub) >= 1 && Number(sub) <= nCh ? ['201 INFO OK', channelXml(Number(sub))] : ['401 INFO ERROR']
			if (/^\d+-\d+$/.test(sub)) return ['201 INFO OK', channelXml(parseInt(sub, 10))]
			if (/^CONFIG$/i.test(sub)) return ['201 INFO OK', configXml()]
			if (/^PATHS$/i.test(sub)) return ['201 INFO OK', '<?xml version="1.0" encoding="utf-8"?><paths><media-path>media/</media-path><template-path>template/</template-path></paths>']
			if (/^SYSTEM$/i.test(sub)) return ['201 INFO OK', '<?xml version="1.0" encoding="utf-8"?><system><name>fake-caspar</name></system>']
			return ['201 INFO OK', '<?xml version="1.0" encoding="utf-8"?><info/>']
		}
		if (verb === 'CLS') return ['200 CLS OK', ...media.map((m) => `"${m}" MOVIE 1000 20261110000000 250 1/25`), '']
		if (verb === 'TLS' || verb === 'FLS') return [`200 ${verb} OK`, '']
		if (verb === 'CINF') {
			const name = sourceOf(rest).toUpperCase()
			return media.includes(name) ? ['200 CINF OK', `"${name}" MOVIE 1000 20261110000000 250 1/25`, ''] : ['404 CINF ERROR']
		}
		if (verb === 'DATA') return /^RETRIEVE/i.test(rest) ? ['404 DATA RETRIEVE ERROR'] : /^LIST/i.test(rest) ? ['200 DATA OK', ''] : ['202 DATA OK']
		if (verb === 'THUMBNAIL') return /^LIST/i.test(rest) ? ['200 THUMBNAIL OK', ''] : ['404 THUMBNAIL ERROR']
		if (verb === 'MIXER' && !isMutating(s)) {
			const m = LINE.exec(s)
			const prop = String(m?.[4] || '').trim().toUpperCase()
			const v = m?.[3] !== undefined ? channels.get(Number(m[2]))?.get(Number(m[3]))?.mixer[prop] : channelMixer.get(Number(m?.[2]))?.[prop]
			return ['201 MIXER OK', v || '1']
		}
		if (QUERY.has(verb)) return [`202 ${verb} OK`]
		record(s, conn)
		const err = apply(s)
		return [err || `202 ${verb} OK`]
	}

	function record(line, conn) {
		if (!conn.pid && opts.pids && !conn.closed) whoIs(conn) // the node may have been unknown when it connected
		const m = LINE.exec(line)
		writes.push({ seq: ++seq, t: Date.now(), from: conn.from, who: conn.who, channel: m ? Number(m[2]) : null, layer: m && m[3] !== undefined ? Number(m[3]) : null, line })
	}

	function whoIs(conn) {
		conn.pid = pidOfClientPort(conn.remotePort, server.address().port, opts.pids)
		if (conn.pid) conn.who = opts.identify?.(conn.pid) || `pid ${conn.pid}`
	}

	const server = net.createServer((sock) => {
		sockets.add(sock)
		const from = `${sock.remoteAddress}:${sock.remotePort}`
		const conn = { from, remotePort: sock.remotePort, pid: 0, who: from, at: Date.now(), closed: 0, lines: 0 }
		if (opts.pids) whoIs(conn)
		conns.push(conn)
		log(`fake Caspar ${host}:${server.address().port}: connection from ${conn.who} (${from})`)
		let buf = ''
		let batch = null
		const send = (lines, req) => {
			if (!lines.length || sock.destroyed) return
			const out = req ? [`RES ${req} ${lines[0]}`, ...lines.slice(1)] : lines
			sock.write(out.join('\r\n') + '\r\n')
		}
		sock.on('data', (d) => {
			buf += d.toString('utf8')
			const parts = buf.split(/\r?\n/)
			buf = parts.pop()
			for (const raw of parts) {
				let line = raw.trim()
				if (!line) continue
				conn.lines++
				let req = ''
				const r = /^REQ\s+(\S+)\s+(.*)$/i.exec(line)
				if (r) [, req, line] = r
				const verb = line.split(/\s+/)[0].toUpperCase()
				if (verb === 'BEGIN') {
					batch = []
					continue
				}
				if (verb === 'DISCARD') {
					batch = null
					send(['202 DISCARD OK'], req)
					continue
				}
				if (verb === 'COMMIT') {
					const lines = batch || []
					batch = null
					const replies = []
					for (const l of lines) replies.push(...answer(l, conn))
					send([...replies, '202 COMMIT OK'], req)
					continue
				}
				if (batch) {
					batch.push(line)
					continue
				}
				send(answer(line, conn), req)
			}
		})
		sock.on('error', () => {})
		sock.on('close', () => {
			conn.closed = Date.now()
			sockets.delete(sock)
		})
	})
	await new Promise((resolve, reject) => {
		server.once('error', reject)
		server.listen(opts.port || 0, host, resolve)
	})
	const port = server.address().port
	if (port === 5250) {
		server.close()
		throw new Error('fake Caspar got port 5250: refusing')
	}

	const match = (e, f = {}) =>
		(f.channel === undefined || e.channel === f.channel) && (f.layer === undefined || e.layer === f.layer) && (f.who === undefined || e.who === f.who) && (f.until === undefined || e.seq <= f.until)

	const api = {
		host,
		port,
		address: `${host}:${port}`,
		/** The screen model of one channel: { layer: { fg, bg, cg, mixer } } (a copy). */
		channel: (ch) => Object.fromEntries([...(channels.get(ch) || new Map()).entries()].map(([l, L]) => [l, structuredClone(L)])),
		layer: (ch, l) => (channels.get(ch)?.get(l) ? structuredClone(channels.get(ch).get(l)) : null),
		/** Layers of a channel whose foreground or CG shows something. */
		visible: (ch) => Object.entries(api.channel(ch)).filter(([, L]) => L.fg || L.cg).map(([l, L]) => ({ layer: Number(l), ...L })),
		mark: () => seq,
		since: (mark = 0, f = {}) => writes.filter((e) => e.seq > mark && match(e, f)).map((e) => ({ ...e })),
		writers: (ch, mark = 0, until) => new Set(writes.filter((e) => e.seq > mark && e.channel === ch && (until === undefined || e.seq <= until)).map((e) => e.who)),
		writes: () => writes.map((e) => ({ ...e })),
		connections: () => conns.map((c) => ({ ...c })),
		/** Re-label connections whose pid was learnt later (a restarted node). */
		relabel() {
			for (const c of conns) if (c.pid && opts.identify) c.who = opts.identify(c.pid) || c.who
		},
		/** A Caspar restart: the screens go black, open connections drop. */
		wipe() {
			channels.clear()
			channelMixer.clear()
		},
		dropConnections() {
			for (const s of sockets) s.destroy()
		},
		close: () =>
			new Promise((r) => {
				for (const s of sockets) s.destroy()
				server.close(() => r())
			}),
	}
	return api
}

module.exports = { startFakeCaspar, isMutating, kindOf, sourceOf, pidOfClientPort }

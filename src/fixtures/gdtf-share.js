'use strict'

/**
 * WO-637 — GDTF Share (gdtf-share.com public API, https://www.gdtf.eu/gdtf/share_api/share-api/): an MVR placeholder
 * GDTF is swapped for the real file automatically. Login {user, password} → session cookie (2 h idle); getList.php →
 * every revision with its modes' footprints; downloadFile.php?rid=N → the .gdtf. Needs a GDTF Share account.
 *
 * Box-local, outside the synced repo: the account ~/.highascg/gdtf-share.json (0600) and the list cache
 * ~/.highascg/cache/gdtf-share-list.json (~7 MB, refreshed when a day old; a stale copy is used offline). What is
 * fetched lands in the type store + a WO-633 alias, so shows run offline.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const store = require('./gdtf-store')
const aliases = require('./gdtf-aliases')
const { rank, loose, pairModes } = require('./gdtf-share-match')

const API = 'https://gdtf-share.com/apis/public'
const LIST_MAX_AGE_MS = 24 * 3600 * 1000

function home() {
	return process.env.HIGHASCG_GDTF_SHARE_DIR || path.join(os.homedir(), '.highascg')
}
const accountFile = () => path.join(home(), 'gdtf-share.json')
const listFile = () => path.join(home(), 'cache', 'gdtf-share-list.json')

function account() {
	try {
		const a = JSON.parse(fs.readFileSync(accountFile(), 'utf8'))
		return a?.user && a?.password ? { user: String(a.user), password: String(a.password) } : null
	} catch {
		return null
	}
}

function setAccount(user, password) {
	fs.mkdirSync(home(), { recursive: true })
	fs.writeFileSync(accountFile(), JSON.stringify({ user, password }), { mode: 0o600 })
	fs.chmodSync(accountFile(), 0o600)
	_cookie = null
}

let _cookie = null

async function login(f) {
	const a = account()
	if (!a) throw new Error('no GDTF Share account set')
	const r = await f(`${API}/login.php`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) })
	const j = await r.json().catch(() => ({}))
	if (!r.ok || !j.result) throw new Error(`GDTF Share login failed: ${j.error || r.status}`)
	_cookie = (r.headers.getSetCookie?.() || [r.headers.get('set-cookie')]).filter(Boolean).map((c) => c.split(';')[0]).join('; ')
}

/** GET with the session; one re-login on 401 (the cookie times out). */
async function get(f, url) {
	if (!_cookie) await login(f)
	let r = await f(url, { headers: { Cookie: _cookie } })
	if (r.status === 401) {
		await login(f)
		r = await f(url, { headers: { Cookie: _cookie } })
	}
	if (!r.ok) throw new Error(`GDTF Share ${url.split('/').pop()}: HTTP ${r.status}`)
	return r
}

/** The revision list: cached copy when fresh, else fetched; a stale copy when the fetch fails (offline). */
async function list(f = fetch, now = Date.now()) {
	let cached = null
	try {
		const st = fs.statSync(listFile())
		cached = JSON.parse(fs.readFileSync(listFile(), 'utf8'))
		if (now - st.mtimeMs < LIST_MAX_AGE_MS) return { list: cached, fresh: true }
	} catch {}
	try {
		const j = await (await get(f, `${API}/getList.php`)).json()
		if (!j?.result || !Array.isArray(j.list)) throw new Error('GDTF Share list: unexpected reply')
		fs.mkdirSync(path.dirname(listFile()), { recursive: true })
		fs.writeFileSync(listFile(), JSON.stringify(j.list))
		return { list: j.list, fresh: true }
	} catch (e) {
		if (cached) return { list: cached, fresh: false, error: e.message }
		throw e
	}
}

async function download(f, rid) {
	return Buffer.from(await (await get(f, `${API}/downloadFile.php?rid=${Number(rid)}`)).arrayBuffer())
}

/**
 * Every placeholder among `ids` (all stored placeholders when empty) that has no alias yet → its real type.
 * → [{ id, name, manufacturer, status: 'replaced' | 'choose' | 'none' | 'error', to?, modes?, rid?, candidates?, error? }]
 * WO-785: `used` { id: [mode names the scene patches] } weighs those modes first; 'none' carries looser candidates
 * (another maker's upload, a sibling model) to offer.
 * @param {string[]} ids  @param {{ fetch?: Function, now?: number }} [deps]  @param {Record<string, string[]>} [used]
 */
async function resolve(ids, deps = {}, used = {}) {
	const f = deps.fetch || fetch
	const want = new Set((ids || []).map(String))
	const stubs = store.list().filter((t) => t.placeholder && !t.replacedBy && (!want.size || want.has(t.id)))
	if (!stubs.length) return { results: [] }
	if (!account()) return { results: [], error: 'no GDTF Share account set' }
	const { list: all, error: listError } = await list(f, deps.now)
	const results = []
	for (const s of stubs) {
		const r = rank(s, all, 5, Array.isArray(used?.[s.id]) ? used[s.id].map(String) : [])
		const base = { id: s.id, name: s.name, manufacturer: s.manufacturer }
		if (!r.best) {
			const offer = loose(s, all)
			results.push(offer.length ? { ...base, status: 'none', candidates: offer } : { ...base, status: 'none' })
			continue
		}
		if (!r.sure) {
			results.push({ ...base, status: 'choose', candidates: r.candidates })
			continue
		}
		try {
			const buf = await download(f, r.best.rid)
			const real = await store.ensureGdtf(buf, `${r.best.manufacturer}@${r.best.fixture}@rid${r.best.rid}.gdtf`)
			const modes = pairModes(s.modes, real.modes)
			aliases.setAlias(s, real.id, modes)
			results.push({ ...base, status: 'replaced', to: real.id, toName: real.name, modes, rid: r.best.rid,
				uploader: r.best.uploader })
		} catch (e) {
			results.push({ ...base, status: 'error', error: e.message, candidates: r.candidates })
		}
	}
	return listError ? { results, offline: listError } : { results }
}

// WO-825: `download` + `home` are the library builder's (gdtf-library-build.js / gdtf-share-full.js) way into the account
module.exports = { account, setAccount, list, download, home, resolve, _reset: () => (_cookie = null) }

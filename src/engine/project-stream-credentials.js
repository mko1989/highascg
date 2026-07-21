'use strict'

/**
 * WO-261 — Stream credentials (RTMP url + stream key) live in the PROJECT and only there.
 *
 * Storage shape (on the project JSON, saved/loaded/autosaved like any other section):
 *   project.streaming.credentials = {
 *     streamingChannel: { rtmpServerUrl, streamKey },   // the settings-modal streaming channel
 *     [outputId]:        { rtmpServerUrl, streamKey },   // per Device-View stream output (e.g. str_1)
 *   }
 *
 * PRECEDENCE / MIGRATION RULES (kept explicit on purpose):
 *  - STREAM TIME: the ACTIVE project's `streaming.credentials[key]` wins per field; the config
 *    copies (`streamingChannel.*`, `streamOutputs[].*`) are FALLBACK-ONLY and only matter before
 *    a project has claimed the creds (i.e. before the one-shot migration blanks config).
 *  - CLIENT SAVE: incoming project payloads are NEVER trusted for credentials (the client only ever
 *    receives masked placeholders). On persist the ON-DISK project creds are authoritative and are
 *    re-applied over whatever the client sent (`preserveProjectCredentials`). Credentials only ever
 *    change via the dedicated credentials API (authoritative write) or the one-shot migration.
 *  - MIGRATION (idempotent, one-shot in effect): on project persist, any non-empty config cred that
 *    the project does not yet hold is MOVED into the project and the config copy is blanked
 *    ("in project and in it only"). Once config is blanked nothing moves again, so loading a
 *    DIFFERENT project that holds no creds yields no creds.
 *  - CLIENT PAYLOADS: raw stream keys are NEVER emitted. `maskProjectStreamCredentials` strips the
 *    key (keeps the non-secret rtmpServerUrl) and adds a `hasStreamKey` boolean, mirroring WO-244.
 */

const STREAMING_CHANNEL_KEY = 'streamingChannel'

/** @param {unknown} v */
function s(v) {
	return String(v == null ? '' : v).trim()
}

/**
 * @param {object|null|undefined} project
 * @returns {Record<string, { rtmpServerUrl: string, streamKey: string, srtPassphrase: string }>}
 */
function getCredentialsMap(project) {
	const creds = project && typeof project === 'object' ? project.streaming?.credentials : null
	return creds && typeof creds === 'object' ? creds : {}
}

/**
 * @param {object|null|undefined} project
 * @param {string} key
 * @returns {{ rtmpServerUrl: string, streamKey: string, srtPassphrase: string }}
 */
function readProjectCredential(project, key) {
	const entry = getCredentialsMap(project)[s(key)] || {}
	return {
		rtmpServerUrl: s(entry.rtmpServerUrl),
		streamKey: s(entry.streamKey),
		srtPassphrase: s(entry.srtPassphrase),
	}
}

/**
 * @param {object|null|undefined} project
 * @param {string} key
 * @returns {boolean}
 */
function projectHasSrtPassphrase(project, key) {
	return !!readProjectCredential(project, key).srtPassphrase
}

/**
 * @param {object|null|undefined} project
 * @param {string} key
 * @returns {boolean}
 */
function projectHasStreamKey(project, key) {
	return !!readProjectCredential(project, key).streamKey
}

/** True when the project holds any non-empty url/key/passphrase for `key`. */
function projectHasCredential(project, key) {
	const c = readProjectCredential(project, key)
	return !!(c.streamKey || c.rtmpServerUrl || c.srtPassphrase)
}

/**
 * Return a shallow project clone with `streaming.credentials[key]` updated using empty-keeps
 * semantics: an empty/omitted streamKey/srtPassphrase KEEPS the stored value; `clearKey`/
 * `clearPassphrase` explicitly blank them (independently — clearing one does not touch the other).
 * @param {object} project
 * @param {string} key
 * @param {{ rtmpServerUrl?: string, streamKey?: string, clearKey?: boolean,
 *   srtPassphrase?: string, clearPassphrase?: boolean }} patch
 * @returns {object}
 */
function withProjectCredential(project, key, patch = {}) {
	const base = project && typeof project === 'object' ? project : {}
	const k = s(key) || STREAMING_CHANNEL_KEY
	const prev = readProjectCredential(base, k)
	const nextUrl = patch.rtmpServerUrl === undefined ? prev.rtmpServerUrl : s(patch.rtmpServerUrl)
	let nextKey
	if (patch.clearKey === true) nextKey = ''
	else {
		const incoming = s(patch.streamKey)
		nextKey = incoming || prev.streamKey
	}
	let nextPassphrase
	if (patch.clearPassphrase === true) nextPassphrase = ''
	else {
		const incoming = s(patch.srtPassphrase)
		nextPassphrase = incoming || prev.srtPassphrase
	}
	const streaming = base.streaming && typeof base.streaming === 'object' ? base.streaming : {}
	const credentials = { ...getCredentialsMap(base) }
	credentials[k] = { rtmpServerUrl: nextUrl, streamKey: nextKey, srtPassphrase: nextPassphrase }
	return { ...base, streaming: { ...streaming, credentials } }
}

/**
 * Client-save preservation: replace the incoming project's credentials with the ON-DISK authoritative
 * set. The client never holds real keys, so its `streaming.credentials` (masked/absent) must never
 * overwrite what is stored. Returns a shallow clone; the incoming object is not mutated.
 * @param {object} incoming
 * @param {object|null|undefined} onDisk
 * @returns {object}
 */
function preserveProjectCredentials(incoming, onDisk) {
	if (!incoming || typeof incoming !== 'object') return incoming
	const stored = getCredentialsMap(onDisk)
	const streaming = incoming.streaming && typeof incoming.streaming === 'object' ? incoming.streaming : null
	if (!Object.keys(stored).length) {
		// Nothing stored → strip any client-sent credentials entirely.
		if (!streaming || streaming.credentials == null) return incoming
		const nextStreaming = { ...streaming }
		delete nextStreaming.credentials
		return { ...incoming, streaming: nextStreaming }
	}
	const credentials = {}
	for (const [k, v] of Object.entries(stored)) {
		credentials[k] = { rtmpServerUrl: s(v?.rtmpServerUrl), streamKey: s(v?.streamKey), srtPassphrase: s(v?.srtPassphrase) }
	}
	return { ...incoming, streaming: { ...(streaming || {}), credentials } }
}

/**
 * Client-bound masking: strip stream keys, keep the (non-secret) rtmpServerUrl, add hasStreamKey.
 * No-op (returns the same reference) when the project holds no credentials. Never mutates input.
 * @param {object} project
 * @returns {object}
 */
function maskProjectStreamCredentials(project) {
	if (!project || typeof project !== 'object') return project
	const creds = getCredentialsMap(project)
	if (!Object.keys(creds).length) return project
	const masked = {}
	for (const [k, v] of Object.entries(creds)) {
		masked[k] = {
			rtmpServerUrl: s(v?.rtmpServerUrl),
			streamKey: '',
			hasStreamKey: !!s(v?.streamKey),
			srtPassphrase: '',
			hasSrtPassphrase: !!s(v?.srtPassphrase),
		}
	}
	return { ...project, streaming: { ...project.streaming, credentials: masked } }
}

/**
 * Client-bound masking for a device graph: strip `connector.caspar.streamKey` (keep the non-secret
 * url), add hasStreamKey. Server-side generation keeps using the raw graph — this is applied ONLY at
 * client emission points (settings-get, /api/device-view). Never mutates input.
 * @param {any} graph
 * @returns {any}
 */
function maskDeviceGraphConnectorKeys(graph) {
	if (!graph || typeof graph !== 'object' || !Array.isArray(graph.connectors)) return graph
	let touched = false
	const connectors = graph.connectors.map((c) => {
		const cas = c && typeof c === 'object' ? c.caspar : null
		if (cas && typeof cas === 'object' && s(cas.streamKey)) {
			touched = true
			return { ...c, caspar: { ...cas, streamKey: '', hasStreamKey: true } }
		}
		return c
	})
	return touched ? { ...graph, connectors } : graph
}

/** @param {object|null|undefined} config */
function configStreamOutputIds(config) {
	const outputs = Array.isArray(config?.streamOutputs) ? config.streamOutputs : []
	return outputs.map((x) => s(x?.id)).filter(Boolean)
}

/**
 * Config fallback slot for a credential key. streamingChannel → config.streamingChannel; any other
 * key → the matching config.streamOutputs[] entry.
 *
 * `srtPassphrase` has NO config fallback and never will — WO-307 deliberately never writes it
 * anywhere but the project (see the module header); config is simply not a valid source for it.
 * @param {object|null|undefined} config
 * @param {string} key
 * @returns {{ rtmpServerUrl: string, streamKey: string }}
 */
function readConfigCredential(config, key) {
	const k = s(key)
	if (k === STREAMING_CHANNEL_KEY) {
		const sc = config?.streamingChannel || {}
		return { rtmpServerUrl: s(sc.rtmpServerUrl), streamKey: s(sc.streamKey) }
	}
	const outputs = Array.isArray(config?.streamOutputs) ? config.streamOutputs : []
	const row = outputs.find((x) => s(x?.id) === k) || {}
	return { rtmpServerUrl: s(row.rtmpServerUrl), streamKey: s(row.streamKey) }
}

/**
 * Stream-time resolution: project first (per field), config fallback-only for
 * rtmpServerUrl/streamKey. srtPassphrase is PROJECT-ONLY (see readConfigCredential).
 * @param {object|null|undefined} config
 * @param {object|null|undefined} project
 * @param {string} key
 * @returns {{ rtmpServerUrl: string, streamKey: string, srtPassphrase: string, source: string }}
 */
function resolveStreamCredential(config, project, key) {
	const k = s(key) || STREAMING_CHANNEL_KEY
	const proj = readProjectCredential(project, k)
	const cfg = readConfigCredential(config, k)
	const rtmpServerUrl = proj.rtmpServerUrl || cfg.rtmpServerUrl
	const streamKey = proj.streamKey || cfg.streamKey
	const srtPassphrase = proj.srtPassphrase
	const source = proj.streamKey || proj.rtmpServerUrl || proj.srtPassphrase ? 'project' : 'config'
	return { rtmpServerUrl, streamKey, srtPassphrase, source }
}

/**
 * Client-safe credential status for settings-get: per-key { rtmpServerUrl, hasStreamKey,
 * hasSrtPassphrase }. Never carries the raw key or passphrase.
 * @param {object|null|undefined} config
 * @param {object|null|undefined} project
 * @returns {Record<string, { rtmpServerUrl: string, hasStreamKey: boolean, hasSrtPassphrase: boolean }>}
 */
function buildStreamCredentialStatus(config, project) {
	const out = {}
	const keys = new Set([STREAMING_CHANNEL_KEY, ...configStreamOutputIds(config)])
	for (const k of Object.keys(getCredentialsMap(project))) keys.add(k)
	for (const k of keys) {
		const r = resolveStreamCredential(config, project, k)
		out[k] = { rtmpServerUrl: r.rtmpServerUrl, hasStreamKey: !!r.streamKey, hasSrtPassphrase: !!r.srtPassphrase }
	}
	return out
}

/**
 * One-shot migration + purge. For streamingChannel + every config streamOutput: when config holds a
 * non-empty cred, ensure the project holds it (MOVE when the project has none) and BLANK the config
 * copy. Mutates `project` in place; returns the blanked config slices + a changed flag. The caller
 * persists the blanked config.
 * @param {object|null|undefined} config
 * @param {object} project
 * @param {(msg: string) => void} [log]
 * @returns {{ changed: boolean, streamingChannel: object|null, streamOutputs: object[]|null, deviceGraph: object|null }}
 */
function migrateConfigCredentialsIntoProject(config, project, log) {
	if (!config || typeof config !== 'object' || !project || typeof project !== 'object') {
		return { changed: false, streamingChannel: null, streamOutputs: null, deviceGraph: null }
	}
	let changed = false
	const ensureStreaming = () => {
		if (!project.streaming || typeof project.streaming !== 'object') project.streaming = {}
		if (!project.streaming.credentials || typeof project.streaming.credentials !== 'object') {
			project.streaming.credentials = {}
		}
		return project.streaming.credentials
	}
	const moveKey = (key, cfgCred) => {
		const creds = ensureStreaming()
		if (!projectHasCredential(project, key)) {
			creds[key] = { rtmpServerUrl: cfgCred.rtmpServerUrl, streamKey: cfgCred.streamKey }
			if (typeof log === 'function') {
				log(`[stream-creds] migrated config '${key}' credential into project (config copy blanked)`)
			}
		} else if (typeof log === 'function') {
			log(`[stream-creds] purged duplicate config '${key}' credential (project already holds it)`)
		}
		changed = true
	}

	// streamingChannel slot
	let nextStreamingChannel = null
	const sc = config.streamingChannel && typeof config.streamingChannel === 'object' ? config.streamingChannel : null
	if (sc && (s(sc.rtmpServerUrl) || s(sc.streamKey))) {
		moveKey(STREAMING_CHANNEL_KEY, { rtmpServerUrl: s(sc.rtmpServerUrl), streamKey: s(sc.streamKey) })
		nextStreamingChannel = { ...sc, rtmpServerUrl: '', streamKey: '' }
	}

	// per-output slots
	let nextStreamOutputs = null
	if (Array.isArray(config.streamOutputs) && config.streamOutputs.length) {
		let anyBlanked = false
		nextStreamOutputs = config.streamOutputs.map((row) => {
			if (!row || typeof row !== 'object') return row
			const id = s(row.id)
			if (id && (s(row.rtmpServerUrl) || s(row.streamKey))) {
				moveKey(id, { rtmpServerUrl: s(row.rtmpServerUrl), streamKey: s(row.streamKey) })
				anyBlanked = true
				return { ...row, rtmpServerUrl: '', streamKey: '' }
			}
			return row
		})
		if (!anyBlanked) nextStreamOutputs = null
	}

	// device graph connector.caspar slots — the same creds mirrored onto the graph. Move (or purge)
	// and blank so no config store retains a key.
	let nextDeviceGraph = null
	const dg = config.deviceGraph
	if (dg && typeof dg === 'object' && Array.isArray(dg.connectors)) {
		let anyDg = false
		const connectors = dg.connectors.map((c) => {
			const cas = c && typeof c === 'object' ? c.caspar : null
			if (cas && typeof cas === 'object' && (s(cas.rtmpServerUrl) || s(cas.streamKey))) {
				const id = s(c.id)
				if (id) moveKey(id, { rtmpServerUrl: s(cas.rtmpServerUrl), streamKey: s(cas.streamKey) })
				anyDg = true
				return { ...c, caspar: { ...cas, rtmpServerUrl: '', streamKey: '' } }
			}
			return c
		})
		if (anyDg) nextDeviceGraph = { ...dg, connectors }
	}

	return { changed, streamingChannel: nextStreamingChannel, streamOutputs: nextStreamOutputs, deviceGraph: nextDeviceGraph }
}

module.exports = {
	STREAMING_CHANNEL_KEY,
	getCredentialsMap,
	readProjectCredential,
	projectHasStreamKey,
	projectHasSrtPassphrase,
	projectHasCredential,
	withProjectCredential,
	preserveProjectCredentials,
	maskProjectStreamCredentials,
	maskDeviceGraphConnectorKeys,
	readConfigCredential,
	configStreamOutputIds,
	resolveStreamCredential,
	buildStreamCredentialStatus,
	migrateConfigCredentialsIntoProject,
}

'use strict'

/**
 * WO-731 — the audio operator's desk link: settings (desk-store.js), one driver for the chosen desk
 * (desk-models.js → drivers/*), and Accept. Accepting a presenter turns the desk input of their mic ON and makes
 * sure its fader is at least the threshold. A fader already above it is never touched, and neither is a fader on
 * a channel that was not mapped. Every change is read back from the desk before Accept reports success.
 * Desk calls run one at a time (a queue), so two accepts never interleave reads and writes.
 */

const store = require('./desk-store')
const { MODELS, createDriver } = require('./desk-models')

const SAME_DB = 0.1 // faders are quantised: a fader 0.02 dB under the threshold is at the threshold
const VERIFY_DB = 0.5

const fmtDb = (db) => (db === -Infinity ? '-∞' : `${Math.round(db * 10) / 10}`)

/**
 * The accept rule on one desk input → { ok, channel, before, after, did: [text], error? }.
 * @param {{ getChannel: Function, setOn: Function, setDb: Function }} driver
 */
async function acceptChannel(driver, channel, thresholdDb) {
	const before = await driver.getChannel(channel)
	const did = []
	if (!before.on) {
		await driver.setOn(channel, true)
		did.push('unmuted')
	}
	if (!(before.db >= thresholdDb - SAME_DB)) {
		await driver.setDb(channel, thresholdDb)
		did.push(`fader ${fmtDb(before.db)} → ${fmtDb(thresholdDb)} dB`)
	}
	const after = await driver.getChannel(channel)
	const ok = after.on === true && after.db >= thresholdDb - VERIFY_DB
	if (!did.length) did.push(`already on at ${fmtDb(before.db)} dB`)
	return {
		ok,
		channel,
		before,
		after,
		did,
		...(ok ? {} : { error: `the desk reads ${after.on ? 'on' : 'muted'} at ${fmtDb(after.db)} dB after the change` }),
	}
}

/** @param {{ log?: Function }} [ctx] @param {{ makeDriver?: Function, file?: string }} [deps] */
function createDeskService(ctx, deps = {}) {
	const log = (lvl, m) => ctx?.log?.(lvl, `[audio-desk] ${m}`)
	const makeDriver = deps.makeDriver || createDriver
	let settings = store.loadSettings(deps.file)
	let driver = null
	let status = { state: 'off', detail: 'no desk chosen' }
	const accepted = new Map() // presenter id → { created, at, mic, channel, did, ok, error }; ids are reused slots
	let queue = Promise.resolve()

	const run = (fn) => {
		const p = queue.then(fn, fn)
		queue = p.catch(() => {})
		return p
	}

	function reconnect() {
		if (driver) driver.close()
		driver = null
		if (!settings.model || !settings.host) {
			status = { state: 'off', detail: settings.model ? 'no desk address' : 'no desk chosen' }
			return
		}
		const model = MODELS[settings.model]
		driver = makeDriver(settings.model, {
			host: settings.host,
			port: settings.port || model.port,
			midiChannel: settings.midi_channel,
			log,
		})
		status = { state: 'connecting', detail: `${model.label} at ${settings.host}` }
	}

	/** Ask the desk who it is → status { state: 'ok' | 'error' | 'off', detail }. */
	function probe() {
		return run(async () => {
			if (!driver) return status
			try {
				const info = await driver.probe()
				status = { state: 'ok', detail: info || MODELS[settings.model].label, at: Date.now() }
			} catch (e) {
				status = { state: 'error', detail: e instanceof Error ? e.message : String(e), at: Date.now() }
			}
			return status
		})
	}

	function setSettings(next) {
		const merged = store.normalizeSettings({ ...settings, ...next, mics: next?.mics ?? settings.mics })
		if (!store.saveSettings(merged, deps.file))
			return { status: 500, body: { error: 'could not save the desk settings' } }
		const relink = ['model', 'host', 'port', 'midi_channel'].some((k) => merged[k] !== settings[k])
		settings = merged
		if (relink) {
			reconnect()
			probe()
		}
		return { status: 200, body: view() }
	}

	/** The desk's input names, for matching mics to channels. → { status, body: { channels: [{ channel, name }] } } */
	function channels() {
		return run(async () => {
			if (!driver) return { status: 409, body: { error: status.detail } }
			try {
				return { status: 200, body: { channels: await driver.names(MODELS[settings.model].inputs) } }
			} catch (e) {
				return { status: 502, body: { error: e instanceof Error ? e.message : String(e) } }
			}
		})
	}

	/** Accept a roster presenter: their mic → desk input → ON + fader ≥ threshold. */
	function accept(presenter) {
		return run(async () => {
			if (!presenter) return { status: 404, body: { error: 'no such presenter' } }
			const mic = String(presenter.mic || '').trim()
			const channel = settings.mics[mic]
			const entry = { created: presenter.created, at: Date.now(), mic, channel: channel || 0 }
			if (!mic) return { status: 409, body: { error: `${presenter.name} has no mic number` } }
			if (!channel) return { status: 409, body: { error: `mic ${mic} is not matched to a desk channel` } }
			if (!driver) return { status: 409, body: { error: status.detail } }
			try {
				const r = await acceptChannel(driver, channel, settings.threshold_db)
				Object.assign(entry, { ok: r.ok, did: r.did, error: r.error })
				status = {
					state: 'ok',
					detail: status.state === 'ok' ? status.detail : MODELS[settings.model].label,
					at: Date.now(),
				}
			} catch (e) {
				Object.assign(entry, { ok: false, did: [], error: e instanceof Error ? e.message : String(e) })
				status = { state: 'error', detail: entry.error, at: Date.now() }
			}
			accepted.set(presenter.id, entry)
			log(
				entry.ok ? 'info' : 'warn',
				`accept ${presenter.name} (mic ${mic}) → ch ${channel}: ${entry.ok ? entry.did.join(', ') : entry.error}`
			)
			return { status: entry.ok ? 200 : 502, body: { accepted: entry } }
		})
	}

	function view() {
		return {
			settings,
			status,
			accepted: Object.fromEntries(accepted),
			models: Object.entries(MODELS).map(([id, m]) => ({
				id,
				label: m.label,
				port: m.port,
				inputs: m.inputs,
				midi: !!m.midi,
			})),
			threshold: store.THRESHOLD_DB,
		}
	}

	reconnect()
	if (driver) probe()
	return {
		view,
		setSettings,
		probe,
		channels,
		accept,
		stop: () => driver && driver.close(),
	}
}

module.exports = { createDeskService, acceptChannel, fmtDb }

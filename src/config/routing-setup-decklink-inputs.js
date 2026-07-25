'use strict'

const routingMap = require('./routing-map')
const {
	infoResponseToXml,
	foregroundProducerOnLayer,
	isDecklinkProducerForDevice,
} = require('../caspar/channel-info-xml')

async function setupInputsChannel(self) {
	const channelMap = routingMap.getChannelMap(self.config)
	const decklinkEntries = (Array.isArray(channelMap.inputChannels) ? channelMap.inputChannels : []).filter((e) => e.kind === 'decklink')
	if (!channelMap.decklinkCount || !channelMap.inputsEnabled || decklinkEntries.length === 0 || !self.amcp) {
		self._decklinkInputsStatus = {
			updatedAt: Date.now(),
			enabled: false,
			reason: !self.amcp
				? 'amcp_disconnected'
				: !channelMap.decklinkCount
					? 'decklink_inputs_disabled'
					: decklinkEntries.length === 0
						? 'no_inputs_channel'
						: 'inputs_disabled',
		}
		return
	}
	// WO-53: each DeckLink input has its own dedicated full-quality channel (isolated audio meter).
	self.log('info', `DeckLink inputs: ${decklinkEntries.length} dedicated channel(s) (${decklinkEntries.map((e) => e.channel).join(', ')})`)

	const outputDevices = new Set(); for (let n = 1; n <= channelMap.screenCount; n++) {
		const dlOut = parseInt(String(routingMap.readCasparSetting(self.config, `screen_${n}_decklink_device`) ?? '0'), 10)
		if (dlOut > 0) outputDevices.add(dlOut)
	}
	const mvDlOut = parseInt(String(routingMap.readCasparSetting(self.config, 'multiview_decklink_device') ?? '0'), 10); if (mvDlOut > 0) outputDevices.add(mvDlOut)

	const usedDevices = new globalThis.Map(); const inputDevice = []; const skippedConflicts = []; const skippedDuplicates = []
	for (const entry of decklinkEntries) {
		const i = entry.slot
		const device = routingMap.resolveDecklinkInputDeviceIndex(self.config, i)
		if (outputDevices.has(device)) { skippedConflicts.push({ input: i, device }); continue }
		if (usedDevices.has(device)) { skippedDuplicates.push({ input: i, device, firstUser: usedDevices.get(device) }); continue }
		usedDevices.set(device, i); inputDevice.push({ channel: entry.channel, layer: entry.layer, slot: i, device })
	}

	const failed = []; let playOk = 0; const alreadyOpen = []
	for (const { channel, layer, device } of inputDevice) {
		const res = await tryPlayDecklinkInput(self, { channel, layer, device })
		if (res.ok) {
			playOk++
			// WO-316: distinct from a fresh PLAY. The input is open on the right device; if it also
			// reports has_signal=false the card is fine and the SOURCE is missing — a different
			// operator problem from "the input never opened", and one no retry can fix.
			if (res.alreadyOpen) alreadyOpen.push({ channel, layer, device, hasSignal: res.hasSignal })
		} else failed.push(res.entry)
	}
	self._decklinkInputsStatus = { updatedAt: Date.now(), enabled: true, channels: decklinkEntries.map((e) => e.channel), inputsOnMvr: false, requestedSlots: channelMap.decklinkCount, scheduledPlays: inputDevice.length, playSucceeded: playOk, alreadyOpen, skippedConflicts, skippedDuplicates, failed, retrying: failed.length > 0 }
	for (const a of alreadyOpen) {
		self.log(
			'info',
			`DeckLink ${a.device} input already open on ${a.channel}-${a.layer} — no re-PLAY${a.hasSignal === false ? ' (no signal: check the source is powered and cabled)' : ''}`,
		)
	}
	if (failed.length) {
		for (const f of failed) self.log('warn', `DeckLink input setup: ${f.message} (channel ${f.channel}-${f.layer}) — retrying every ${Math.round(DECKLINK_INPUT_RETRY_MS / 1000)}s`)
	}
	scheduleDecklinkInputRetries(self)
}

/**
 * Read what is currently running on one channel-layer. Returns null on any failure — an
 * unreadable INFO means UNKNOWN, and callers must fall through to attempting the PLAY rather
 * than assuming the layer is empty.
 * @param {object} self
 * @param {number} channel
 * @param {number} layer
 */
async function readForegroundProducer(self, channel, layer) {
	try {
		const res = await self.amcp.raw(`INFO ${channel}`)
		return await foregroundProducerOnLayer(infoResponseToXml(res), layer)
	} catch {
		return null
	}
}

/**
 * PLAY one DeckLink input and classify the outcome.
 *
 * A card input can only be enabled by ONE producer. Caspar builds the new producer BEFORE
 * tearing down the one already on the layer, so re-PLAYing a device that THIS layer already
 * holds fails with `404 PLAY FAILED` every single time — forever, at the retry cadence.
 *
 * That is the live 2026-07-21 case, diagnosed on the box: `PLAY 5-4 DECKLINK 4` retried every
 * 20s and always failed, while INFO showed channel 5 layer 4 ALREADY running
 * `producer=decklink, file.path=4` (has_signal=false — nothing cabled, which is why the first
 * attempt got classified failed and entered the retry set). Nothing else held device 4: no
 * decklink consumer in the running config, and channel 3's output consumer is index 3.
 *
 * So the input was already open and working as far as Caspar was concerned — the retry was
 * fighting its own producer. Check first; only PLAY when the layer does not already hold it.
 *
 * Caspar also reports a genuinely un-openable input (camera powered off, nothing cabled,
 * connector-profile conflict) as `404 PLAY FAILED` — the pre-2026-07-19 code pattern-matched
 * that as SUCCESS, so a dead input was counted healthy and never retried. That classification
 * stays: those failures are transient and MUST keep retrying.
 *
 * @param {object} self
 * @param {{ channel: number, layer: number, device: number }} target
 * @param {{ assumeReleased?: boolean }} [opts] `assumeReleased` when the caller has just STOPped
 *   and CLEARed the layer itself (src/audio/live-input-start.js does exactly that to release the
 *   card before re-acquiring it). The device is provably free at that point, so the INFO probes
 *   below would only cost a round-trip and add a command to a deliberate, asserted restart
 *   sequence. Skip them and go straight to the PLAY.
 */
async function tryPlayDecklinkInput(self, { channel, layer, device }, opts = {}) {
	const probe = opts.assumeReleased !== true
	if (probe) {
		const before = await readForegroundProducer(self, channel, layer)
		if (isDecklinkProducerForDevice(before, device)) {
			return { ok: true, alreadyOpen: true, hasSignal: before.hasSignal }
		}
	}
	try {
		await self.amcp.raw(`PLAY ${channel}-${layer} DECKLINK ${device}`)
		return { ok: true }
	} catch (e) {
		const raw = e?.message || String(e)
		// Race guard: another path may have opened it between the pre-check and the PLAY.
		// If the layer now holds the device we asked for, the PLAY was redundant, not failed.
		const after = probe ? await readForegroundProducer(self, channel, layer) : null
		if (isDecklinkProducerForDevice(after, device)) {
			return { ok: true, alreadyOpen: true, hasSignal: after.hasSignal }
		}
		const message = /404|PLAY FAILED/i.test(raw)
			? `DeckLink ${device} input could not be enabled — source powered off / not cabled, or connector-profile conflict`
			: raw
		return { ok: false, entry: { channel, layer, device, message, raw } }
	}
}

const DECKLINK_INPUT_RETRY_MS = 20000

/**
 * Re-attempt failed DeckLink input PLAYs every {@link DECKLINK_INPUT_RETRY_MS} until they
 * come up (e.g. the operator turns the camera on) — one PLAY per failed device per tick,
 * no storm. Re-arms itself only while failures remain; setupInputsChannel re-runs clear
 * and replace the pending timer so reconnect/config-apply never double-schedules.
 * @param {object} self
 */
function scheduleDecklinkInputRetries(self) {
	if (self._decklinkInputRetryTimer) {
		clearTimeout(self._decklinkInputRetryTimer)
		self._decklinkInputRetryTimer = null
	}
	const status = self._decklinkInputsStatus
	if (!status?.enabled || !Array.isArray(status.failed) || status.failed.length === 0) return
	self._decklinkInputRetryTimer = setTimeout(async () => {
		self._decklinkInputRetryTimer = null
		const cur = self._decklinkInputsStatus
		if (!cur?.enabled || !Array.isArray(cur.failed) || cur.failed.length === 0) return
		if (!self.amcp || self.amcp.isConnected === false) { scheduleDecklinkInputRetries(self); return }
		const stillFailed = []
		let recovered = 0
		for (const entry of cur.failed) {
			const res = await tryPlayDecklinkInput(self, entry)
			if (res.ok) {
				recovered++
				self.log('info', `DeckLink ${entry.device} input recovered (channel ${entry.channel}-${entry.layer})`)
			} else {
				stillFailed.push(res.entry)
			}
		}
		self._decklinkInputsStatus = {
			...cur,
			updatedAt: Date.now(),
			playSucceeded: (cur.playSucceeded || 0) + recovered,
			failed: stillFailed,
			retrying: stillFailed.length > 0,
		}
		scheduleDecklinkInputRetries(self)
	}, DECKLINK_INPUT_RETRY_MS)
	if (typeof self._decklinkInputRetryTimer.unref === 'function') self._decklinkInputRetryTimer.unref()
}

module.exports = {
	setupInputsChannel,
	tryPlayDecklinkInput,
}

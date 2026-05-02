'use strict'

const { resolveCaptureTier } = require('./go2rtc-manager')
const { resolveNdiSourceName } = require('./ndi-resolve')

/** AMCP `info()` resolves to `{ ok, data }` — never `body`. */
function amcpInfoText(info) {
	if (!info) return ''
	const d = info.data
	if (d == null) return ''
	if (Array.isArray(d)) return d.join('\n')
	return String(d)
}

function truncate(s, max) {
	if (s.length <= max) return s
	return s.slice(0, max) + '…'
}

/**
 * FFmpeg UDP output URL for Caspar → go2rtc. `localport` is the **source** port Caspar binds for sending;
 * without it, some Caspar/ffmpeg builds bind the same port as the destination and collide with go2rtc's
 * listener on udp://0.0.0.0:destPort (bind failed: Address already in use).
 * @param {number} port - destination UDP port (e.g. basePort+1)
 */
function casparUdpStreamUri(port) {
	const localport = port + 10000
	return `udp://127.0.0.1:${port}?localport=${localport}`
}

function casparUdpStreamUriVariantsForRemove(port) {
	const dest = `udp://127.0.0.1:${port}`
	const localport = port + 10000
	return [
		`udp://127.0.0.1:${port}?connect=1&localport=${localport}`,
		`udp://127.0.0.1:${port}?localport=${localport}`,
		`udp://127.0.0.1:${port}?connect=1`,
		dest,
	]
}

/**
 * Returns a list of active STREAM URIs for a channel by parsing `INFO <channel>`.
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number} channel
 * @returns {Promise<string[]>}
 */
async function getActiveStreamUris(amcp, channel) {
	if (!amcp || !amcp.isConnected) return []
	try {
		const info = await amcp.info(channel)
		const text = amcpInfoText(info)
		// Extract all udp://... URIs from STREAM consumers
		// Lines usually look like: #2 STREAM udp://127.0.0.1:10035?localport=20035 ...
		const matches = text.matchAll(/STREAM\s+(\S+)/gi)
		return [...matches].map((m) => m[1])
	} catch {
		return []
	}
}

/**
 * Caspar can stop replying to AMCP while shutting down; unbounded waits block SIGTERM shutdown.
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {string} cmd
 * @param {number} [ms]
 */
function amcpRawWithTimeout(amcp, cmd, ms = 8000) {
	return Promise.race([
		amcp.raw(cmd),
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error(`AMCP timeout after ${ms}ms: ${truncate(cmd, 72)}`)), ms)
		),
	])
}

/**
 * After Caspar ADD STREAM, ffmpeg may exit quickly; compare INFO a few seconds later.
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {Array<{channel: number, port: number}>} targets
 * @param {number} [delayMs]
 */
function scheduleVerifyUdpStreams(amcp, targets, delayMs = 2500) {
	if (!amcp || !targets.length) return
	setTimeout(() => {
		void (async () => {
			for (const t of targets) {
				const uri = `udp://127.0.0.1:${t.port}`
				try {
					const info = await amcp.info(t.channel)
					const text = amcpInfoText(info)
					const hasUdp = text.includes(uri)
					console.log(
						`[Streaming] VERIFY ch${t.channel} port ${t.port}: INFO contains ${uri} → ${hasUdp} (INFO length ${text.length})`
					)
					if (!hasUdp) {
						console.warn(`[Streaming] VERIFY ch${t.channel} INFO excerpt:\n${truncate(text, 900)}`)
					}
				} catch (e) {
					console.warn(`[Streaming] VERIFY ch${t.channel} failed:`, e?.message || e)
				}
			}
		})()
	}, delayMs)
}

/**
 * Builds the ffmpeg arguments for the CasparCG ADD STREAM command (MPEG-TS bridge to go2rtc).
 * Caspar expects: ADD n STREAM <output_url> <ffmpeg args…>.
 * **Must use `-format mpegts`**, not `-f mpegts`: Caspar's ffmpeg_consumer maps `-name value` into an options
 * map and only reads `options["format"]` for avformat_alloc_output_context2. The flag `-f` becomes key `f`, so
 * the muxer format was never set — FFmpeg then errors "Unable to choose an output format" for udp:// / srt://.
 *
 * We use **UDP** to 127.0.0.1:port (not srt://): many Caspar 2.5 builds cannot open srt:// output
 * ("Unable to choose an output format") when libsrt is missing or SRT mux is not wired for STREAM.
 * go2rtc listens on `udp://0.0.0.0:port`; Caspar must send to `127.0.0.1:port` with a **different** local bind
 * (`?localport=`, see `casparUdpStreamUri`) so the ports do not collide.
 *
 * Caspar’s ffmpeg consumer only forwards **`-name:stream`** style options (`-filter:v`, `-preset:v`, …).
 * **`-vf`**, **`-g`**, **`-r`** are ignored (“Unused option”) — then **yuv420p** / keyframes / headers are wrong
 * and go2rtc hits **H.264 PPS** errors and **AAC channel** errors on multi-channel buses.
 *
 * **`-filter:v`** chain includes **format=yuv420p**; **`-g:v`** + **`-x264-params:v`** (two tokens) for GOP + **repeat-headers**
 * (Caspar logs showed **`-x264-params`** without **`:v`** and **`-ac`** as unused — they must use **`-name:stream`**).
 * Audio: **`-filter:a`** downmix to stereo (Caspar’s own client uses **`-filter:a pan=…`**); **`-ac`** / mux flags are not forwarded.
 */
/** Dynamic downscale: half of Caspar channel size (e.g. 3840×768 → 1920×384). Fast preview default. */
const SCALE_HALF_VF = 'scale=w=iw/2:h=ih/2'

function buildFfmpegArgs(config) {
	const fps =
		config.fps && config.fps !== 'native' ? Math.max(1, parseInt(String(config.fps), 10) || 25) : 25
	const resMap = { '720p': '1280:720', '540p': '960:540', '360p': '640:360' }

	let filterV = `format=yuv420p,fps=${fps}`
	if (config.resolution === 'half') {
		filterV = `${SCALE_HALF_VF},format=yuv420p,fps=${fps}`
	} else if (config.resolution && config.resolution !== 'native' && resMap[config.resolution]) {
		filterV = `scale=${resMap[config.resolution]},format=yuv420p,fps=${fps}`
	}

	// At very low fps (e.g. preview preset = 1), keep GOP short so the first decodable frame is not ~24s away.
	const keyint = fps <= 5 ? 1 : Math.max(2 * fps, 24)
	const minKeyint = fps <= 5 ? 1 : fps
	// `-g:v` sets GOP; `repeat-headers` must be in x264-params (two tokens: `-x264-params:v` then value).
	const x264opts = `min-keyint=${minKeyint}:scenecut=0:repeat-headers=1`

	let args = `-filter:v ${filterV}`
	args += ` -codec:v libx264 -preset:v ultrafast -tune:v zerolatency`
	if (config.maxBitrate) {
		args += ` -b:v ${config.maxBitrate}k`
	}
	args += ` -g:v ${keyint}`
	args += ` -x264-params:v ${x264opts}`
	// Stereo downmix + 48 kHz before AAC (matches Caspar client’s -filter:a pattern).
	args += ` -filter:a aformat=channel_layouts=stereo,aresample=48000`
	args += ` -codec:a aac -b:a 128k`
	args += ` -format mpegts`

	return args
}

/**
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {Array<{channel: number, port: number}>} targets
 * @param {Object} config (from stream-config)
 */
async function addStreamingConsumers(amcp, targets, config) {
	if (!amcp || !amcp.isConnected) {
		console.warn('[Streaming] addStreamingConsumers: AMCP not connected — skip')
		return
	}

	const tier = resolveCaptureTier(config.captureMode || 'udp', config._casparHost || '127.0.0.1')
	console.log(`[Streaming] addStreamingConsumers: tier=${tier} targets=${targets.map((t) => `ch${t.channel}:${t.port}`).join(', ')}`)

	if (tier === 'local') {
		// Local capture mode: go2rtc captures directly from X11/DRM.
		// No CasparCG consumers needed — the server renders to screen and we grab it.
		console.log('[Streaming] Local capture mode — skipping CasparCG ADD STREAM (x11grab/kmsgrab handles capture)')
		return
	}

	if (tier === 'ndi') {
		// CasparCG outputs NDI natively (AMCP consumer type — sends channel to the network; no ffmpeg on Caspar).
		// go2rtc separately uses ffmpeg libndi_newtek_input to receive those streams for WebRTC preview.
		for (const t of targets) {
			const ndiName = resolveNdiSourceName(config, t.channel)
			try {
				const info = await amcp.info(t.channel)
				if (amcpInfoText(info).includes('NDI')) {
					console.log(`[Streaming] NDI output already registered on channel ${t.channel}`)
					continue
				}
			} catch { /* proceed */ }

			const cmd = `ADD ${t.channel} NDI "${ndiName}"`
			try {
				const res = await amcp.raw(cmd)
				console.log(
					`[Streaming] Registered Caspar NDI: ch${t.channel} → "${ndiName}" (${truncate(amcpInfoText(res), 80)})`
				)
				await new Promise((r) => setTimeout(r, 100))
			} catch (e) {
				console.error(`[Streaming] Failed to register NDI output on channel ${t.channel}:`, e.message)
			}
		}
		return
	}

	// MPEG-TS over UDP to localhost. go2rtc ingests with `ffmpeg:udp://0.0.0.0:port` (see go2rtc-manager).
	const ffmpegArgs = buildFfmpegArgs(config)

	for (const t of targets) {
		const uri = casparUdpStreamUri(t.port)

		const active = await getActiveStreamUris(amcp, t.channel)
		const variants = casparUdpStreamUriVariantsForRemove(t.port)
		
		for (const u of active) {
			// If it's a UDP stream we recognize (matches one of our variants) or any UDP stream on this port
			if (variants.includes(u) || u.includes(`:${t.port}`)) {
				try {
					await amcp.raw(`REMOVE ${t.channel} STREAM ${u}`)
					console.log(`[Streaming] pre-ADD REMOVE ch${t.channel} STREAM ${u}`)
				} catch (e) {
					console.log(`[Streaming] pre-ADD REMOVE ch${t.channel} failed: ${e?.message || e}`)
				}
			}
		}
		await new Promise((r) => setTimeout(r, 150))

		const cmd = `ADD ${t.channel} STREAM ${uri} ${ffmpegArgs}`
		try {
			const res = await amcp.raw(cmd)
			console.log(
				`[Streaming] ADD STREAM ch${t.channel} ${uri} → AMCP ${truncate(amcpInfoText(res), 100)}`
			)
			await new Promise((r) => setTimeout(r, 100))
		} catch (e) {
			console.error(`[Streaming] Failed ADD STREAM ch${t.channel}:`, e.message)
		}
	}

	scheduleVerifyUdpStreams(amcp, targets)
}

/**
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {Array<{channel: number, port: number}>} targets
 * @param {Object} [config]
 */
async function removeStreamingConsumers(amcp, targets, config) {
	if (!amcp || !amcp.isConnected) {
		console.warn('[Streaming] removeStreamingConsumers: AMCP not connected — skip')
		return
	}

	const tier = config ? resolveCaptureTier(config.captureMode || 'udp', config._casparHost || '127.0.0.1') : 'udp'
	console.log(`[Streaming] removeStreamingConsumers: tier=${tier}`)

	for (const t of targets) {
		if (tier === 'ndi') {
			const ndiName = resolveNdiSourceName(config || {}, t.channel)
			try {
				console.log(`[Streaming] REMOVE ch${t.channel} NDI "${ndiName}"`)
				await amcpRawWithTimeout(amcp, `REMOVE ${t.channel} NDI "${ndiName}"`)
				await new Promise((r) => setTimeout(r, 100))
			} catch (e) {
				console.warn(`[Streaming] REMOVE NDI ch${t.channel}:`, e?.message || e)
			}
		} else if (tier === 'udp') {
			const active = await getActiveStreamUris(amcp, t.channel)
			const variants = casparUdpStreamUriVariantsForRemove(t.port)
			for (const u of active) {
				if (variants.includes(u) || u.includes(`:${t.port}`)) {
					try {
						console.log(`[Streaming] REMOVE ch${t.channel} STREAM ${u}`)
						await amcpRawWithTimeout(amcp, `REMOVE ${t.channel} STREAM ${u}`)
						await new Promise((r) => setTimeout(r, 100))
					} catch (e) {
						console.warn(`[Streaming] REMOVE STREAM ch${t.channel} ${u}:`, e?.message || e)
					}
				}
			}
		}
		// local mode: nothing to remove
	}
}

module.exports = {
	SCALE_HALF_VF,
	buildFfmpegArgs,
	casparUdpStreamUri,
	casparUdpStreamUriVariantsForRemove,
	getActiveStreamUris,
	amcpInfoText,
	truncate,
	addStreamingConsumers,
	removeStreamingConsumers,
}

'use strict'

/** WO-1026 — what the active two-box checks measure on a server: a Caspar layer, the logs, a media file, load. */

const { sleep } = require('./lib')

const NOISE = /Failed to enable external keyer/i // standard on DeckLink outputs, not an error of the run

/**
 * `INFO <channel>` (this build answers the whole channel) → what stage layer `n` shows:
 * { empty, producer, text } — `text` is the foreground block, flattened, for the report.
 */
function layerOf(infoXml, n) {
	const flat = String(infoXml).replace(/\s+/g, ' ')
	const stage = flat.slice(Math.max(0, flat.indexOf('<stage>')))
	const m = new RegExp(`<layer_${n}>(.*?)</layer_${n}>`).exec(stage)
	if (!m) return { empty: true, producer: '', text: '' }
	const fg = /<foreground>(.*?)<\/foreground>/.exec(m[1])?.[1] || ''
	const producer = /<producer>([^<]+)<\/producer>/.exec(fg)?.[1] || ''
	return { empty: !producer || producer === 'empty', producer, text: fg.trim().slice(0, 700) }
}

/** Does that layer show DeckLink input `slot`, which this server hosts on `channel`? (a route to it, or the device itself) */
function showsInput(layer, slot, channel) {
	if (layer.empty) return false
	if (/decklink/i.test(layer.producer)) return new RegExp(`<path>${slot}</path>`).test(layer.text)
	return new RegExp(`route://${channel}\\b|<channel>${channel}</channel>|\\b${channel}-${slot}\\b`).test(layer.text)
}

const CASPAR_LOG = '$HOME/highascg/log/caspar_$(date +%F).log'

/** A mark in a server's Caspar log + journal: read with logsSince(). */
async function logMark(box) {
	const r = await box.sh(`wc -l < ${CASPAR_LOG} 2>/dev/null || echo 0`)
	return { line: parseInt(r.out, 10) || 0, at: Math.floor(Date.now() / 1000) }
}

/** Since the mark → { caspar: [error / warning lines], node: [error lines] } without the known noise. */
async function logsSince(box, mark) {
	const c = await box.sh(`tail -n +${mark.line + 1} ${CASPAR_LOG} 2>/dev/null | grep -E "\\[(error|warning)\\]" | tail -200 || true`)
	const n = await box.sh(`journalctl -u highascg --since @${mark.at} --no-pager -o cat 2>&1 | grep -E "\\[error\\]|\\[warn\\]" | tail -200 || true`)
	const lines = (t) => t.split('\n').map((l) => l.trim()).filter((l) => l && !NOISE.test(l))
	return { caspar: lines(c.out), node: lines(n.out) }
}

/** ffprobe on that server → { video: { codec, width, height, fps, frames }, audio: n, duration } or { error }. */
async function probeMedia(box, file) {
	const r = await box.sh(`ffprobe -v error -count_packets -show_entries stream=codec_type,codec_name,width,height,r_frame_rate,nb_read_packets:format=duration -of json '${file}'`, 120000)
	let doc = null
	try {
		doc = JSON.parse(r.out)
	} catch {
		return { error: (r.err || r.out || 'ffprobe failed').trim().slice(0, 300) }
	}
	const v = (doc.streams || []).find((s) => s.codec_type === 'video')
	if (!v) return { error: 'no video stream' }
	const [a, b] = String(v.r_frame_rate || '0/1').split('/').map(Number)
	return {
		video: { codec: v.codec_name, width: v.width, height: v.height, fps: b ? a / b : 0, frames: Number(v.nb_read_packets) || 0 },
		audio: (doc.streams || []).filter((s) => s.codec_type === 'audio').length,
		duration: Number(doc.format?.duration) || 0,
	}
}

/** GPU load of that server right now: { util (%), mem (MiB) } or null. */
async function gpu(box) {
	const r = await box.sh('nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader,nounits', 10000)
	const [util, mem] = r.out.trim().split(',').map((x) => Number(x))
	return Number.isFinite(util) ? { util, mem } : null
}

/** One timed API round trip (ms) — the same small call the cluster poll makes. */
async function apiMs(box) {
	const t = process.hrtime.bigint()
	await box.get('/api/replication/ping', 5000)
	return Number(process.hrtime.bigint() - t) / 1e6
}

/**
 * An RTMP receiver on `box` listening for `seconds` (ffmpeg -listen 1, copy to a .flv) → { file, log, done() }.
 * done() waits for it to exit (the sender stopped, or the time ran out) and returns the file path.
 */
async function rtmpReceiver(box, url, seconds, dir) {
	const file = `${dir}/rx-${Date.now()}.flv`
	const listen = url.replace(/^rtmp:\/\/[^/:]+/, 'rtmp://0.0.0.0')
	await box.sh(`mkdir -p '${dir}'; nohup ffmpeg -y -loglevel error -listen 1 -timeout ${seconds + 30} -i '${listen}' -t ${seconds} -c copy '${file}' > '${file}.log' 2>&1 &`)
	await sleep(1200)
	return {
		file,
		async done(maxMs) {
			const end = Date.now() + maxMs
			while (Date.now() < end) {
				const r = await box.sh(`pgrep -f 'rx-[0-9]+\\.flv' > /dev/null && echo run || echo gone`)
				if (r.out.includes('gone')) break
				await sleep(1000)
			}
			await box.sh(`pkill -TERM -f '[f]fmpeg -y -loglevel error -listen 1' || true`)
			return file
		},
	}
}

const pct = (xs, p) => {
	const s = [...xs].sort((a, b) => a - b)
	return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0
}

module.exports = { layerOf, showsInput, logMark, logsSince, probeMedia, gpu, apiMs, rtmpReceiver, pct }

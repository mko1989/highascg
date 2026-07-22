#!/usr/bin/env node
'use strict'
/**
 * WO-319 standalone test harness — prove the ENTIRE NVENC→browser decode pipeline without touching
 * the running highascg service or requiring a restart.
 *
 * It reuses the exact production modules (gui-stream-ingest + the GOP relay policy + the wire
 * format), adds the same verified NVENC consumer to the operator-GUI channel, and serves a
 * self-contained WebCodecs page on its OWN port. Open it in Firefox on the box:
 *
 *     node tools/runtime/gui-stream-standalone-test.js
 *     # then browse to http://127.0.0.1:9280/
 *
 * You should see live motion from channel 4 decoded by WebCodecs. Ctrl-C removes the consumer.
 * Nothing about the production service or channel 4's real output is disturbed (the encode is an
 * added consumer, verified non-disruptive on 2026-07-22).
 */

const http = require('http')
const net = require('net')
const { WebSocketServer } = require('ws')

const { createGuiStreamIngest } = require('../../src/preview/gui-stream-ingest')
const { createClientCursor, framesForClient } = require('../../src/preview/gui-stream-gop-buffer')
const { encodeWireFrame } = require('../../src/preview/gui-stream-ws-relay')

const HTTP_PORT = Number(process.env.GUI_TEST_PORT || 9280)
const AMCP_PORT = Number(process.env.AMCP_PORT || 5250)
const CHANNEL = Number(process.env.GUI_TEST_CHANNEL || 4)
const SCALE = process.env.GUI_TEST_SCALE || '1920:-2'

/** Minimal AMCP raw client (same shape the ingest expects). */
function makeAmcp(port) {
	const sock = net.connect(port, '127.0.0.1')
	let buf = ''
	const waiters = []
	sock.setEncoding('utf8')
	sock.on('data', (d) => {
		buf += d
		let i
		while ((i = buf.indexOf('\r\n')) >= 0) {
			const line = buf.slice(0, i)
			buf = buf.slice(i + 2)
			if (/^\d{3}/.test(line) && waiters.length) waiters.shift()(line)
		}
	})
	sock.on('error', (e) => console.error('[amcp] socket error', e.message))
	return {
		raw: (cmd) =>
			new Promise((res, rej) => {
				const to = setTimeout(() => rej(new Error(`AMCP timeout: ${cmd.slice(0, 30)}`)), 5000)
				waiters.push((line) => {
					clearTimeout(to)
					if (/^(2\d\d|101)/.test(line)) res(line)
					else rej(new Error(`AMCP ${line}`))
				})
				sock.write(cmd + '\r\n')
			}),
		close: () => sock.destroy(),
	}
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>WO-319 GUI stream test</title>
<style>
 body{margin:0;background:#111;color:#ccc;font:14px system-ui;display:flex;flex-direction:column;height:100vh}
 header{padding:8px 12px;background:#1a1a1e;border-bottom:1px solid #333}
 #stat{font-family:monospace;font-size:12px;color:#8c8}
 #wrap{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden}
 canvas{max-width:100%;max-height:100%;background:#000;box-shadow:0 0 30px #000}
</style></head><body>
<header>WO-319 live decode — channel ${CHANNEL} · <span id="stat">connecting…</span></header>
<div id="wrap"><canvas id="c"></canvas></div>
<script>
const HDR=8, KEY=1;
const cv=document.getElementById('c'), cx=cv.getContext('2d'), stat=document.getElementById('stat');
let frames=0, seenKey=false, cfg=null, last=performance.now(), fps=0;
if(!('VideoDecoder' in window)){ stat.textContent='WebCodecs NOT available in this browser'; }
const dec=new VideoDecoder({
  output:f=>{
    frames++;
    if(cv.width!==f.displayWidth){cv.width=f.displayWidth;cv.height=f.displayHeight;}
    cx.drawImage(f,0,0); f.close();
    const now=performance.now(); fps=1000/(now-last); last=now;
  },
  error:e=>{ stat.textContent='decoder error: '+e.message; }
});
function connect(){
  const ws=new WebSocket((location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/ws/gui-stream');
  ws.binaryType='arraybuffer';
  ws.onmessage=ev=>{
    if(typeof ev.data==='string'){ cfg=JSON.parse(ev.data);
      if(cfg.type==='gui_stream_config'){ try{ dec.configure({codec:cfg.codec,optimizeForLatency:true}); seenKey=false; }catch(e){ stat.textContent='configure fail: '+e.message; } }
      return; }
    const v=new DataView(ev.data); const seq=v.getUint32(0,true); const key=(v.getUint8(4)&KEY)!==0;
    if(!seenKey){ if(!key) return; seenKey=true; }
    if(dec.state!=='configured') return;
    try{ dec.decode(new EncodedVideoChunk({type:key?'key':'delta',timestamp:Math.round(seq*(1e6/(cfg?.fps||50))),data:new Uint8Array(ev.data,HDR)})); }
    catch(e){ stat.textContent='decode fail: '+e.message; }
  };
  ws.onclose=()=>{ stat.textContent='disconnected — retrying'; setTimeout(connect,1000); };
  ws.onerror=()=>{};
}
connect();
setInterval(()=>{ stat.textContent='frames='+frames+'  ~'+fps.toFixed(0)+' fps  codec='+(cfg?.codec||'?'); },500);
</script></body></html>`

const amcp = makeAmcp(AMCP_PORT)
const ingest = createGuiStreamIngest({
	amcp,
	channel: CHANNEL,
	scale: SCALE,
	lingerMs: 3000,
	log: (lvl, m) => console.log(`[${lvl}] ${m}`),
})

const server = http.createServer((req, res) => {
	if ((req.url || '/').split('?')[0] === '/') {
		res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
		res.end(PAGE)
		return
	}
	res.writeHead(404)
	res.end()
})

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false })
const clients = new Set()
server.on('upgrade', (req, socket, head) => {
	if ((req.url || '').split('?')[0] !== '/ws/gui-stream') return socket.destroy()
	wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws))
})
wss.on('connection', (ws) => {
	const entry = { ws, cursor: createClientCursor() }
	clients.add(entry)
	console.log(`[test] browser connected (${clients.size})`)
	ws.send(JSON.stringify({ type: 'gui_stream_config', codec: 'avc1.4d002a', channel: CHANNEL, fps: 50, gop: 50 }))
	ingest.acquire().then(() => pump(entry)).catch((e) => console.error('[test] acquire failed', e.message))
	ws.on('close', () => {
		clients.delete(entry)
		ingest.release()
		console.log(`[test] browser left (${clients.size})`)
	})
	ws.on('error', () => {})
})
function pump(entry) {
	if (entry.ws.readyState !== 1) return
	if (entry.ws.bufferedAmount > 2 * 1024 * 1024) return
	for (const f of framesForClient(ingest.buffer, entry.cursor).frames) entry.ws.send(encodeWireFrame(f))
}
ingest.events.on('au', () => {
	for (const e of clients) pump(e)
})

server.listen(HTTP_PORT, '127.0.0.1', () => {
	console.log(`\n  WO-319 test harness up.  Open Firefox on the box to:\n\n      http://127.0.0.1:${HTTP_PORT}/\n\n  Channel ${CHANNEL}, scale ${SCALE}. Ctrl-C to stop and remove the consumer.\n`)
})

async function shutdown() {
	console.log('\n[test] shutting down — removing consumer…')
	try {
		await ingest.stop()
	} catch {
		/* best effort */
	}
	amcp.close()
	process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

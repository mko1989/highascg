// WO-902 dev tool: put in front of the box server to see what a client WOULD write — GET + WS pass to :4200, every POST is
// logged and swallowed, GET /api/operator-gui/layout serves the fixture. node tools/dev/readonly-proxy.js <layout.json>
// then HIGHASCG_SERVER=http://127.0.0.1:4299 (or HIGHASCG_TEST_SERVER for run-client.sh --check).
const http = require('http'), net = require('net'), fs = require('fs')
const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const srv = http.createServer((req, res) => {
	if (req.method !== 'GET') {
		let b = ''
		req.on('data', (d) => (b += d))
		req.on('end', () => {
			console.log('POST', req.url, req.url.includes('operator-gui/layout') ? b : b.length + 'B')
			res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}')
		})
		return
	}
	if (req.url.startsWith('/api/operator-gui/layout')) {
		return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, channel: 1, cells: fixture.cells, atlas: null }))
	}
	const p = http.request({ host: '127.0.0.1', port: 4200, path: req.url, method: 'GET', headers: req.headers }, (r) => {
		res.writeHead(r.statusCode, r.headers)
		r.pipe(res)
	})
	p.on('error', () => res.writeHead(502).end())
	p.end()
})
srv.on('upgrade', (req, sock, head) => {
	const up = net.connect(4200, '127.0.0.1', () => {
		up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n')
		up.write(head)
		up.pipe(sock)
		sock.pipe(up)
	})
	up.on('error', () => sock.destroy())
	sock.on('error', () => up.destroy())
})
srv.listen(4299, '127.0.0.1', () => console.log('proxy on 4299'))

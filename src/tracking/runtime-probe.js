'use strict'

/**
 * WO-1094 — gathers the facts runtime-status.evaluate() judges: the system python3, the venv (pyvenv.cfg, lib dirs,
 * interpreter), an import check run by the venv's own Python (numpy, cv2, onnxruntime + its providers; cached until
 * pyvenv.cfg or site-packages change), the model files, free disk, and — only when asked — internet reachability
 * (cached 60 s). Async throughout: the import check takes ~1 s and never runs on a hot path.
 */

const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')
const { runtimePaths, loadFeatures } = require('./runtime-paths')
const { evaluate } = require('./runtime-status')

const PROBE_PY = [
	'import json, sys',
	'out = {"version": "%d.%d.%d" % sys.version_info[:3], "imports": {}, "providers": []}',
	'for m in ("numpy", "cv2", "onnxruntime"):',
	'    try:',
	'        mod = __import__(m)',
	'        out["imports"][m] = {"ok": True, "version": str(getattr(mod, "__version__", ""))}',
	'    except Exception as e:',
	'        out["imports"][m] = {"ok": False, "error": ("%s: %s" % (type(e).__name__, e))[:200]}',
	'try:',
	'    import onnxruntime',
	'    out["providers"] = list(onnxruntime.get_available_providers())',
	'except Exception:',
	'    pass',
	'print(json.dumps(out))',
].join('\n')

function execJson(file, args, timeout = 30000, exec = childProcess.execFile) {
	return new Promise((resolve) => {
		exec(file, args, { timeout, maxBuffer: 1 << 20, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }, (err, stdout, stderr) => {
			if (err) return resolve({ error: (String(stderr || '').trim().split('\n').pop() || err.message).slice(0, 200) })
			try {
				resolve(JSON.parse(String(stdout).trim().split('\n').pop()))
			} catch {
				resolve({ error: 'unreadable output: ' + String(stdout).slice(0, 120) })
			}
		})
	})
}

const statOr = (p) => {
	try {
		return fs.statSync(p)
	} catch {
		return null
	}
}

function dirBytes(dir, depth = 0) {
	let n = 0
	let list
	try {
		list = fs.readdirSync(dir, { withFileTypes: true })
	} catch {
		return 0
	}
	for (const e of list) {
		const p = path.join(dir, e.name)
		if (e.isDirectory() && depth < 12) n += dirBytes(p, depth + 1)
		else if (e.isFile()) n += statOr(p)?.size || 0
	}
	return n
}

async function freeMb(dir) {
	let d = dir
	while (d !== '/' && !statOr(d)) d = path.dirname(d)
	try {
		const s = await fs.promises.statfs(d)
		return Math.floor((s.bavail * s.bsize) / 1048576)
	} catch {
		return null
	}
}

function createProbe(deps = {}) {
	const exec = deps.execFile || childProcess.execFile
	let sys = null // { at, value }
	const probes = new Map() // python path → { key, value }
	const sizes = new Map() // venv → { key, bytes }
	let net = { at: 0, value: null }

	async function system() {
		if (sys && Date.now() - sys.at < 60000) return sys.value
		const r = await execJson('python3', ['-c', 'import json, sys\ntry:\n import venv\n v = True\nexcept Exception:\n v = False\nprint(json.dumps({"version": "%d.%d.%d" % sys.version_info[:3], "venv": v}))'], 10000, exec)
		sys = { at: Date.now(), value: r.error ? { version: null, venv: false } : r }
		return sys.value
	}

	function venvFacts(p) {
		const cfg = statOr(path.join(p.venv, 'pyvenv.cfg'))
		if (!cfg) return { exists: false }
		let cfgVersion = null
		try {
			cfgVersion = /^version(?:_info)?\s*=\s*([\d.]+)/m.exec(fs.readFileSync(path.join(p.venv, 'pyvenv.cfg'), 'utf8'))?.[1] || null
		} catch {
			/* unreadable cfg = no version */
		}
		let libDirs = []
		try {
			libDirs = fs.readdirSync(path.join(p.venv, 'lib')).filter((d) => /^python\d+\.\d+$/.test(d)).sort()
		} catch {
			/* no lib dir */
		}
		const site = libDirs.map((d) => statOr(path.join(p.venv, 'lib', d, 'site-packages'))?.mtimeMs || 0).join(',')
		const key = `${cfg.mtimeMs}:${site}`
		let size = sizes.get(p.venv)
		if (!size || size.key !== key) sizes.set(p.venv, (size = { key, bytes: dirBytes(p.venv) }))
		return { exists: true, python: !!statOr(p.python), cfgVersion, libDirs, key, bytes: size.bytes, installedAt: cfg.mtimeMs }
	}

	async function importCheck(p, v) {
		if (!v.exists || !v.python) return null
		const hit = probes.get(p.python)
		if (hit && hit.key === v.key) return hit.value
		const value = await execJson(p.python, ['-I', '-c', PROBE_PY], 30000, exec)
		probes.set(p.python, { key: v.key, value })
		return value
	}

	function models(p) {
		const out = {}
		const partial = []
		let list
		try {
			list = fs.readdirSync(p.models)
		} catch {
			return { models: out, partial }
		}
		for (const f of list) {
			if (/\.onnx\.(part|dl)$/.test(f)) partial.push(f.replace(/\.(part|dl)$/, ''))
			else if (f.endsWith('.onnx')) {
				const s = statOr(path.join(p.models, f))
				if (s?.isFile()) out[f] = { bytes: s.size, mtime: Math.round(s.mtimeMs) }
			}
		}
		return { models: out, partial }
	}

	/** reachability of what an online install downloads from (node's fetch: no proxy env) */
	async function internet(force = false) {
		if (!force && net.value && Date.now() - net.at < 60000) return net.value
		const doFetch = deps.fetch || fetch
		const hosts = ['https://pypi.org/simple/pip/', 'https://github.com/ultralytics/assets/releases']
		let value = { ok: true, error: '' }
		for (const u of hosts) {
			try {
				await doFetch(u, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
			} catch (e) {
				value = { ok: false, error: `cannot reach ${new URL(u).host} (${e?.cause?.code || e?.message || e})` }
				break
			}
		}
		net = { at: Date.now(), value }
		return value
	}

	/** → { facts, status, paths, free_mb } */
	async function status(prefix, { withNet = false } = {}) {
		const p = runtimePaths(prefix)
		const [system_, free] = await Promise.all([system(), freeMb(p.prefix)])
		const venv = venvFacts(p)
		const probe = await importCheck(p, venv)
		const facts = { system: system_, venv, probe, ...models(p) }
		const out = { ...evaluate(facts, loadFeatures()), paths: p, free_mb: free }
		if (withNet) out.internet = await internet()
		return out
	}

	return { status, internet, forget: () => (probes.clear(), sizes.clear(), (sys = null)) }
}

module.exports = { createProbe, freeMb }

'use strict'

/** WO-730 — the machine under the app: services, clock, disks, GPU, ports, SSH trust, the existing startup verifiers. */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { REPO, sh, has, unit } = require('./sweep-util')

const CORE_UNITS = ['highascg', 'casparcg-server', 'casparcg-scanner', 'nodm']
const PORTS = { 4200: 'HighAsCG', 5250: 'Caspar AMCP', 8000: 'media scanner' }

/** df → [{ mount, size, avail, pct }] for the given paths (deduplicated by mount). */
function disks(paths) {
	const r = sh('df', ['-P', '-B1', ...paths.filter((p) => fs.existsSync(p))])
	const seen = new Map()
	for (const l of r.out.trim().split('\n').slice(1)) {
		const f = l.split(/\s+/)
		if (f.length < 6) continue
		seen.set(f[5], { mount: f[5], size: Number(f[1]), avail: Number(f[3]) })
	}
	return [...seen.values()]
}

/** WO-730 disk rule: fail under 2 % or 1 GB free, warn under 10 % or 10 GB. */
function diskStatus({ size, avail }) {
	const pct = size ? (avail / size) * 100 : 100
	if (pct < 2 || avail < 1e9) return 'fail'
	if (pct < 10 || avail < 10e9) return 'warn'
	return 'pass'
}

/** Option-less authorized_keys lines that carry a HighAsCG replication key (WO-729: a full shell). */
function plainReplicationKeys(text) {
	return text.split('\n').filter((l) => /^(ssh-|ecdsa-)/.test(l.trim()) && /\shighascg-replication@/.test(l))
}

const verifier = (id, name, script, { timeoutMs = 60000 } = {}) => ({
	id,
	name,
	async run() {
		const file = path.join(REPO, 'tools/startup', script)
		if (!fs.existsSync(file)) return { status: 'skip', summary: `${script} missing` }
		if (!unit('highascg')) return { status: 'skip', summary: 'not a HighAsCG box (no highascg unit)' }
		const r = sh('bash', [file], { timeoutMs })
		const lines = `${r.out}\n${r.err}`.split('\n')
		const fails = lines.filter((l) => /^FAIL\b/.test(l.trim()))
		const warns = lines.filter((l) => /^WARN\b/.test(l.trim()))
		const oks = lines.filter((l) => /^(OK|PASS)\b/.test(l.trim())).length
		if (r.timedOut) return { status: 'fail', summary: `${script} did not finish in ${timeoutMs / 1000} s` }
		if (r.code !== 0 || fails.length)
			return { status: 'fail', summary: `${fails.length} failed, ${oks} ok`, details: fails.slice(0, 6) }
		return {
			status: warns.length ? 'warn' : 'pass',
			summary: `${oks} ok${warns.length ? `, ${warns.length} warn` : ''}`,
			details: warns.slice(0, 4),
		}
	},
})

module.exports = [
	{
		id: 'system.services',
		name: 'core services active, no failed units',
		async run() {
			if (!has('systemctl')) return { status: 'skip', summary: 'no systemd' }
			const down = []
			const present = []
			for (const u of CORE_UNITS) {
				const s = unit(u)
				if (!s) continue
				present.push(u)
				if (s.active !== 'active') down.push(`${u} ${s.active}`)
			}
			if (!present.length) return { status: 'skip', summary: 'not a HighAsCG box (no core units)' }
			const failed = sh('systemctl', ['--failed', '--no-legend', '--plain'])
				.out.trim()
				.split('\n')
				.filter(Boolean)
				.map((l) => l.split(/\s+/)[0])
			if (down.length) return { status: 'fail', summary: `down: ${down.join(', ')}`, details: failed }
			if (failed.length)
				return { status: 'warn', summary: `${present.length} core active · failed units: ${failed.join(', ')}` }
			return { status: 'pass', summary: `${present.join(', ')} active` }
		},
	},
	{
		id: 'system.clock',
		name: 'clock synced (NTP) and a local time zone',
		async run() {
			const r = sh('timedatectl', ['show'])
			if (r.missing || r.code !== 0) return { status: 'skip', summary: 'no timedatectl' }
			const p = Object.fromEntries(
				r.out
					.trim()
					.split('\n')
					.map((l) => l.split('='))
			)
			if (p.NTPSynchronized !== 'yes')
				return {
					status: p.NTP === 'yes' ? 'warn' : 'fail',
					summary: `NTP ${p.NTP === 'yes' ? 'on but not synced yet' : 'off'}: Settings → System → System time`,
				}
			if (/^(Etc\/)?UTC$/.test(p.Timezone))
				return {
					status: 'warn',
					summary: `synced, but the time zone is ${p.Timezone}: sudo timedatectl set-timezone Europe/Warsaw`,
				}
			return { status: 'pass', summary: `synced · ${p.Timezone}` }
		},
	},
	{
		id: 'system.disk',
		name: 'free space (system, app, media, logs)',
		async run({ config }) {
			const media = config?.local_media_path || path.join(REPO, 'media')
			const rows = disks(['/', REPO, media, '/var/log', os.tmpdir()])
			if (!rows.length) return { status: 'skip', summary: 'df gave nothing' }
			const gb = (b) => `${(b / 1e9).toFixed(b < 10e9 ? 1 : 0)} GB`
			const st = rows.map(diskStatus)
			const status = st.includes('fail') ? 'fail' : st.includes('warn') ? 'warn' : 'pass'
			return {
				status,
				summary: rows.map((d, i) => `${d.mount} ${gb(d.avail)} free${st[i] === 'pass' ? '' : ` (${st[i]})`}`).join(' · '),
			}
		},
	},
	{
		id: 'system.gpu',
		name: 'GPU driver answers',
		async run() {
			if (!has('nvidia-smi')) return { status: 'skip', summary: 'no nvidia-smi' }
			const r = sh(
				'nvidia-smi',
				['--query-gpu=name,driver_version,temperature.gpu,memory.used,memory.total', '--format=csv,noheader'],
				{ timeoutMs: 20000 }
			)
			if (r.code !== 0)
				return { status: 'fail', summary: `nvidia-smi exit ${r.code}: ${(r.err || r.out).trim().split('\n')[0]}` }
			return { status: 'pass', summary: r.out.trim().split('\n').join(' | ') }
		},
	},
	{
		id: 'system.ports',
		name: 'app, AMCP and scanner ports listening',
		async run() {
			const r = sh('ss', ['-ltnH'])
			if (r.missing) return { status: 'skip', summary: 'no ss' }
			const open = new Set(r.out.split('\n').map((l) => Number((l.split(/\s+/)[3] || '').split(':').pop())))
			const shut = Object.entries(PORTS)
				.filter(([p]) => !open.has(Number(p)))
				.map(([p, what]) => `${p} ${what}`)
			if (!unit('casparcg-server'))
				return {
					status: open.has(4200) ? 'pass' : 'fail',
					summary: open.has(4200) ? '4200 listening (no Caspar unit here)' : '4200 not listening',
				}
			return shut.length
				? { status: 'fail', summary: `not listening: ${shut.join(', ')}` }
				: {
						status: 'pass',
						summary: Object.entries(PORTS)
							.map(([p, w]) => `${p} ${w}`)
							.join(' · '),
					}
		},
	},
	{
		id: 'system.ssh-trust',
		name: 'replication keys are rsync-only (WO-729)',
		async run() {
			const auth = path.join(os.homedir(), '.ssh/authorized_keys')
			if (!fs.existsSync(auth)) return { status: 'pass', summary: 'no authorized_keys' }
			const text = fs.readFileSync(auth, 'utf8')
			const plain = plainReplicationKeys(text)
			if (plain.length)
				return {
					status: 'fail',
					summary: `${plain.length} replication key(s) give a full shell: restart highascg (it restricts them)`,
				}
			const forced = text.split('\n').filter((l) => l.includes('highascg-replication-ssh')).length
			if (forced && !fs.existsSync('/usr/local/bin/highascg-replication-ssh'))
				return {
					status: 'fail',
					summary:
						'keys point at /usr/local/bin/highascg-replication-ssh, which is not installed: sudo bash scripts/replication/install-replication-ssh-wrapper.sh',
				}
			return { status: 'pass', summary: `${forced} replication key(s), all bound to the forced command` }
		},
	},
	verifier('system.sudo', 'privileged helpers allowed (sudoers)', 'verify-passwordless-sudo.sh'),
	verifier('system.caspar-autostart', 'Caspar autostart wiring', 'verify-caspar-autostart.sh'),
	verifier('system.decklink', 'DeckLink driver + cards', 'verify-decklink.sh', { timeoutMs: 90000 }),
]

module.exports.diskStatus = diskStatus
module.exports.plainReplicationKeys = plainReplicationKeys

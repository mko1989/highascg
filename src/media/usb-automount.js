/**
 * USB auto-mount (WO-413): plug a drive → it mounts, no terminal.
 *
 * Polls lsblk for UNMOUNTED removable filesystem partitions and mounts each one
 * through the existing WO-29 udisks2 path (`mountUsbBlockDevice`), so mounts land
 * where the ingest browse/import/eject flow already looks (/media/<user>/<label>)
 * and the hotplug watcher's `usb:attached` broadcast fires as usual. Any number
 * of drives mount independently.
 *
 * Per-device state (keyed by /dev/… path, kept while the device stays plugged):
 *  - a successful mount marks the device `done` — if the operator EJECTS it, the
 *    partition becomes an unmounted candidate again but is NOT remounted, so a
 *    drive can be safely pulled after eject. Unplugging clears the state; the
 *    next plug mounts fresh.
 *  - failures back off (30 s × attempts, capped 5 min); a polkit denial backs
 *    off 10 min and logs the one-time setup command
 *    (`sudo bash scripts/setup/13-usb-ingest.sh <user>`, see
 *    docs/USB_AUTO_MOUNT_UBUNTU.md) instead of retry-spamming.
 *
 * Config gate: `usbIngest.enabled` and `usbIngest.autoMount` (both default true),
 * re-read every tick so a settings change needs no restart.
 *
 * Inhibit file (WO-416): the flash pipeline repartitions sticks and must not race
 * this poller. `usb_mask_exfat_automount` (tools/eggs/live-usb/flash-stick-common.sh)
 * touches /run/highascg/usb-automount-inhibit; while it exists no mount is attempted.
 * unmask-exfat-systemd.sh removes it; /run is tmpfs so a crashed flash run can leave
 * it at worst until reboot.
 */
'use strict'

const fs = require('fs')

const usbDrives = require('./usb-drives')

const INHIBIT_FILE = '/run/highascg/usb-automount-inhibit'
const POLL_MS = 3000
const RETRY_BASE_MS = 30 * 1000
const RETRY_MAX_MS = 5 * 60 * 1000
const POLKIT_RETRY_MS = 10 * 60 * 1000

/**
 * @param {object} ctx app context (reads ctx.config.usbIngest, uses ctx._wsBroadcast)
 * @param {{ intervalMs?: number, log?: (m: string) => void, logError?: (m: string) => void,
 *   listCandidates?: () => Promise<Array<{ blockDevice: string, label?: string, fsType?: string }>>,
 *   listMounted?: () => Promise<Array<{ device?: string }>>,
 *   mount?: (dev: string) => Promise<{ ok: boolean, mountpoint?: string|null, message?: string, needsPolkit?: boolean }>,
 *   inhibitFile?: string, force?: boolean }} [options] non-default fields exist for offline tests
 * @returns {() => void} stop function
 */
function startUsbAutoMount(ctx, options = {}) {
	if (process.platform !== 'linux' && !options.force) return () => {}
	const intervalMs = options.intervalMs ?? POLL_MS
	const listCandidates = options.listCandidates || usbDrives.listRemovableBlockDevices
	const listMounted = options.listMounted || usbDrives.listUsbDrives
	const mount = options.mount || usbDrives.mountUsbBlockDevice
	const log = options.log || (() => {})
	const logError = options.logError || log

	const inhibitFile = options.inhibitFile ?? INHIBIT_FILE

	/** @type {Map<string, { done: boolean, attempts: number, nextRetryAt: number }>} */
	const state = new Map()
	let ticking = false
	let stopped = false
	let inhibited = false

	const enabled = () => {
		let inhibitNow = false
		try {
			inhibitNow = fs.existsSync(inhibitFile)
		} catch {
			inhibitNow = false
		}
		if (inhibitNow !== inhibited) {
			inhibited = inhibitNow
			log(inhibited
				? `USB auto-mount inhibited (${inhibitFile} present — flash pipeline owns the stick)`
				: 'USB auto-mount resumed (inhibit file gone)')
		}
		if (inhibitNow) return false
		const u = ctx?.config?.usbIngest
		if (!u || typeof u !== 'object') return true
		return u.enabled !== false && u.autoMount !== false
	}

	const tick = async () => {
		if (ticking || stopped || !enabled()) return
		ticking = true
		try {
			const candidates = await listCandidates()
			const mounted = await listMounted()
			const present = new Set(candidates.map((c) => c.blockDevice))
			for (const d of mounted) if (d && d.device) present.add(d.device)
			for (const key of [...state.keys()]) if (!present.has(key)) state.delete(key)

			for (const c of candidates) {
				if (stopped) break
				if (!c || !c.blockDevice || !c.fsType) continue
				const st = state.get(c.blockDevice)
				const now = Date.now()
				if (st && (st.done || now < st.nextRetryAt)) continue
				// Claim before the async mount so an overlapping tick can't double-mount.
				state.set(c.blockDevice, { done: false, attempts: st?.attempts || 0, nextRetryAt: Infinity })
				const res = await mount(c.blockDevice)
				if (res && res.ok) {
					state.set(c.blockDevice, { done: true, attempts: 0, nextRetryAt: Infinity })
					log(`USB auto-mount: ${c.blockDevice}${c.label ? ` (${c.label})` : ''} → ${res.mountpoint || 'mounted'}`)
					if (typeof ctx._wsBroadcast === 'function') {
						ctx._wsBroadcast('usb:automounted', {
							blockDevice: c.blockDevice,
							label: c.label || '',
							mountpoint: res.mountpoint || null,
						})
					}
				} else {
					const attempts = (st?.attempts || 0) + 1
					const backoffMs = res && res.needsPolkit ? POLKIT_RETRY_MS : Math.min(RETRY_MAX_MS, RETRY_BASE_MS * attempts)
					state.set(c.blockDevice, { done: false, attempts, nextRetryAt: Date.now() + backoffMs })
					logError(`USB auto-mount failed for ${c.blockDevice}: ${res?.message || 'unknown error'}`)
				}
			}
		} catch {
			/* discovery failures are transient; next tick retries */
		} finally {
			ticking = false
		}
	}

	const timer = setInterval(() => void tick(), intervalMs)
	if (timer.unref) timer.unref()
	void tick()
	return () => {
		stopped = true
		clearInterval(timer)
	}
}

module.exports = { startUsbAutoMount }

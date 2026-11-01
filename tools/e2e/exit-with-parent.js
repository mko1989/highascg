'use strict'
/**
 * WO-923 — preloaded into every e2e sandbox server (`node --require`): the server shuts down (its own SIGTERM handler)
 * once the process that started it is gone. A killed or crashed runner used to leave its sandbox running for days, and
 * a stale sandbox kept sending its pixel map's Art-Net to 127.0.0.1:6455 under the next run's receiver, so
 * 07_pixel_map read another server's frames (override "not applied", 255-filled slots).
 */
const parent = process.ppid
setInterval(() => {
	if (process.ppid !== parent) process.kill(process.pid, 'SIGTERM')
}, 1000).unref()

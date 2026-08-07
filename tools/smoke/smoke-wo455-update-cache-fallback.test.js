'use strict'

/**
 * WO-455 — GUI update EACCES on installed systems.
 *
 * Installed boxes ship without /var/cache/highascg (eggs excludes `var/cache/*`);
 * the node process (casparcg) cannot mkdir under root-owned /var/cache, so the
 * first-ever GUI update on an installed machine died in phase 'starting'.
 * Pins the three legs of the fix: the /tmp fallback in server-update.js (a path
 * the DEPLOYED sudo helper already whitelists, so old installs work unmodified),
 * the helper's root-side ensure_cache_dirs self-heal, and the tmpfiles.d entry.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

describe('WO-455 update cache fallback', () => {
	it('server-update.js falls back to /tmp/highascg-updates on EACCES/EPERM/EROFS', () => {
		const src = read('src/system/server-update.js')
		assert.match(src, /const FALLBACK_CACHE = '\/tmp\/highascg-updates'/)
		assert.match(src, /\['EACCES', 'EPERM', 'EROFS'\]\.includes\(e\?\.code\)/, 'only permission-class errors may trigger the fallback')
		assert.match(src, /const cacheDir = resolveUpdateCacheDir\(appendJobLog\)/, 'apply job must resolve the cache through the fallback path')
		assert.ok(!/const cacheDir = process\.env\.HIGHASCG_UPDATE_CACHE \|\| CACHE_ROOT\n\t*fs\.mkdirSync\(cacheDir/.test(src), 'the bare mkdir that EACCESed must be gone')
	})

	it('sudo helper whitelists the fallback source AND self-heals the real cache tree as root', () => {
		const helper = read('scripts/exfat/highascg-webui-server-update.sh')
		assert.match(helper, /\/tmp\/highascg-updates\/\*/, 'validate_source_path must accept the fallback root')
		assert.match(helper, /ensure_cache_dirs\(\) \{/)
		assert.match(helper, /\n\tensure_cache_dirs\n/, 'main() must create the cache tree before validating the source')
	})

	it('tmpfiles.d entry exists and the exFAT installer deploys it', () => {
		const conf = read('scripts/tmpfiles.d/highascg.conf')
		assert.match(conf, /^d \/var\/cache\/highascg 0755 root root -$/m)
		assert.match(conf, /^d \/var\/cache\/highascg\/updates 0755 casparcg casparcg -$/m)
		const installer = read('scripts/exfat/install-exfat-systemd-units.sh')
		assert.match(installer, /tmpfiles\.d\/highascg\.conf" \/etc\/tmpfiles\.d\/highascg\.conf/)
	})
})

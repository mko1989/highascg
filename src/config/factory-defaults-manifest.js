'use strict'

/**
 * WO-168 — single source of truth for "what a factory reset preserves vs.
 * purges" and "what must never ship on a produced ISO/clone". Consumed by:
 *
 *   - tools/eggs/live-usb/write-iso-default-config.js (factory reset run
 *     before `eggs produce`; imports these constants instead of keeping a
 *     local PRESERVE_JSON literal).
 *   - tools/eggs/live-usb/verify-iso-squashfs-excludes.sh (post-build
 *     assertions). Shell can't `require()` this file, so it pulls the
 *     directory-name constants via a `node -e` print step at verify time
 *     (see manifest_const() in that script) instead of hardcoding a second
 *     copy that could drift.
 *
 * Starter-project identifiers are re-exported from src/config/factory-starter.js
 * (the existing single source of truth for the starter show) rather than
 * redefined here — closes the WO-106 deferred "shared default project
 * template" item.
 */

const { STARTER_PROJECT_NAME, STARTER_PROJECT_SLUG } = require('./factory-starter')

/** JSON in config/ kept as repo templates (operator settings, not data) — never wiped by factory reset. */
const PRESERVE_JSON = new Set(['casparcg.config.iso', 'exfat-sync.json'])

/** Root-level operator session-state files always cleared by factory reset. */
const ROOT_STATE_FILES = ['highascg.config.json', '.highascg-state.json', '.module-state.json', 'autosave.json']

/**
 * Root-level build-host stamp files with NO runtime consumer at
 * HIGHASCG_ROOT — safe for factory reset to clear (WO-168 T168.4
 * investigation). `.applied-stamp` / `.applied-at` are written by
 * scripts/exfat/highascg-apply-server-drop.sh, but the only reader
 * (src/system/server-update.js readAppliedStamp()) always passes the
 * exfat/bridge `drop-update/` mount root, never HIGHASCG_ROOT — a copy at
 * the repo root is build-host test/dev leftover, not live behavior.
 *
 * Deliberately NOT included: `BUILD_STAMP` and `.highascg-build-stamp` —
 * both are read from HIGHASCG_ROOT at runtime by
 * src/system/build-stamp.js readBuildStampFromDir(REPO_ROOT), used by
 * src/system/server-update.js for the running/update-check version compare.
 * Clearing them would make a fresh box misreport its version.
 */
const STALE_ROOT_STAMP_FILES = ['.applied-at', '.applied-stamp']

/** projects/ directory names with special factory-reset handling. */
const PROJECTS_TRASH_DIR = '_trash'
const PROJECTS_AUTOSAVE_DIR = '_autosave'

/** Device identity/auth material (Tailscale, Syncthing, replication pairing) — must never ship on an ISO (WO-168 T168.1). */
const PRIVATE_IDENTITY_DIR = '.private'

/**
 * config/ entries that are build-host backups/duplicates, not operator
 * settings templates — purged by factory reset and excluded from the ISO
 * squashfs (belt-and-suspenders vs. the exclude list). Examples seen in the
 * wild: `casparcg.config.bak.1783337760`, `casparcg copy.config`.
 * @param {string} name basename of a config/ entry
 * @returns {boolean}
 */
function isConfigBackupEntry(name) {
	return /\.bak(\.|$)/i.test(name) || /copy\.config$/i.test(name)
}

module.exports = {
	STARTER_PROJECT_NAME,
	STARTER_PROJECT_SLUG,
	PRESERVE_JSON,
	ROOT_STATE_FILES,
	STALE_ROOT_STAMP_FILES,
	PROJECTS_TRASH_DIR,
	PROJECTS_AUTOSAVE_DIR,
	PRIVATE_IDENTITY_DIR,
	isConfigBackupEntry,
}

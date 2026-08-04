/**
 * DeckLink install POST handler — triggers tar.gz/deb install from vendor dirs via sudo.
 * WO-188: add UI-triggered DeckLink install from exFAT/bridge vendor directories.
 */

'use strict'

const { execFileSync } = require('child_process')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { checkNuclearPassword } = require('./routes-system-setup')

const DECKLINK_INSTALL_SCRIPT = '/usr/local/lib/highascg/decklink-install-from-exfat.sh'

/**
 * POST /api/system/decklink/install — install or skip based on vendor availability.
 * Requires nuclear password (same gate as system/update/apply).
 * Returns {ok, action: 'installed'|'skipped', reason: <string>}
 */
async function handleDecklinkInstallPost(body, ctx) {
	const pw = checkNuclearPassword(body, ctx)
	if (!pw.ok) {
		return { status: pw.status || 403, headers: JSON_HEADERS, body: jsonBody({ error: pw.error }) }
	}

	let payload = {}
	try {
		payload = parseBody(body)
	} catch {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid JSON' }) }
	}

	// Invoke the install script via sudo -n (requires sudoers entry)
	try {
		const output = execFileSync('sudo', ['-n', DECKLINK_INSTALL_SCRIPT], {
			encoding: 'utf8',
			timeout: 300000, // 5 minutes
			stdio: ['pipe', 'pipe', 'pipe'],
		})

		// Parse output to extract the action and reason
		const lines = String(output).split('\n')
		const lastLine = lines[lines.length - 2] || ''

		// Script outputs "skip: <reason>" or "ok: <reason>"
		let action = 'skipped'
		let reason = 'unknown'

		if (lastLine.includes('skip:')) {
			action = 'skipped'
			reason = lastLine.replace(/.*skip:\s*/, '').trim()
		} else if (lastLine.includes('ok:')) {
			action = 'installed'
			reason = lastLine.replace(/.*ok:\s*/, '').trim()
		}

		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				action,
				reason,
			}),
		}
	} catch (e) {
		const stderr = e.stderr ? String(e.stderr).trim() : ''
		const stdout = e.stdout ? String(e.stdout).trim() : ''
		const msg = stderr || stdout || e.message || 'Install script failed'

		return {
			status: 409,
			headers: JSON_HEADERS,
			body: jsonBody({
				error: msg,
			}),
		}
	}
}

/* WO-427: Blackmagic's EULA does not allow redistributing Desktop Video, so the driver can
 * never ship inside the ISO — the user must supply the package themselves. This upload makes
 * that a browser action: Settings → DeckLink → choose the tar.gz downloaded from
 * blackmagicdesign.com/support → it lands in the local vendor dir the install script scans
 * first (no USB stick required). Upload only STAGES the file; installing stays behind the
 * nuclear-password Install button. */
const DECKLINK_LOCAL_VENDOR_DIR = '/home/casparcg/highascg/vendor/decklink'
const DECKLINK_VENDOR_NAME_RE = /^(Blackmagic_Desktop_Video_Linux_[\w.-]+\.tar\.gz|desktopvideo[\w.-]*\.deb)$/i

/**
 * POST /api/system/decklink/upload — multipart, single file.
 * @param {import('http').IncomingMessage} req
 */
function handleDecklinkUploadPost(req) {
	const busboy = require('busboy')
	const fs = require('fs')
	const path = require('path')
	return new Promise((resolve) => {
		let bb
		try {
			bb = busboy({ headers: req.headers, limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 } })
		} catch (e) {
			resolve({ status: 400, headers: JSON_HEADERS, body: jsonBody({ error: `Bad upload request: ${e?.message || e}` }) })
			return
		}
		let done = false
		let pendingWrite = null
		let savedAs = null
		let failure = null
		const finish = () => {
			if (done) return
			done = true
			if (failure) resolve({ status: 400, headers: JSON_HEADERS, body: jsonBody({ error: failure }) })
			else if (!savedAs) resolve({ status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'No file received' }) })
			else resolve({ status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, savedAs, dir: DECKLINK_LOCAL_VENDOR_DIR }) })
		}
		bb.on('file', (_name, file, info) => {
			const filename = path.basename(String(info?.filename || ''))
			if (!DECKLINK_VENDOR_NAME_RE.test(filename)) {
				failure = `Not a Desktop Video package: "${filename}" — expected Blackmagic_Desktop_Video_Linux_*.tar.gz (or a desktopvideo_*.deb)`
				file.resume()
				return
			}
			let dest
			try {
				fs.mkdirSync(DECKLINK_LOCAL_VENDOR_DIR, { recursive: true })
				dest = path.join(DECKLINK_LOCAL_VENDOR_DIR, filename)
			} catch (e) {
				failure = `Cannot create vendor dir: ${e?.message || e}`
				file.resume()
				return
			}
			const ws = fs.createWriteStream(dest)
			pendingWrite = new Promise((wDone) => {
				const failWrite = (e) => {
					failure = failure || `Write failed: ${e?.message || e}`
					try { fs.unlinkSync(dest) } catch { /* partial gone or never created */ }
					file.resume()
					wDone()
				}
				ws.on('error', failWrite)
				file.on('error', failWrite)
				file.on('limit', () => failWrite(new Error('File exceeds the 2 GB upload limit')))
				ws.on('finish', () => {
					savedAs = filename
					wDone()
				})
			})
			file.pipe(ws)
		})
		bb.on('error', (e) => {
			failure = failure || `Upload stream error: ${e?.message || e}`
			finish()
		})
		bb.on('close', () => {
			if (pendingWrite) pendingWrite.then(finish)
			else finish()
		})
		req.pipe(bb)
	})
}

module.exports = {
	handleDecklinkInstallPost,
	handleDecklinkUploadPost,
}

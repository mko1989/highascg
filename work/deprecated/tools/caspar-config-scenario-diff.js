#!/usr/bin/env node
'use strict'

/**
 * Scenario-focused CasparCG config comparator.
 *
 * Goal:
 * - Read the current generated Caspar XML (from file or HighAsCG endpoint)
 * - Compare against a read-only reference XML
 * - Print channel/consumer mismatches so generator logic can be tuned quickly
 *
 * Usage examples:
 *   node tools/caspar-config-scenario-diff.js --reference work/caspar_extended.config
 *   node tools/caspar-config-scenario-diff.js --generated work/generated.config --reference work/caspar_extended.config
 *   node tools/caspar-config-scenario-diff.js --reference work/caspar_extended.config --out work/caspar-diff-report.md
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const DEFAULT_GENERATED_URL = 'http://127.0.0.1:4200/api/caspar-config/generate'

function usage() {
	console.log(`Caspar scenario diff tool

Required:
  --reference <path>            Reference XML config (read-only input)

Optional:
  --generated <path>            Generated XML file path
  --generated-url <url>         Fetch generated XML from URL (default: ${DEFAULT_GENERATED_URL})
  --save-generated <path>       Save fetched generated XML to file
  --out <path>                  Save text report to file
  --json <path>                 Save JSON report to file
  --clean-reference <path>      Write sanitized reference XML copy (no inline hint text)
  --strict-exit                 Exit 2 when mismatches exist
  --help                        Show this help
`)
}

function parseArgs(argv) {
	const out = {
		reference: '',
		generated: '',
		generatedUrl: DEFAULT_GENERATED_URL,
		saveGenerated: '',
		out: '',
		json: '',
		cleanReference: '',
		strictExit: false,
		help: false,
	}
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		const next = argv[i + 1]
		if (a === '--reference') { out.reference = String(next || ''); i++; continue }
		if (a === '--generated') { out.generated = String(next || ''); i++; continue }
		if (a === '--generated-url') { out.generatedUrl = String(next || ''); i++; continue }
		if (a === '--save-generated') { out.saveGenerated = String(next || ''); i++; continue }
		if (a === '--out') { out.out = String(next || ''); i++; continue }
		if (a === '--json') { out.json = String(next || ''); i++; continue }
		if (a === '--clean-reference') { out.cleanReference = String(next || ''); i++; continue }
		if (a === '--strict-exit') { out.strictExit = true; continue }
		if (a === '--help' || a === '-h') { out.help = true; continue }
	}
	return out
}

function readText(absPath) {
	return fs.readFileSync(absPath, 'utf8')
}

function writeText(absPath, content) {
	fs.mkdirSync(path.dirname(absPath), { recursive: true })
	fs.writeFileSync(absPath, content, 'utf8')
}

function resolveAbs(p) {
	if (!p) return ''
	return path.isAbsolute(p) ? p : path.join(ROOT, p)
}

function stripComments(xml) {
	return String(xml || '').replace(/<!--[\s\S]*?-->/g, '')
}

function firstTagText(xml, tagName) {
	const rx = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i')
	const m = String(xml || '').match(rx)
	return m ? String(m[1]).trim() : ''
}

function normalizeTagValue(raw) {
	let s = String(raw || '').trim()
	// Reference docs often append hints like:
	// "0 (x offset into the channel)" or "[bt601|bt709](default ...)"
	// Normalize those away for semantic comparison.
	s = s.replace(/\s*\([^)]*\)\s*$/g, '').trim()
	s = s.replace(/\s*\[[^\]]*\]\s*$/g, '').trim()
	s = s.replace(/\s+/g, ' ')
	return s
}

function collectTagBlocks(xml, tagName) {
	const rx = new RegExp(`<${tagName}\\b[\\s\\S]*?<\\/${tagName}>`, 'gi')
	return String(xml || '').match(rx) || []
}

function collectTagNames(consumersXml) {
	const names = []
	const rx = /<([a-zA-Z0-9_-]+)\b/g
	let m
	while ((m = rx.exec(String(consumersXml || ''))) !== null) {
		names.push(String(m[1]).toLowerCase())
	}
	return names
}

function parseConsumers(consumersXml) {
	const decklinkBlocks = collectTagBlocks(consumersXml, 'decklink')
	const decklinkDevices = decklinkBlocks
		.map((b) => parseInt(firstTagText(b, 'device'), 10))
		.filter((n) => Number.isFinite(n) && n > 0)

	const screenBlocks = collectTagBlocks(consumersXml, 'screen')
	const ffmpegBlocks = collectTagBlocks(consumersXml, 'ffmpeg')
	const ndiBlocks = collectTagBlocks(consumersXml, 'ndi')
	const portAudioBlocks = collectTagBlocks(consumersXml, 'portaudio')
	const systemAudioBlocks = collectTagBlocks(consumersXml, 'system-audio')

	const known = new Set(['screen', 'decklink', 'ffmpeg', 'ndi', 'portaudio', 'system-audio'])
	const unknownTags = collectTagNames(consumersXml)
		.filter((n) => !known.has(n) && n !== 'consumers')
		.filter((n, i, arr) => arr.indexOf(n) === i)

	return {
		screenCount: screenBlocks.length,
		decklinkDevices,
		ffmpegCount: ffmpegBlocks.length,
		ndiCount: ndiBlocks.length,
		portAudioCount: portAudioBlocks.length,
		systemAudioCount: systemAudioBlocks.length,
		unknownTags,
	}
}

function parseChannels(xml) {
	const clean = stripComments(xml)
	const channelsBlock = firstTagText(clean, 'channels')
	if (!channelsBlock) return []
	const out = []
	const rx = /<channel>([\s\S]*?)<\/channel>/gi
	let m
	let idx = 1
	while ((m = rx.exec(channelsBlock)) !== null) {
		const body = String(m[1] || '')
		const videoMode = normalizeTagValue(firstTagText(body, 'video-mode')) || '(missing)'
		const consumersXml = firstTagText(body, 'consumers')
		out.push({
			ch: idx++,
			videoMode,
			consumers: parseConsumers(consumersXml),
		})
	}
	return out
}

function sameNumberArray(a, b) {
	if (!Array.isArray(a) || !Array.isArray(b)) return false
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) if (Number(a[i]) !== Number(b[i])) return false
	return true
}

function diffChannels(generatedChannels, referenceChannels) {
	const maxCh = Math.max(generatedChannels.length, referenceChannels.length)
	const findings = []
	for (let i = 1; i <= maxCh; i++) {
		const g = generatedChannels[i - 1] || null
		const r = referenceChannels[i - 1] || null
		if (!g || !r) {
			findings.push({
				ch: i,
				kind: 'missing_channel',
				message: !g
					? `Channel ${i} missing in generated config`
					: `Channel ${i} exists in generated but not in reference`,
				generated: g,
				reference: r,
			})
			continue
		}

		if (String(g.videoMode) !== String(r.videoMode)) {
			findings.push({
				ch: i,
				kind: 'video_mode',
				message: `Channel ${i} video-mode mismatch`,
				generated: g.videoMode,
				reference: r.videoMode,
			})
		}

		if (g.consumers.screenCount !== r.consumers.screenCount) {
			findings.push({
				ch: i,
				kind: 'screen_consumer',
				message: `Channel ${i} screen consumer count mismatch`,
				generated: g.consumers.screenCount,
				reference: r.consumers.screenCount,
			})
		}

		if (!sameNumberArray(g.consumers.decklinkDevices, r.consumers.decklinkDevices)) {
			findings.push({
				ch: i,
				kind: 'decklink_devices',
				message: `Channel ${i} decklink device list mismatch`,
				generated: g.consumers.decklinkDevices,
				reference: r.consumers.decklinkDevices,
			})
		}

		const scalarChecks = [
			['ffmpegCount', 'ffmpeg consumers'],
			['ndiCount', 'ndi consumers'],
			['portAudioCount', 'portaudio consumers'],
			['systemAudioCount', 'system-audio consumers'],
		]
		for (const [field, label] of scalarChecks) {
			if (g.consumers[field] !== r.consumers[field]) {
				findings.push({
					ch: i,
					kind: field,
					message: `Channel ${i} ${label} count mismatch`,
					generated: g.consumers[field],
					reference: r.consumers[field],
				})
			}
		}
	}
	return findings
}

function buildTextReport(input) {
	const {
		generatedSource,
		referenceSource,
		generatedChannels,
		referenceChannels,
		findings,
	} = input
	const lines = []
	lines.push('# Caspar Scenario Diff Report')
	lines.push('')
	lines.push(`Generated source: ${generatedSource}`)
	lines.push(`Reference source: ${referenceSource}`)
	lines.push(`Generated channels: ${generatedChannels.length}`)
	lines.push(`Reference channels: ${referenceChannels.length}`)
	lines.push('')
	if (!findings.length) {
		lines.push('No structural mismatches found. Generated config matches reference for compared channel/consumer signals.')
		return lines.join('\n')
	}
	lines.push(`Mismatches: ${findings.length}`)
	lines.push('')
	for (const f of findings) {
		lines.push(`- [CH ${f.ch}] ${f.message}`)
		if (f.generated !== undefined || f.reference !== undefined) {
			lines.push(`  - generated: ${JSON.stringify(f.generated)}`)
			lines.push(`  - reference: ${JSON.stringify(f.reference)}`)
		}
	}
	return lines.join('\n')
}

async function loadGeneratedXml(args) {
	if (args.generated) {
		const abs = resolveAbs(args.generated)
		return { source: abs, xml: readText(abs) }
	}
	const url = args.generatedUrl || DEFAULT_GENERATED_URL
	const res = await fetch(url)
	if (!res.ok) throw new Error(`Failed to fetch generated config: HTTP ${res.status} ${res.statusText}`)
	const raw = await res.text()
	let xml = raw
	const ct = String(res.headers.get('content-type') || '').toLowerCase()
	if (ct.includes('application/json') || raw.trim().startsWith('{')) {
		try {
			const j = JSON.parse(raw)
			xml =
				typeof j?.xml === 'string'
					? j.xml
					: typeof j?.configXml === 'string'
						? j.configXml
						: typeof j?.config === 'string'
							? j.config
							: ''
		} catch {
			xml = ''
		}
	}
	if (!xml || !String(xml).includes('<configuration')) {
		throw new Error('Generated response does not contain Caspar XML (expected <configuration>...)')
	}
	if (args.saveGenerated) {
		const absOut = resolveAbs(args.saveGenerated)
		writeText(absOut, xml)
	}
	return { source: url, xml }
}

async function main() {
	const args = parseArgs(process.argv.slice(2))
	if (args.help) { usage(); return }
	if (!args.reference) {
		usage()
		throw new Error('Missing required --reference <path>')
	}

	const refPath = resolveAbs(args.reference)
	const referenceXml = readText(refPath)
	const generated = await loadGeneratedXml(args)

	const generatedChannels = parseChannels(generated.xml)
	const referenceChannels = parseChannels(referenceXml)
	const findings = diffChannels(generatedChannels, referenceChannels)

	const reportText = buildTextReport({
		generatedSource: generated.source,
		referenceSource: refPath,
		generatedChannels,
		referenceChannels,
		findings,
	})

	console.log(reportText)

	if (args.out) writeText(resolveAbs(args.out), reportText)
	if (args.cleanReference) {
		const cleaned = stripReferenceHints(referenceXml)
		writeText(resolveAbs(args.cleanReference), cleaned)
	}
	if (args.json) {
		const jsonPayload = {
			generatedSource: generated.source,
			referenceSource: refPath,
			generatedChannels,
			referenceChannels,
			findings,
		}
		writeText(resolveAbs(args.json), JSON.stringify(jsonPayload, null, 2))
	}

	if (args.strictExit && findings.length > 0) process.exit(2)
}

function stripReferenceHints(xml) {
	let out = String(xml || '')
	// Remove inline "(...)" help text when it follows a value.
	out = out.replace(/>([^<]*?)\s+\([^<)]*\)(\s*<)/g, (m, a, b) => `>${a}${b}`)
	// Remove trailing bracket-enum hints before closing tags.
	out = out.replace(/>([^<]*?)\s+\[[^\]<]*\](\s*<)/g, (m, a, b) => `>${a}${b}`)
	// Compact leftover excessive internal spaces inside text nodes.
	out = out.replace(/>([^<]*)</g, (m, a) => `>${String(a).replace(/[ \t]{2,}/g, ' ').trim()}<`)
	return out
}

main().catch((err) => {
	console.error('[caspar-config-scenario-diff] ERROR:', err && err.message ? err.message : String(err))
	process.exit(1)
})


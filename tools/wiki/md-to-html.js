'use strict'

/**
 * Lightweight markdown → HTML for wiki build (no runtime deps).
 * Covers GFM used in HighAsCG docs: headings, lists, tables, fences, links.
 */

function escapeHtml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

function slugifyHeading(text) {
	return text
		.toLowerCase()
		.replace(/[^\w\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-')
}

function inlineFormat(text, linkResolver) {
	let out = escapeHtml(text)
	out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
	out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
	out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>')
	out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
		const resolved = linkResolver ? linkResolver(href) : href
		const extra = resolved.startsWith('#/') ? ' data-wiki-page="1"' : ''
		return `<a href="${escapeHtml(resolved)}"${extra}>${escapeHtml(label)}</a>`
	})
	return out
}

function isTableRow(line) {
	return /^\|/.test(line.trim())
}

function parseTableRow(line) {
	return line
		.trim()
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split('|')
		.map((c) => c.trim())
}

function isTableSep(line) {
	return /^\|[\s:-]+\|/.test(line.trim())
}

/**
 * @param {string} md
 * @param {{ linkResolver?: (href: string) => string }} [opts]
 */
function markdownToHtml(md, opts = {}) {
	const linkResolver = opts.linkResolver || ((h) => h)
	const lines = md.replace(/\r\n/g, '\n').split('\n')
	const out = []
	let i = 0

	while (i < lines.length) {
		const line = lines[i]
		const trimmed = line.trim()

		if (!trimmed) {
			i += 1
			continue
		}

		if (/^```/.test(trimmed)) {
			const lang = trimmed.slice(3).trim()
			i += 1
			const codeLines = []
			while (i < lines.length && !/^```/.test(lines[i].trim())) {
				codeLines.push(lines[i])
				i += 1
			}
			i += 1
			const cls = lang ? ` class="language-${escapeHtml(lang)}"` : ''
			out.push(`<pre><code${cls}>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
			continue
		}

		if (/^#{1,6}\s/.test(line)) {
			const m = line.match(/^(#{1,6})\s+(.+)$/)
			if (m) {
				const level = m[1].length
				const text = m[2].trim()
				const id = slugifyHeading(text)
				out.push(`<h${level} id="${id}">${inlineFormat(text, linkResolver)}</h${level}>`)
			}
			i += 1
			continue
		}

		if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
			out.push('<hr>')
			i += 1
			continue
		}

		if (/^>\s?/.test(line)) {
			const q = []
			while (i < lines.length && /^>\s?/.test(lines[i])) {
				q.push(lines[i].replace(/^>\s?/, ''))
				i += 1
			}
			out.push(`<blockquote><p>${inlineFormat(q.join(' '), linkResolver)}</p></blockquote>`)
			continue
		}

		if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
			const header = parseTableRow(line)
			i += 2
			const rows = []
			while (i < lines.length && isTableRow(lines[i])) {
				rows.push(parseTableRow(lines[i]))
				i += 1
			}
			out.push('<table><thead><tr>' + header.map((c) => `<th>${inlineFormat(c, linkResolver)}</th>`).join('') + '</tr></thead><tbody>')
			for (const row of rows) {
				out.push('<tr>' + row.map((c) => `<td>${inlineFormat(c, linkResolver)}</td>`).join('') + '</tr>')
			}
			out.push('</tbody></table>')
			continue
		}

		if (/^[-*+]\s/.test(trimmed)) {
			out.push('<ul>')
			while (i < lines.length && /^[-*+]\s/.test(lines[i].trim())) {
				out.push(`<li>${inlineFormat(lines[i].trim().replace(/^[-*+]\s+/, ''), linkResolver)}</li>`)
				i += 1
			}
			out.push('</ul>')
			continue
		}

		if (/^\d+\.\s/.test(trimmed)) {
			out.push('<ol>')
			while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
				out.push(`<li>${inlineFormat(lines[i].trim().replace(/^\d+\.\s+/, ''), linkResolver)}</li>`)
				i += 1
			}
			out.push('</ol>')
			continue
		}

		const para = []
		while (i < lines.length) {
			const l = lines[i]
			const t = l.trim()
			if (!t) break
			if (/^#{1,6}\s/.test(l) || /^```/.test(t) || /^>\s?/.test(l) || isTableRow(l) || /^[-*+]\s/.test(t) || /^\d+\.\s/.test(t) || /^(-{3,}|_{3,}|\*{3,})$/.test(t)) {
				break
			}
			para.push(l.trim())
			i += 1
		}
		if (para.length) {
			out.push(`<p>${inlineFormat(para.join(' '), linkResolver)}</p>`)
		} else {
			// Orphan line (e.g. table row without separator) — emit as paragraph and advance.
			out.push(`<p>${inlineFormat(trimmed, linkResolver)}</p>`)
			i += 1
		}
		continue
	}

	return out.join('\n')
}

module.exports = { markdownToHtml, escapeHtml, slugifyHeading }

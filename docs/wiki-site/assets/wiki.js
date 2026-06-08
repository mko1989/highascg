'use strict'

/** @typedef {{ id: string, title: string, file: string, category: string, group?: string, description?: string }} WikiPage */

const $ = (sel) => document.querySelector(sel)
const navEl = $('#wiki-nav')
const articleEl = $('#wiki-article')
const loadingEl = $('#wiki-loading')
const errorEl = $('#wiki-error')
const searchEl = $('#wiki-search')
const sidebarEl = $('#wiki-sidebar')
const menuBtn = $('#menu-toggle')
const generatedEl = $('#wiki-generated')

/** @type {{ pages: WikiPage[], categories: string[], defaultPage: string, generatedAt?: string }} */
let manifest = { pages: [], categories: [], defaultPage: '' }
/** @type {Record<string, string>} */
let content = {}
/** @type {Map<string, WikiPage>} */
let pageById = new Map()
/** @type {Map<string, WikiPage>} */
let pageByFile = new Map()

function pageUrl(id) {
	return `#/${encodeURIComponent(id)}`
}

function parseRoute() {
	const raw = window.location.hash.replace(/^#\/?/, '').trim()
	if (!raw) return { id: manifest.defaultPage || manifest.pages[0]?.id || '', anchor: '' }
	let decoded
	try {
		decoded = decodeURIComponent(raw)
	} catch {
		decoded = raw
	}
	const hashIdx = decoded.indexOf('#')
	if (hashIdx > 0) {
		return { id: decoded.slice(0, hashIdx), anchor: decoded.slice(hashIdx + 1) }
	}
	return { id: decoded, anchor: '' }
}

function setRoute(id, anchor) {
	let next = `#/${encodeURIComponent(id)}`
	if (anchor) next += `#${anchor}`
	if (window.location.hash !== next) window.location.hash = next
}

function showLoading(on) {
	loadingEl.hidden = !on
	if (on) {
		articleEl.hidden = true
		errorEl.hidden = true
	}
}

function showError(msg) {
	loadingEl.hidden = true
	articleEl.hidden = true
	errorEl.hidden = false
	errorEl.textContent = msg
}

function buildNav() {
	navEl.innerHTML = ''
	const byCat = new Map()
	for (const page of manifest.pages) {
		if (!byCat.has(page.category)) byCat.set(page.category, [])
		byCat.get(page.category).push(page)
	}

	for (const cat of manifest.categories) {
		const pages = byCat.get(cat)
		if (!pages?.length) continue
		const section = document.createElement('div')
		section.className = 'wiki-nav-section'
		const title = document.createElement('span')
		title.className = 'wiki-nav-title'
		title.textContent = cat
		section.appendChild(title)

		let lastGroup = null
		for (const page of pages) {
			if (page.group && page.group !== lastGroup) {
				lastGroup = page.group
				const g = document.createElement('span')
				g.className = 'wiki-nav-group'
				g.textContent = page.group
				section.appendChild(g)
			}
			const a = document.createElement('a')
			a.className = 'wiki-nav-link'
			a.href = pageUrl(page.id)
			a.dataset.pageId = page.id
			a.textContent = page.title
			section.appendChild(a)
		}
		navEl.appendChild(section)
	}
}

function highlightNav(activeId) {
	for (const a of navEl.querySelectorAll('.wiki-nav-link')) {
		a.classList.toggle('active', a.dataset.pageId === activeId)
	}
}

function loadPage(id, anchor) {
	const page = pageById.get(id)
	if (!page) {
		showError(`Unknown page: ${id}`)
		return
	}

	const html = content[id]
	if (!html) {
		showError(`Missing content for ${id}. Run: npm run wiki:build`)
		return
	}

	showLoading(false)
	document.title = `${page.title} — HighAsCG Wiki`
	highlightNav(id)
	sidebarEl.classList.remove('open')

	articleEl.innerHTML = `
		<div class="wiki-page-meta">
			<span>${page.category}</span>
			<span><code>${page.file}</code></span>
		</div>
		${html}
	`
	loadingEl.hidden = true
	errorEl.hidden = true
	articleEl.hidden = false
	window.scrollTo(0, 0)
	if (anchor) {
		requestAnimationFrame(() => {
			const el = document.getElementById(anchor)
			if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
		})
	}
}

function onNavigate() {
	const { id, anchor } = parseRoute()
	if (id) loadPage(id, anchor)
}

function setupSearch() {
	let box = null
	const hideBox = () => {
		if (box) {
			box.remove()
			box = null
		}
	}

	searchEl.addEventListener('input', () => {
		hideBox()
		const q = searchEl.value.trim().toLowerCase()
		if (q.length < 2) return

		const hits = manifest.pages
			.filter((p) => {
				const hay = `${p.title} ${p.description || ''} ${p.file} ${p.category}`.toLowerCase()
				return hay.includes(q)
			})
			.slice(0, 12)

		if (!hits.length) return

		box = document.createElement('div')
		box.className = 'wiki-search-results'
		box.style.position = 'fixed'
		const rect = searchEl.getBoundingClientRect()
		box.style.top = `${rect.bottom + 6}px`
		box.style.left = `${rect.left}px`
		box.style.width = `${rect.width}px`

		for (const hit of hits) {
			const a = document.createElement('a')
			a.className = 'wiki-search-hit'
			a.href = pageUrl(hit.id)
			a.innerHTML = `<div class="wiki-search-hit-title">${escapeHtml(hit.title)}</div><div class="wiki-search-hit-desc">${escapeHtml(hit.description || hit.file)}</div>`
			a.addEventListener('click', () => {
				hideBox()
				searchEl.value = ''
			})
			box.appendChild(a)
		}
		document.body.appendChild(box)
	})

	document.addEventListener('click', (e) => {
		if (e.target === searchEl || box?.contains(e.target)) return
		hideBox()
	})
}

function escapeHtml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

document.addEventListener('click', (e) => {
	const t = e.target
	if (!(t instanceof Element)) return
	const link = t.closest('a[data-wiki-page], a[href^="#/"]')
	if (!link || !(link instanceof HTMLAnchorElement)) return
	const href = link.getAttribute('href') || ''
	const m = href.match(/^#\/([^#?]+)(?:#([^?]*))?/)
	if (!m) return
	e.preventDefault()
	const pageId = decodeURIComponent(m[1])
	const anchor = m[2] ? decodeURIComponent(m[2]) : ''
	setRoute(pageId, anchor)
})

menuBtn?.addEventListener('click', () => sidebarEl.classList.toggle('open'))
window.addEventListener('hashchange', onNavigate)

function init() {
	const bundle = window.WIKI_BUNDLE
	if (!bundle?.manifest?.pages?.length) {
		showError('Wiki bundle not loaded. Run: npm run wiki:build')
		return
	}

	manifest = bundle.manifest
	content = bundle.content || {}
	pageById = new Map(manifest.pages.map((p) => [p.id, p]))
	pageByFile = new Map(manifest.pages.map((p) => [p.file, p]))

	if (generatedEl && manifest.generatedAt) {
		generatedEl.textContent = `Built ${new Date(manifest.generatedAt).toLocaleString()}`
	}

	buildNav()
	setupSearch()
	onNavigate()
}

init()

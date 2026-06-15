'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { markdownToHtml } = require('../wiki/md-to-html')
const { resolveWikiLink } = require('../wiki/resolve-link')

const REPO_ROOT = path.join(__dirname, '..', '..')
const DOCS_ROOT = path.join(REPO_ROOT, 'docs')
const SITE_DIR = path.join(DOCS_ROOT, 'wiki-site')
const BUNDLE_PATH = path.join(SITE_DIR, 'assets', 'wiki-bundle.js')

describe('wiki build', () => {
	it('markdown converter handles headings and code', () => {
		const html = markdownToHtml('# Title\n\nHello `world`\n\n```bash\necho hi\n```')
		assert.match(html, /<h1 id="title">Title<\/h1>/)
		assert.match(html, /<code>world<\/code>/)
		assert.match(html, /<pre><code class="language-bash">echo hi<\/code><\/pre>/)
	})

	it('build-wiki.js produces bundle with pages', () => {
		execFileSync('node', ['tools/wiki/build-wiki.js'], { cwd: REPO_ROOT, stdio: 'pipe' })
		assert.ok(fs.existsSync(BUNDLE_PATH), 'wiki-bundle.js missing after build')
		const src = fs.readFileSync(BUNDLE_PATH, 'utf8')
		assert.match(src, /window\.WIKI_BUNDLE=/)
		assert.match(src, /wiki--api--project/)
	})

	it('index.html references bundled assets only', () => {
		const index = fs.readFileSync(path.join(SITE_DIR, 'index.html'), 'utf8')
		assert.match(index, /wiki-bundle\.js/)
		assert.doesNotMatch(index, /cdn\.jsdelivr\.net/)
	})

	it('resolveWikiLink maps relative markdown paths', () => {
		const pageByFile = new Map([
			['wiki/api/project.md', { id: 'wiki--api--project' }],
			['wiki/api/timelines.md', { id: 'wiki--api--timelines' }],
			['README.md', { id: 'README' }],
			['BRIDGE_DISK_AND_USB_EXFAT.md', { id: 'BRIDGE_DISK_AND_USB_EXFAT' }],
		])
		const r = (href, src, id) =>
			resolveWikiLink(href, src, pageByFile, id, DOCS_ROOT, SITE_DIR, REPO_ROOT)

		assert.equal(r('timelines.md', 'wiki/api/project.md', 'wiki--api--project'), '#/wiki--api--timelines')
		assert.equal(r('api/project.md', 'wiki/README.md', 'wiki--README'), '#/wiki--api--project')
		assert.equal(r('../README.md', 'wiki/README.md', 'wiki--README'), '#/README')
		assert.equal(
			r('../../BRIDGE_DISK_AND_USB_EXFAT.md', 'wiki/api/project.md', 'wiki--api--project'),
			'#/BRIDGE_DISK_AND_USB_EXFAT',
		)
		assert.match(
			r('../../../src/api/routes-data.js', 'wiki/api/project.md', 'wiki--api--project'),
			/^(\.\.\/){2}src\/api\/routes-data\.js$/,
		)
	})

	it('built wiki README links target hash routes', () => {
		execFileSync('node', ['tools/wiki/build-wiki.js'], { cwd: REPO_ROOT, stdio: 'pipe' })
		const src = fs.readFileSync(BUNDLE_PATH, 'utf8')
		const bundle = JSON.parse(src.replace(/^[\s\S]*?window\.WIKI_BUNDLE=/, '').replace(/;\s*$/, ''))
		const html = bundle.content['wiki--README']
		assert.match(html, /href="#\/wiki--api--project"/)
		assert.match(html, /href="#\/wiki--api--README"/)
		assert.doesNotMatch(html, /href="api\/project\.md"/)
	})
})

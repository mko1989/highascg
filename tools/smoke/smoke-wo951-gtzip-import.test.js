'use strict'

/**
 * WO-951 — a NewTek LiveGraphics-style .gtzip imports as a CG Studio lower third. The fixture is built here with the
 * structure of the owner's file (05.11): document.xml declared utf-16 (plain ASCII), resources.xml → image entry by
 * GUID, layers with Rectangle / Image / TextBlock, a Skew effect, a dangling mask, In / TransitionOut / Page1
 * storyboards.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const JSZip = require('jszip')
const { parseGtzip, importGtzip, decodeXml, cssColor } = require('../../src/cg-studio/gtzip-import')
const { buildHtml, accentOf } = require('../../src/cg-studio/gtzip-import-html')
const { studioLtDefaultsFromHtml } = require('../../src/cg-studio/studio-lt-defaults')
const { parseInitSelectors } = require('../../src/cg-studio/lt-param-registry')
const { handleImport } = require('../../src/api/routes-lower-third-gtzip')

const DOC = `<?xml version="1.0" encoding="utf-16"?>
<Composition Width="1920" Height="1080">
  <Layer Name="Base Layer" Dimensions="1560,190,0" Location="180,832,0">
    <Layer.Composition><Composition Width="1560" Height="190">
      <Rectangle Name="White Rectangle" Dimensions="1500,190,0"><Rectangle.Fill><Brush Color="#FFFFFFFF" /></Rectangle.Fill></Rectangle>
      <Rectangle Name="Shade" Dimensions="100,190,0" Location="10,0,0"><Rectangle.Fill><Brush Color="#80000000" /></Rectangle.Fill></Rectangle>
      <Image Name="Logo Image" Dimensions="140,140,0" Location="42,25,0"><Image.Bitmap><Bitmap Source="abc\\IMAGE1.gif" /></Image.Bitmap></Image>
      <Rectangle Name="Rectangle End" Dimensions="60,190,0" Location="1500,0,0"><Rectangle.Fill><Brush Color="#FF50ADCC" /></Rectangle.Fill></Rectangle>
      <Rectangle Name="Vertical Line" Dimensions="31,190,0" Location="216,0,0">
        <Rectangle.Effects><Effect Type="Skew" Angle="10,0" /></Rectangle.Effects>
        <Rectangle.Mask><Mask Object="VL Mask" /></Rectangle.Mask>
        <Rectangle.Fill><Brush Color="#FF50ADCC" /></Rectangle.Fill></Rectangle>
    </Composition></Layer.Composition>
  </Layer>
  <Layer Name="Text" Dimensions="1563,196,0" Location="178,832,0">
    <Layer.Composition><Composition Width="1563" Height="196">
      <TextBlock Name="Description" Dimensions="1103,59,0" Location="382,118,0" Text="Description &amp; more" FontFamily="Century Gothic" FontWeight="Bold" AutoSize="Shrink"><TextBlock.Fill><Brush Color="#FF000000" /></TextBlock.Fill></TextBlock>
      <TextBlock Name="Headline" Dimensions="1163,71,0" Location="322,28,0" Text="HEADLINE" FontFamily="Century Gothic" FontSize="96" FontWeight="Bold" VerticalAlign="Center" AutoSize="Shrink"><TextBlock.Fill><Brush Color="#FF000000" /></TextBlock.Fill></TextBlock>
    </Composition></Layer.Composition>
  </Layer>
  <Storyboard><Storyboard.Animations>
    <Expand Object="White Rectangle" Delay="0.2" Duration="0.8" Direction="BottomLeft" />
    <Fly Object="Vertical Line" Delay="0.5" Duration="0.5" Interpolation="CubicEasingIn" Direction="Top" />
    <Fade Object="Headline" Delay="1.2" Duration="0.4" />
    <Wobble Object="Logo Image" />
  </Storyboard.Animations></Storyboard>
  <Storyboard Type="TransitionOut"><Storyboard.Animations>
    <Fly Object="Text" Interpolation="CubicEasingOut" Direction="Right" />
    <Fly Object="Base Layer" Interpolation="CubicEasingOut" Direction="Right" />
  </Storyboard.Animations></Storyboard>
  <Storyboard Type="Page1"><Storyboard.Animations><Rotate Object="Logo Image" /></Storyboard.Animations></Storyboard>
</Composition>`

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

async function fixture(doc = DOC) {
	const z = new JSZip()
	z.file('document.xml', doc)
	z.file(
		'resources.xml',
		'<resources><resource filename="abc\\IMAGE1.gif"><source guid="e63a">abc\\IMAGE1.gif</source></resource></resources>'
	)
	z.file('e63a', GIF)
	z.file('thumbnail.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
	return z.generateAsync({ type: 'nodebuffer' })
}

test('WO-951: colours and text decoding', () => {
	assert.equal(cssColor('#FF50ADCC'), '#50adcc')
	assert.equal(cssColor('#80000000'), 'rgba(0, 0, 0, 0.502)')
	assert.equal(cssColor('#50ADCC'), '#50adcc')
	assert.equal(cssColor('red'), null)
	const utf16 = Buffer.concat([
		Buffer.from([0xff, 0xfe]),
		Buffer.from('<?xml version="1.0" encoding="utf-16"?><A/>', 'utf16le'),
	])
	assert.equal(decodeXml(utf16), '<A/>')
	assert.equal(
		decodeXml(Buffer.from('<?xml version="1.0" encoding="utf-16"?>\r\n<B/>')),
		'\r\n<B/>',
		'declared utf-16, really ASCII'
	)
})

test('WO-951: the composition — layers flattened to canvas px, fills, skew, image by GUID, text, storyboards', async () => {
	const m = await parseGtzip(await fixture())
	assert.deepEqual([m.width, m.height], [1920, 1080])
	const by = Object.fromEntries(m.elements.map((e) => [e.name, e]))
	assert.deepEqual([by['Rectangle End'].x, by['Rectangle End'].y, by['Rectangle End'].fill], [1680, 832, '#50adcc'])
	assert.equal(by.Shade.fill, 'rgba(0, 0, 0, 0.502)')
	assert.deepEqual(by['Vertical Line'].skew, [10, 0])
	assert.equal(by['Logo Image'].file, 'image1.gif')
	assert.ok(m.images['image1.gif'].equals(GIF), 'the GIF entry found through resources.xml')
	assert.deepEqual(
		[by.Headline.x, by.Headline.size, by.Headline.weight, by.Headline.valign, by.Headline.shrink],
		[500, 96, 700, 'Center', true]
	)
	assert.equal(by.Description.text, 'Description & more')
	assert.equal(by.Description.layer, 'Text')
	assert.deepEqual(
		m.boards.in.map((a) => a.type),
		['Expand', 'Fly', 'Fade', 'Wobble']
	)
	assert.deepEqual(
		[m.boards.in[1].ease, m.boards.out[0].direction, m.boards.out[0].duration],
		['power2.in', 'Right', 0.5]
	)
	assert.ok(
		m.warnings.some((w) => w.includes('mask')),
		m.warnings.join(' | ')
	)
	assert.ok(m.warnings.some((w) => w.includes('"Page1"')))
	assert.ok(!m.warnings.some((w) => /Storyboard is not imported/.test(w)), 'storyboards are not reported as shapes')
})

test('WO-951: the template — lt-engine contract the studio readers understand', async () => {
	const m = await parseGtzip(await fixture())
	const { html, fields, warnings } = buildHtml(m, { id: 'lt-x', title: 'X.gtzip' })
	assert.deepEqual(fields, { title: 'Headline', subtitle: 'Description' }, 'the largest text is the title')
	assert.match(html, /LTEngine\.init\(/)
	assert.match(html, /src="\.\.\/lower-thirds\/lt-engine\.js"/)
	assert.match(html, /src="\.\.\/lower-thirds\/vendor\/gsap\.min\.js"/)
	assert.match(html, /src="assets\/lt-x\/image1\.gif"/)
	assert.equal(parseInitSelectors(html).titleSel, '#gt-headline h1')
	const d = studioLtDefaultsFromHtml(html)
	assert.deepEqual(
		[d.title, d.subtitle, d.primaryColor, d.textColor],
		['HEADLINE', 'Description & more', '#50adcc', '#000000']
	)
	assert.match(
		html,
		/#gt-rectangle-end \{[^}]*background: var\(--primary, #50adcc\)/,
		'the accent follows the inspector colour'
	)
	assert.match(html, /#gt-white-rectangle \{[^}]*background: #ffffff/, 'white is not the accent')
	assert.equal(accentOf(m.elements), '#50adcc')
	assert.ok(
		warnings.some((w) => w.includes('Wobble')),
		'an unknown animation is reported (played as a fade)'
	)
	assert.ok(
		!/<\/script>[^]*"<\/script>/.test(html.split('var GT = ')[1].split(';\n')[0]),
		'no </script> inside the data'
	)
})

test('WO-951: importGtzip writes the template + assets, a free id each time', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo951-'))
	try {
		const buf = await fixture()
		const a = await importGtzip(buf, { name: 'Kopia belka EKF.gtzip', studioDir: dir })
		assert.deepEqual([a.id, a.casparPath], ['lt-kopia-belka-ekf', 'studio/lt-kopia-belka-ekf'])
		assert.ok(fs.existsSync(path.join(dir, 'lt-kopia-belka-ekf.html')))
		assert.ok(fs.existsSync(path.join(dir, 'assets', 'lt-kopia-belka-ekf', 'image1.gif')))
		const b = await importGtzip(buf, { name: 'Kopia belka EKF.gtzip', studioDir: dir })
		assert.equal(b.id, 'lt-kopia-belka-ekf-2', 'never overwrites')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('WO-951: POST /api/lower-thirds/import-gtzip answers', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo951-api-'))
	try {
		assert.equal((await handleImport({}, {}, { studioDir: dir })).status, 400)
		const bad = await handleImport(
			{ name: 'x.gtzip', data: Buffer.from('not a zip').toString('base64') },
			{},
			{ studioDir: dir }
		)
		assert.equal(bad.status, 422)
		const noDoc = new JSZip()
		noDoc.file('x.txt', 'x')
		const nd = await handleImport(
			{ name: 'n.gtzip', data: (await noDoc.generateAsync({ type: 'nodebuffer' })).toString('base64') },
			{},
			{ studioDir: dir }
		)
		assert.match(JSON.parse(nd.body).error, /no document\.xml/)
		const ok = await handleImport(
			{ name: 'Bar.gtzip', data: (await fixture()).toString('base64') },
			{},
			{ studioDir: dir }
		)
		const j = JSON.parse(ok.body)
		assert.deepEqual([ok.status, j.ok, j.id], [200, true, 'lt-bar'])
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

/**
 * WO-951 — the HTML half of the .gtzip import (gtzip-import.js parses): the composition as absolutely placed elements
 * on the lt-engine contract the CG Studio exports use.
 *  - the largest text → title `<h1>` (titleSel `#… h1`), the next → subtitle `div.subtitle p` (studio-lt-defaults.js and
 *    export-template.js read and bake these two), any other text static;
 *  - the accent colour (the most used saturated fill) and the text colour are `--primary` / `--text` (`:root`), so the
 *    inspector's Primary / Text colour re-colour the import — the colour still has to be matched to a brand;
 *  - "Shrink" text shrinks to its box on every play; Skew is a GSAP skew (GSAP owns every transform);
 *  - the default storyboard plays in (animateIn), TransitionOut plays out (animateOut; none = a fade).
 */
'use strict'

const { FONT_FALLBACK } = require('./gtzip-import')

const VALIGN = { Top: 'flex-start', Center: 'center', Bottom: 'flex-end' }
const HALIGN = { Left: 'flex-start', Center: 'center', Right: 'flex-end' }
const KNOWN = new Set(['Fly', 'Fade', 'Expand', 'Rotate'])

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function hexSat(c) {
	const m = /^#([0-9a-f]{6})$/i.exec(c || '')
	if (!m) return 0
	const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
	const mx = Math.max(r, g, b)
	return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx
}

/** The accent: the saturated fill most shapes use (ties: the first). null when every fill is grey. */
function accentOf(elements) {
	const count = new Map()
	for (const e of elements)
		if (e.kind !== 'TextBlock' && e.fill && hexSat(e.fill) > 0.2) count.set(e.fill, (count.get(e.fill) || 0) + 1)
	let best = null
	for (const [c, n] of count) if (!best || n > count.get(best)) best = c
	return best
}

/**
 * @param {{ width: number, height: number, elements: object[], boards: { in: object[], out: object[] } }} model
 * @param {{ id: string, title: string }} opts
 * @returns {{ html: string, fields: { title: string|null, subtitle: string|null }, warnings: string[] }}
 */
function buildHtml(model, opts) {
	const { width: W, height: H, elements } = model
	const warnings = []
	const texts = elements.filter((e) => e.kind === 'TextBlock')
	const ranked = [...texts].sort((a, b) => (b.size || b.h * 0.75) - (a.size || a.h * 0.75))
	const title = ranked[0] || null
	const subtitle = ranked[1] || null
	const accent = accentOf(elements)
	const textColours = new Set(texts.map((t) => t.fill || '#000000'))
	const textVar = textColours.size === 1 ? [...textColours][0] : null
	const css = []
	const body = []
	for (const e of elements) {
		const box = `left: ${e.x}px; top: ${e.y}px; width: ${e.w}px; height: ${e.h}px;`
		if (e.kind === 'TextBlock') {
			const colour = textVar ? `var(--text, ${textVar})` : e.fill || '#000000'
			const fs = Math.round(e.size || e.h * 0.75)
			css.push(
				`#${e.id} { ${box} display: flex; align-items: ${VALIGN[e.valign] || 'flex-start'}; ` +
					`justify-content: ${HALIGN[e.halign] || 'flex-start'}; overflow: hidden; color: ${colour}; ` +
					`font-family: ${e.font ? `'${e.font.replace(/'/g, '')}', ` : ''}${FONT_FALLBACK}; font-weight: ${e.weight}; }`
			)
			const fit = e.shrink ? ` data-fs="${fs}"` : ` style="font-size: ${fs}px"`
			if (e === title) body.push(`<div class="gt-el gt-text" id="${e.id}"><h1${fit}>${esc(e.text)}</h1></div>`)
			else if (e === subtitle)
				body.push(`<div class="gt-el gt-text subtitle" id="${e.id}"><p${fit}>${esc(e.text)}</p></div>`)
			else body.push(`<div class="gt-el gt-text" id="${e.id}"><span${fit}>${esc(e.text)}</span></div>`)
			continue
		}
		const fill = e.fill ? (accent && e.fill === accent ? `var(--primary, ${accent})` : e.fill) : 'transparent'
		const round = e.kind === 'Ellipse' ? ' border-radius: 50%;' : ''
		css.push(`#${e.id} { ${box}${e.kind === 'Image' ? '' : ` background: ${fill};`}${round} }`)
		if (e.kind === 'Image')
			body.push(
				e.file
					? `<img class="gt-el" id="${e.id}" src="assets/${opts.id}/${esc(e.file)}" alt="">`
					: `<div class="gt-el" id="${e.id}"></div>`
			)
		else body.push(`<div class="gt-el" id="${e.id}"></div>`)
	}
	// Storyboard objects name an element or a layer (every element in it).
	const byName = {}
	for (const e of elements) {
		;(byName[e.name] = byName[e.name] || []).push(e.id)
		if (e.layer) (byName[e.layer] = byName[e.layer] || []).push(e.id)
	}
	const anims = (list, dir) =>
		list.filter((a) => {
			if (!byName[a.object]) warnings.push(`${dir} animation of "${a.object}": no such element or layer`)
			else if (!KNOWN.has(a.type)) warnings.push(`${dir} animation ${a.type} of "${a.object}" played as a fade`)
			return !!byName[a.object]
		})
	const geom = Object.fromEntries(elements.map((e) => [e.id, { x: e.x, y: e.y, w: e.w, h: e.h, skew: e.skew || null }]))
	const data = { W, H, IN: anims(model.boards.in, 'in'), OUT: anims(model.boards.out, 'out'), EL: byName, GEOM: geom }
	const json = JSON.stringify(data).replace(/<\//g, '<\\/')
	const vars = [accent ? `--primary: ${accent}` : '', textVar ? `--text: ${textVar}` : ''].filter(Boolean)
	const html = `<!DOCTYPE html>
<!-- ${esc(opts.id)}.html — imported from "${esc(opts.title)}" (.gtzip, WO-951). Edit the text and colours in the inspector. -->
<html>
<head>
    <meta charset="utf-8">
    <title>Lower Third — ${esc(opts.title)}</title>
    <style>
        ${vars.length ? `:root { ${vars.join('; ')}; }` : ''}
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: transparent; width: ${W}px; height: ${H}px; overflow: hidden; position: relative; }
        .gt-root { position: absolute; inset: 0; opacity: 0; }
        .gt-el { position: absolute; display: block; }
        .gt-text h1, .gt-text p, .gt-text span { font: inherit; color: inherit; white-space: nowrap; line-height: 1.15; }
        ${css.join('\n        ')}
    </style>
</head>
<body>
    <main class="gt-root">
        ${body.join('\n        ')}
    </main>
    <script src="../lower-thirds/vendor/gsap.min.js"></script>
    <script src="../lower-thirds/lt-engine.js"></script>
    <script src="../lower-thirds/lt-engine-controls.js"></script>
    <script>
        var GT = ${json};
        function gtEls(name) { return (GT.EL[name] || []).map(function (id) { return document.getElementById(id); }); }
        function gtFit() {
            document.querySelectorAll('[data-fs]').forEach(function (el) {
                var fs = Number(el.dataset.fs), box = el.parentElement;
                el.style.fontSize = fs + 'px';
                while ((el.scrollWidth > box.clientWidth || el.scrollHeight > box.clientHeight) && fs > 8) { fs -= 1; el.style.fontSize = fs + 'px'; }
            });
        }
        function gtOff(el, dir) {
            var g = GT.GEOM[el.id];
            if (dir === 'Right') return { x: GT.W - g.x };
            if (dir === 'Top') return { y: -(g.y + g.h) };
            if (dir === 'Bottom') return { y: GT.H - g.y };
            return { x: -(g.x + g.w) };
        }
        function gtOrigin(dir) {
            var v = /Top/.test(dir) ? 'top' : /Bottom/.test(dir) ? 'bottom' : 'center';
            var h = /Left/.test(dir) ? 'left' : /Right/.test(dir) ? 'right' : 'center';
            return { origin: h + ' ' + v, sx: dir === 'Top' || dir === 'Bottom' ? 1 : 0, sy: dir === 'Left' || dir === 'Right' ? 1 : 0 };
        }
        function gtAdd(tl, a, el, into) {
            var t = { duration: a.duration, ease: a.ease };
            if (a.type === 'Fly') {
                var off = gtOff(el, a.direction);
                if (into) tl.fromTo(el, Object.assign({ opacity: 1 }, off), Object.assign({ x: 0, y: 0 }, t), a.delay);
                else tl.to(el, Object.assign(off, t), a.delay);
            } else if (a.type === 'Expand') {
                var o = gtOrigin(a.direction);
                gsap.set(el, { transformOrigin: o.origin });
                if (into) tl.fromTo(el, { opacity: 1, scaleX: o.sx, scaleY: o.sy }, Object.assign({ scaleX: 1, scaleY: 1 }, t), a.delay);
                else tl.to(el, Object.assign({ scaleX: o.sx, scaleY: o.sy }, t), a.delay);
            } else if (a.type === 'Rotate') {
                var r = a.direction === 'Left' ? -360 : 360;
                if (into) tl.fromTo(el, { opacity: 1, rotation: r }, Object.assign({ rotation: 0 }, t), a.delay);
                else tl.to(el, Object.assign({ rotation: r }, t), a.delay);
            } else if (into) tl.fromTo(el, { opacity: 0 }, Object.assign({ opacity: 1 }, t), a.delay);
            else tl.to(el, Object.assign({ opacity: 0 }, t), a.delay);
        }
        function gtReset() {
            Object.keys(GT.GEOM).forEach(function (id) {
                var g = GT.GEOM[id], el = document.getElementById(id);
                gsap.set(el, { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, skewX: g.skew ? -g.skew[0] : 0, skewY: g.skew ? -g.skew[1] : 0 });
            });
        }
        gtReset();
        gtFit();
        LTEngine.init({
            containerSel: '.gt-root',
            titleSel: '${title ? `#${title.id} h1` : 'h1'}',
            subtitleSel: '.subtitle p',
            applyStyles: function (style) {
                var root = document.documentElement;
                if (style.primaryColor) root.style.setProperty('--primary', style.primaryColor);
                if (style.textColor) root.style.setProperty('--text', style.textColor);
            },
            animateIn: function () {
                return new Promise(function (resolve) {
                    gtReset();
                    gtFit();
                    GT.IN.forEach(function (a) { gtEls(a.object).forEach(function (el) { gsap.set(el, { opacity: 0 }); }); });
                    var tl = gsap.timeline({ onComplete: resolve });
                    tl.set('.gt-root', { opacity: 1 }, 0);
                    GT.IN.forEach(function (a) { gtEls(a.object).forEach(function (el) { gtAdd(tl, a, el, true); }); });
                });
            },
            animateOut: function () {
                return new Promise(function (resolve) {
                    var tl = gsap.timeline({ onComplete: function () { gsap.set('.gt-root', { opacity: 0 }); gtReset(); resolve(); } });
                    if (!GT.OUT.length) tl.to('.gt-root', { opacity: 0, duration: 0.4 });
                    GT.OUT.forEach(function (a) { gtEls(a.object).forEach(function (el) { gtAdd(tl, a, el, false); }); });
                });
            },
        });
    </script>
</body>
</html>
`
	return { html, fields: { title: title ? title.name : null, subtitle: subtitle ? subtitle.name : null }, warnings }
}

module.exports = { buildHtml, accentOf }

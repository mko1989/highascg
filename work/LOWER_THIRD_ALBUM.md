# Lower Third Template Album

> All templates live in [`template/lower-thirds/`](file:///home/casparcg/highascg/template/lower-thirds).
> They share a common engine ([`lt-engine.js`](file:///home/casparcg/highascg/template/lower-thirds/lt-engine.js)) and use GSAP for animation.
> Each template is a self-contained HTML file ready for CasparCG CG layer playback.

---

## 1. Classic Box (`lt-classic-box`)

SVG-bordered box with a title and colored subtitle bar. Based on the original `lower-third.1.html`.

```html
<main class="lt-classic-box">
  <div class="graphic">
    <svg viewbox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path vector-effect="non-scaling-stroke" d="M50 100 H0 V0 H50" />
      <path vector-effect="non-scaling-stroke" d="M50 100 H100 V0 H50" />
    </svg>
    <h1>Name</h1>
    <div class="subtitle"><p>Title</p></div>
  </div>
</main>
```

**Animation:** SVG paths draw on → title slides up → subtitle slides up.
**Best for:** General purpose, classic broadcast look.

---

## 2. Slide Bar (`lt-slide-bar`)

Full-width horizontal bar that slides in from the left edge. Accent stripe on top.

```html
<main class="lt-slide-bar">
  <div class="graphic">
    <div class="accent-line"></div>
    <div class="name-row"><h1>Name</h1></div>
    <div class="title-row"><p>Title</p></div>
  </div>
</main>
```

**Animation:** Accent line scales → name row slides in → title row slides in.
**Best for:** News, sports, wide-format broadcasts.

---

## 3. Minimal Fade (`lt-minimal-fade`)

No background — just text with a thin vertical accent bar. Ultra-clean.

```html
<main class="lt-minimal-fade">
  <div class="graphic">
    <div class="accent-bar"></div>
    <div class="text-block">
      <h1>Name</h1>
      <p>Title</p>
    </div>
  </div>
</main>
```

**Animation:** Accent bar scales up → name fades in → subtitle fades in.
**Best for:** Documentary, film, subtle overlays.

---

## 4. Split Color (`lt-split-color`)

Name on a colored left panel, title on a dark right panel. Both slide in from opposite directions.

```html
<main class="lt-split-color">
  <div class="graphic">
    <div class="left-panel"><h1>Name</h1></div>
    <div class="right-panel"><p>Title</p></div>
  </div>
</main>
```

**Animation:** Left panel slides from left → right panel slides from right.
**Best for:** Interviews, panels, dual-tone branding.

---

## 5. Frosted Glass (`lt-frosted-glass`)

Glassmorphism panel with `backdrop-filter: blur`. Rounded corners, subtle border.

```html
<main class="lt-frosted-glass">
  <div class="graphic">
    <div class="glass-panel">
      <h1>Name</h1>
      <div class="subtitle-row">
        <div class="dot"></div>
        <p>Title</p>
      </div>
    </div>
  </div>
</main>
```

**Animation:** Panel scales + fades in → name slides → subtitle slides.
**Best for:** Modern/premium look, works great over busy video backgrounds.

---

## 6. Underline Reveal (`lt-underline-reveal`)

Name with a gradient underline, subtitle below. No box — pure typography.

```html
<main class="lt-underline-reveal">
  <div class="graphic">
    <h1>Name</h1>
    <div class="line"></div>
    <p>Title</p>
  </div>
</main>
```

**Animation:** Gradient line draws on → name fades up → subtitle fades up.
**Best for:** Talks, presentations, editorial content.

---

## 7. Tag Badge (`lt-tag-badge`)

Colored badge/tag on the left (role), dark name panel extending right.

```html
<main class="lt-tag-badge">
  <div class="graphic">
    <div class="badge"><p>Title</p></div>
    <div class="name-panel"><h1>Name</h1></div>
  </div>
</main>
```

**Animation:** Badge pops in (back ease) → name panel scales out from badge.
**Best for:** News channels, role/title emphasis, info graphics.

---

## 8. Gradient Wave (`lt-gradient-wave`)

Wide panel with diagonal clip-path and 3-stop gradient background. Cinematic.

```html
<main class="lt-gradient-wave">
  <div class="graphic">
    <div class="wave-bg"></div>
    <div class="content">
      <h1>Name</h1>
      <p>Title</p>
    </div>
  </div>
</main>
```

**Animation:** Gradient background scales in from left → text slides in.
**Best for:** Entertainment, music, dramatic/cinematic productions.

---

## 9. Corner Bracket (`lt-corner-bracket`)

Four animated corner brackets frame the text. Sci-fi / tech / esports aesthetic.

```html
<main class="lt-corner-bracket">
  <div class="graphic">
    <div class="bracket-tl"></div>
    <div class="bracket-tr"></div>
    <div class="bracket-bl"></div>
    <div class="bracket-br"></div>
    <h1>Name</h1>
    <p>Title</p>
  </div>
</main>
```

**Animation:** Corner brackets pop in with stagger → name fades up → subtitle fades up.
**Best for:** Esports, tech events, gaming streams.

---

## Data Format (all templates)

All templates accept the same JSON payload via CasparCG `update()` or the HTTP API:

```json
{
  "data": { "title": "John Smith", "subtitle": "Executive Producer" },
  "style": {
    "primaryColor": "#00bcd4",
    "textColor": "#ffffff",
    "position": "left"
  }
}
```

Multiple titles can be provided as an array and cycled with `next` / `previous`:

```json
{
  "data": [
    { "title": "John Smith", "subtitle": "Executive Producer" },
    { "title": "Jane Doe", "subtitle": "Director" }
  ]
}
```

# WO-459 — Calamares installer slideshow still said "Broadcast graphics playout"

**Status: IN PROGRESS (repo fixed + guarded 2026-08-10; owner must redeploy branding on the eggs host and re-produce the ISO before it changes on a stick)**

Owner (todos10.08 §1): *"when calamares install is running there are splash screens inside the
installer and one of them reads highascg broadcast graphics playout. ive already told that there
should not be any broadcast mentions. this is a media server!"*

## 1. Investigation

The earlier ruling is todos03.08 §30–31: *"in a couple places there is a subtitle of highascg as
broadcast playout graphics. or direct playout. i want all of them to say media server."* That
sweep fixed the running-system surfaces — `client/index.html:6` is `HighAsCG — Media Server`,
`README.md:3` is `Media server — …` — but missed the installer.

Exactly two operator-facing strings survived, both in the Calamares slideshow
`tools/eggs/live-usb/highascg-eggs-theme/theme/calamares/branding/show.qml` (WO-148):

| Line | Was |
|------|-----|
| 76 | `qsTr("Broadcast graphics playout — installing to this machine")` |
| 92 | `qsTr("One-box playout")` |

**Why the first sweep missed it, and why nothing caught it since:** this slideshow renders *only
while Calamares is installing to disk*. It is not part of the running box, not part of the web UI,
and not visible on the stick — the only way to see it is to sit through an install. A grep for
"broadcast" across the repo also drowns it: the term is overwhelmingly used for the WebSocket
fan-out (`_wsBroadcast`, `broadcastProject`, `flushProjectSyncBroadcast`, …), so the two real hits
sat in a haystack of ~40 files of legitimate code.

`verify-iso-boot-branding.sh:286` did check the slideshow inside the squashfs, but only asserted
that it contained the string `HighAsCG` (i.e. "not the stock penguins-eggs slideshow"). Wording was
never gated, so a full produce would have shipped it again indefinitely.

**Deployment path (why editing the repo alone is not enough).** `install-eggs-calamares.sh:104-111`
syncs the repo slideshow into `/etc/calamares/branding/highascg-eggs-theme/` on the clone host;
`eggs produce` then captures *that* directory into the squashfs. The copy on this build host was
verified still stale at the time of writing:

```
$ grep -inE 'broadcast|playout' /etc/calamares/branding/highascg-eggs-theme/show.qml
76:                text: qsTr("Broadcast graphics playout — installing to this machine")
92:                text: qsTr("One-box playout")
```

## 2. What was done

- `show.qml:76` → `qsTr("Media server — installing to this machine")`;
  `show.qml:92` → `qsTr("One-box media server")`. Wording matches the surfaces the earlier sweep
  already settled on (`client/index.html` tab title, `README.md` strapline). No other slide
  mentioned either term; the wordmark, palette and slide structure from WO-148 are untouched.
- `verify-iso-boot-branding.sh` — the squashfs slideshow check now **fails** on
  `grep -qiE 'broadcast|playout'` and prints the offending lines, before it reaches the
  "is it HighAsCG-branded" branch. A regression can no longer reach an ISO silently.
- `tools/smoke/smoke-wo459-installer-slideshow-media-server.test.js` (new, registered in
  `tools/ci/run-offline-tests.js`) — guards the repo source offline: no `broadcast`/`playout` in
  any `qsTr(`/`text:` line, the two replacement strings are present, the wordmark slide survives,
  and the ISO verifier gate itself is pinned.

Deliberately **not** changed: `client/map.html:7`
`<meta name="description" content="Interactive architecture map of the HighAsCG playout stack">`.
It is document metadata rather than a rendered subtitle, it is pinned verbatim in WO-83d, and
touching it forces a client rebuild. Flagged for the owner — one word, say so and it goes.

## 3. What was VERIFIED to work

- `smoke-wo459-installer-slideshow-media-server.test.js` — **3/3 pass**.
- Full offline suite: **1900 pass / 0 fail / 2 skip** (1902 tests, 254 suites).
- `bash -n tools/eggs/live-usb/verify-iso-boot-branding.sh` clean.
- Repo-wide re-sweep of operator-facing surfaces (`client/*.html`, `client/components/`,
  the eggs theme, boot-branding scripts): after this change no **rendered** string in the product
  contains "broadcast". Remaining hits are WebSocket identifiers, code comments, and
  `console.warn` developer text.

**Remains (owner — needs root on the eggs host, then a produce):**

1. `sudo bash ~/highascg/tools/eggs/live-usb/install-eggs-calamares.sh` — resyncs the corrected
   slideshow into `/etc/calamares/branding/highascg-eggs-theme/`. Until this runs, the stale
   wording is what the next produce bakes in.
2. Full `eggs produce`, then `verify-iso-boot-branding.sh` on the new ISO — it now asserts the
   wording, so a green verify is the proof.
3. Optional: decide on `client/map.html`'s "playout stack" meta description (above).

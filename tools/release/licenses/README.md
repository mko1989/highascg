# Licence texts the collector cannot read from the build host (WO-1096)

`tools/release/collect-third-party-licenses.sh` copies these into the generated licence tree
(`/usr/share/doc/highascg/licenses/`, which `licenses/` symlinks to). Never edit the generated tree by hand.
Each text is unmodified from the source below. Update it when the shipped version changes. The collector warns
when the version on the host differs.

| File | Component | Source (fetched 2026-11-16) |
|------|-----------|-----------------------------|
| `COMPLIANCE-ISO.md` | how the ISO meets each third-party licence | this repo (was hand-written in the generated tree only) |
| `SOURCES.md.in` | written source offer; the collector fills in the versions | this repo |
| `third-party/casparcg-server-LICENSE.txt` | CasparCG Server (GPL-3.0-or-later) | `LICENSE` at mko1989/casparcg-server `8a2e2937234a8362d1efd10d7da2a60362e3a5f3` (tag `highascg-8a2e29372`) |
| `third-party/cef-142.0.17-LICENSE.txt` | Chromium Embedded Framework (BSD-3-Clause) | `LICENSE.txt` of the CEF 142.0.17+g60aac24+chromium-142.0.7444.176 minimal distribution used by build-26 |
| `third-party/chromium-142.0.7444-LICENSES.html.xz` | Chromium's third-party licences (inside libcef) | `LICENSES.chromium.html` from Electron v39.2.4 (`electron-v39.2.4-linux-x64.zip`, sha256 70e70d99…d17d per its SHASUMS256.txt), Chromium 142.0.7444.177. The CEF minimal distribution ships only a placeholder `CREDITS.html` ("This is sample credits page … set `generate_about_credits=true`"), so this is the nearest published credits file for the same Chromium branch (.176 in CEF vs .177 here). xz-compressed (15 MB → 180 KB) |
| `third-party/godot-4.7.2-LICENSE.txt` | Godot Engine (MIT) | `LICENSE.txt` at godotengine/godot tag `4.7.2-stable` |
| `third-party/godot-4.7.2-COPYRIGHT.txt` | Godot's third-party components | `COPYRIGHT.txt` at godotengine/godot tag `4.7.2-stable` |
| `third-party/companion-5.0.2-LICENSE.md` | Bitfocus Companion (MIT, part 1) | `LICENSE.md` at bitfocus/companion tag `v5.0.2` |
| `third-party/penguins-eggs-LICENSE.txt` | penguins-eggs (MIT or GPL-2.0) | `LICENSE` at pieroproietti/penguins-eggs tag `v26.10.30` (blob 7a645069) |

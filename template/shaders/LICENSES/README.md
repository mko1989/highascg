# Shader library licences

The shaders in `template/shaders/sh-*.html` (and their configs in `data/shaders/*.json`) are **third-party works
under their own licences. They are NOT covered by HighAsCG's AGPL-3.0-or-later licence.** The one exception is
`sh-fft-test`, a test card written for HighAsCG (AGPL-3.0-or-later).

Most of them (about nine in ten) are under **Creative Commons Attribution-NonCommercial-ShareAlike** (CC BY-NC-SA
3.0 or 4.0). That means:

- **free to use, copy and adapt for non-commercial purposes only.** Do not sell them, and do not use them in paid
  work, unless the author grants you other terms;
- **attribution:** keep the author, title, source link and licence (the header at the top of each shader);
- **share-alike:** your changes to such a shader are under the same licence.

The rest are under permissive licences (CC0, MIT, CC BY) or CC BY-NC 4.0 — see the manifest.

## Where the licence of each file is recorded

- **The header at the top of each shader's image pass** is the source of truth:

  ```
  // <title> — by <author>
  // <source URL>
  // License: <licence> — <licence URL> (<basis>)
  // Note: … / Converted for HighAsCG … / Modified for HighAsCG …
  ```

- **`manifest.json`** maps every file to its licence: `templates[]` holds one row per `template/shaders/<id>.html`
  (file, id, name, title, author, source, licence, licenceUrl, the exact licence line, nonCommercial, shareAlike,
  modified, notes). `boxLibrary[]` holds the FragCoord shaders (WO-999). They have no template and keep their
  attribution in the config's `source` field. `counts` gives the totals per licence. The manifest is generated, so do
  not edit it by hand:

  ```
  node tools/shaders/shader-licence-manifest.js --write   # after adding/editing a shader
  node tools/shaders/shader-licence-manifest.js --check   # CI: stale manifest or a shader without a licence fails
  ```

- **`opt-in.json`** lists the shaders taken out of the shipped set, with the reason for each. Four have an unknown
  origin. Three were removed outright: Nintendo IP (Mario), the Balatro game shader, and one "All rights reserved".

## Shadertoy's default licence

Many Shadertoy shaders carry no licence line. For those, Shadertoy's terms apply
(<https://www.shadertoy.com/terms>, read from web.archive.org snapshots of 2025-09-20 and 2025-10-01):

> All the shaders you create in Shadertoy are owned by you. You decide which license applies to every shader you
> create. We recommend you paste your preferred license on top of your code, if you don't place a license on a
> shader, it will be protected by our default license: This work is licensed under a Creative Commons
> Attribution-NonCommercial-ShareAlike 3.0 Unported License.

Those shaders are labelled `CC-BY-NC-SA-3.0 … (Shadertoy default licence …)`. A shader is shipped only if its author
and source are known, so that it can be attributed.

## Modifications

The `sh-sa-*` shaders were converted from ArthurTent's ShaderAmp collection (WO-586,
<https://github.com/ArthurTent/ShaderAmp>). The `sh-bg-*` shaders were imported from the Vipitis/shadertoys-dataset
(WO-587). Shader Live children (`parentId`) and pasted shaders may carry parameter or audio-channel edits. Each header
says so. All such changes are released under the same licence as the original shader.

## HighAsCG's own code in this folder

- `player.js`, `player-*.js`: HighAsCG's shader player, **AGPL-3.0-or-later** (see the repository `LICENSE`).
- `ShaderToyLite.js`: vendored renderer, **BSD-3-Clause** (see `vendor/shadertoy` and `THIRD_PARTY_NOTICES`).

# Shader library licences

The shaders in `template/shaders/sh-*.html` (and their configs in `data/shaders/*.json`) are **third-party works
under their own licences. They are NOT covered by HighAsCG's AGPL-3.0-or-later licence.** The one exception is
`sh-fft-test`, a test card written for HighAsCG (AGPL-3.0-or-later).

**Only shaders whose licence allows commercial use and redistribution ship** (repository, ISO, releases): CC0, MIT,
CC BY 3.0 / 4.0, and HighAsCG's own AGPL code. HighAsCG is used at paid shows, so a NonCommercial licence does not fit
(WO-1106 B67, owner decision 17.11.26: "Don't ship them"). The shipped set is 14 shaders: `sh-bg-anya-s-rose`,
`sh-bg-perlin-noise-fire`, `sh-fft-test`, `sh-sa-attempt-at-vdj-effects`, `sh-sa-ictalurus-forest`,
`sh-sa-mind-flowers`, `sh-sa-mind-flowers-2`, `sh-sa-more-glow-experiments`, `sh-sa-moving-without-travelling`,
`sh-sa-sound-oscilloscope-from-spectrum`, `sh-sa-synthwave-canyon`, `sh-sa-tribute-to-my-old-atari`,
`sh-sa-truchet-kaleidoscope-ftw`, `sh-triangle`.

For the CC BY ones, keep the attribution: the author, title, source link and licence in the header at the top of
each shader.

## NonCommercial shaders: withdrawn, held per machine only

169 shaders of the earlier library are under **Creative Commons NonCommercial** licences (CC BY-NC-SA 3.0 / 4.0,
CC BY-NC 4.0). They were withdrawn on 17.11.26 by licence, not by hand: every row whose licence id contains `-NC`.
`withdrawn-nc.json` records each one (id, title, author, source link, licence).

- **Not shipped.** Their templates are gone from the repository. The shader store never exports an NC shader to
  `template/shaders/`, never re-creates one from a stale template, and the ISO check
  (`tools/eggs/live-usb/verify-iso-redistribution.sh`) fails an image that carries one.
- **Boxes that already had them** keep their own copy in `data/shaders/` (box state: not in git, not in the ISO).
  Such a shader still runs in the Visuals, and saved looks that use it keep working on that box. The shader list
  (`GET /api/shaders`) marks it `nonCommercial: true`, `local: true`, `licence`,
  `licenceNote: "non-commercial licence — not part of HighAsCG"`, and `casparPath: null` (no Caspar template).
- **Bringing one in** is the operator's own choice and responsibility, per machine, for non-paid work: import it
  from its source link (FragCoord import or `POST /api/shaders`) with `allowNonCommercial: true`. Editing an NC
  shader the box already holds, or saving a Shader Live child of one, needs no flag.

## Where the licence of each file is recorded

- **The header at the top of each shader's image pass** is the source of truth:

  ```
  // <title> — by <author>
  // <source URL>
  // License: <licence> — <licence URL> (<basis>)
  // Note: … / Converted for HighAsCG … / Modified for HighAsCG …
  ```

- **`manifest.json`** maps every shipped file to its licence: `templates[]` holds one row per `template/shaders/<id>.html`
  (file, id, name, title, author, source, licence, licenceUrl, the exact licence line, nonCommercial, shareAlike,
  modified, notes). `boxLibrary[]` holds the FragCoord shaders (WO-999). They have no template and keep their
  attribution in the config's `source` field. `counts` gives the totals per licence. The manifest is generated, so do
  not edit it by hand:

  ```
  node tools/shaders/shader-licence-manifest.js --write   # after adding/editing a shader
  node tools/shaders/shader-licence-manifest.js --check   # CI: stale manifest, a shader without a licence, or an NC one fails
  ```

  `boxLibrary[]` leaves out the NC configs a box holds locally: they are not part of HighAsCG.

- **`opt-in.json`** lists the shaders taken out in WO-1096, with the reason for each. Four have an unknown
  origin. Three were removed outright and can never be saved again: Nintendo IP (Mario), the Balatro game shader,
  and one "All rights reserved".
- **`withdrawn-nc.json`** lists the 169 NonCommercial shaders withdrawn in WO-1106 B67 (see above).

## Shadertoy's default licence

Many Shadertoy shaders carry no licence line. For those, Shadertoy's terms apply
(<https://www.shadertoy.com/terms>, read from web.archive.org snapshots of 2025-09-20 and 2025-10-01):

> All the shaders you create in Shadertoy are owned by you. You decide which license applies to every shader you
> create. We recommend you paste your preferred license on top of your code, if you don't place a license on a
> shader, it will be protected by our default license: This work is licensed under a Creative Commons
> Attribution-NonCommercial-ShareAlike 3.0 Unported License.

Those shaders are labelled `CC-BY-NC-SA-3.0 … (Shadertoy default licence …)`. So a Shadertoy shader without a
licence line is NonCommercial and does not ship. A shader is shipped only if its author and source are known, so
that it can be attributed, and its licence allows commercial use.

## Modifications

The shipped `sh-sa-*` shaders were converted from ArthurTent's ShaderAmp collection (WO-586,
<https://github.com/ArthurTent/ShaderAmp>). The shipped `sh-bg-*` shaders were imported from the
Vipitis/shadertoys-dataset (WO-587). Shader Live children (`parentId`) and pasted shaders may carry parameter or audio-channel edits. Each header
says so. All such changes are released under the same licence as the original shader.

## HighAsCG's own code in this folder

- `player.js`, `player-*.js`: HighAsCG's shader player, **AGPL-3.0-or-later** (see the repository `LICENSE`).
- `ShaderToyLite.js`: vendored renderer, **BSD-3-Clause** (see `vendor/shadertoy` and `THIRD_PARTY_NOTICES`).

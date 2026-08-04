# WO-429 — Produced ISOs must ship no credentials and no vendor driver packages

**Status: DONE (2026-08-04 — both exclude fragments + ISO verifier extended; smoke 2/2; suite green. TAKES EFFECT at the next produce; SEE THE TOKEN WARNING below for ISOs already produced.)**

Owner: "make sure the decklink drivers are in eggs excluded. as well as any logins and
others for tailscale, nomachine, syncthing etc."

## Audit result

Already covered (WO-142/WO-168 era, both fragments): the INSTALLED Blackmagic driver files
(full decklink fragment, always merged), Tailscale node identity (deb + snap layouts),
NoMachine in full, Syncthing device identity + state, `~/.ssh`, `~/highascg/.private`,
`.env`, `~/Downloads` (where the 16.2 tar.gz sits), operator-Firefox/browser profiles,
`.mozilla`, IDE server caches, `~/.claude`, `~/.config/Code`.

**Gaps found and closed (added to BOTH fragments):**
- **`~/.config/gh` — the GitHub OAuth token.** This is the credential that pushes this repo.
  It had zero exclude coverage → **every ISO produced before 04.08 contains a working GitHub
  token for the repo.**
- `~/.gitconfig` (wires git to the gh credential helper), `~/.git-credentials`, `~/.netrc`,
  `~/.npmrc` (defensive), `~/.bash_history` / `~/.zsh_history` (92 KB of shell history was
  shipping), `~/.local/share/keyrings`.
- `~/highascg/vendor` — WO-427's GUI-uploaded Blackmagic packages (2 GB, EULA-bound).

`verify-iso-squashfs-excludes.sh` now FAILS a produced squashfs containing the gh token,
shell history, or vendor packages (mirrors the WO-168 identity check; the token message
says to rotate).

## ⚠ Owner action for ALREADY-produced ISOs

Any ISO produced before today carries the gh token (plus whatever T168.1 already flagged
for pre-07-13 ISOs). If any such ISO/stick left your hands, rotate the token:
`gh auth logout && gh auth login` on this box. ISOs staying in your own drawer: your call.

Note on the INSTALLED driver in clones: the decklink exclude fragment already masks the
installed Desktop Video files out of the squashfs, so the ISO ships driver-free and users
supply the package via the (now working) GUI upload — WO-427/428's flow is the EULA-clean
path end to end.

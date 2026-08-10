# WO-471 — Every produce stamps the ISO; boot stops waiting on absent hardware

**Status: DONE (2026-08-10 — three fixes, verified offline; suite 1942/0/2, eslint 0). Owner QA: one produce + one boot of the resulting ISO.**

**Source:** owner, 2026-08-10, after the highascg7579 install:
- "i just went into settings updates on the installed .27 and it shows the version from 2026.05.20 instead of the todays iso date"
- "make sure the timestamp is printed on the iso even when only producing eggs, because thats the main workflow now"
- "the second boot (without the stick) just now was way quicker, so its definitly the decklink install that slowed it down. does the service check if the decklink drivers are already installed so it doesnt install them again each boot?"

---

## 1. A bare `eggs produce` never stamped the build

`src/system/build-stamp.js:11` resolves the reported version in precedence order
`BUILD_STAMP` → `.highascg-build-stamp` → `package.json.version`. On the build host:

| file | value |
|---|---|
| `BUILD_STAMP` | **absent** |
| `.highascg-build-stamp` | `2026.05.20` |
| `package.json.version` | `2026.05.20` |

WO-432 added the `BUILD_STAMP` write to `build-produce-flash-stick.sh` — and its own comment says
*"only the GitHub-release flow ever wrote BUILD_STAMP, never eggs produce."* But `npm run eggs:build`
(`build-highascg-egg.sh`) is the owner's main workflow and bypasses that wrapper entirely, so ISOs
built that way shipped **no** `BUILD_STAMP` and fell through to a legacy file frozen at the
package version. Hence a same-day ISO reporting `2026.05.20`.

Second-order: `compareBuildStamps()` then weighs that bogus value against real release stamps — the
same class WO-424 fixed, re-entered through a different door.

`BUILD_STAMP` is deliberately absent from both eggs exclude fragments (they carry an explicit comment
saying so), so it rides into the squashfs once written.

**Fix:** the write moved into `build-highascg-egg.sh`, immediately before `eggs produce` clones the
filesystem. `build-produce-flash-stick.sh` no longer writes it — it exports `HIGHASCG_BUILD_STAMP`
so both phases print one identical stamp. Single writer, every path stamped.

## 2. A stickless boot spent 30s waiting for a stick

`systemd-analyze critical-chain casparcg-server.service`, installed box, no stick:

```
casparcg-server.service               @31.489s
└─highascg-exfat-sync.service         @30.852s  +628ms
  └─highascg-decklink-install.service @30.779s  +54ms
    └─highascg-exfat-boot.service     @649ms    +30.111s
```

The decklink unit took **54ms** — its gate skipped correctly, so the owner's initial reading (and
this session's earlier one) pointed at the wrong unit. The 30.111s is the exfat boot script's
`for ((i = 0; i < WAIT_SEC; i++)); do … sleep 1; done` polling for
`/dev/disk/by-label/HIGHASCGEXF`. `WAIT_SEC` is 30 on the `/run/live` branch, 12 otherwise.

Caspar is ordered behind that chain — `scripts/setup/13-caspar-systemd-units.sh:46-58` prepends
`highascg-decklink-install.service` to `casparcg-server.service`'s `After=` list, which chains back
to the exfat boot unit. So playout waits on optional hardware that is not present.

**Fix:** `udevadm settle --timeout=5`, then — only when the label node is absent *and* `lsblk` reports
no USB-transport disk at all — fall back to a 5s grace
(`HIGHASCG_EXFAT_STICKLESS_GRACE_SEC`) instead of the full wait. udev creates
`/dev/disk/by-label/*` while processing the block device, so after its queue drains "no USB disk"
is an answer rather than a guess. **A present stick takes the unchanged path** — verified on the
build host, whose `sdb` reports `usb`, so it still resolves to the full `WAIT_SEC`.

## 3. The decklink gate trusted `dpkg` alone

The final branch queued a DKMS build whenever `dpkg-query` did not report `desktopvideo` installed.
WO-431 established that a clone ships `/var/lib/dpkg/status` **whole**, so dpkg's record is not
evidence in either direction — and highascg7579 showed exactly that skew: `dpkg -l` reported
`ii desktopvideo 16.2a1` while `dkms status` printed nothing. A box whose driver is loaded and
working could rebuild it on every boot, and that delay lands on time-to-playout via the `After=`
chain above.

**Fix:** decide on observable state. Module loaded → skip, whatever dpkg says. No Blackmagic card in
`lspci` → skip. Otherwise (card present, module missing) → queue. This subsumes the old correct
branch and closes the dpkg-only hole.

### The trap this nearly fell into

`highascg-exfat-boot.sh` exists **twice**. `patch-wo47-exfat-boot-scripts.sh`'s `pick_src` prefers
`scripts/exfat/` and only falls back to `tools/runtime/wo47-*`, and
`install-exfat-systemd-units.sh:50` installs from `scripts/exfat/` exclusively. The first edit in
this WO went to the `tools/runtime/` copy only — a **no-op on a real host**. The header comment there
("ISO excludes `~/highascg/scripts/*`") is wrong: the exclude fragments drop only
`scripts/deprecated`. Both copies now carry both fixes, and a smoke pins the precedence.

## What was VERIFIED to work

- `npm run test:ci` → **1942 tests, 1940 pass, 0 fail, 2 skipped** (baseline 1935/1933/0/2).
  eslint 0. 0 files over 500 lines. `bash -n` clean on all four shell scripts.
- Stamp precedence exercised directly against a temp dir: legacy-only reports `2026.05.20`; adding
  `BUILD_STAMP` makes it report the produce stamp; `compareBuildStamps` orders it newer.
- Stamp write proven to precede `eggs produce` by line number, not by eye.
- The USB predicate run on the build host resolves to "USB disk detected → full `WAIT_SEC`",
  confirming the with-stick path is untouched.
- New smokes, both in the curated `FILES` list:
  `smoke-eggs-produce-build-stamp.test.js` (write happens, happens before produce, honours the env
  override, wrapper is not a second writer, `BUILD_STAMP` not excluded, runtime precedence) and
  `smoke-exfat-boot-wait-and-decklink-gate.test.js` (**both** script copies carry both fixes, the
  loop uses the reduced bound, no executable line decides the install from `dpkg-query`, and
  `scripts/exfat` remains the preferred source).

### Not provable offline — owner QA

1. Run one produce and confirm `==> BUILD_STAMP=<date>` appears, then that Settings → Updates on the
   resulting ISO shows that date rather than `2026.05.20`.
2. Boot the ISO **without** a stick and re-run `systemd-analyze critical-chain
   casparcg-server.service` — `highascg-exfat-boot.service` should drop from ~30s to ~5s.
3. Boot **with** a stick and confirm the exfat pipeline still mounts and syncs normally.

## Related, still open

- The operator GUI now lands on whichever port the `operator_gui` destination is bound to (DP-0 on
  highascg7579) instead of being mirrored onto both by the WO-468 overlap. On that box the operator
  monitor is evidently the other one, and pointer confinement follows the GUI rect, so the box was
  left unusable. **Owner chose not to fix .27.** Two things worth deciding for the ISO: whether the
  default binding should follow the primary output, and whether pointer confinement should refuse a
  rect the operator cannot reach rather than locking them out.
- The `/run/live` branch gives `WAIT_SEC=30` on what should be an installed box — worth checking
  whether `/run/live` survives a Calamares install, since that also picks the wrong 30s default.

# Work Order 97: Injection hardening — Zip-Slip, sudo wildcards, xrandr shell strings

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Complete (v1) — Zip-Slip, sudoers, xrandr argv, subprocess hardening (2026-07-02)
**Priority:** **High** — three concrete injection/pivot paths; amplified by WO-96 (no auth)
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Builds on / touches:**
- `src/api/routes-ingest.js` — upload/download zip extraction (`unzipper.Extract`)
- `scripts/setup/12-passwordless-sudo.sh` + [docs/HIGHASCG_PASSWORDLESS_SUDO.md] — NOPASSWD allowlist
- `src/utils/os-config.js` — xrandr / sudo persistence via `execSync`
- `src/network/tailscale-service.js` — `buildTailscaleUpArgs`
- `src/audio/audio-devices.js`, `src/utils/gpu-modetest.js` — `execSync` string interpolation

---

## 1. Problem statement

The codebase mostly avoids command injection (arg arrays, no `shell:true`, sudoers allowlist), but the review found three real weaknesses plus fragile patterns:

1. **Zip-Slip (F4):** uploaded/downloaded `.zip` files extracted via `unzipper.Extract({ path: zipDir })` (`routes-ingest.js` ~160, ~355) with **no per-entry path validation** — a crafted archive with `../../` entries can write outside the media dir.
2. **Sudo wildcards (F5):** `12-passwordless-sudo.sh` grants `tailscale up *` (lines ~55–58) and `eggs calamares --install *` (line ~65) NOPASSWD. `tailscale up` flags (`--ssh`, exit-node, route advertising) are a root/remote pivot; the app only ever needs `--hostname`/`--accept-routes`.
3. **xrandr shell strings (F3):** `os-config.js` builds `execSync` strings (~233, ~250, ~371, ~379). Output name is regex-validated but the **mode token** (`modeArg`, ~201) is interpolated unquoted; screen config is writable via `POST /api/settings`, making this a second-order injection reachable through WO-96's missing auth.
4. **Fragile `execSync` patterns:** `audio-devices.js` (~37, ~57) and `gpu-modetest.js` (~84) interpolate into shell strings even though inputs are currently constants — inconsistent with safer `execFileSync` used elsewhere.

---

## 2. Goal (normative)

- No archive extraction can write outside its target root.
- Sudoers grants are pinned to exact argument lists the app actually issues — no broad wildcards.
- All privileged/user-influenced subprocess calls use `execFile`/`spawn` with **argument arrays**, never interpolated shell strings.

---

## 3. Recommended approach

### 3.1 Zip-Slip fix (routes-ingest.js)

Replace the naive `unzipper.Extract` sink with per-entry validation:

```js
// pseudo — validate each entry resolves under target
for await (const entry of zip) {
  const dest = path.resolve(zipDir, entry.path)
  const rel = path.relative(zipDir, dest)
  if (rel.startsWith('..') || path.isAbsolute(rel)) { entry.autodrain(); continue } // reject
  // also reject symlink entries (entry.type / external attrs)
  ...
}
```

Apply to **both** the upload path (~160) and the download path (~355). Reject symlink entries. Add a size/entry-count cap (zip-bomb guard).

### 3.2 Sudoers tightening (12-passwordless-sudo.sh)

- Remove `tailscale up *` / `/snap/bin/tailscale up *` wildcards. Replace with the exact invocation the app uses, or wrap in a fixed helper (`/usr/local/lib/highascg/highascg-tailscale-up.sh`) that itself constructs a constrained arg set and is the only NOPASSWD entry.
- Remove/narrow `eggs calamares --install *` — pin the installer invocation or gate it behind a helper that validates args.
- Audit every remaining NOPASSWD line for wildcards or user-controlled args; document each in `docs/HIGHASCG_PASSWORDLESS_SUDO.md` with justification.

### 3.3 xrandr / os-config `execSync` → `execFileSync`

- Convert `os-config.js` xrandr calls to `execFileSync('xrandr', [...args])` arg arrays.
- Strictly validate `modeArg` against `^\d{3,5}x\d{3,5}(_\d+(\.\d+)?)?$` (or the exact modeline token format) before use; reject otherwise.
- Convert the sudo-persistence pipelines (~371, ~379) to arg arrays or a fixed helper script.

### 3.4 audio-devices.js / gpu-modetest.js

- Convert to `execFileSync(bin, argsArray)`. Even though inputs are constants today, this removes the fragile pattern and future-proofs against a caller passing dynamic values.

---

## 4. Tasks

- [x] **T97.0** Zip-Slip guard in `routes-ingest.js` (upload + download paths); reject `..`/absolute/symlink entries; entry-count + total-size caps.
- [x] **T97.1** Smoke test `tools/smoke/smoke-zip-slip.test.js` — crafted archive cannot escape target dir.
- [x] **T97.2** Remove `tailscale up *` / `eggs ... *` wildcards; add pinned helper or exact arg entries; re-run sudoers `visudo -c`.
- [x] **T97.3** Audit + document all NOPASSWD entries in `docs/HIGHASCG_PASSWORDLESS_SUDO.md`.
- [x] **T97.4** `os-config.js` xrandr → `execFileSync` arg arrays; strict `modeArg` validation.
- [x] **T97.5** `os-config.js` sudo-persistence pipelines → arg arrays / helper.
- [x] **T97.6** `audio-devices.js`, `gpu-modetest.js` → `execFileSync` arg arrays.
- [x] **T97.7** Smoke test asserting invalid mode token is rejected (no shell metachar reaches xrandr).

---

## 5. Acceptance criteria

1. A malicious zip with `../../evil` entries extracts nothing outside `zipDir` (test proves it).
2. `sudo -l` for `casparcg` shows no `*` wildcard on `tailscale up` / installer; app still brings up tailscale.
3. `grep -rn "execSync(\`" src` returns no interpolated-string privileged calls (all arg arrays).
4. Setting a screen mode containing shell metacharacters via `POST /api/settings` is rejected, not executed.
5. No regression: display layout apply, audio device enumerate, GPU modetest still function.

---

## Work Log

### 2026-07-02 — Initial WO (from project security review)

- Captured findings F3/F4/F5 into concrete remediation tasks.
- **Instructions for Next Agent:** T97.0/T97.1 (Zip-Slip) are the fastest high-value fix — do them first. T97.2/T97.3 (sudoers) need testing on a live egg/stick before shipping. Coordinate sudoers changes with [96_WO_API_WS_AUTHENTICATION.md](./96_WO_API_WS_AUTHENTICATION.md) since auth reduces remote reachability of these paths.

### 2026-07-02 — WO-97 implementation (agent)

- `src/utils/safe-unzip.js` — Zip-Slip, symlink, size caps; wired in `routes-ingest.js` (from WO-96).
- `src/utils/xrandr-safety.js` + `os-config.js` — `execFileSync` arg arrays, mode token validation, sudo install via argv.
- `scripts/setup/12-passwordless-sudo.sh` — removed `tailscale up *` and `eggs calamares --install *`; Tailscale via `highascg-tailscale-up.sh` only.
- `tailscale-service.js` — sudo bring-up uses pinned helper only.
- `audio-devices.js`, `gpu-modetest.js` — `execFileSync` arg arrays.
- Smoke: `smoke-zip-slip.test.js`, `smoke-xrandr-mode-validation.test.js`; docs updated.
- **Instructions for Next Agent:** Re-run `sudo bash scripts/setup/12-passwordless-sudo.sh` on deployed sticks to apply sudoers. Commit WO-97 batch when user asks.

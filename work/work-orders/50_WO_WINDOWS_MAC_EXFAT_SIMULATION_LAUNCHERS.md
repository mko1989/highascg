# Work Order 50: Windows & macOS desktop executables — run HighAsCG from exFAT in simulation mode

> **AGENT COLLABORATION PROTOCOL**  
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done  
> 2. Update task checkboxes to reflect current status  
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry  
> 4. Do **NOT** delete previous agents' log entries  

---

## Goal

Ship **click-to-run** native wrappers (not only shell/PowerShell scripts) that let **programming / prep** staff on **Windows** and **macOS** start **HighAsCG in simulation** straight from the **`HIGHASCGEXF`** exFAT slice (WO‑47 portable tree), without a full Linux live boot.

**“Simulation mode”** here means: **no Caspar AMCP** (`--no-caspar` CLI), using the **simulated AMCP stack** already in the repo (`src/caspar/amcp-simulated.js`, see **WO‑14**, **WO‑37**). Optionally align with **`offline_mode`** in config (`src/config/defaults.js`) for UX that matches “prep / no playout hardware”.

Operators keep the **canonical app tree** under exFAT at **`sim/highascg/`** (ZIP / GitHub release drop; same path as **`config/exfat-sync.json`** `sim-highascg` pair). The launcher must **resolve that path** from the **volume label `HIGHASCGEXF`** (11‑char exFAT limit — see **WO‑47** / **`tools/eggs/live-usb/MANUAL_STICK_WINDOWS_MACOS.md`**).

Deliverables:

| Platform | Artifact (directional — exact tech TBD below) |
|----------|-----------------------------------------------|
| **Windows** | **`.exe`** double‑click launcher (installer optional) |
| **macOS** | **`.app` bundle** (optionally DMG‑distributed, **notarized** for Gatekeeper if distributed wide) |

---

## Relationship to existing work

| Work / doc | Relationship |
|------------|----------------|
| **WO‑47** | Linux playout uses **`exfat/update/server/`** (not **`sim/highascg`**). Win/Mac launcher still uses **`sim/highascg`** for **offline simulation only** — separate from production stick layout. |
| **`tools/eggs/live-usb/MANUAL_STICK_WINDOWS_MACOS.md`** | Describes manual Etcher + partitioning + folder seeds; launcher docs should link here for “why `HIGHASCGEXF` / where to unzip releases.” |
| **WO‑14 Offline preparation** | Simulated AMCP / no‑Caspar workflows. Launcher must invoke **`node index.js --no-caspar`** (or equivalent programmatic flag) from the **`sim/highascg`** root containing **`package.json`**. |
| **WO‑37 Simulation placeholders** | UI expectations when not connected to real Caspar; launcher should document “simulation / prep only.” |

---

## Success criteria

### A. Discovery & paths

- [x] **A1.** Resolved **volume** by filesystem **label** **`HIGHASCGEXF`** on **Windows** and **macOS** (fallback: **`HIGHASCG_EXFAT_ROOT`** / **`HIGHASCG_EXFAT_APP_ROOT`**; dev **cwd** when **`package.json`** present — documented in **`client/tools/portable-desktop/README.md`**. **Not done:** graphical volume picker if label missing.)
- [x] **A2.** Canonical app root **`{volume}/sim/highascg`** — refuse to start unless **`package.json`** exists **under** that root (guard against typo “double nested” folder — log a helpful error with expected layout).
- [x] **A3.** **Working directory** for Node is **`sim/highascg`** (so relative paths behave like Linux **`~/highascg`**).

### B. Simulation runtime

- [x] **B1.** Start server with **`--no-caspar`** passed to **`index.js`** (or internal equivalent that prevents real AMCP TCP).
- [x] **B2.** **`offline_mode`** for prep UX: **`HIGHASCG_OFFLINE_MODE`** honoured in **`buildConfig`** (**`src/bootstrap/config.js`**); portable launcher **defaults** **`HIGHASCG_OFFLINE_MODE=1`** ( **`HIGHASCG_LAUNCH_NO_OFFLINE_DEFAULT=1`** to rely on disk only). **`config/general.json`** / monolithic **`offline_mode`** documented in **`client/tools/portable-desktop/README.md`**. (**`drop-config`** / dedicated sim drop still optional.)
- [x] **B3.** **Ports:** Launcher resolves **`httpPort`** / **`bindAddress`** consistently with **`index.js`** (modular **`config/server.json`** if **`config/`** present else **`highascg.config.json`**; honours **`HIGHASCG_CONFIG_PATH`**; **`HTTP_PORT` / `PORT` / `HIGHASCG_PORT`** and **`BIND_ADDRESS`**). **TCP bind preflight** (**`HIGHASCG_LAUNCH_SKIP_PORT_CHECK=1`** to skip). **`HIGHASCG_LAUNCH_PORT_FALLBACK=N`** probes successive ports and passes **`--port`** to **`index.js`**. **Optional / not done:** interactive tty prompt.
- [x] **B4.** **Browser:** Optionally open **`http://127.0.0.1:<port>/`** once timer elapses (~**`2500` ms**) — suppress with **`HIGHASCG_LAUNCH_NO_BROWSER=1`** (host via **`HIGHASCG_BIND_ADDRESS`** / **`HIGHASCG_LAUNCH_BROWSER_HOST`**).

### C. Node & dependencies (`node_modules`)

Pick **one** primary strategy (secondary allowed as advanced):

| Strategy | Pros | Cons |
|---------|------|------|
| **C‑embed** bundled **Node** (platform build) inside `.exe` / `.app` `_internal` | No separate Node install | Larger download; upgrades per OS |
| **C‑system** Require **nodejs.org** / **Homebrew** install + `PATH` | Smaller launcher | Operators must install Node |
| **C‑frozen** **`pkg`** / **`ncc`** bundle of **`index.js` + deps** | Single binary feel | Heavy; native addons (if any) need care |

- [ ] **C1.** Chosen strategy documented for operators (README next to installers).
- [ ] **C2.** **`npm ci` / `npm install`**: Launcher **detects missing `node_modules`** and either (i) runs **`npm ci`** interactively once with spinner + log pane, **or** (ii) refuses with link to README “run **`npm ci`** inside **`sim/highascg`** once” — **avoid** silent hangs. **Partial (ii):** reference launcher exits with **`npm ci`** hint; no auto‑install UI.
- [ ] **C3.** Respect **`NODE_ENV`**; default **`development`** acceptable for simulation if it improves DX (document prod vs prep).

### D. Packaging, UX, signing

- [ ] **D1.** **Windows**: `.exe` — consider **Electron-free** launcher (tiny C#/Go/Rust shim + bundled Node **or** **PowerShell‑compiled exe** acceptable only if security policy reviewed). Code signing certificate for SmartScreen (**best effort / org decision**).
- [ ] **D2.** **macOS**: `.app` with **bundled helper** invoking Node; **`Info.plist`** + codesign **`--deep`** where applicable; **`notarize`** checklist if distributed outside org (Apple account).
- [ ] **D3.** Visible **splash / console** tail on failure (pasteable log snippet for Slack).
- [ ] **D4.** Graceful shutdown: **SIGINT**/`Ctrl+C` / window close terminates child Node (no orphan **`node`** on the HTTP port).

### E. Repo & CI

- [x] **E1.** Source for launchers lives under **`client/tools/portable-desktop/`** (or **`tools/win-mac-sim-launcher/`** — bikeshed in first PR).
- [ ] **E2.** **`npm run`** or **`make`** recipes to produce Windows / mac bundles on tagged releases (GitHub Actions matrix **windows-latest** / **macos-latest** preferred). **Partial:** **`.github/workflows/portable-desktop-check.yml`** runs **`npm run portable:sim:check`** on **ubuntu-latest** (syntax only; not bundle builds).
- [ ] **E3.** Attribution / license headers for third-party wrapper deps.

### F. Documentation

- [x] **F1.** Operator one‑pager: **`client/tools/portable-desktop/README.md`** (double‑click **`.cmd` / `.command`**, **`npm ci`**, **`HIGHASCGEXF`** layout). Packaged installers TBD (**§D**).
- [x] **F2.** Troubleshooting in **`client/tools/portable-desktop/README.md`**: label, **`node_modules`**, port conflict + probe, firewall, **`powershell`**, BitLocker/encryption, antivirus, Gatekeeper, rare **`EACCES`**. Refine with operator reports.
- [x] **F3.** Explicit **non‑goals** in **`client/tools/portable-desktop/README.md`** — no Caspar/DeckLink **production** guarantees; prep / simulation lane only (**§ Non‑goals**).

---

## Architecture sketch (for implementers)

```
[OS native wrapper .exe/.app]
    ├─ find volume by label HIGHASCGEXF
    ├─ appRoot = {vol}/sim/highascg (validate package.json)
    ├─ ensure node (+ node_modules per strategy)
    └─ spawn: node "{appRoot}/index.js" --no-caspar [...]
```

- **stdin/stdout/stderr:** tee to **`%LOCALAPPDATA%\HighAsCG\launcher.log`** / **`~/Library/Logs/HighAsCG/launcher.log`** (paths bikeshed OK).
- **Updates:** Launcher does **not** replace Linux boot sync — it only reads exFAT. Document that **releases** overwrite **`sim/highascg`** manually on Win/Mac.

---

## Open decisions (capture in PR / Work Log)

1. **Bundled vs system Node** (see §C table).  
2. **Electron vs minimal native shim** — default **minimal** unless product wants single branded window.  
3. **Automatic `npm ci`** vs “fail with README” — security / air‑gapped policy.  
4. **Configurable port** precedence: CLI > env **`HIGHASCG_PORT`** > `highascg.config.json`.

---

## Work Log

## 2026-05-18 — follow-up 2 (@cursor-agent)

### Done
- **`offline_mode` (B2):** **`HIGHASCG_OFFLINE_MODE`** parsed in **`buildConfig`** — overrides config after load; portable launcher **defaults** **`HIGHASCG_OFFLINE_MODE=1`** with **`HIGHASCG_LAUNCH_NO_OFFLINE_DEFAULT`** escape hatch; README section **`offline_mode` vs `--no-caspar`**.
- **Port fallback (B3):** **`HIGHASCG_LAUNCH_PORT_FALLBACK=N`**, **`HIGHASCG_LAUNCH_INJECT_CLI_PORT`**; probe uses **`pickFirstBindableTcpPort`**; child gets matching **`--port`** when no **`-p`** in forwarded args.
- **WO** checklist: **B2** **✓**, **B3** clarified.

### Instructions for Next Agent
- **§C–§E:** bundled Node, **`.exe`/`.app`**, signing/notarization, release matrix beyond syntax CI.
- **`drop-config`** sim fragment (optional **B2** extra) if ops want a file drop without editing **`general.json`**.

---

## 2026-05-18 — follow-up (@cursor-agent)

### Done
- **`launch-sim-from-exfat.js`:** TCP bind **preflight** (**`HIGHASCG_LAUNCH_SKIP_PORT_CHECK`**); **`resolveHttpListenTargets`** aligned with **`index.js`** ( **`HIGHASCG_CONFIG_PATH`** file/dir; **`config/`** excludes monolithic when modular dir exists; **`HTTP_PORT`/`PORT`/`HIGHASCG_PORT`**, **`BIND_ADDRESS`**).
- **`README.md`**: **`HIGHASCG_LAUNCH_SKIP_PORT_CHECK`**; **`BIND_ADDRESS`/port env**; troubleshooting (port conflict, BitLocker, AV, Gatekeeper, **`EACCES`**); CI workflow pointer.
- **`.github/workflows/portable-desktop-check.yml`**: **`npm run portable:sim:check`** on **ubuntu-latest**.

### Checked / unchecked tasks
- **B3** core (preflight) **✓**; auto pick next port still optional.
- **F2** **✓** (initial depth).
- **E2** partially (syntax CI only); **§C–§D** bundles/signing unchanged.

### Instructions for Next Agent
- **§D–§E:** signed **`.exe` / `.app`**, **`pkg`**/**bundled Node**, release matrix (**windows-latest** /**macos-latest**).
- **B2 (optional):** **`offline_mode`** via **`HIGHASCG_CONFIG_PATH`** / **`drop-config`** + doc.
- **B3 (optional):** incremental port scan or single retry if probe passes but child races (rare).

---

## 2026-05-18 — @cursor-agent

### Done
- Added **`client/tools/portable-desktop/launch-sim-from-exfat.js`**: resolve **`HIGHASCGEXF`** (PowerShell on Windows, `/Volumes/` on macOS, common Linux mount paths + `findmnt`), **`HIGHASCG_EXFAT_ROOT`**, **`HIGHASCG_EXFAT_APP_ROOT`**, or **cwd fallback** for `npm run portable:sim`; require **`node_modules`**; spawn **`index.js --no-caspar`**; optional browser open to **`server.httpPort`** (default **4200**).
- Added **`win/HighAscg-Simulation.cmd`**, **`mac/HighAscg-Simulation.command`**, **`README.md`**.
- **`package.json`**: scripts **`portable:sim`**, **`portable:sim:check`** (`node --check` on the launcher).
- **`README.md`**: **Non‑goals** section (**F3**); env table includes **`HIGHASCG_EXFAT_APP_ROOT`**.
- Refreshed **Success criteria** checkboxes in this WO to match the reference launcher (ports note **4200** / **`defaults.js`**).

### Checked / unchecked tasks
- **Snapshot (first landing):** reference launcher covered A/B partial; **B3**/**F2**/**E2** gaps noted below at that time.
- **Open (then):** graphical volume picker (A1 footnote); B2 optional; B3 busy port; bundled Node + signed artifacts §C–§D; §E CI; F2 depth.


### Instructions for Next Agent
- **`pkg`** / **`nexe`** or bundled Node + **Inno Setup** / mac **`.app`** skeleton + **codesign** / **notarize** (§D–§E).
- Optionally run **`npm ci`** from launcher with UI (security review §C).
- **B3:** detect busy **`httpPort`** and surface a clear message or retry.
- **F2:** expand troubleshooting (BitLocker, AV, Gatekeeper) as operator feedback arrives.

---

### Template for new agents

```
## YYYY-MM-DD — @handle

### Done
-

### Checked / unchecked tasks
-

### Instructions for Next Agent
-
```

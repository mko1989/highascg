# WO-811 — Auth for every client (Godot auto-login, Companion, web UI) + change the casparcg OS password from Nuclear

**Status: IN PROGRESS (29.10) — phases 1 + 2 DONE (offline suite 3504/3504 incl. 14 new, Godot 22237/0, Companion 100/100; live box probed with enforcement OFF). Phase 3 (OS-password button) BUILT, offline-verified (6 smokes, Godot 22252/0); sign-in pages screenshotted on a sandbox and fixed. Template credentials DONE (offline: templates never get the shared password; a node-made template key, the AMCP path refuses the password; 11 new smokes with enforcement ON on a sandbox; suite 3518 pass/0 fail). Open: owner runs the button on :0 (after a node restart) and restarts the HTTPS proxy; a real template under enforcement ON and enforcement ON itself are the owner's steps.**
**Source:** owner 29.10: *"inside nuclear i need an option to change password to casparcg ubuntu user. and add auth for any
client, godot (default auto-login), companion, webui etc."*
**Related:** [WO-96](./96_WO_API_WS_AUTHENTICATION.md) (API/WS auth v1 — the code this builds on; its web login was
deleted a day later, see 1.3), WO-611 #6 (Nuclear flag must not be redacted), [WO-802](./802_WO_linked_servers_node_only_godot_stays_local.md)
(RULES.md "Linked servers": a Godot client talks only to its own node), WO-712/WO-732 (signed `/api/cluster/call`),
WO-387 (app catalog, terminal wrap for console tools), WO-628 (operator dock behind the Nuclear gate).

Investigation only. **Nothing was changed**: no code, no config, no auth setting, no restart. Everything below is from
reading the source and read-only probes on the live box (`GET /api/auth/status`, `ss`, `systemctl cat`, `sudo -n -l`,
`passwd -S`, boolean/emptiness checks of `config/security.json` and `config/ui.json`). No secret was printed.

---

## 1. Investigation

### 1.1 What auth exists in the server (WO-96 v1)

| piece | file:line | what it does |
|---|---|---|
| switch | `src/server/auth.js:21-37` | `security.enforceAuth` (config) decides. `HIGHASCG_ENFORCE_AUTH=1` **cannot turn it on**: line 34 returns false whenever the config flag is false ("explicit config opt-out overrides env"), and when the flag is true the env is irrelevant. So the eggs drop-in (`tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh:163-167`, installs `25-api-auth.conf` with `HIGHASCG_ENFORCE_AUTH=1`) does nothing while `config/security.json` says false. |
| one token | `auth.js:8`, `:51-97` | one per-install token, `REPO_ROOT/.private/api-token` (0600), else `security.apiToken`. Generated (32 random bytes, hex) at boot only when enforcement is on (`ensureApiToken`, called from `index.js:71-95`). Recovery: `tools/runtime/print-api-token.sh`. |
| transport | `auth.js:113-132` | `Authorization: Bearer <token>`, else cookie `highascg_session`, else `?token=` query. Compare: `secureCompare` (`:44-49`, `timingSafeEqual`). |
| public paths | `auth.js:134-143` | only `GET /api/auth/status`, `POST /api/auth/login|logout`, `GET /api/ping`, `POST /api/cluster/call` (ed25519-signed, WO-712). Everything else under `/api/` needs the token. |
| HTTP choke point | `src/api/router-dispatch.js:54-61` | `checkHttpAuth` before every route → 401 JSON. Static files (`dist-web/`, `/templates/`) are not gated (`src/server/http-server.js:323-350`). |
| WS | `src/server/ws-server.js:257-270` (operator `/api/ws`, `/ws`), `src/system/video-feed.js:133-142` (`/api/video-feed`) | origin allow-list + same token; 401 on the upgrade. `/api/replication/ws` has its own peer token (`ws-server.js:238-247`). |
| CORS | `src/server/cors.js:43-60` | `*` while off; origin allow-list (`HIGHASCG_CORS_ORIGINS`) while on. |
| bind | `auth.js:198-211` | off → `0.0.0.0`; on + `exposeToNetwork:false` → loopback. |
| login | `src/api/routes-auth.js:35-69` | `POST /api/auth/login {token|password}` compares against **the API token itself** and sets the cookie to **that same token** (`:65`). So a browser "session" is the master token: not revocable per browser, logout only clears the cookie on that browser (`:70-78`). |
| Nuclear gate | `src/api/routes-system-setup.js:179-193` (`checkNuclearPassword`), paths `:325-337` | separate, per action: scrypt hash in `config/ui.json` (`src/utils/nuclear-password.js:17-58`), only when `ui.nuclearRequirePassword` is true. Used by reboot/shutdown/WM restart/Calamares/Caspar stop-start-restart, `/api/system/gui-launch` + pointer confine (`system-hardware-gui.js:162,235`), dock launch (`routes-operator-dock.js:20`), Tailscale (`routes-network-tailscale.js:42`), time (`system-time.js:86`), DeckLink install, update apply (`routes-system-update.js:39`). |
| Nuclear password change | `src/api/settings-post.js:62-66` → `nuclear-password.js:94-112` | `POST /api/settings {ui:{nuclearPassword}}` sets a new one, and `{ui:{nuclearRequirePassword:false}}` turns the gate off — **neither needs the old password**. With the API open, the Nuclear password protects nothing against anyone who can reach :4200. |

### 1.2 State on the box now (29.10, read-only)

- `GET http://127.0.0.1:4200/api/auth/status` → `{"enforceAuth":false,"hasToken":false,"authenticated":false}`.
- `config/security.json`: `enforceAuth false`, `exposeToNetwork true`, `apiToken` empty. No `.private/api-token`. No
  `HIGHASCG_ENFORCE_AUTH` in the `highascg` unit (`systemctl cat highascg`).
- `ss -ltn`: node listens on `0.0.0.0:4200`; `highascg-https-proxy.service` listens on `*:4443` (see 1.5 #3).
- `config/ui.json`: `nuclearRequirePassword false`, no hash → **the Nuclear actions are open as well**.
- Net: anyone on the LAN / tailnet can call every route, including reboot, update apply, AMCP and app launch.

### 1.3 What each client sends today

| client | where it connects | sends a credential? | evidence |
|---|---|---|---|
| **Godot** | HTTP pool, WS, video feed, media download, upload | **No.** Headers are only `Accept` / `Content-Type`; no token anywhere in `godot/client` (grep `Authorization|token=|auth/` = 0 hits outside tests). | `core/api.gd:54-59` (JSON), `:73` (`get_bytes`, no headers), `core/ws.gd:89` (`connect_to_url(Config.ws_url())`), `video/video_feed.gd:73`, `features/live/media_download.gd:81`, `core/stream_upload.gd:39` (raw HTTP request line). Origin: `core/config.gd:13,28-29,67-77` (`--server`, `HIGHASCG_SERVER`, A/B profile in `user://ui.cfg`, default `http://127.0.0.1:4200`). The five entry points are pinned by `tests/test_devices_target.gd:14-15` — any token work touches exactly these. |
| **Companion module** (`~/companion-module-dev/companion-module-highpass-highascg`, runs in `companion.service` on this box) | REST + WS to `box_host:highascg_port` | **No.** No token config field; `fetch` with `Content-Type` only. | `src/bridge/api-client.js:25-27` (`_post`), `:49-51` (`_get`), `src/bridge/ws-client.js:29-31` (`new WebSocket(url)`, no headers), plus 7 more direct `fetch` sites: `connection-router.js:98,111`, `bridge/playlist-poller.js:53`, `pgm-layer-poller.js:50`, `compose-preview-poller.js:123`, `streaming-channel-poller.js:60`, `screen-timer-poller.js:50`. Config fields: `src/config-fields.js` (host, port, preview, hot backup — no auth). |
| **Web UI** (`client/` → `dist-web/`, opened in Firefox) | `/api` + `/api/ws` same-origin | Cookie only (`credentials: 'include'`, `client/lib/api-client.js:11`; browser WS sends cookies, `client/lib/ws-client.js:115`). **There is no login page**: WO-96 added `client/lib/auth-gate.js` on 02.07, commit `dd17ea3f` (03.07, "Fix compose preview thumbs…") deleted it (74 lines) together with a 5-line `auth.js` change; `dist-web/` has no `auth/login` string. No 401 handling in `api-client.js` / `ws-client.js` / `app.js`. |
| **Caspar HTML templates** (CEF, inside playout) | `ws://127.0.0.1:4200/api/ws` | **No.** | `template/multiview_overlay.js:16-21`, `template/multiview_master.js:41`, `template/playback_timers.js:2`, `template/shaders/player.js:214-218` (shader audio FFT tier, memory "Shader audio FFT routing"). |
| **Served pages** (phones: presenter intake, audio desk; show-timer strip) | `/intake` → `/api/tracking/presenters/intake`, `/audio` → `…/audio` (`http-server.js:330-335`); `src/show-timers/widget.js:58` | **No** — and they live under `/api/`, so they are gated. |
| **Linked node servers** (cluster, WO-732/802) | peer `:4200` | Only `/api/cluster/call` is signed + public. Unsigned/ungated calls to the peer: `/api/replication/ping`, `/api/cluster/identity`, `/api/cluster/peers` (link-back), `/api/cluster/master`, `/api/device-view` (`src/cluster/cluster-peers.js:44,69,251,263,316,320,419`, `cluster-master.js:126,163`), the Devices "Edit" relay (`cluster-relay.js:52-57`, no auth header), and `/api/cluster/ssh-key` (`cluster-media.js:68`: signed body, but **not** in `isPublicApiPath`). |
| **Replication peer** | peer `/api/replication/*` | `X-HighAsCG-Replication-Token` (`src/replication/peer-client.js:47`) — **not accepted** by `checkHttpAuth` (only Bearer/cookie/query). |
| **Scripts / tools** | `curl` to `/api/...` | none (`scripts/deploy/push-backup-box.sh:107-109`, `tools/runtime/replication-pair-qa.sh:105`, `tools/sweep/checks-app.js:16-28`, `scripts/exfat/highascg-exfat-remount-sync.sh:44`). |

### 1.4 Lockout risk if `enforceAuth` were switched on today

A token would be generated at the next boot of node (`ensureApiToken`), then:

| client | what happens | severity |
|---|---|---|
| Godot on the box | every `/api` GET/POST → 401; WS upgrade → 401, `ws.gd` reconnects forever (1-30 s backoff) silently; video feed and uploads fail. No login UI, no token setting → **operator UI dead** until the flag is reverted in `config/security.json` + node restart from a shell. | **total** |
| Godot on a laptop | same. | total |
| Web UI | page loads (static is open) but every API call 401s; no login page since `dd17ea3f` → only a hand-made `POST /api/auth/login` from devtools would get a cookie. | total |
| Companion | every action / feedback / poller 401s; WS refused; buttons dead, status error. | total for the show desk |
| **Caspar templates (on air)** | multiview overlay/master labels + timers, playback timer strip, shader audio FFT lose their WS → frozen/blank overlays on the outputs. | **on-air** |
| Phones (intake / audio pages), show-timer strip | 401. | high |
| Linked servers / replication | link, master claim, device view, relay, ssh-key exchange, replication pulls → 401 on the enforcing peer; only `/api/cluster/call` keeps working. | high (two-box shows) |
| Nuclear actions | unchanged (Nuclear gate is separate) — but unreachable from a client that cannot authenticate. | — |
| Recovery | local shell only (`print-api-token.sh`, or edit `config/security.json` + `kill -TERM` node). Not reachable from any UI. | — |

**Conclusion: switching enforcement on today locks out every client, including on-air templates. It must stay off
until each client can authenticate (section 3).**

### 1.5 Other findings that change the design

1. **The token file would sync to the peers.** `~/highascg` is a Syncthing folder (`label="highascg" path="~/highascg"`)
   and `.private/` is **not** in `.stignore` (only in `.gitignore:16`). `auth.js:8` puts the token at `.private/api-token`,
   not in the per-host subfolder the rest of `.private/` already uses (`.private/highascg7580/`, `.private/highascg7579/`).
   Turning auth on would hand this box's token to every peer (and two boxes generating their own would fight).
   The ISO is safe: `.private` is excluded (`penguins-eggs-exclude-highascg-*.list`).
2. **Token in the URL is journaled.** `http-server.js:390-391` logs `req.url` (with query) for every WS upgrade; a
   `?token=` would land in the journal. Header clients (Godot, Companion) avoid it; browser/CEF WS cannot set headers.
3. **Loopback is not "local".** `tools/runtime/highascg-https-proxy.js:80-93` and `:96-117` forward `:4443` → `127.0.0.1:4200`
   verbatim, without `X-Forwarded-For`. A "trust 127.0.0.1" rule would trust every LAN client that uses `:4443`.
   Caspar's CEF also renders arbitrary web pages (webpage live sources, HTML templates) from `127.0.0.1`.
4. **Nuclear password is weaker than it looks** (1.1 last row): changeable / switchable off via `/api/settings` without
   the old one, and the Godot field (`features/settings/settings_panes.gd:155-172`) sets it without asking for the current one.
5. Godot's Nuclear prompt (`app/nuclear_gate.gd:18-32`, `app/nuclear_model.gd:5-11`) is a good pattern to reuse for a
   401 → login prompt: same retry loop, keyed on the 401 instead of the 403.

### 1.6 The casparcg OS password

- `casparcg` (uid 1000) is in `sudo` with `(ALL : ALL) ALL` **with password** plus a NOPASSWD list (`sudo -n -l`):
  nodm restart, reboot/poweroff, Calamares, `caspar-systemd-control.sh`, Caspar/scanner/tailscaled units,
  tailscale logout, and `/usr/local/lib/highascg/highascg-{tailscale-up,vcam-modules-up,apply-hardware-hostname,network-apply,network-reset,set-system-time,webui-server-update}.sh`,
  `decklink-install-from-exfat.sh`, `highascg-operator-snap-home.sh`. **No `passwd`/`chpasswd`.**
  So the OS password is also the **sudo password** and (sshd active) the **SSH login password**.
  Desktop login is nodm autologin (`/etc/default/nodm`: `NODM_USER=casparcg`) → a new password does not affect boot.
- `passwd -S` → `casparcg P 2026-06-07` (password set). `/usr/bin/passwd` is setuid root (`-rwsr-xr-x`).
- **Changing one's own password needs no root**: `passwd` run as casparcg asks for the current password, then the new
  one twice (PAM). Root is only needed to set it **without** the current one (`chpasswd`, `passwd casparcg` under sudo).
- The node runs as `casparcg` (`systemctl cat highascg`: `User=casparcg`) and already opens console tools in a terminal
  on `:0`: `spawnGuiDetached('alsamixer')` (`src/api/system-hardware-gui.js:50-58`) wraps the command with
  `resolveTerminalEmulator()` + `terminalArgv()` (`src/utils/desktop-app-catalog.js:47-65`, `:90-98`) and spawns detached
  with `DISPLAY=:0` + `XAUTHORITY` (`system-hardware-gui.js:110-140`), behind the Nuclear gate (`:234-254`).
- Probed (pure functions only, nothing spawned): the terminal resolves to `/usr/bin/lxterm`, and
  `terminalArgv(term, 'highascg-passwd', 'Change password', ['/usr/bin/passwd'], {dark:true})` →
  `["-class","highascg-passwd","-title","Change password","-bg","#0d1117","-fg","#c9d1d9","-e","/usr/bin/passwd"]`,
  `terminalSupportsClass` true (the window can be found/raised by class like the alsamixer one).
- **Feasible as-is** — no sudoers change, no root, no secret ever passes through node or a client. What it needs:
  1. a new fixed action (e.g. `os-password`) in `handleGuiLaunchPost`'s list (`system-hardware-gui.js:240-247`) and a
     branch in `spawnGuiDetached` like alsamixer; the argv is constant (never from the request).
  2. a small wrapper so the window does not vanish before the operator reads the result — xterm closes when `passwd`
     exits: `sh -c 'passwd; s=$?; …write result…; echo; read -p "Press Enter to close" _'` (fixed string), writing
     `ok`/`failed` to e.g. `~/.highascg/run/os-password-result` so the app can show the outcome.
  3. the Godot button in Settings → Nuclear (`features/settings/nuclear_pane.gd`, a new HOST-style row) via
     `NuclearGate.post(self, "/api/system/gui-launch", {"action": "os-password"})`; the web Settings → Nuclear the same.
- Limits: the window opens on **the box's own screen (:0)** — fine on the box or over NX, useless from a laptop
  (the button must say so, or be disabled when the client is not on the box: Godot knows from `Config.origin`).
  It cannot reset a **forgotten** password (passwd asks for the current one; `sudo passwd` asks for it too).

---

## 2. Options — auth for every client

### A. One per-install token, every client gets it (WO-96 as designed)

Godot: token in `user://ui.cfg` per A/B profile, header on the 5 entry points; on the box **auto-login** by reading the
local token file (same user, 0600). Companion: a "HighAsCG API token" field (secret text, base 2.1), header on all 9
call sites + WS. Web: restore a login page (token entry) + 401 handling. Templates: `?token=` in the CEF URL or the
template's data.

- **+** Server is done; smallest change; one thing to explain.
- **−** A 64-hex string typed into Companion, a phone, a laptop. Not revocable per device: the cookie *is* the token
  (`routes-auth.js:65`), so a lost laptop means rotating the token and re-entering it everywhere. Leaks via query
  logging (1.5 #2). Every template/phone page holds the master key.

### B. Named per-client keys, revocable

`security.clients` (stored hashed, per host, under `.private/<host>/`): `{id, name, kind: godot|companion|web|template|peer,
scope: full|read, created, lastSeen}`. Settings → Security lists them with last-seen, Revoke and New key (shown once).
Browsers log in and get a **server-side session** (random id, expiry, revocable), not the master key. On-box Godot
auto-login: node writes a `godot-local` key to a 0600 file Godot reads at start (only when `Config.origin` is the
box's own loopback). Templates: a `read`-scoped key (WS receive only, no AMCP/POST) the server puts in the template URL/data.

- **+** Revoke one device without touching the others; last-seen shows who is connected; templates and phones hold
  a read-only key, not root-equivalent power; fits the existing per-host `.private/` layout.
- **−** Most work: store + session table, a Settings page in Godot **and** web, a scope check in the router/WS, migration.

### C. Keep the Nuclear password for destructive actions; add one operator login for the rest

Operator password (scrypt, like Nuclear) → session for web/Godot; Nuclear stays as the second, per-action gate.

- **+** Humans type a password they know, not a token; matches the owner's mental model ("login" + "nuclear").
- **−** Does not cover machines (Companion, templates, peers, scripts) — they still need keys, so C alone is
  incomplete; it is really "B's machine keys + a password login for humans". Two passwords to manage.

### D. Trust loopback (no credential from 127.0.0.1) — listed because it is the obvious shortcut

- **+** Zero config for on-box Godot, Companion (on this box), templates, scripts.
- **−** **Unsafe here**: the `:4443` HTTPS proxy makes every LAN client look like loopback (1.5 #3) unless it is fixed to
  send `X-Forwarded-For` and node refuses trust when it is present; CEF renders arbitrary web pages from loopback
  (a webpage live source could reboot the box); any local process is trusted. Remote Godot/Companion/web still need A or B.

### Trade-off summary

| | Godot on box | Godot laptop | Companion | web | templates | peers | revoke one | work |
|---|---|---|---|---|---|---|---|---|
| A | auto (file) | paste token | paste token | token login | master key in URL | shared token | no | S |
| B | auto (key file) | paste key | paste key | password/key → session | read-only key | per-peer key / signature | yes | L |
| C | login | login | needs keys anyway | password → session | needs keys anyway | needs keys anyway | sessions only | M + B's keys |
| D | free | — | free (on box) | — | free | — | no | S, unsafe |

---

## 3. Recommended path

**B, built in phases, with a password login for humans (C's good part) and A as the first shippable step.**
Enforcement stays **off** until phase 3 and is switched on only by the owner.

0. **Fix the ground (no behaviour change):** token/keys under `.private/<host>/` (not synced) and `.private/` in
   `.stignore` (mirror on the Mac — `.stignore` does not sync); stop logging the query part of upgrade URLs; accept the
   replication header and make `/api/cluster/ssh-key` + the cluster link paths signed-public like `/api/cluster/call`;
   Nuclear password change requires the current one.
1. **Every client can send a credential (still off):** Godot — header on the 5 entry points (`api.gd`, `ws.gd`
   `handshake_headers`, `video_feed.gd`, `media_download.gd`, `stream_upload.gd`), on-box auto-login from the local key
   file, a "Server key" field per A/B profile, 401 → prompt (reuse `nuclear_gate.gd`'s loop). Companion — secret field +
   `Authorization` on all 9 call sites + WS `headers`. Web — login page back (password → session) + 401 → login.
   Templates/phones — read-scoped key. Each proven against an enforcing **sandbox** server (WO-719 harness), never the box.
2. **Named keys + sessions** (B proper): Settings → Security page (Godot + web), revoke, last-seen.
3. **Owner switches it on** in Settings → Security (a new toggle; today it is file-only), with a pre-flight that lists
   every client seen in the last N minutes without a credential and refuses while any on-air template lacks one.
   Recovery stays `print-api-token.sh` + the config flag from a shell.

**OS password:** the terminal-launch option (1.6), behind the Nuclear gate, in Settings → Nuclear of both clients.
What the app shows:
- Button "Change casparcg login password…", note under it: *"Also the sudo and SSH password. Opens a terminal on this
  box's screen; type the current password, then the new one twice. Auto-login is not affected."*
- Off the box (Godot origin not loopback / web from another host): button disabled with *"Only on the box's own screen
  (or over NX)"* — or enabled with that warning, per owner decision 7.
- After launch: *"Terminal opened on the box screen — finish there."*, then *"Password changed"* / *"Password not
  changed"* from the wrapper's result file.
- Not offered: a form that sends the new password to node (would need a NOPASSWD `chpasswd` helper = any API caller can
  set the sudo password = root over HTTP, while the API is open).

---

## 4. Owner decisions needed

1. **Model:** A (one token, fastest), **B (named revocable keys + login, recommended)**, or C-only? 
2. **Humans log in with** a password you choose (recommended) or the key/token itself?
3. **On-box Godot auto-login** from a local key file (recommended) — or must it also prompt once?
4. **Laptops:** key pasted once per A/B profile in Godot Settings → Connection — OK?
5. **Companion:** key in the module's connection settings (module release needed) — OK? Companion runs on this box:
   should it still need a key (recommended: yes, no loopback trust)?
6. **Templates / phones (intake, audio page, timer strip):** read-only key put in by the server (recommended), or keep
   these pages open (unauthenticated read-only)?
7. **OS password button off the box:** hide/disable, or allow with the "opens on the box screen" warning?
8. **Nuclear password:** keep as a second gate for destructive actions after login (recommended), and require the
   current Nuclear password to change or disable it — yes?
9. **Turning enforcement on:** you flip it in Settings → Security after QA (recommended), or should new sticks/ISOs ship
   with it on (the eggs drop-in intends that but is a no-op today, 1.1 row 1)?
10. **Forgotten OS password:** accept that the app cannot reset it (recovery = console/root), or add a guarded root
    helper later (not recommended while the API is open)?

---

## 5. What was done / verified

Nothing changed. Read-only evidence: `GET /api/auth/status` (above), `ss -ltn` (0.0.0.0:4200, *:4443),
`systemctl cat highascg` (no auth env), `config/security.json` / `config/ui.json` read for booleans and emptiness
only, `sudo -n -l`, `passwd -S`, `/etc/default/nodm`, Syncthing folder paths, and a pure-function call of
`resolveTerminalEmulator()` / `terminalArgv()` (no spawn). Implementation and verification wait on section 4.

## Owner decisions (29.10)

1. Model: one shared password for all clients (a single login credential, not per-client keys). Sessions for browsers.
2. Godot auto-logs in on the box (the credential lives in the box's own client settings).
3. The OS-password button is available only from the box's own screen (:0).
4. The Nuclear password is NOT a second gate for changing auth; it stays as it is for the actions it already protects.
5. Enforcement is switched on by the owner, last, after every client has been checked with it off.

## Phases (this WO)

- Phase 1: token/password file kept out of Syncthing (`.private/` into `.stignore`, or moved), and no `?token=`
  query strings in the journal (http-server.js:391).
- Phase 2: every client (Godot, Companion module, web UI, template overlays, phone pages, linked-server calls) can
  send the shared password, with enforcement still OFF. Tests prove each client's request is accepted with the
  credential present and with enforcement on.
- Phase 3 (not started): the OS-password terminal action, box-screen only.
- Turning enforcement on is the owner's step, not part of this WO.

---

## Implementation (29.10, Opus)

### Investigation (before the change)

- **Credential = the existing API token.** With one shared password (decision 1) the server needs no new store:
  `getExpectedApiToken` (`src/server/auth.js`, file `.private/api-token`, else `security.apiToken`) *is* the password;
  `extractAuthTokenFromRequest` already takes `Authorization: Bearer`, the `highascg_session` cookie and `?token=`;
  `POST /api/auth/login {password}` (`src/api/routes-auth.js:53`) already accepts `password` and sets the cookie.
  There is **no WS "auth message"**: `/api/ws` (`ws-server.js:257-270`) and `/api/video-feed` (`video-feed.js:133-142`)
  check the credential on the **upgrade request** (header / cookie / query) — so Godot and Companion send the header
  on the upgrade, browsers use the cookie, CEF templates `?token=`.
- **Phase 1:** `.stignore` had no `.private` line (Syncthing folder `w6jjt-3qnxe`, `~/highascg`). Only one place logs a
  raw request URL: `src/server/http-server.js:391` (`[HTTP Server Upgrade] Event fired for path: ${req.url}`);
  `ws-server.js:236` logs the path without the query; the router logs no URLs. (`tools/runtime/highascg-https-proxy.js`
  logs no request URLs.)
- **Godot:** the five entry points pinned by `tests/test_devices_target.gd:14-15` (`core/api.gd:54-59,73`,
  `core/ws.gd:89`, `video/video_feed.gd:73`, `features/live/media_download.gd:81`, `core/stream_upload.gd:39`).
  `stream_upload.upload()` is called from `features/previs/` (not mine to touch) → the header had to come from inside
  `stream_upload.gd`, not from its callers. Pure scripts (video_feed, stream_upload, media_download) are preloaded by
  the `-s` test runner, which has no autoloads → the password lives in a static var of a pure script
  (`core/auth_model.gd`), not only on the `Config` autoload.
- **Templates:** the multiview chrome is `CG ADD`ed by the node with JSON it builds (`multiview-apply-overlay.js:133`);
  shader templates (`template/shaders/<id>.html`, file on disk, synced/ignored) and `playback_timers.html` (a URL stored
  in the project) get their data elsewhere (scene take: `scene-take-lbg-amcp-pipeline.js:270-280`,
  `scene-take-pgm-only.js`; project URL) — no single node point to inject a credential there.
- **Phones:** `/intake`, `/audio` → `/api/tracking/presenters/{intake,audio}` (`http-server.js:330-335`) are gated
  `/api/` pages; under enforcement a phone would get a bare 401 JSON with no way to sign in.
- **Linked servers:** all node→node GETs/POSTs go through `cluster-peers.js` `getJson`/`requestJson` (also used by
  `cluster-master.js:126,163` and `cluster-media.js:68` via deps) and `cluster-relay.js` `rawRequest`; replication
  through `src/replication/peer-client.js:47`. The subnet **scan** (`cluster-peers.js:431`) uses the same `getJson`.

### What was done

**Phase 1**
- `.stignore` (end): `/.private/api-token` — **listed, not moved**: `tools/runtime/print-api-token.sh` (recovery, not
  mine to touch) and the eggs drop-in name that path; moving it would break recovery. The per-host `.private/<host>/`
  folders keep syncing as before. **Mirror the line on the Mac** (`.stignore` does not sync).
- `src/server/auth.js` `redactUrlForLog()` (`token|password|apiToken|auth` query values → `***`);
  `src/server/http-server.js:397` logs the redacted URL.
- `src/server/auth.js:9-15` `tokenFilePath()`: `HIGHASCG_API_TOKEN_FILE` moves the file for tests/sandboxes (the
  tests never read or write the box's file).

**Phase 2 (enforcement stays OFF; with no password nothing on the wire changes)**
- **Godot** — `core/auth_model.gd` (new, pure: header builder, ui.cfg `[auth] passwords = {origin: pw}`, on-box file
  paths), `core/auth_prompt.gd` (new: "Server password" dialog after a 401, one dialog for all waiting requests, a
  cancel quiets it 60 s). `core/config.gd:27,66-98`: password loaded for the chosen origin; **on the box** (origin
  loopback, `Platform.is_local_origin`) the node's own `.private/api-token` is adopted and stored in ui.cfg
  (decision 2: auto-login); elsewhere asked once and kept. `core/api.gd:52-101`: header on every JSON and bytes
  request; 401 → adopt the box file or prompt → retry. `core/ws.gd:90`, `video/video_feed.gd:74`:
  `handshake_headers`. `features/live/media_download.gd:81`: header on the download. `core/stream_upload.gd:39-41,101`:
  `Authorization` line in the raw request head.
- **Companion** (`~/companion-module-dev/companion-module-highpass-highascg`, not packaged/released, Companion not
  restarted): config field `api_password` (`secret-text`, "HighAsCG password", default "", `src/config-fields.js:48-59`);
  `src/bridge/auth-headers.js` (new); header on every call: `api-client.js:30,54`, `ws-client.js:33` (WS upgrade),
  `connection-router.js:103,117`, `playlist-poller.js:56`, `pgm-layer-poller.js:53`, `compose-preview-poller.js:126`,
  `streaming-channel-poller.js:63`, `screen-timer-poller.js:53`. Read from the live config on each call (no restart
  after changing it). Empty → no header.
- **Web UI** — `client/lib/auth-gate.js` restored (WO-96's, deleted in `dd17ea3f`; now "password", posts
  `{password}`); `client/app.js:69` `await ensureAuthGate()` (asks only when `/api/auth/status` says enforce and not
  authenticated — with enforcement off it returns at once); `client/lib/api-client.js`: a 401 in get/post/put/delete
  → sign-in overlay → reload. Uses the existing `highascg_session` cookie (fetch `credentials:'include'`, browser WS
  sends it). `dist-web` rebuilt (`npm run build:client`).
- **Phones / served pages** — `src/server/login-page.js` (new): `/login` sign-in page (static, outside `/api/`, no
  secret; `next` same-site only); `src/api/router-dispatch.js:56-57`: under enforcement a **browser page load** (GET,
  `Accept: text/html`) of a gated page → 302 `/login?next=…`; fetch/XHR still get 401. `src/server/http-server.js:332-334`.
  Same-origin pages (intake, audio, show-timer strip) then use the cookie.
- **Caspar templates** — `template/multiview_overlay.js:16-31`, `multiview_master.js:37-51`, `playback_timers.js:2-31`:
  `wsAuthQuery()` adds `?token=` to the `/api/ws` URL from the CG data (`apiToken`, stored by `update()`:
  `multiview_overlay.js` / `multiview_master-labels.js:209`) or the page's own `?token=`/`#token=`; none → the URL of
  before. `template/shaders/player.js:56,219-222`: same for the FFT WS tier. Node side:
  `src/engine/multiview-apply-overlay.js:134-137` puts `apiToken` into the chrome's data **only while enforcement is ON**
  (`auth.templateApiToken`).
- **Linked servers / replication** — `auth.outboundAuthHeaders()` (this node's password, `{}` without one — today);
  `index.js:72` hands the live config to auth. `src/cluster/cluster-peers.js:42-46,73` (getJson/requestJson → identity,
  link-back, master, device view, ssh-key), `cluster-relay.js:56` (Devices "Edit" relay), `replication/peer-client.js:49`
  (Bearer next to the replication token). The **subnet scan** sends nothing (`cluster-peers.js:434`, `{ auth: false }`):
  it must not hand the password to every host on the /24. One shared password means linked boxes must be given the
  same password.

### What was verified

- Offline: `tools/smoke/smoke-wo811-auth-server-paths.test.js` (6 tests) — a **sandbox** server in the test process
  (port 0, own config, own token file via `HIGHASCG_API_TOKEN_FILE`): enforcement ON → `/api/logs` 401 without / with a
  wrong password, 200 with Bearer, `?token=`, and the cookie from `POST /api/auth/login {password}`; `/api/ws` and
  `/api/video-feed` upgrades 401 without, open with header / `?token=` / cookie; a browser page load → 302
  `/login?next=…`, `/login` 200 and holds no secret; the upgrade log line says `token=***` and no log line has the
  password. Enforcement OFF → everything 200/open with no, a right or a wrong credential, no redirect, login answers
  `{ok:true, enforceAuth:false}`. `tools/smoke/smoke-wo811-auth-clients.test.js` (8 tests): node→node headers (real
  HTTP server: getJson/requestJson/rawRequest carry Bearer, the scan does not, none without a password), replication
  header, `templateApiToken` only while ON, each template's `wsAuthQuery()` run in a VM (none / CG data / `?token=` /
  `#token=`), web gate wiring, redaction, `.stignore` line, `safeNext`. Both added to `tools/ci/offline-test-files-2.js`.
  Full curated suite (`node tools/ci/run-offline-tests.js`): **3504 tests, 3504 pass**. `check-max-file-lines`: 0 over
  500. `gen-api-contract --check`: clean.
- Godot: `godot/client/tests/test_auth_wo811.gd` (6 tests, 35 assertions: header builder, 401 detection, per-origin
  ui.cfg storage, on-box file paths/reading, upload head, every entry point sends it). `run-client.sh --test`:
  **22237 passed, 0 failed**; `run-client.sh --check` (headless boot, all autoloads + UI scripts): no script errors.
- Companion: `test/auth-headers.test.js` (7 tests: builder, config field, api-client GET/POST against a real HTTP server
  incl. a changed password, WS upgrade header via `ws` WebSocketServer, none when empty). `npm test`: **100/100**.
- Live box (node restarted once with `kill -TERM`, dev mode, to load the server changes; **enforcement still OFF**):
  `GET /api/auth/status` → `{"enforceAuth":false,"hasToken":false,"authenticated":false}`; `/api/settings` 200 with no
  and with a junk Bearer; `/login` 200; intake page with `Accept: text/html` 200 (no redirect while off); a WS with
  `?token=wo811probe…` opened and the journal line reads `path: /api/ws?token=***` (0 journal lines contain the probe
  value). No `.private/api-token` exists; `config/` untouched; no `HIGHASCG_ENFORCE_AUTH`. Syncthing REST
  `/rest/db/ignores?folder=w6jjt-3qnxe` lists `/.private/api-token`.

**Not verified / open**
- Enforcement ON on the live box (owner's step, last — decision 5). Before it: set the password (`.private/api-token`,
  `print-api-token.sh`), enter it in Companion's connection settings, mirror the `.stignore` line on the Mac, give linked
  boxes the same password, and relaunch the Godot GUI (the running one predates this code; on the box it will adopt
  the file by itself).
- A real Companion button press with the password; the Godot prompt and the web/phone sign-in pages seen by a person.
- (Superseded by "Template credentials" below — templates now get a node-made template key, never the password.)
  **Shader templates and `playback_timers.html` get no credential from the node yet** (template side ready: `?token=`
  / `#token=` / `apiToken` in CG data). Their data comes from the scene take / the project URL; injecting it there
  (only while ON) is the remaining step — until then, under enforcement the shader FFT WS tier and the timer strip
  would lose their WS. The multiview chrome is covered.
- (Superseded, fixed below.) While ON, the chrome's CG data carries the password over AMCP — Caspar's own AMCP log (local `log/`, not synced) may
  record it.
- Scripts in `tools/runtime/` / `scripts/` (curl without a credential) and the HTTPS proxy were out of scope.
- Phase 3 (OS-password terminal action) not started.

---

## Phase 3 and pages (29.10, Opus)

### Investigation

- **Headless browser:** `firefox-esr` 140.17 (`/usr/bin/firefox-esr`), `--headless --screenshot` with its own throw-away
  profile (`--no-remote --profile <scratch>`, `DISPLAY` unset) — the owner's Firefox and :0 untouched.
- **Sandbox server:** a scratch `sandbox.js` (scratchpad, not in the repo) built like `smoke-wo811-auth-server-paths.test.js`:
  `startHttpServer` + `routeRequest` on **127.0.0.1:4201**, its own in-memory config (`security.enforceAuth: true`,
  `apiToken` = a sandbox word), `HIGHASCG_API_TOKEN_FILE` → a scratch file, `webDir` = `dist-web/`. The live node (:4200),
  `config/` and `.private/api-token` were not used (the box still has no `.private/api-token`). Probes: `/api/auth/status`
  → `{"enforceAuth":true,"hasToken":true,"authenticated":false}`; `GET /intake` (Accept text/html) → 302
  `/api/tracking/presenters/intake` → 302 `/login?next=%2Fapi%2Ftracking%2Fpresenters%2Fintake`.
- **Faults seen in the first screenshots:** web UI sign-in — the password field was an **empty unlabeled box** (no
  placeholder/label), and the card was `min-width:320px` + 24 px padding (content-box) → on a 320 px phone it is wider
  than the screen (horizontal scroll) and at 390 px the gutter is under 16 px. Phone `/login` — fit and contrast fine
  (16 px+ gutter), but no product name or hint: a phone redirected from `/intake` saw only "Sign in" with no idea which
  server or which password. Input font 15 px (iOS zooms inputs under 16 px).
- **Local-only check (OS password):** the existing guard is `isLoopback(req)` in `src/api/routes-media-ingest-local.js:19`
  (socket peer 127.0.0.1/::1). Not enough on its own here (1.5 #3): `tools/runtime/highascg-https-proxy.js` forwards :4443
  verbatim from 127.0.0.1 with the client's `Host` and **no** `X-Forwarded-For`, and CEF renders foreign pages from
  loopback. `handleGuiLaunchPost(body, ctx)` had no `req` (`routes-system-hardware.js:57`, `router.js:163`).

### What was done

**Sign-in pages**
- `src/server/login-page.js`: title "Sign in to HighAsCG", hint "This server asks for its password.", `aria-label`,
  card `min(360px, 100vw − 32px)` (16 px gutter), input 16 px.
- `client/lib/auth-gate.js`: same title, placeholder "Password" + `aria-label`, card `width:min(360px,calc(100vw - 32px));
  box-sizing:border-box` instead of `min-width:320px;max-width:90vw`, input 16 px. `npm run build:client` (dist-web).

**OS-password button (phase 3)**
- `tools/runtime/os-password.sh` (new, 755): refuses uid 0; prints what will happen; runs `/usr/bin/passwd` (PAM asks for
  the current password, then the new one twice, no echo); prints "Password changed." / "Password NOT changed (passwd exit
  status N)."; waits for Enter (`read -r _`). Never reads, stores, prints or passes a password; writes no file.
- `src/api/box-local-request.js` (new): `checkBoxLocalRequest(req)` — all of: socket peer loopback (127/8, ::1,
  ::ffff:127.x); no `X-Forwarded-For` / `Forwarded` / `X-Real-IP` / `X-Forwarded-Host`; `Host` (if sent) a loopback name
  and its port = the port the connection came in on (`socket.localPort`; a :4443-proxied request keeps `Host: …:4443`);
  `Origin` (if sent) a loopback origin (`null` = file:// / sandboxed page is refused). Godot sends no Origin and
  `Host: 127.0.0.1:4200`.
- `src/api/system-hardware-gui.js`: action `os-password` in `handleGuiLaunchPost`'s list; after the existing nuclear gate,
  a non-local request → **403** `Only on the box's own screen (<reason>).`; `spawnGuiDetached('os-password')` = the
  alsamixer wrap: `terminalArgv(term, 'highascg-passwd', 'Change password', ['/bin/sh', OS_PASSWORD_SCRIPT], {dark:true})`,
  `DISPLAY=:0`, as the node's user (casparcg). Fixed argv, nothing from the request. 200 carries
  `note: "Terminal opened on the box screen — finish there."`. `deps.spawnGuiDetached` lets tests stub the launch.
  `routes-system-hardware.js` + `router.js:163` pass `req`. `x-display-session-gui-windows.js`: class `highascg-passwd`
  so the window is raised above the kiosk like alsamixer.
- `tools/runtime/highascg-https-proxy.js`: stamps `X-Forwarded-For: <client ip>` on every proxied request and upgrade
  (a client-sent one is dropped/overwritten), so a proxied LAN client is never taken for the box. **Takes effect when
  `highascg-https-proxy.service` restarts** (not restarted: audio test running). Until then the Host-port rule refuses
  normal :4443 traffic; only a hand-forged `Host: 127.0.0.1:4200` through the proxy would pass (and still meets the
  nuclear gate, and only opens a terminal that asks for the current password).
- Godot: `features/settings/os_password_model.gd` (new, pure: `PATH`, `request_body()` = `{"action":"os-password"}`,
  `available(origin)` = `Platform.is_local_origin`, `result_text`). `features/settings/nuclear_pane.gd`: "Login password"
  section under the host buttons — note *"Also the sudo and SSH password. Opens a terminal on this box's screen … A
  forgotten password cannot be reset here."*, button "Change casparcg login password…" via
  `NuclearGate.post(self, OsPw.PATH, OsPw.request_body())`, **disabled** off the box with "Only on the box's own screen …".
- Not done: the web UI Settings → Nuclear button (only Godot was asked); the result file the investigation suggested
  (the terminal shows the result; the app shows "finish there").

### Screenshots (headless Firefox, sandbox :4201, enforcement ON) — after the fixes

`/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/wo811_pages/`
- `login_phone_390x844.png` — `/login`: card "Sign in to HighAsCG", hint, "Password" field, blue "Sign in"; 16 px
  gutters, readable contrast, image exactly 390 wide (no horizontal overflow).
- `login_phone_320x640.png` — the same at 320 px: card shrinks to 288 px, 16 px gutters, no overflow.
- `intake_redirect_phone_390x844.png` — `/intake` followed to `/login?next=…`: byte-identical to the `/login` shot.
- `webui_signin_desktop_1440x900.png` — web UI (dist-web) at boot: dimmed app behind, centred 360 px card, title, hint,
  "Password" placeholder, "Sign in".
- `webui_signin_phone_320x640.png` — the web overlay at 320 px: fits with 16 px gutters (before the fix it overflowed).

### What was verified

- `tools/smoke/smoke-wo811-os-password.test.js` (6 tests, in `tools/ci/offline-test-files-2.js`): the local-check matrix
  (loopback ok; LAN peer, X-Forwarded-For, Forwarded, `Host: box:4443`, `Host: 127.0.0.1:4443`, foreign Origin,
  `Origin: null` refused); the handler with a stubbed launch — 4 non-local requests → 403 and nothing launched, local → 200
  + note, alsamixer from a LAN peer unaffected; the nuclear gate still first (403 "Invalid password" without it, 200
  with it); the **real route** over loopback HTTP with `child_process.spawn` stubbed — `X-Forwarded-For` and
  `Host: …:4443` → 403 with no spawn, local → 200 with argv ending `/bin/sh <repo>/tools/runtime/os-password.sh` and
  `DISPLAY=:0` (502 "No terminal emulator" accepted on a runner without one); the wrapper: `sh -n`, plain
  `/usr/bin/passwd`, no `echo`, no `chpasswd`/`--stdin`/`stty`/file write, every `read` is `read -r _ || true`, root
  refused; wiring pins (router passes `req`, window class, proxy XFF lines).
- Full curated suite (`node tools/ci/run-offline-tests.js`), run before the concurrent template-credential edits landed:
  **3510 tests, 3508 pass, 0 fail, 2 skipped** (the two `CI=1` skips). A later run had 2 failures in
  `smoke-wo811-auth-clients.test.js` ("templates: …apiToken…", `auth.templateApiToken is not a function`,
  `multiview_overlay.js` CG data) — caused by another agent's in-flight edits to `src/server/auth.js`,
  `template/multiview_overlay.js`, `src/engine/multiview-apply-overlay.js` (13:38–13:39), none of which this phase touched.
  `check-max-file-lines`: 0 over 500 (`router.js` stays 500). `gen-api-contract --check`: clean.
- Godot: `tests/test_os_password_wo811.gd` (4 tests: request builder, box-only availability incl. :4443, status text, pane
  posts via `NuclearGate.post` and is disabled off-box). `run-client.sh --test`: **22252 passed, 0 failed**;
  `--check`: boot OK, no script errors. The owner's running GUI was not closed or relaunched.

**Not verified / open**
- The button on the box's screen and a real `passwd` run — **owner** (nothing ran passwd; no click or key on :0).
  The live node predates this code: it needs a node restart (`kill -TERM`, after the audio test) to serve `os-password`;
  the running Godot GUI needs a relaunch to show the button.
- `highascg-https-proxy.service` restart for the X-Forwarded-For stamp (see above).
- A real sign-in through the pages (typing the password in a browser) — the cookie flow itself is covered by the phase 2
  smoke; the screenshots only show layout.
- Web UI Settings → Nuclear has no OS-password button yet.

---

## Template credentials (29.10, Opus)

Owner 29.10: *"why would a producer need a password???"* (shader and playback-timer templates) and *"The multiview
overlay sends the password through Caspar. Caspar's own log could then record it, so that path needs to change before
enforcement goes on."*

### Investigation (before the change)

- **The shared password was put into Caspar.** `src/engine/multiview-apply-overlay.js:133-137` merged
  `apiToken = templateApiToken(ctx.config)` (`src/server/auth.js:167-177`: the shared password, only while enforcement
  is ON) into the chrome's CG data, sent by `multiview-layout-helper.js:220-221` (`CG ADD` + `CG UPDATE`).
- **Templates read it into a URL.** `template/multiview_overlay.js:16-21` / `:430`, `template/multiview_master.js:37-42` +
  `multiview_master-labels.js:209`, `template/playback_timers.js:2-7`, `template/shaders/player.js:56` / `:219-222`:
  `wsAuthQuery()` / `initTierB()` appended `?token=<password>` from the CG data `apiToken`, or from the page's own
  `?token=` / `#token=` — an invitation to type the password into a template URL.
- **Shader and timer templates got nothing** from the node (shader CG data from the look layer, `scene-template-cg.js`;
  timers = a browser-source URL) — under enforcement their WS would be refused.
- **What Caspar logs** (read-only, `log/caspar_2026-10-29.log`, `<log-level>info</log-level>` in `config/casparcg.config`):
  every AMCP command in full, e.g. `Received message from 127.0.0.1: CG 3-999 ADD 0 "led_grid_test" 1 "{\"showLedGrid\":…}"`
  and `… PLAY 5-10 route://1` (6807 such lines today). So CG ADD/UPDATE data and `[HTML]` URLs land in Caspar's log
  verbatim. (`log` is in `.stignore` and `.gitignore`, so it is not synced — but it is readable by anyone on the box.)
- Every AMCP line the node sends goes through `src/caspar/amcp-client-transport.js` `_sendPrepare` (single sends, also
  `query-cycle.js` and the `_invokeTyped` fallback) or `src/caspar/amcp-batch.js` `runBeginCommitBatch` (BEGIN…COMMIT);
  the library-typed path (`_invokeTyped`, `useLibraryTyped`) serializes `params` itself.
- `/api/ws` lets any authenticated socket send `amcp` / structured AMCP (`src/server/ws-server.js:323-339`).
- Found on the way (not changed, outside this WO): an `http(s)://` browser-source clip is mangled before it is played —
  `normalizeCasparMediaPath` (`src/media/caspar-cls-id.js:21-30`) collapses `//` before `isPassthroughAmcpClip`
  (`:124`) can recognise `https?://`, so `resolveClipForAmcpLoad('http://127.0.0.1:4200/templates/playback_timers.html')`
  → `HTTP:/127.0.0.1:4200/TEMPLATES/PLAYBACK_TIMERS.HTML`. Both the take (`scene-take-lbg-jobs.js:140`) and
  `amcp.play` (multiview timers cell, `multiview-apply.js:351`) resolve through it, so the timers strip as a browser
  source probably never plays through the node today. Needs its own WO.

### Design

1. **No producer ever types or sees a credential, and the shared password never goes to Caspar.**
2. **Template key** (`src/server/template-credential.js`): `crypto.randomBytes(32)` hex, made once per node process,
   held only in memory (no file, nothing synced) → rotates on every node restart. Accepted **only** as `?template_key=`
   on the WS upgrades templates use (`/api/ws`, `/ws`, `/api/video-feed`: `auth.checkWebSocketAuth`), **only** from the
   Caspar host (`caspar.host`; Caspar on this machine → loopback or one of this machine's own addresses; Caspar
   elsewhere → exactly that address), **only** while enforcement is ON. Never on an HTTP route, never as Bearer /
   cookie / `?token=`. A template-key socket is **read-only**: it receives state and may send `osc_resync`, every other
   message is dropped (so a key read from Caspar's log cannot drive AMCP).
3. **Handed over at send time, in the one AMCP path** (`src/caspar/amcp-template-credential.js`, called from
   `_sendPrepare`, `runBeginCommitBatch`): while enforcement is ON, `CG <ch-l> ADD <n> <template> <0|1> [<json>]` for a
   WS template (`shaders/*`, `multiview_master`, `multiview_overlay`, `playback_timers`) gets `templateKey` merged into its
   JSON data; `PLAY|LOADBG|LOAD <ch-l> [HTML] <url>` to this machine's `/templates/<ws template>.html` gets
   `#template_key=<key>` (never for a foreign host). That covers the multiview apply (the data built in
   `multiview-apply-overlay.js`, no credential there any more), scene takes (`scene-template-cg.js` lines, single or
   batched), playlist shader hops (`cgAdd … '{}'`), Shader Live re-host, `/api/cg`, and client PRV pushes. Enforcement
   OFF → the line is untouched.
4. **Guard:** the same path refuses any line that carries the shared password (plain, AMCP-escaped or URL-encoded;
   passwords under 8 characters are not matched) — single sends, typed sends (`params` checked too) and batches (all or
   nothing: `batchSend` / `batchSendChunked` refuse the whole batch before any line is sent). Caspar's log can record
   the template key; it is useless after a node restart, read-only, and only accepted from the Caspar host — accepted
   as the trade-off. The node's own AMCP log/history masks it (`redactAmcpCommandForLog`).
5. Templates read `window.__HIGHASCG_TEMPLATE_KEY__` (set by `update()` from `templateKey`) or `#template_key=`; the page
   `?token=` / `#token=` paths are gone. The shader FFT tier now retries its WS every 2 s on close (it starts before
   Caspar's first `update()` delivers the key).

### What was done

- New `src/server/template-credential.js` (122 lines): key, Caspar-host check, `isTemplateCredentialRequest`,
  `isWsTemplateName`, `isOwnHost`.
- New `src/caspar/amcp-template-credential.js` (99): `injectTemplateCredential`, `carriesSharedPassword`,
  `prepareAmcpLine`, `passwordRefusal`.
- `src/server/auth.js` (302): `checkWebSocketAuth` accepts the template key first (`:209`, returns `template: true`);
  `templateApiToken` removed; `redactUrlForLog` also masks `template_key` (and after `#`).
- `src/server/ws-server.js` (498): the upgrade marks template sockets (`:272`); the message gate (`:319`).
- `src/caspar/amcp-client-transport.js` (274): `_sendPrepare` runs `prepareAmcpLine` and throws the refusal inside
  `execute` (nothing written, waiter removed); `_invokeTyped` refuses a password in the command or `params` (`:220`).
- `src/caspar/amcp-batch.js` (481): `runBeginCommitBatch` prepares every line (`:198`); `batchSend` (`:384`) and
  `batchSendChunked` (`:435`) refuse the whole batch up front.
- `src/engine/multiview-apply-overlay.js` (147): no credential in the chrome data.
- `src/streaming/stream-secret-redact.js` (92): `redactAmcpCommandForLog` masks `templateKey` / `template_key`.
- Templates: `template/multiview_overlay.js` (467, `:16-26`, `:431`), `template/multiview_master.js` (301, `:37-47`),
  `template/multiview_master-labels.js` (223, `:209`), `template/playback_timers.js` (403, `:2-12`),
  `template/shaders/player.js` (485, `:56`, `:214-231` incl. the retry).
- Tests: new `tools/smoke/smoke-wo811-template-credentials.test.js` (310, 11 tests) in `tools/ci/offline-test-files-2.js`;
  `smoke-wo811-auth-clients.test.js` (116): the two apiToken template tests replaced by one "no shared password" pin;
  `smoke-wo811-auth-server-paths.test.js`: comments/messages no longer call `?token=` the template path.
- Not touched: `config/`, the token file, `HIGHASCG_ENFORCE_AUTH`, any look/take on the box.

### What was verified

- `smoke-wo811-template-credentials.test.js`, **11/11**, against a **sandbox** server (port 0, own config
  `{ security: { enforceAuth: true, apiToken } , caspar: { host: '127.0.0.1' } }`, own token file via
  `HIGHASCG_API_TOKEN_FILE`), enforcement **ON**:
  - the key opens `/api/ws`, `/ws`, `/api/video-feed`; a wrong key and no credential → 401;
  - the key is refused as HTTP `?template_key=`, HTTP Bearer, HTTP `?token=`, WS `?token=`, WS Bearer, WS cookie (401);
  - Caspar host elsewhere (`10.255.255.1`) → the key from loopback is 401; unit checks for IPv4-mapped loopback, a LAN
    host, a remote Caspar;
  - a template-key socket: `{type:'amcp'}` gets no reply, `osc_resync` → `osc_resync_ok`; a password socket gets the
    AMCP `error` reply (handled);
  - the upgrade log line reads `template_key=***`; no log line holds the key;
  - **every real template's WS URL is accepted:** `wsAuthQuery()` of `multiview_overlay.js`, `multiview_master.js`,
    `playback_timers.js` run in a VM with the key from the CG data and from `#template_key=` → `?template_key=…` → a
    real WS to the sandbox opens; the shader `initTierB` URL lines run the same way → opens; a page `?token=` is ignored;
  - **the grep:** a real `AmcpClient` over a fake Caspar socket, the real `applyMultiviewOverlay`, the take's
    `buildSceneTemplateCgAmcpLines` for a shader (single sends and a BEGIN…COMMIT batch), the timers URL through
    `serializeClipCommandPlan`, a lower third via `cgAdd`: the joined wire strings contain **neither the shared password
    nor its URL-encoded form nor any `apiToken`**; the chrome ADD data, the shader ADD data and the batch carry
    `templateKey` = the key; the timers line is `PLAY 1-30 [HTML] http://127.0.0.1:4200/templates/playback_timers.html#template_key=<key> MIX 25 linear`;
    the lower third is byte-identical; the node's log redaction masks the key;
  - a password in `cgAdd` data, in a raw `[HTML]` URL (URL-encoded), in a batch and in a typed `cgUpdate` → all
    rejected, **nothing reached the socket**;
  - enforcement OFF: `/api/ws` opens with no key; a shader `CG ADD` line is unchanged.
- Full curated suite (`node tools/ci/run-offline-tests.js`): **3520 tests, 3518 pass, 0 fail, 2 skipped** (the two
  `CI=1` skips). `check-max-file-lines`: 0 over 500. `prettier --check tools/ci …` (CI gate): clean. eslint on the
  changed files: 0 errors (2 old warnings).
- Live box (read-only; no take, clear, play, restart or config change by this session): the node was restarted at
  13:44:25-30 by another session (clean SIGTERM exit, systemd restart) after these edits, so it runs this code with
  enforcement OFF: `GET /api/auth/status` → `{"enforceAuth":false,"hasToken":false,"authenticated":false}`;
  `/api/settings` 200; WS clients connect (`[WS] client connected`); 0 journal lines with "refused: it carries",
  `TypeError`, `ReferenceError` or `Cannot find module` since; Caspar's log since 13:44:30: 225 AMCP messages, 0 contain
  `templateKey`, `template_key` or `apiToken` (enforcement OFF → no key, as designed). No `.private/api-token` exists.

**Not verified / open**
- **A real template on Caspar with enforcement ON** (CEF actually running `update()` with the key and its WS accepted
  by the live node) — owner's step, with enforcement. The sandbox proves the URL each template builds is accepted.
- **After a node restart under enforcement**, templates already on air hold the old key: the multiview chrome is
  re-applied on boot (`multiview-reapply.js` via `routing-setup.js:173`) and gets the new one; **shaders and the timer
  strip on air stay refused until their look is taken again** (shader FFT WS tier falls back to tier A; timers freeze).
- No key for: a shader playlist hop with a non-CUT transition (LOADBG/PLAY of the html file,
  `scene-take-lbg-playlist.js:384-389` — no data, no URL); the multiview `CALL … update()` fallback
  (`multiview-layout-helper.js:229-232`, only when CG ADD fails); a typed-library `cgAdd` without data.
- Replication: the leader's AMCP fan-out carries the leader's key to the follower's Caspar; the follower node refuses it,
  so follower templates have no WS under enforcement.
- The server still accepts the shared password as `?token=` (scripts); no template sends it any more.
- The `http(s)` browser-source mangling above (own WO).

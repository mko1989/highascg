# WO-822 — Remove the :4443 HTTPS proxy (`highascg-https-proxy`), the way nginx went in WO-498

**Area:** network
**Status: DONE (29.10) — repo (offline gate green, see 4) and box: the owner ran the remover at 19:16; verified below (Box verified).**

Owner 29.10: *"The https proxy was deprecated due to some issues I don't remember now."* — then confirmed: remove it the same
way nginx was removed in [WO-498](./498_WO_REMOVE_NGINX_AND_GZIP_IN_NODE.md).

## 1. Investigation (written before any change)

### 1.1 What it is

| piece | evidence |
|---|---|
| process | `tools/runtime/highascg-https-proxy.js` (143 lines): `https.createServer` on `HTTPS_PORT` (default 4443), forwards requests and WS upgrades to `127.0.0.1:4200`, Host header preserved (`:12-19`); makes its own self-signed cert into `config/certs/` (`:37-62`). |
| unit | `tools/runtime/highascg-https-proxy.service` — a template the owner copied by hand to `/etc/systemd/system/` (header `:6-9`). **No installer script exists** (`rg highascg-https-proxy scripts tools/eggs tools/startup` finds no installer, only comments and the exclude lists), so there is no provisioning to delete. |
| box today | `systemctl show highascg-https-proxy`: `FragmentPath=/etc/systemd/system/highascg-https-proxy.service`, `UnitFileState=enabled`, active since 29.10 10:13; `ss -ltn`: `*:4443`; node pid 3812 under user `casparcg`. `ss -tn state established '( sport = :4443 )'`: **no connections**. Journal: only its own start-up banner after boot, no request logging. |

### 1.2 Why it existed, and why that is gone

Its own header (`highascg-https-proxy.js:5-10`, `.service:1-2`) and WO-319 / WO-325: the live GUI preview decoded an NVENC stream with
WebCodecs `VideoDecoder`, which browsers expose only in a secure context. A LAN client on `http://<box>:4200` is insecure, so the
proxy gave `https://<box>:4443` (self-signed) purely to make that toggle appear. Both ends are removed:

- The web-side decoder went with the kiosk: [WO-646](./646_WO_kiosk_decommission.md) stage C (`preview-canvas-live-stream.js`,
  `gui-stream-client.js`, Settings "Live stream").
- The server-side encoder/stream went in [WO-660](./660_WO_remove_gui_stream_encoder.md) (`/api/gui-stream/status` 404 on the box).
- `rg -n -a "VideoDecoder|WebCodecs|isSecureContext|gui-stream" client src godot/client` finds nothing live. (`src/system/video-feed*.js`
  is the Godot shm→WebSocket feed; Godot is not a browser and has no secure-context requirement; `godot/client/tests/test_video_feed.gd:20`
  already exercises `wss://` generically against a Tailscale-style URL, not this proxy.)
- Nothing in `client/`, `godot/client/` (non-test) or `src/` names `:4443`. The only `4443` strings outside work orders are
  tests asserting it is *refused* (see 1.4), exclusion lists (1.3), and `docs/MANUAL_INSTALL.md:338`, which is `HTTPS_PROXY` for npm
  (unrelated).

Also the proxy is a standing liability: **stale cert SANs** (WO-498 §5) — `config/certs/highascg-cert.pem` has `192.168.0.35` and
`DNS:highascg7579`; this box is `192.168.0.56` / `highascg7580`, and the cert is "valid" to 2036 and never regenerated. It also
listens on all interfaces, forwarding every LAN client as `127.0.0.1` (WO-811 §1.5 #3), which is exactly the trap box-local checks
had to be defended against.

### 1.3 Every reference (`rg -n "https-proxy|4443|highascg-cert|certs/highascg"`, plus unit templates, install/prepare scripts, eggs, stick seed, smokes, docs, API contract, `.stignore`/`.gitignore`)

| reference | kind | action |
|---|---|---|
| `tools/runtime/highascg-https-proxy.js`, `tools/runtime/highascg-https-proxy.service` | the thing | **deleted** |
| `tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list:315`, `…-embed-server.list:332` | comment "highascg-https-proxy.js makes a fresh one"; the exclude line itself is `home/casparcg/highascg/config/certs/*` | **exclude kept** (WO-669: the key must never ship, and old boxes still carry the dir); comment reworded |
| `tools/eggs/live-usb/verify-iso-squashfs-excludes.sh:162`, `tools/smoke/smoke-eggs-exclude-lists.test.js:260,287` | assert `config/certs/highascg-key.pem` absent / excluded | **kept unchanged** — same reason; they pin the exclusion, not the proxy |
| `scripts/lib/archive-common.sh:118` | `--exclude=config/certs` in release tarballs (WO-687, key leaked in old releases) | **kept unchanged** |
| `.gitignore:139` `config/certs/` | runtime dir | **kept** (stray certs on old boxes must never be committable). `.stignore` has no certs line and needs none: `config/*.json` is the pattern there; the cert dir was never server-synced-and-fought. Not touched. |
| `docs/DEFAULT_LOGINS.md:15` | "no TLS key (the HTTPS proxy makes a fresh…)" | reworded: no TLS key ships (the proxy is gone; a leftover `config/certs/` is excluded from stick/ISO/releases) |
| `docs/SECURITY.md:54-56` | "HighAsCG does not terminate TLS in-process. Put nginx, Caddy, or Tailscale Serve in front" | still true; nginx is gone since WO-498, so the list is trimmed to Caddy / Tailscale Serve and states there is no built-in HTTPS proxy any more |
| `scripts/README.md:225` | lists the nginx remover | add the new remover |
| `tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh:128-131` | calls the nginx remover on prepare | also calls the new remover |
| `src/api/box-local-request.js:7-12` | comments name the proxy | decision in 1.4 |
| `tools/smoke/smoke-wo811-os-password.test.js:52-53,120,159-165` | `:4443` Host cases (kept) and a test that **reads the proxy source** (`:163`) | the source-reading assertions can no longer exist: replaced with an assertion that the server-side refusal does not depend on any proxy file |
| `godot/client/tests/test_os_password_wo811.gd:22` | asserts `available("https://192.168.1.20:4443") == false`, message "through the HTTPS proxy" | assertion kept (still a correct refusal case), message reworded |
| `work/work-orders/{319,325,498,669,687,811}`, `todos22.07.26`, `work/godot-port/inventory/live-core-scenes-preview.md`, `work/OPEN_ISSUES.md` | history | untouched, except a one-line pointer in WO-498 §5 (it says the proxy "remains") |
| `docs/wiki-site/assets/wiki-bundle.js`, `client/assets-source/metal.svg`, `package-lock.json`, `godot/client/tests/golden/*.json`, a vendor PDF | false positives (`4443` inside numbers / `https-proxy-agent`) | none |
| API contract / `docs/api` | no route, no doc mentions the proxy | `node tools/dev/gen-api-contract.js` not needed (nothing changed in routes) |
| stick seed scripts, `tools/startup`, `verify-eggs-prepare-host.sh`, `verify-highascg-stick-boot.sh` | none provision or assert it | none |

### 1.4 `src/api/box-local-request.js` — decision: KEEP the rules, reword the comments

The module refuses a "box-local" action (OS-password terminal, WO-811 phase 3) unless the TCP peer is loopback, there is no
`X-Forwarded-For`/`Forwarded`/`X-Real-IP`/`X-Forwarded-Host`, `Host` names loopback with the port this server actually accepted
the connection on, and any `Origin` is loopback. Two of those (proxy-header refusal, Host-port equality) were written because of the
`:4443` proxy. They are **not** dead with it:

- any other front proxy that relays to loopback (Caddy, Tailscale Serve, an `ssh -L` forward — the ones `docs/SECURITY.md`
  tells the owner to use) makes every remote client look like `127.0.0.1` and keeps the client's `Host`; the same two rules are
  what refuses those;
- until the box step in 5 is run, the old proxy is still listening on this box; with the Host-port rule it already refuses its traffic;
- they cost nothing on the real paths (Godot sends `Host: 127.0.0.1:4200`; the web UI on the box sends loopback Host+Origin);
- simplifying them would make the box-local check *weaker* against a proxy that is not ours, and the task is to not weaken it.

So no logic changes; the doc comment drops the dead file path and describes the rule generically ("a TLS/reverse proxy such as the
removed :4443 one, Caddy, Tailscale Serve"). `smoke-wo811-os-password.test.js` keeps every `:4443` Host case as the concrete
regression for "a relayed request keeps `Host: <box>:<other port>`", and the Godot `available()` test keeps its `:4443` refusal.

## 2. What was done

**Deleted**
- `tools/runtime/highascg-https-proxy.js`, `tools/runtime/highascg-https-proxy.service`.

**Added**
- `scripts/runtime/remove-highascg-https-proxy.sh` (mirror of `remove-highascg-web-proxy.sh`): root-only (refuses otherwise,
  exit 1); `disable --now` + remove `/etc/systemd/system/highascg-https-proxy.service` + `daemon-reload` + **mask** (masked so a
  stale copy of the template can never bring :4443 back); `REMOVE_CERTS=1` also deletes `highascg-cert.pem` / `highascg-key.pem`
  from `<repo>/config/certs/` (and the dir if then empty); `DRY_RUN=1` prints the plan without root and changes nothing.
  Idempotent: every step tolerates "already gone"; a second run is a clean no-op.
- `tools/smoke/smoke-wo822-no-https-proxy.test.js`, registered in `tools/ci/offline-test-files-2.js` (the first list is exactly
  at the 500-line limit, so WO-498's slot was not available).

**Changed**
- `tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh`: also runs the new remover (same as it does for nginx), so a clone or
  stick prepared from a box that still has the unit gets it cleaned and no enabled `highascg-https-proxy.service` ships in the ISO.
- `src/api/box-local-request.js` (comment only), `tools/eggs/live-usb/penguins-eggs-exclude-highascg-{fragment,embed-server}.list`
  (comment only), `docs/DEFAULT_LOGINS.md`, `docs/SECURITY.md`, `scripts/README.md`, `smoke-wo811-os-password.test.js`,
  `test_os_password_wo811.gd` (message only), WO-498 §5 (pointer), `work/OPEN_ISSUES.md` (row).

**Not done on purpose**: `config/certs/` is runtime material on this box and was not deleted; `config/*.json` untouched; the running
service was not stopped; no restart of node or Caspar (nothing here is loaded by either).

## 3. Why this shape

Same as WO-498: the cost is a URL (`https://<box>:4443` → `http://<box>:4200`) the owner already accepts; the remover is a
separate, idempotent script so an old box, an old clone and an old stick are all fixed by one call, instead of hoping the
file removal reaches the unit that lives in `/etc`. Mask instead of just disable so apt/copy-paste cannot resurrect it.

## 4. Verified

- `node tools/ci/run-offline-tests.js` → **3577 tests, 3575 pass / 0 fail / 2 skipped** (baseline 3569/0/2; +6 from
  `smoke-wo822-no-https-proxy.test.js`, whose 6 tests cover: files gone, no source names the deleted script, remover parses and
  masks/disables/removes, refuses without root (exit 1, "Run as root") and `DRY_RUN=1 REMOVE_CERTS=1` against a temp cert dir deletes
  nothing, prepare-eggs calls both removers, `config/certs/*` stays excluded + box-local guard still refuses `Host: …:4443`,
  `127.0.0.1:4443` and `X-Forwarded-For`). `smoke-wo811-os-password` (12 tests with the new file) and `smoke-eggs-exclude-lists` pass unchanged in substance.
- `node tools/ci/check-max-file-lines.js` → 0 files over 500. `npm run -s format:check` → clean. `npx eslint` on the touched/new JS → 0 problems.
- `bash -n` on `scripts/runtime/remove-highascg-https-proxy.sh` and `prepare-eggs-clone-with-exfat.sh` → ok.
- Remover run as the non-root `casparcg` user: prints `Run as root: …`, exit 1. `DRY_RUN=1` (and `DRY_RUN=1 REMOVE_CERTS=1`) prints the full plan
  (disable --now, rm unit, daemon-reload, mask, rm certs) and changes nothing — `systemctl is-enabled highascg-https-proxy` still `enabled`,
  `config/certs/` untouched.
- **Not verified**: the real (root) run — sudo needs an interactive terminal, so the running unit (pid 3812) is still up and `:4443` still
  listens until the owner runs 5. Godot test message edit (`test_os_password_wo811.gd:22`, string only) was not run. No API/route change, so the API
  contract was not regenerated.

## 5. Owner step — on the box (needs an interactive terminal)

```
cd /home/casparcg/highascg
sudo DRY_RUN=1 bash scripts/runtime/remove-highascg-https-proxy.sh     # optional: print the plan
sudo bash scripts/runtime/remove-highascg-https-proxy.sh               # disable + stop + mask, remove the unit file
sudo REMOVE_CERTS=1 bash scripts/runtime/remove-highascg-https-proxy.sh   # …and delete config/certs/highascg-{cert,key}.pem
```

Check: `ss -ltn | grep 4443` prints nothing; `systemctl is-enabled highascg-https-proxy` says `masked`;
`curl -sI http://127.0.0.1:4200/ | head -1` is `HTTP/1.1 200`. The operator web UI is `http://<playout-ip>:4200/`; the Godot client
needs nothing.

## 6. Consequence worth stating

Browsers on the LAN lose the secure context they got from `https://<box>:4443`. Nothing in the repo still needs one (1.2). If a
future feature does (WebCodecs, clipboard, `getUserMedia`), the answer is Tailscale Serve (a real certificate, no stale SANs), not
a hand-rolled proxy in this repo.

## Box verified (29.10, after the owner ran the remover)

- `ss -ltn | grep 4443` → nothing (exit 1); `curl -k https://127.0.0.1:4443/` → no connection (000).
- `systemctl is-enabled highascg-https-proxy` → `masked` (`/etc/systemd/system/highascg-https-proxy.service` → `/dev/null`,
  19:16); `is-active` → `inactive`; no `highascg-https-proxy` process.
- `config/certs/` is gone (REMOVE_CERTS=1). The operator UI `http://127.0.0.1:4200/` → 200.

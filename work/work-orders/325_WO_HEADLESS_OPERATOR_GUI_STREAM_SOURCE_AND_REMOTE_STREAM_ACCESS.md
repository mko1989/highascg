# WO-325 — Operator GUI as headless stream-only source (multiview owns the port); remote laptop stream access

**Source:** todos22.07.26 line 13 (elaborates line 11 / **WO-324**) — "operator gui present because
needed for stream to a remote client. but its not connected to a gpu port, meaning user doesnt want
to use it as operator gui. the port has multiview screen connected to it now and thats what i want on
this screen. and the stream to the laptop client doesnt work."

This is the concrete answer to WO-324's triage question. The "stuck together" symptom is **not** a
window-stacking/watchdog bug — it is a **topology** bug: the operator-GUI Caspar `<screen>` consumer
is auto-placed on the **multiview's physical port**, because the operator GUI has no port of its own
and falls back to the multiview's. WO-324's watchdog analysis can be closed in favour of this.

Two parts. Part B has an **immediate no-code workaround** (see box) the owner can use today.

> **STATUS 2026-07-22:** **Part A IMPLEMENTED** via a `headless` destination flag (default false).
> `config/screen_destinations.json` Operator GUI set `headless:true`. Verified by regenerating the
> Caspar XML from the on-box config: channel 5 emits no `<screen>` (keeps raster + `<audio-osc>`),
> total screen consumers 3→2 (PGM/PRV + Multiview only). Needs a **node restart + Caspar config
> regenerate/restart** to take on the live box (see Part A constraints). Part B remains an access fix
> (+ optional UX hint, not yet built).

---

## Live facts (gathered on-box 2026-07-22, read-only)
- `GET /api/gui-stream/status` → `{enabled:true, channel:5, running:true, watching:1,
  framesIngested:13233, lastError:null}` — the NVENC encode + node ingest are healthy.
- `config/screen_destinations.json`: "Operator GUI" (`dst_mrumipa8_1`, `mode:operator_gui`,
  `autoLaunch:true`), "PGM/PRV 2" (`pgm_prv`), "PGM 3" (`pgm_only`), "Multiview 1"
  (`dst_mrwcnzfb_1`, `mode:multiview`). All `edidLabel:""` (no EDID pinning).
- `config/device_graph.json` GPU edges: PGM/PRV 2 → `gpu_p0` (port 1); **Multiview 1 → `gpu_p2`
  (port 3)**; PGM 3 → decklink/stream/record; **Operator GUI → no `gpu_out` edge at all**.
- Generated `config/casparcg.config`: channel 4 (Multiview) `<screen>` at `<x>3072</x><y>0</y>`
  (:107); channel 5 (Operator GUI) `<screen>` at the **same** `<x>3072</x><y>0</y>` (:125). Both
  consumers land on the same physical monitor — that is the "stuck together".

---

## Part A — Operator GUI headless (no physical `<screen>`, no port); multiview keeps the port

### Root cause (topology)
Because the Operator GUI destination has **no GPU edge**,
`resolvePhysicalPortIndexForDestination` returns null for it
(`src/config/screen-consumer-port-resolve.js:99-106`), and with no `operator_monitor` flag set
(none in `config/general.json`), `resolveOperatorGuiPort` **falls through to
`multiviewPhysicalPortIndex(config)`** — the multiview's port
(`src/config/config-generator-operator-gui.js:31-38`;
`src/utils/x-display-session-layout.js:66-75`). `resolveLayoutRectForOperatorPort` then returns the
**multiview rect** for `operator_gui`/`multiview` modes (`x-display-session-layout.js:169-182`). And
the generator **always** emits a `<screen>` block for the operator GUI — there is no conditional to
omit it (`config-generator-operator-gui.js:61,100-104`; called unconditionally at
`src/config/config-generator-channels.js:142-148`). Net: channel 5's screen consumer is stamped onto
the multiview's port 3, overlapping channel 4.

**Asymmetry worth noting:** the local Firefox **kiosk** launcher uses a *different* resolver
(`resolveOperatorMonitorPort`, no multiview fallback) and refuses to launch on mode `'none'`
(`src/system/operator-gui-launcher.js:456-465`) — so the kiosk may correctly decline, yet the
`<screen>` consumer is still emitted onto the multiview port. The two paths disagree; the fix must
address the **generator**, not just the launcher.

### The stream does NOT need the port (verified)
gui-stream is a fully independent consumer of channel 5 and survives removal of the `<screen>`:
- Wired by channel **number** only: `index.js:398-414` → `resolveOperatorGuiChannel(config)` = ch 5;
  never references the `<screen>` consumer.
- NVENC STREAM consumer at index **730** (`ADD 5-730 STREAM udp://…`,
  `src/preview/gui-stream-ingest.js:39`, `src/preview/gui-stream-nvenc-args.js:131-138`) — distinct
  from the screen consumer (600/`<screen>`).
- The mosaic it encodes = route layers **10-49** PLAYed onto ch 5 by
  `src/system/operator-gui-channel.js:428-447` — also independent of `<screen>`.
So removing the `<screen>` leaves raster + route layers + NVENC + remote stream intact.

### Change points
1. **Gate the `<screen>` emission.** `buildOperatorGuiChannel`
   (`config-generator-operator-gui.js:61-108`) must emit the `<channel>` (raster + `<mixer>`/
   `<audio-osc>`, needed by the stream + route layers) **without** the `<screen>` block when the
   destination is headless. There is **no field for this today** — add one (e.g. destination
   `physicalOutput:false` / `headless:true`, or reuse the `screen_N_screen_consumer:false` pattern
   that `pgm_prv` screens already honor at `src/config/config-generator-consumer-attach.js:173`).
   This single field expresses the owner's intent.
2. **Kill the multiview-port fallback for a headless operator GUI.** In `resolveOperatorGuiPort`
   (`config-generator-operator-gui.js:31-38`), a headless operator GUI must resolve to **null**
   (no port), never borrow the multiview's. Guard/short-circuit before the
   `multiviewPhysicalPortIndex()` fallback.
3. **`autoLaunch:false`** on the Operator GUI destination (`config/screen_destinations.json:27`;
   honored at `operator-gui-launcher.js:459`) suppresses the local **kiosk** window — set it false.
   This is *complementary to, and separate from,* change #1 (the kiosk window and the Caspar screen
   consumer are two different windows). The remote stream needs neither.
4. **No stream change** — `index.js:398-414` keys on the channel number, which still exists.

Net: channel 5 keeps existing (raster + route layers 10-49 + NVENC 730 → remote stream) but emits
**no** physical `<screen>` and launches **no** kiosk; the multiview (channel 4) is the sole consumer
on gpu_p2 / port 3.

### Live-box constraints (Part A)
- The `<screen>` consumer lives in the **generated** `config/casparcg.config` (baked XML) — removing
  it requires **regenerating** the config and **restarting CasparCG**; it is not a live AMCP toggle.
  Coordinate with the owner (see `src/config/config-reload-signature.js`,
  `src/streaming/caspar-restart-dirty-policy.js` for the dirty/restart policy). The generator
  rewrites `casparcg.config` in place (note the existing `casparcg.config.bak.*` snapshots).
- Route layers (10-49) and the NVENC consumer (730) are runtime AMCP and re-attach across restarts
  (`ensureOperatorGuiChannel` re-applies on reconnect; `gui-stream-ingest.js` re-ADDs idempotently).

### Acceptance (Part A)
- With the operator GUI marked headless: the generated `casparcg.config` has channel 5 with **no
  `<screen>`** block; only channel 4 (multiview) has a `<screen>` on port 3 (`x=3072,y=0`). The
  multiview monitor shows the multiview, alone — no overlapping operator-GUI consumer.
- No kiosk Firefox window spawns for the operator GUI (`autoLaunch:false`).
- `GET /api/gui-stream/status` still `{running:true, channel:5}` after regenerate + Caspar restart;
  remote stream unaffected.
- A non-headless operator GUI (cabled to its own port) still works exactly as before (the new field
  defaults to today's behaviour — screen consumer emitted).
- Offline test (non-vacuous): generator emits/omits the operator-GUI `<screen>` per the headless
  field, and a headless operator GUI resolves to a null port (never the multiview's). Extend the
  consumer-index/port tests. `npm run test:ci` → 0 fail.

---

## Part B — "Stream to the laptop doesn't work" (access, not a code bug)

> **IMMEDIATE FIX (no code): on the laptop, open `https://192.168.0.35:4443/` (LAN) or
> `https://100.101.245.97:4443/` (Tailscale) — accept the self-signed cert once — then set
> Settings → Compose preview → Preview source → "Live stream (hardware encoded)". The plain
> `http://…:4200` URL can never decode the stream.**

### Root cause
WebCodecs' `VideoDecoder` is exposed by browsers **only in a secure context**. A laptop on
`http://<lan-ip>:4200` is a non-localhost **insecure** origin, so `VideoDecoder` is `undefined`,
`guiStreamSupported()` returns false (`client/lib/gui-stream-client.js:51-53`), and `reconcile()`
never calls `acquireGuiStream()` (`client/components/preview-canvas-live-stream.js:101-102`) — the WS
is never opened and nothing decodes. This is exactly what the HTTPS proxy exists for
(`tools/runtime/highascg-https-proxy.js:6-10`). The proxy on `*:4443` forwards the WS upgrade
verbatim (`:97-127`); the client builds `wss://<host>/ws/gui-stream` from `location` when on https
(`gui-stream-client.js:156-159`); the self-signed cert's SANs already cover both LAN IPs. Auth is not
a barrier (`config/security.json` `enforceAuth:false` → `src/server/auth.js:168,227`), and the app
binds `0.0.0.0:4200` / proxy `*:4443` (both LAN-reachable).

`watching:1` is the **local kiosk** (a secure `127.0.0.1` origin with the shared `stream` mode on),
**not** the laptop — the relay counts sockets only (`src/preview/gui-stream-ws-relay.js:113,138`;
`src/api/routes-gui-stream.js:29`). **Check:** watch `watching` while the laptop toggles the stream —
1→2 means it connected; staying 1 confirms the insecure-context cause.

### Recommended code improvement (the reason it read as "broken": silent failure)
Selecting "Live stream" on an insecure/unsupported client **silently does nothing** — no message,
which is why the owner reads it as broken. Add operator feedback so this is self-diagnosing:
- When the Preview-source dropdown is set to `stream` but `isOperatorLiveCanvasAvailable()` is false
  **because** the context is insecure / WebCodecs is missing (distinguish from "server feature off"),
  surface a hint near the dropdown or on the preview surface: e.g. *"Live stream needs a secure
  connection — open this page at https://<box-ip>:4443."* Compute the suggested URL from the current
  host. Files: `client/components/settings-modal-templates.js` (the note added in WO-320-adjacent
  work at :92-93), `client/components/preview-canvas-live-stream.js`
  (`isOperatorLiveCanvasAvailable`/`guiStreamSupported` split), `client/lib/gui-stream-client.js:51-53`.
- Optional: on operator-GUI/remote pages, the compose surface could show a small "stream
  unavailable — use https://…:4443" badge instead of a blank/JPEG-only tile.
- dist-web rule: `npm run build:client` + reload for any client change.

### Acceptance (Part B)
- Documented: the laptop uses `https://<box-ip>:4443`, accepts the cert once, selects Live stream →
  the tile decodes (verify `watching` 1→2 and `window.__liveCanvas()` shows `streaming:true,
  connected:true, frames` climbing — `preview-canvas-live-stream.js:131`).
- If the UX hint is implemented: selecting Live stream on `http://…:4200` shows the secure-URL hint
  instead of silently doing nothing; on `https://…:4443` the hint is absent and the stream runs.

---

## Ambiguities for the owner
1. **Headless field name/shape (A):** a per-destination `headless:true`/`physicalOutput:false`, or a
   `screen_5_screen_consumer:false`-style flag reusing the existing pgm_prv pattern? (Recommend a
   destination-level `physicalOutput:false` — clearest intent, one place.)
2. **Should headless imply `autoLaunch:false` automatically**, or keep them independent toggles?
   (Recommend: headless implies no kiosk, but keep the field explicit for clarity.)
3. **Part B UX hint (B):** implement the secure-context hint now (recommended — prevents exactly this
   confusion), or is the documented HTTPS URL enough for the owner?
4. Confirm the multiview is the intended sole occupant of port 3 permanently (it already owns
   `gpu_p2` via its device-graph edge), so Part A only needs to *remove* the operator-GUI consumer,
   not move the multiview.

# Work Order 96: API + WebSocket authentication, loopback bind, CORS/origin lockdown

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Draft — root cause confirmed in 2026-07-02 project review; fix not implemented
**Priority:** **Critical** — the entire control plane is unauthenticated and network-reachable
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Builds on / touches:**
- `src/server/http-server.js` — `startHttpServer`, request pipeline, upgrade handler
- `src/server/ws-server.js` — operator WS (`/api/ws`, `/ws`) + replication WS token model (already token-gated at lines ~215–233)
- `src/api/router.js` / `src/api/route-registry.js` — `routeRequest`, `RouteRegistry.dispatch`
- `src/server/cors.js` — `corsHeadersForRequest`, `BASE`
- `src/api/settings-get.js` / `src/api/support/redact-settings.js` — settings disclosure
- `src/api/routes-system-setup.js` — nuclear-password gate (`checkNuclearPassword`)

---

## 1. Problem statement

From the 2026-07-02 security review:

- The server binds `0.0.0.0:4200` by default (`http-server.js` ~line 198) with **no authentication or authorization** on the HTTP API or the operator WebSocket.
- CORS is fully open: `Access-Control-Allow-Origin: *` (`cors.js` line 6) and the operator WS upgrade does **no origin or token check** (`ws-server.js` ~234–241).
- Any host on the LAN/Tailnet — or any web page the operator visits — can call destructive endpoints: `POST /api/system/setup/reboot`, `/install` (Calamares), `/api/system/setup/caspar/*`, `/api/system/network/apply`, `/api/network/tailscale/*`, `/api/system/update/apply`, `DELETE /api/local-media/*`, `POST /api/amcp/*`, and `POST /api/cef-interactive/eval` (arbitrary JS in the renderer).
- The only gate that exists — the **nuclear password** — is bypassable because `GET /api/settings` returns `ui.nuclearPassword` in cleartext (`settings-get.js` ~line 32; redaction helper not applied on this path), defaults to disabled, and uses non-constant-time plaintext comparison.

**Trust model today:** "reachable on the network" == "full root-capable control". This is the single highest-severity weakness in the project.

---

## 2. Goal (normative)

1. **No state-changing endpoint** (HTTP or WS) is reachable without a valid credential.
2. Server defaults to **`127.0.0.1`** bind; LAN/Tailnet exposure is an explicit opt-in that REQUIRES auth to be configured.
3. CORS and WS origin are **allowlisted**, never `*` for authenticated/credentialed responses.
4. Secrets (nuclear password, tokens) are **never** returned by any read endpoint.
5. Backwards path for existing single-operator deployments: a first-run bootstrap that generates a token and shows it once, so we don't lock operators out.

**Out of scope v1:** multi-user accounts/RBAC, OAuth/SSO, TLS termination (document reverse-proxy option separately).

---

## 3. Recommended approach

### 3.1 Single auth choke point

Add one middleware evaluated in `routeRequest` (before dispatch) and one in the WS `upgrade` handler:

- **Token model:** per-install secret (32+ bytes, `crypto.randomBytes`) stored in `.private/api-token` (0600) and/or `highascg.config.json` `security.apiToken`. Generated on first boot if absent; logged **once** to the console/journal.
- **Transport:** `Authorization: Bearer <token>` header for HTTP; `?token=` query param or `Sec-WebSocket-Protocol` for WS upgrade (mirror replication WS at `ws-server.js` ~218–221). Constant-time compare (`crypto.timingSafeEqual`).
- **Session cookie for the browser UI:** `POST /api/auth/login` (token or operator password) → sets `HttpOnly; SameSite=Strict; Secure`(when TLS) cookie; UI uses cookie thereafter. This closes the drive-by-CORS hole because `SameSite=Strict` blocks cross-site use.
- **Allowlist of unauthenticated paths:** only `GET /` (login page bootstrap), static assets, `/api/health` (non-sensitive), `POST /api/auth/login`.

### 3.2 Bind + exposure policy

- Default `bindAddress` → `127.0.0.1` in `src/config/defaults`.
- Introduce `security.exposeToNetwork` (bool). When true, bind `0.0.0.0` **only if** a token/password is configured; otherwise refuse to start network exposure and log an error.
- The playout deployment (which needs LAN access for operator laptops) sets `exposeToNetwork=true` + token in `.env` / config as part of egg build.

### 3.3 CORS / WS origin

- Replace `BASE` `*` with an allowlist derived from `HIGHASCG_CORS_ORIGINS` + the server's own origins. No `Access-Control-Allow-Origin: *` when credentials are in play.
- WS upgrade: reject with 403 when `Origin` header is present and not in allowlist (same-origin requests from the served UI have no cross-origin problem).

### 3.4 Stop leaking secrets + fix nuclear gate

- Run `GET /api/settings` output through `redactObject` (mask `nuclearPassword`, `apiToken`, any `*password*`/`*token*`/`*secret*` key).
- Store nuclear password **hashed** (scrypt/argon2 or at minimum salted SHA-256), constant-time compare.
- Once 3.1 lands, reconsider whether the nuclear gate is still needed — global auth supersedes it; keep it only as a **second confirmation** for reboot/install, not as the primary control.

### 3.5 Privileged-even-when-authed endpoints

`POST /api/amcp/*`, `/api/cef-interactive/eval`, `/api/system/update/apply` are "run code" primitives. Even with auth, require `exposeToNetwork`-aware confirmation or a separate capability flag; document them as high-privilege.

---

## 4. Tasks

- [ ] **T96.0** Inventory every route's destructiveness in `router.js`; tag each `{ auth: 'required' | 'public' }` (default required).
- [ ] **T96.1** Token store: generate/read `.private/api-token`; `crypto.timingSafeEqual` compare helper in `src/server/auth.js`.
- [ ] **T96.2** HTTP auth middleware in `routeRequest`; public allowlist; 401 JSON on failure.
- [ ] **T96.3** WS upgrade auth (operator socket) mirroring replication token; 403 on missing/bad token or origin.
- [ ] **T96.4** `POST /api/auth/login` + `HttpOnly SameSite=Strict` session cookie; UI login screen (minimal) in `client/`.
- [ ] **T96.5** Default `bindAddress=127.0.0.1`; `security.exposeToNetwork` gate that refuses `0.0.0.0` without a credential.
- [ ] **T96.6** CORS allowlist (drop `*`); WS origin allowlist.
- [ ] **T96.7** Redact secrets in `GET /api/settings` (+ any other read endpoints returning `config.ui`/`config.security`).
- [ ] **T96.8** Hash nuclear password; constant-time compare; migrate existing plaintext on load.
- [ ] **T96.9** Egg build / deploy: provision token into config so operator laptops keep working.
- [ ] **T96.10** Smoke tests: `tools/smoke/smoke-api-auth.test.js` (401 without token, 200 with), `smoke-ws-auth`, `smoke-settings-redaction`, CORS/origin rejection.
- [ ] **T96.11** Docs: `docs/SECURITY.md` (threat model, token setup, reverse-proxy TLS), update README config table.

---

## 5. Acceptance criteria

1. With no token configured, server binds loopback only; LAN request is refused/unreachable.
2. Every state-changing HTTP endpoint returns 401 without a valid Bearer/cookie; 200 with.
3. Operator WS rejects upgrade without token/valid origin; replication WS unaffected.
4. `GET /api/settings` never returns `nuclearPassword`/`apiToken` (asserted by smoke test).
5. A cross-origin browser page cannot drive the API (CORS + `SameSite=Strict` cookie).
6. Existing operator laptop workflow still works after egg build provisions the token.
7. No regression: local UI on the box (same origin) works without manual token entry after login.

---

## 6. Rollout / risk notes

- **Lockout risk:** ship a `tools/runtime/print-api-token.sh` (reads `.private/api-token`) and document recovery via local shell. First-run must log the token to the journal.
- Sequence: land loopback default + token + login **before** flipping any deployed box to require auth; coordinate with egg build (T96.9) so field sticks aren't bricked.

---

## Work Log

### 2026-07-02 — Initial WO (from project security review)

- Captured findings F1/F2/F7 from the security review into a concrete plan.
- **Instructions for Next Agent:** Start with T96.0–T96.2 (choke point + token) behind a config flag defaulting to *off* so nothing breaks; do NOT enable enforcement on deployed boxes until T96.9 (egg provisioning) is ready. Coordinate with [97_WO_INJECTION_HARDENING.md](./97_WO_INJECTION_HARDENING.md) (same files).

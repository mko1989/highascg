# WO-986 — Security sweep of the node server and tools
**Area:** network, media, testing-ci
**Status: DONE (07.11.26, offline reproduction and regression tests: 49 passed; ESLint and file-size checks passed)**

## Investigation

Static/offline follow-up to WO-96/97, WO-418, WO-687, WO-729 and WO-830; auth policy belongs to WO-811.

1. USB import ancestor symlink escape (`src/media/usb-drives-copy.js:23-28`).
   `collectFilesForImport(root, ['escape/private.mp4'])`, with `root/escape` pointing outside root,
   returns the external file because lstat checks only the final component. A malicious mounted filesystem
   plus a LAN caller selecting that item can import server-readable data into the media library.
   The direct-function smoke returned one file instead of zero (5 pass, 1 fail before fix).
   Fix: realpath containment of each selected file before adding it; preserve symlinked mount roots.

2. Media resolver is lexical (`src/media/local-media-paths.js:40-54`). Same synthetic symlink input
   resolves and reads outside data. Requires an existing link; remote creation of that link is NOT proven.
   Unlike USB import, media deliberately uses bridge/project links. A blanket no-symlink fix risks breaking
   playout. Propose an explicit allowlist of canonical media/project/bridge roots, with write destinations
   checked separately. Offline test documents the current limitation, not a regression acceptance criterion.

3. LAN-open mode includes browser origins (`src/server/auth.js:192-193,218-219,274-276`,
   `src/server/cors.js:8-10`). With enforceAuth false, unauthenticated POST /api/settings and WS auth checks
   succeed and Origin https://attacker.example is accepted. A browser able to reach the LAN endpoint can
   control it, subject to browser private-network policy. This is the existing WO-811 design choice, not a
   new auth bypass. No change made. Propose separating origin policy from auth enablement after owner review.

4. URL-shaped stream credentials survive base redaction (`src/support/redact-settings.js:6,44-48`,
   `src/api/settings-get.js:88-93,113`). Input rtmpServerUrl `rtmp://example.invalid/live/synthetic-key`
   survives the settings redactor; support-mode redaction masks it. Settings deliberately returns server
   URLs for inspector round-tripping, so use a credential-free URL plus a has-credential flag and preserve
   stored credentials on save. Do not simply enable support-mode redaction for settings (WO-830c contract).
   Synthetic helper test proves the redactor gap; no actual credential exposure on this box is asserted.

Additional reviewed boundaries and evidence:

- Command execution: `src/api/system-network-wifi.js:48` uses execFileSync argv, password on stdin;
  the shell helper quotes SSID/connection values. `src/api/system-time.js:135-154` uses argv;
  `src/system/hardware-identity.js:231-241` uses argv; `src/replication/rsync-exec.js` spawns rsync
  without a shell. `src/streaming/stream-capture-tier.js:18,26` shell commands are fixed literals.
  `tools/replication/compare-caspar-parity.js:142` uses a fixed SSH command, not interpolated request
  input. No new request-derived shell injection established in these paths. Existing WO-830b malicious
  vcam labels, host, rsync-option and plugin-id cases pass (25 tests, including AMCP/path guards).
- AMCP: `src/caspar/amcp-utils.js:18-31` quotes/folds clip strings;
  `src/caspar/amcp-client-transport.js:28` and `src/caspar/amcp-batch.js:198` both call prepareAmcpLine.
  The synthetic `clip"\r\nCLEAR 1\r\n(foo)` input contains no resulting CR/LF. Existing template,
  effect and nudge injection tests pass. This does not prove every raw AMCP interpolation safe.
- Path checks: `src/engine/project-store.js:51-61` rejects separator/dot traversal before I/O;
  `src/utils/safe-unzip.js:18-34` checks lexical containment. Its actual-byte decompression limit
  remains a known WO-830 open item. Font upload/delete uses basename (`routes-lower-thirds.js:215,235`).
  Shader import inspection did not establish a request-derived filesystem traversal. Logs, all upload
  formats, template handlers and exFAT helpers were not exhaustively traced; no blanket clearance.
- Signed cluster actions: `src/cluster/cluster-call.js:104-125` verifies linked identity, recipient,
  timestamp, nonce, signature and action allowlist. All 17 existing offline tests pass.
  Legacy `src/replication/peer-client.js:39-49` instead sends replication token and shared Bearer over
  plain HTTP. A LAN on-path observer can capture/replay bearer credentials; concrete traffic shape is
  POST to a configured peer with Authorization and X-HighAsCG-Replication-Token headers. This is static
  evidence, not a network interception reproduction. Propose authenticated encrypted transport and
  signed requests for legacy replication; changing this requires peer compatibility work.
- Settings keys: base redaction covers token/password/secret/apikey/api_key/auth/privatekey/private_key/
  tailscale; booleans intentionally survive. `settings-get.js:64-70,88-93,104-108` separately strips
  stream keys and exposes auth presence. `project-stream-credentials.js:244` emits hasSrtPassphrase,
  not the project passphrase. Generic passphrase/psk/credential keys and embedded URL credentials are
  not covered by base redaction. The stream-URL case above is the demonstrated gap, not a claim that
  every arbitrary key is currently persisted or returned by the settings route.
- Public-repo scan: `git ls-files config .private '*.pem' '*id_rsa*' '*id_ed25519*' '*.key'` lists
  tracked config defaults but no private key files in those selections. A Python recursive scan of
  `git show HEAD:<tracked config JSON>` inspected 23 files: zero nonempty string fields matching
  password/passphrase/secret/token/api-key/private-key/stream-key/psk patterns. Values were never printed.
  `git grep -IlE 'BEGIN .*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{30}|AKIA[0-9A-Z]{16}' -- ':!package-lock.json'`
  returned no matches (exit 1). `.gitignore` explicitly ignores machine identities and certificates,
  while allowing the factory config JSONs. This is a bounded current-tree/config-HEAD scan, not an
  entropy scan, password scan of every text file, or history audit. No confirmed committed secret found.

## What was done

- `src/media/usb-drives-copy.js`: canonical containment for selected items; retain skipped symlink leaves,
  normal nested imports and symlinked mount-root support. No deliberate media bridge policy changed.
- `tools/smoke/smoke-986-security.test.js`: seven offline cases, three USB cases including the failing
  exploit, plus media limitation, slug/AMCP, LAN-open policy and URL-redaction characterization.
  Known-limitation assertions intentionally document open findings and must be revised when addressed.
- `work/work-orders/986_WO_security_sweep.md`: findings, evidence, limitations and coordinator handoff.

No forbidden files edited, no live requests or service changes, no git mutations. INDEX and curated test
registration deliberately left to the coordinator per assignment, overriding CLAUDE.md's usual registration step.

## What was VERIFIED

Before fix: `node tools/smoke/smoke-986-security.test.js`: 5 pass, 1 fail (USB escape).
`node --test tools/smoke/smoke-986-security.test.js`: child test failed, 0 pass / 1 fail;
plain invocation was used to obtain the individual assertion diagnostics.

After fix (final tree):

- `node --test tools/smoke/smoke-986-security.test.js`: 1 file passed, 0 failed (this environment's
  isolated runner reports file totals rather than child assertions).
- `node --test --test-isolation=none tools/smoke/smoke-986-security.test.js tools/smoke/smoke-wo712-cluster-call.test.js`:
  24 tests passed, 0 failed (7 new + 17 existing).
- `node --test tools/smoke/smoke-wo830b-injection-validation.test.js`: 1 file passed, 0 failed.
- `node --test --test-isolation=none tools/smoke/smoke-wo830b-injection-validation.test.js`:
  25 tests passed, 0 failed. Total distinct final assertions: 49 tests.
- `npx eslint src/media/usb-drives-copy.js tools/smoke/smoke-986-security.test.js`: exit 0, no diagnostics.
- `node tools/ci/check-max-file-lines.js`: exit 0, 0 files over 500 lines.
- `git diff --check -- src/media/usb-drives-copy.js`: exit 0.

No socket failures encountered; tests used direct functions, fixtures and existing mock-based tests.
No live API/AMCP, sudo installation, network probes, PGM changes or GUI runs. Root helper deployment,
actual stored stream credentials, browser exploitation, races and exhaustive route/history coverage are NOT proven.

## Proposals (not built)

- Register the new smoke in the curated offline list and regenerate INDEX through the coordinator.
- Media canonical-root policy, browser-origin policy independent of auth, URL credential round-trip
  redesign, and encrypted legacy peer transport as described above. These are compatibility changes.
- Close the USB check/use race against a concurrently changed filesystem using descriptor-based traversal;
  current fix blocks a stable symlink escape, not a hostile mount being modified between scan and copy.
- Complete exhaustive handler/secret-history review before declaring the server security-audited.

## Coordinator follow-up (07.11, Claude)
- `usb-drives-copy.js`: the realpath containment ran for every walked entry (2 realpath calls per file over a whole drive,
  root realpath recomputed each time). It now runs only for the explicitly selected items (`walk(rel, selected)`), with
  the root realpath computed once. Children are reached through a checked, non-link directory, and link leaves are
  still skipped, so the guarantee is unchanged. The 3 USB cases pass.
- `smoke-986-security.test.js`: the two "known limitation" tests asserted the vulnerable behaviour, so fixing a finding
  would have failed CI. They are now executable TODOs (node:test `todo`) asserting the desired behaviour: finding 2,
  the media guard refuses a link leaving every allowed root; finding 4, base redaction does not return a URL-embedded
  stream key. They report as todo, not as failures; flip them when the proposals land. The LAN-open test is renamed a
  WO-811 design contract. Result: 6 pass + 2 todo. Registered in `tools/ci/offline-test-files-3.js`.

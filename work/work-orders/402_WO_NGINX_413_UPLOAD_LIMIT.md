# WO-402 — mp4 upload fails: nginx port-80 proxy 413s files > 512 MB (HTML error page)

**Status: IN PROGRESS (repo fix committed; live nginx reload = owner action, needs sudo password)**

## Investigation

Owner report (01.08, show day): every attempt to upload an mp4 via the GUI failed with
"expected JSON but got HTML"-style error. No restarts allowed (on show).

- The error string comes from `client/lib/form-upload.js:22` — `postFormDataWithProgress`
  rejects when the response Content-Type isn't JSON: `HTTP <status>: server returned HTML (not JSON)`.
- The node server itself can't produce that: every `/api/*` path in
  `src/server/http-server.js` answers JSON, including the 413/502 paths. And
  `journalctl -u highascg --since today` showed **zero** `[Ingest]` lines — the uploads
  never reached node.
- A 100 KB curl upload straight to `127.0.0.1:4200/api/ingest/upload` returned
  `{"ok":true,"count":1}` — endpoint healthy.
- The GUI was being used from the owner's Mac via **port 80**: nginx
  (`/etc/nginx/sites-enabled/highascg-web-proxy.conf`, installed by
  `scripts/runtime/install-highascg-web-proxy.sh`) proxies :80 → :4200 with
  `client_max_body_size 512m`.
- **Smoking gun** — `/var/log/nginx/access.log`, 01.08:

  ```
  192.168.1.235 "POST /api/ingest/upload HTTP/1.1" 413 594 "http://192.168.1.253/"  (11:50:56)
  192.168.1.235 "POST /api/ingest/upload HTTP/1.1" 200 32                            (11:51:06)
  192.168.1.235 "POST /api/ingest/upload HTTP/1.1" 413 594                           (11:51:32, 14:30:08, 14:30:54, 14:31:47, 14:39:03)
  ```

  Files > 512 MB → nginx rejects with its default **HTML** 413 page (594 bytes) before
  the request ever reaches node; small files 200. The GUI surfaces the HTML as the
  "expected JSON" parse error. Root cause confirmed.

## What was done

`config/nginx/highascg-web-proxy.conf`:
- `client_max_body_size 512m` → `0` (unlimited at the proxy). The node server already
  enforces its own cap — 200 GB via `readMaxUploadBytes()` in `src/api/routes-ingest.js:17`
  (`HIGHASCG_MAX_UPLOAD_BYTES` override) — so nginx must not impose a smaller, silent one.
- Added `proxy_request_buffering off` so multi-GB uploads stream through to busboy
  instead of being spooled to `/var/lib/nginx` on the root disk first (double disk cost +
  the whole upload's progress bar would complete before node even saw byte one).

Why not just raise 512m → a bigger number: any fixed proxy number silently shadows the
app-level cap and reproduces this incident at a new size. The app owns the limit.

**Live box NOT yet updated** — editing `/etc/nginx/sites-available/` + `nginx -s reload`
needs sudo (password; not in the NOPASSWD list), and this session had no way to enter it.
Reload is graceful (old workers drain, WebSockets stay up) — safe during show.

Owner apply (one line, no service interruption):

```
sudo install -m 0644 -o root -g root /home/casparcg/highascg/config/nginx/highascg-web-proxy.conf /etc/nginx/sites-available/highascg-web-proxy.conf && sudo nginx -t && sudo nginx -s reload
```

Zero-change workaround meanwhile: open the GUI as `http://192.168.1.253:4200/`
(direct to node, bypasses nginx) — uploads of any size work immediately.

Note: `tools/eggs/live-usb/verify-highascg-stick-boot.sh` checks for `ln.conf` /
`install-ln.sh` — stale names for this proxy pair; not touched here.

## What was VERIFIED to work

- curl 100 KB multipart POST to `:4200/api/ingest/upload` → 200 `{"ok":true,"count":1}`
  (test file uploaded to ingest dir from scratchpad; harmless).
- nginx access log correlates every failed owner attempt with 413 at :80 and every
  small-file success with 200 — no other failure mode present today.
- Repo config edited; **not** yet live (needs owner sudo, above). After reload, QA =
  re-upload the same mp4 through `http://192.168.1.253/` and see it land in the media list.

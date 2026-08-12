# WO-498 — Remove nginx; gzip in the Node server instead

**Status: DONE (12.08 — 8 new smokes, suite 2035/2033/0, eslint 0 errors). Root step (stopping/purging nginx on a box) is one command, §4.**

Owner 12.08: *"i see nginx is giving some problems so id like it removed completly. ip with a port
number is totaly fine for connecting"*.

## 1. What nginx was actually doing

One thing: `listen 80` → `proxy_pass http://127.0.0.1:4200` with WebSocket upgrade and
`proxy_request_buffering off` (so multi-GB ingest uploads streamed to busboy instead of spooling to
`/var/lib/nginx`). Nothing else — no TLS (the `:4443` HTTPS proxy is a separate Node process), no
static serving (`location /` had no `root`), no auth.

So the entire benefit was a URL without a port. The owner does not want that trade.

**It was not compressing anything, either.** `/etc/nginx/nginx.conf` has `gzip on;` but **every**
`gzip_types` / `gzip_vary` / `gzip_comp_level` line commented out, and nginx's default `gzip_types` is
`text/html` alone — while the UI is served as `application/javascript` and `text/css`
(measured in [WO-497](./497_WO_UI_LOAD_AND_PROBE_CACHE.md) §1). So removing the proxy costs **zero**
compression, because there never was any.

Also measured on the box: `/var/log/nginx/access.log` had grown to **2.0 GB** (error.log 144 MB).

## 2. What was done

**Removed**
- `config/nginx/highascg-web-proxy.conf` and `scripts/runtime/install-highascg-web-proxy.sh` (deleted).
- `prepare-eggs-clone-with-exfat.sh` no longer `apt install`s nginx; it now *calls the remover*, so
  re-preparing a clone made before this WO clears a stale proxy that would otherwise shadow `:4200`.
- The nginx assertions in `verify-eggs-prepare-host.sh` and `verify-highascg-stick-boot.sh`.
- `tools/startup/stick-boot-test/tests/test-08-highascg-ui.sh` no longer probes `http://127.0.0.1/`.
- Doc/reference updates: `docs/STICK_QUICK_START.md`, `scripts/README.md`, `scripts/setup/17-operator-tools.sh`.

**Added** — `scripts/runtime/remove-highascg-web-proxy.sh`: drops the site, stops + disables + **masks**
nginx (masked so a later apt dependency cannot quietly re-take port 80 and shadow `:4200`),
optionally `PURGE=1` to apt-purge, and truncates the two runaway logs.

**Added** — in-process gzip (`maybeGzip` in `src/server/http-server.js`). Since nginx was the only
hop that *could* have compressed, and the owner is now hitting Node directly, compression belongs
here. Applies to text types only (`text/*`, JS, JSON, XML, SVG), only when the client offers gzip,
only above 1 KB, never to streamed responses (no buffered body), and it sets `Vary: Accept-Encoding`
so a cache can never hand a gzipped body to a client that did not ask. Measured ~3.8× on this repo's
bundles: the ~1.69 MB eager UI drops to ~0.45 MB.

Together with WO-497's immutable caching for content-hashed assets, a warm reload now transfers
almost nothing, and a cold one transfers roughly a quarter of what it did.

## 3. What was VERIFIED

`tools/smoke/smoke-wo498-no-nginx-gzip.test.js` — **8 tests, all passing**, registered in the curated
CI list. The compression tests recover the shipped `maybeGzip` out of the source and run it, so they
cannot drift: a large JS body compresses >2× and **round-trips byte-exact through `gunzipSync`**;
a client that does not offer gzip gets the raw body; images/fonts and sub-1 KB bodies are untouched;
CSS/HTML/JSON/SVG all qualify; the stream branch bypasses compression. Three further tests assert the
proxy is gone from the repo, that nothing still provisions or asserts nginx, and that the boot test
no longer probes port 80.

Full offline gate → **2035 tests, 2033 pass / 0 fail / 2 skip**. eslint 0 errors; 0 files over 500;
all changed shell scripts pass `bash -n`.

**Not verified live** — `highascg.service` is stopped on this box, so the gzip path has not served a
real request here. It is pure request-path code with no config dependency, and the round-trip test
covers correctness.

## 4. Owner step — one command per box

```
sudo bash scripts/runtime/remove-highascg-web-proxy.sh          # disable + stop + mask
sudo PURGE=1 bash scripts/runtime/remove-highascg-web-proxy.sh  # …and remove the package
```

Then the operator UI is **`http://<playout-ip>:4200/`**. Verify with:

```
curl -sI -H 'Accept-Encoding: gzip' http://<playout-ip>:4200/assets/<hashed>.js | grep -i 'content-encoding\|cache-control'
```

Expect `Content-Encoding: gzip` and `Cache-Control: public, max-age=31536000, immutable`.

## 5. Consequence worth stating

`docs/SECURITY.md` still notes that HighAsCG does not terminate TLS in-process and suggests a
front-end proxy for HTTPS. That remains true and is unaffected: the `:4443` HTTPS proxy
(`tools/runtime/highascg-https-proxy.js`) is a separate Node process and was never nginx. Note the
separate, still-open defect found alongside WO-497: that proxy's certificate has stale SANs and is
never regenerated when the box IP changes.

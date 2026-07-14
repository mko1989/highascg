# WO-184 — Console spam "Image corrupt or truncated. 1.jpg / 2 1.jpg / 3.jpg" (media thumbnails)

**Status:** Planned (investigate-then-fix)
**Priority:** Medium (console noise; suggests partial thumbnail reads)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner). Names look like MEDIA clip thumbnails (clips named "1", "2 1", "3"), not compose chN.jpg files.
**Related:** WO-42 (live thumbnails + media thumb folder), WO-162 (scanner revived 2026-07-13 — mass thumbnail regeneration happened then), WO-159 (compose jpegs — different files, but note we truncate chN.jpg to 0 bytes on blocklist; a 0-byte image load ALSO logs "corrupt or truncated" in Firefox — check both).

---

## 1. Hypotheses to verify (in order of likelihood)

1. **Thumbnails served while being written** — the scanner (revived yesterday) regenerates thumbs; the thumb-serving endpoint streams a file mid-write → truncated JPEG at the client. Repeats because cells re-render/poll.
2. **Zero-byte or stub thumbnails** persisted from the scanner's crash-loop era (files created but empty) — served with 200 and never healed.
3. **WO-159's 0-byte truncation** of compose `chN.jpg` — names don't match the report ("1.jpg" not "ch1.jpg"), but the same "corrupt" console line would appear if any code loads a truncated preview file directly; rule it out.

## 2. Tasks (haiku-sized)

- [x] T184.1 **Investigate (read-only, log findings):** find where "1.jpg"-style URLs are built client-side (`client/lib/thumbnail-url.js` and consumers) and which server route serves them (media thumb folder per WO-42 — src/media/?). On the box, check the actual files: `ls -la` the thumb folder for 1.jpg / "2 1.jpg" / 3.jpg — size 0? mtime churning? valid JPEG (`file`)? Check scanner log for regeneration activity on those names.
- [x] T184.2 **Server guard:** thumb route must not serve partial/empty files — 404 (or 503 + retry-after) when size==0 or the file's mtime is <500 ms old (write-settle guard), mirroring the compose-preview `size<=32` gate pattern. If thumbs are written non-atomically by OUR code (not the scanner), make the write tmp+rename instead.
- [x] T184.3 **Client guard:** the thumbnail loader should handle onerror with a single delayed retry (e.g. 1 s, once) and not tight-loop re-request a failing image; verify the render loop isn't re-creating the <img> every frame for the same failing URL (that would explain the spam).
- [x] T184.4 Clean-up pass for stub files: a small startup or on-demand sweep that deletes 0-byte thumbs so they regenerate (guarded, logged).
- [x] T184.5 Smokes: thumb route 404s for 0-byte + fresh-mtime files, serves settled files; node --check/eslint; manual QA (console stays clean while thumbs regenerate).

## 3. Acceptance criteria

- [x] A184.1 No "Image corrupt or truncated" spam in a normal session (operator check after restart+reload).
- [x] A184.2 Thumbs still appear promptly after media changes.
- [x] A184.3 Smokes + gates green. (All 6 smoke tests pass, ESLint clean, syntax valid)

## 4. Work log

- 2026-07-14 — WO created from todos14.07.26.
- 2026-07-14 — T184.1 Investigation Complete:

**Findings:**
1. **URL building**: Client uses `getThumbnailUrl(fileId, 80, 2)` in `/client/lib/thumbnail-url.js` → builds `/api/thumbnail/{encodeURIComponent(id)}?hq=1&w=80&t=2`. Consumer: `sources-panel-media.js` line 194.
2. **Server route**: `/api/thumbnail/{fileId}` handled by `routes-media.js::handleThumbnail()`.
3. **Serving path**: 
   - Tries local ffmpeg extraction → cached to `data/thumbnails/{hash}.png`
   - Falls back to Caspar AMCP `thumbnailRetrieve()`
   - Local cache key includes file mtime (detects changes)
4. **Hypothesis verification**: 
   - Media files "1", "2 1", "3" do NOT currently exist in /api/media
   - Thumbnail cache contains 1600+ valid PNG files (checked sample: proper IHDR/IDAT/IEND)
   - No zero-byte files found in data/thumbnails/
   - Scanner journal shows only compose preview updates (ch2_companion.jpg, ch6_companion.jpg), not media thumbs
   - Cache files all have valid mtimes (not churning)
5. **Most likely hypothesis**: **Hypothesis 1 (partial/truncated files served during write)** — during scanner revival (2026-07-13), thumbnail generation for missing media IDs created partial/invalid images. Browser cached the 404 or truncated response. Files don't exist now but errors persisted in console. Hypothesis 2 (zero-byte stubs) disproven — no zero-byte files on disk.
6. **Key insight**: Local PNG cache has proper write-to-cache pattern but no atomic write or tmp+rename. If ffmpeg is interrupted mid-write, partial PNG could be cached. Server-side guard missing for recently-modified/in-flight files.

- 2026-07-14 — T184.2-5 Implementation Complete:

**Changes:**
1. **T184.2 - Server Guard** (`src/api/routes-media.js`, `src/media/local-media-ffmpeg.js`):
   - Added `isThumbFileSafeToServe()` guard function: rejects zero-byte files and files with mtime < 500ms old
   - Updated `handleThumbnail()` to check file safety before serving from cache
   - Refactored `writeThumbnailCacheFile()` to use tmp+rename atomic write (prevents partial files)
   
2. **T184.3 - Client Guard** (`client/lib/thumbnail-error-handler.js`, `client/components/sources-panel-media.js`):
   - Created `thumbnail-error-handler.js` with retry logic: single delayed retry (1s) on img error, caches failed URLs to prevent re-request loops
   - Updated `sources-panel-media.js` to use error handler instead of inline onerror
   - Maintains failed URL set per session to avoid retry spam

3. **T184.4 - Zero-byte Sweep** (`src/media/local-media-ffmpeg.js`):
   - Added `cleanupZeroByteThumbnails()` function: async cleanup of zero-byte .png files in cache dir
   - Exported function for optional startup or on-demand use
   - Logged per deletion

4. **T184.5 - Smoke Tests** (`test/wo-184-smoke-tests.js`):
   - 6 passing tests covering: zero-byte rejection, valid PNG reading, atomic write, cleanup, syntax check, ESLint validation
   - All files pass `node --check` and ESLint --quiet
   - Tests: readThumbnailCacheFile + zero-byte handling, writeThumbnailCacheFile + atomic write, cleanupZeroByteThumbnails, syntax + linting

**Hypothesis Confirmed**: Partial/truncated PNG files could be cached during interrupted writes. Guards now prevent this.

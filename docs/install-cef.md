# CEF for CasparCG: what Caspar loads, how to check it, how to roll back

Work order: [WO-848](../work/work-orders/848_WO_install_cef_casparonly_pinning_symlinks.md).

## Where Caspar's CEF lives

- Caspar runs as `~/highascg/bin/casparcg`, started by `~/highascg/run.sh`, which exports
  `LD_LIBRARY_PATH=~/highascg/lib`. The pinned CEF (`libcef.so`, `icudtl.dat`, `*.pak`, `locales/`, …) is in
  `~/highascg/lib`. CEF finds its resources next to the `libcef.so` it was loaded from.
- Binaries built with `~/caspar-build/build-26.sh` since WO-848 carry `RUNPATH $ORIGIN/../lib`, so they load the
  same `lib/libcef.so` when started without `run.sh`. Older binaries carry the build tree's CEF dir plus an empty
  entry (= the working directory) and only get the right CEF through `run.sh`.
- The pin is the owner build `cef_binary_142.0.17+g60aac24…_linux64_minimal.tar.bz2` (`URL_CEF_BINARY_TAR`);
  `scripts/lib/install-config.sh` holds its sha256 (`CEF_BINARY_SHA256`, the same value as the fork's CMake
  `URL_HASH`) and the sha256 of the `libcef.so` inside (`CEF_LIBCEF_SHA256`).
- `/usr/lib/casparcg-cef-142.0.17` is a symlink to `~/highascg/lib`. `/usr/lib/cef/142.0.17/x86_64-linux-gnu/` is
  written by the installer (a copy by default) but no Caspar binary loads it, and it is not in the linker cache.
- Ubuntu ships no CEF package, so there is nothing to pin or hold in apt. Other apps (e.g. Zoom in
  `/opt/zoom/cef`) bring a private CEF that only they load.

## Check

```
bash scripts/setup/check-cef-caspar.sh          # full report; exit 1 on FAIL
bash scripts/setup/check-cef-caspar.sh --quiet  # only WARN/FAIL (also run at the end of setup step 08)
```

It is green when the bundle `libcef.so` matches the pin, the binary resolves it (with `run.sh`'s environment and
without it), and the running Caspar maps it. It warns about a RUNPATH outside the bundle, a `libcef.so` in
`ldconfig -p`, and `/usr/lib/cef` copies that differ from the bundle.

## Reinstall

`sudo bash scripts/setup/reinstall-cef.sh` (= step 08). The download goes to a private temp dir, and the archive
and its `libcef.so` must match the pins before anything in `lib/` is overwritten. A failed download or a bad hash
leaves `lib/` as it was.

`HIGHASCG_CEF_SYSTEM_LAYOUT` chooses what goes to `/usr/lib/cef/<ver>/<triplet>`: `copy` (default, as before),
`symlink` (one link per file into `lib/`, no 600 MB duplicate) or `none`.

## Roll back

- A bad CEF in `lib/`: `sudo bash scripts/setup/reinstall-cef.sh` puts the pinned files back.
- A Caspar binary: the swap keeps `bin/casparcg.pre-<wo>`; `mv -f` it back and send AMCP `RESTART`.
- `/usr/lib/cef/<ver>/<triplet>` in `symlink` mode: re-run with `HIGHASCG_CEF_SYSTEM_LAYOUT=copy` to get real files
  back, or remove the directory; Caspar does not use it either way.

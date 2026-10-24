#!/usr/bin/env bash
# WO-745 — open the operator's game window: run-retro.sh --core <x_libretro.so> --game <file> [--ring retro]
# The picture becomes the Live-tab source shm://<ring> (WO-744). Run install.sh once first.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${GODOT:-$HOME/.local/opt/godot/godot}" --path "$HERE" -- "$@"

#!/usr/bin/env bash
# WO-1121 — Super+Space: a search box over every installed application (openbox keybind, see
# scripts/setup/desktop-quality-of-life.sh). Needs rofi; says so on the screen when it is missing.
if command -v rofi >/dev/null 2>&1; then
	exec rofi -show drun -show-icons -drun-display-format '{name}' -matching fuzzy -sort \
		-theme-str 'window { width: 640px; } listview { lines: 10; } element-icon { size: 28px; }'
fi
command -v notify-send >/dev/null 2>&1 && notify-send "App search" "rofi is not installed: sudo apt install rofi"
exit 1

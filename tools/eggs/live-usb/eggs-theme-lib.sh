# Locate the penguins-eggs stock theme directory and the managed branding dir (source, do not execute).
# WO-832: eggs 26.10.25 moved the theme out of /usr/lib/penguins-eggs/addons/eggs/theme into
# /etc/penguins-eggs.d/branding.default (applications/ artwork/ calamares/ livecd/). Older eggs
# still ship the /usr/lib tree, so try the new location first and fall back.

# Prints the theme dir (the one that contains livecd/). Returns 1 when none exists.
# An explicit EGGS_THEME env wins, but only if it really has livecd/.
highascg_eggs_theme_dir() {
	local d
	for d in \
		"${EGGS_THEME:-}" \
		/etc/penguins-eggs.d/branding.default \
		/usr/lib/penguins-eggs/addons/eggs/theme; do
		[[ -n "$d" && -d "${d}/livecd" ]] || continue
		printf '%s\n' "$d"
		return 0
	done
	return 1
}

# WO-870: the new eggs (Go rewrite) reads our branding from <conf>/branding (livecd/, calamares/), written by
# install-eggs-config.sh --apply. Prints the dir whether or not it exists yet; EGGS_CONF_DIR moves it like there.
highascg_eggs_branding_dir() {
	printf '%s\n' "${EGGS_CONF_DIR:-/etc/penguins-eggs.d}/branding"
}

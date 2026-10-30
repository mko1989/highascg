# shellcheck shell=bash
# Layout-specific Calamares checks for verify-iso-squashfs-excludes.sh (WO-870 Phase 5). Sourced, not executed:
# uses the caller's SQ, UNSQ, ok, bad, squash_has_path, squash_grep_list.
#
#   legacy eggs: /etc/calamares is written at build time (install-eggs-calamares.sh) and patched in the squashfs.
#   eggs 26.10 : /etc/calamares is not used; the overlay ships under etc/penguins-eggs.d/branding/calamares/branding
#                (install-eggs-config.sh --apply). `eggs sysinstall calamares` builds /etc/penguins-eggs.d/installer.d
#                from it when the installer is launched on the stick (WO-870 Phase 4). No modules/ overrides ship: a
#                whole-file override would replace coa's generated partition/users confs.

calamares_checks_legacy() {
	local hc=etc/calamares/branding/highascg-eggs-theme
	if squash_has_path "${hc}/branding.desc"; then
		ok "present: /${hc}/branding.desc"
	else
		bad "missing Calamares branding — run install-eggs-calamares.sh before produce"
	fi
	if squash_has_path "${hc}/highascg-eggs-theme-logo.png"; then
		ok "present: /${hc}/highascg-eggs-theme-logo.png"
	elif squash_has_path "${hc}/eggs-logo.png"; then
		bad "only eggs-logo.png in squashfs — run install-eggs-calamares.sh (branding fix not baked)"
	else
		bad "missing Calamares logo in squashfs — run install-eggs-calamares.sh"
	fi
	if squash_has_path 'usr/local/lib/highascg/fix-calamares-branding.sh'; then
		ok "present: /usr/local/lib/highascg/fix-calamares-branding.sh"
	else
		bad "missing Calamares branding fixer — run install-eggs-calamares.sh before produce"
	fi
	if squash_has_path 'etc/calamares/modules/shellprocess@mkinitramfs.conf'; then
		if "${UNSQ[@]}" -cat "$SQ" etc/calamares/modules/shellprocess@mkinitramfs.conf 2>/dev/null \
			| grep -q '/usr/sbin/mkinitramfs'; then
			ok "present: shellprocess@mkinitramfs uses /usr/sbin/mkinitramfs (avoids exit 127)"
		else
			bad "shellprocess@mkinitramfs not patched — eggs produce overwrote preflight; run patch-iso-squashfs-calamares.sh"
		fi
	else
		bad "missing etc/calamares/modules/shellprocess@mkinitramfs.conf"
	fi
	if squash_has_path 'usr/sbin/cleanup.sh'; then
		ok "present: /usr/sbin/cleanup.sh (Calamares cleanup job)"
	else
		bad "missing /usr/sbin/cleanup.sh — run install-eggs-calamares.sh (fix-calamares-shellprocess)"
	fi
	local h
	for h in l10n logs; do
		if squash_has_path "usr/libexec/calamares/calamares-${h}-helper.sh"; then
			if "${UNSQ[@]}" -cat "$SQ" "usr/libexec/calamares/calamares-${h}-helper.sh" 2>/dev/null \
				| grep -q 'HighAsCG — offline-safe'; then
				ok "present: /usr/libexec/calamares/calamares-${h}-helper.sh (offline-safe)"
			else
				bad "calamares-${h}-helper.sh is eggs default — run fix-calamares-shellprocess.sh / patch-iso-squashfs-calamares.sh"
			fi
		else
			bad "missing calamares-${h}-helper.sh — run install-eggs-calamares.sh"
		fi
	done
	if squash_has_path 'etc/calamares/modules/shellprocess@boot_reconfigure.conf'; then
		if "${UNSQ[@]}" -cat "$SQ" etc/calamares/modules/shellprocess@boot_reconfigure.conf 2>/dev/null \
			| grep -q '/usr/sbin/dpkg-reconfigure'; then
			ok "present: shellprocess@boot_reconfigure uses /usr/sbin/dpkg-reconfigure"
		else
			bad "shellprocess@boot_reconfigure not patched — run fix-calamares-shellprocess.sh before produce"
		fi
	fi
	if "${UNSQ[@]}" -cat "$SQ" etc/calamares/modules/before_bootloader_context.conf 2>/dev/null \
		| grep -q 'grub-pc'; then
		ok "present: before_bootloader_context installs grub-pc on BIOS firmware"
	else
		bad "before_bootloader_context missing BIOS grub-pc — run fix-calamares-shellprocess.sh"
	fi
}

calamares_checks_new() {
	local ov=etc/penguins-eggs.d/branding/calamares
	if squash_has_path "${ov}/branding/show.qml"; then
		ok "present: /${ov}/branding/show.qml"
	else
		bad "missing Calamares slideshow /${ov}/branding/show.qml — run install-eggs-config.sh --apply before remaster"
	fi
	if squash_has_path "${ov}/branding/branding.desc" || squash_has_path "${ov}/branding/branding.desc.tmpl"; then
		ok "present: /${ov}/branding/branding.desc[.tmpl]"
	else
		bad "missing Calamares branding.desc[.tmpl] under /${ov}/branding — run install-eggs-config.sh --apply before remaster"
	fi
	if squash_has_path "${ov}/branding/highascg-eggs-theme-logo.png"; then
		ok "present: /${ov}/branding/highascg-eggs-theme-logo.png"
	else
		bad "missing Calamares logo under /${ov}/branding — run install-eggs-config.sh --apply before remaster"
	fi
	if squash_grep_list "^squashfs-root/${ov}/modules/[^/]+\\.(yaml|conf)\$" "${ov}/modules"; then
		bad "Calamares module overrides in /${ov}/modules — they replace coa's generated confs whole (WO-870 Phase 4)"
	else
		ok "no Calamares module overrides (coa's generated partition/users confs stay intact)"
	fi
}

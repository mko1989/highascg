# DeckLink tarball: try URL first (wget/curl), then HIGHASCG_DECKLINK_TAR, then /tmp/decklink.tar.gz
# Writes to $1 (e.g. /tmp/decklink.tar.gz). Returns 0 if valid .tar.gz content.
fetch_decklink_tarball() {
    local out="${1:-/tmp/decklink.tar.gz}"
    rm -f "$out"
    echo "  Trying download: $URL_DECKLINK_TAR"
    if command -v wget >/dev/null 2>&1; then
        wget --tries=3 --timeout=45 -U "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" -O "$out" "$URL_DECKLINK_TAR" 2>/dev/null || true
    fi
    if [ ! -s "$out" ] && command -v curl >/dev/null 2>&1; then
        curl -fL --retry 2 --connect-timeout 45 -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" -o "$out" "$URL_DECKLINK_TAR" 2>/dev/null || true
    fi
    if [ ! -s "$out" ] && [ -n "${HIGHASCG_DECKLINK_TAR:-}" ] && [ -f "$HIGHASCG_DECKLINK_TAR" ]; then
        echo "  Using HIGHASCG_DECKLINK_TAR=$HIGHASCG_DECKLINK_TAR"
        cp -f "$HIGHASCG_DECKLINK_TAR" "$out"
    fi
    if [ ! -s "$out" ] && [ -s /tmp/decklink.tar.gz ] && [ "${HIGHASCG_USE_TMP_DECKLINK:-1}" = "1" ]; then
        echo "  Using existing /tmp/decklink.tar.gz"
        if [ "$out" != "/tmp/decklink.tar.gz" ]; then
            cp -f /tmp/decklink.tar.gz "$out"
        fi
    fi
    if [ ! -s "$out" ]; then
        echo -e "  ${RED}Could not obtain DeckLink tarball.${NC}"
        return 1
    fi
    if ! tar -tzf "$out" >/dev/null 2>&1; then
        echo -e "  ${RED}File is not a valid gzip tarball (CDN may have returned an HTML error page).${NC}"
        rm -f "$out"
        return 1
    fi
    return 0
}

# NDI SDK tarball: URL first, then HIGHASCG_NDI_SDK_TAR, then /tmp/ndi-sdk.tar.gz
fetch_ndi_sdk_tarball() {
    local out="${1:-/tmp/ndi-sdk.tar.gz}"
    rm -f "$out"
    echo "  Trying download: $URL_NDI_SDK_TAR"
    if command -v wget >/dev/null 2>&1; then
        wget --tries=3 --timeout=45 -U "Mozilla/5.0 (X11; Linux x86_64) HighAsCG-Installer" -O "$out" "$URL_NDI_SDK_TAR" 2>/dev/null || true
    fi
    if [ ! -s "$out" ] && command -v curl >/dev/null 2>&1; then
        curl -fL --retry 2 --connect-timeout 45 -A "Mozilla/5.0 (X11; Linux x86_64) HighAsCG-Installer" -o "$out" "$URL_NDI_SDK_TAR" 2>/dev/null || true
    fi
    if [ ! -s "$out" ] && [ -n "${HIGHASCG_NDI_SDK_TAR:-}" ] && [ -f "$HIGHASCG_NDI_SDK_TAR" ]; then
        echo "  Using HIGHASCG_NDI_SDK_TAR=$HIGHASCG_NDI_SDK_TAR"
        cp -f "$HIGHASCG_NDI_SDK_TAR" "$out"
    fi
    if [ ! -s "$out" ] && [ -s /tmp/ndi-sdk.tar.gz ] && [ "${HIGHASCG_USE_TMP_NDI:-1}" = "1" ]; then
        echo "  Using existing /tmp/ndi-sdk.tar.gz"
        [ "$out" != "/tmp/ndi-sdk.tar.gz" ] && cp -f /tmp/ndi-sdk.tar.gz "$out"
    fi
    if [ ! -s "$out" ]; then
        echo -e "  ${RED}Could not obtain NDI SDK tarball.${NC}"
        return 1
    fi
    if ! tar -tzf "$out" >/dev/null 2>&1; then
        echo -e "  ${RED}NDI archive invalid (wrong file or HTML error page).${NC}"
        rm -f "$out"
        return 1
    fi
    return 0
}

# Caspar binary lives in the playout tree; Openbox runs ~/highascg/run.sh (not /opt, not .deb).
ensure_highascg_caspar_launcher() {
    local root="${CASPAR_PLAYOUT_ROOT:-/home/casparcg/highascg}"
    local bin="${root}/bin/casparcg"
    local run_src user="${USER_CASPAR:-casparcg}"

    [ -x "$bin" ] || {
        echo -e "  ${RED}Missing ${bin} — restore your custom Caspar build into ${root}/bin/${NC}" >&2
        return 1
    }

    local run_dest="${root}/run.sh"
    local run_canonical="${SCRIPT_DIR}/run.sh"
    if [ -f "$run_canonical" ]; then
        run_src="$run_canonical"
    elif [ -f "${SCRIPT_DIR}/tools/runtime/casparcg-run.sh" ]; then
        run_src="${SCRIPT_DIR}/tools/runtime/casparcg-run.sh"
    else
        run_src=""
    fi

    if [ -n "$run_src" ] && [ -f "$run_src" ]; then
        if [ "$run_src" -ef "$run_dest" ]; then
            chmod 0755 "$run_dest" 2>/dev/null || true
            chown "$user:$user" "$run_dest" 2>/dev/null || true
        else
            install -m 0755 -o "$user" -g "$user" "$run_src" "$run_dest"
        fi
    fi
    chmod +x "$run_dest" 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} Caspar binary ${bin} (launcher ${root}/run.sh)"

    # Remove mistaken /opt installer from earlier runs (does not affect restored bin/).
    rm -rf /opt/casparcg-enhanced 2>/dev/null || true
}

# Pinned CEF → playout ~/highascg/lib (what Caspar loads: run.sh LD_LIBRARY_PATH=lib, and since WO-848
# the binary's RUNPATH $ORIGIN/../lib). Overlays Release/* + Resources into lib/ via cp -a (libndi.so etc. stay).
# WO-848: every step is checked (callers use `fn || …`, which turns set -e off in here), the archive goes to a
# private mktemp dir, and both the archive and its libcef.so must match the pins in install-config.sh before
# anything in lib/ is touched.
# /usr/lib/cef/<ver>/<triplet> is NOT on any loader path Caspar uses (WO-848 §1); HIGHASCG_CEF_SYSTEM_LAYOUT
# picks what is put there: copy (default, as before) | symlink (per-file links into lib/, no 600 MB duplicate)
# | none.
install_highascg_cef_binary() {
    local url="${HIGHASCG_CEF_TAR_URL:-${URL_CEF_BINARY_TAR:-}}"
    local want_tar="${HIGHASCG_CEF_TAR_SHA256:-${CEF_BINARY_SHA256:-}}"
    local want_lib="${CEF_LIBCEF_SHA256:-}"
    local root="${CASPAR_PLAYOUT_ROOT:-/home/casparcg/highascg}"
    local lib="${root}/lib"
    local cef_ver="${CASPAR_CEF_VERSION:-142.0.17}"
    local triplet="${HIGHASCG_CEF_TRIPLET:-x86_64-linux-gnu}"
    local cef_sys="/usr/lib/cef/${cef_ver}/${triplet}"
    local layout="${HIGHASCG_CEF_SYSTEM_LAYOUT:-copy}"
    local user="${USER_CASPAR:-casparcg}"
    local work archive extract tar_root rel f got

    [ -n "$url" ] || return 1
    case "$layout" in copy | symlink | none) ;; *)
        echo -e "  ${RED}HIGHASCG_CEF_SYSTEM_LAYOUT=${layout}: use copy, symlink or none${NC}" >&2
        return 1
        ;;
    esac
    work=$(mktemp -d /tmp/highascg-cef.XXXXXX) || return 1
    archive="${work}/cef.tar.bz2"
    extract="${work}/x"

    echo -e "${CYAN}→ Downloading pinned CEF binary (${cef_ver})…${NC}"
    if command -v curl >/dev/null 2>&1; then
        curl -fL --retry 2 -o "$archive" "$url" || { rm -rf "$work"; return 1; }
    else
        wget -q -O "$archive" "$url" || { rm -rf "$work"; return 1; }
    fi

    if [ -n "$want_tar" ]; then
        got=$(sha256sum "$archive" | cut -d' ' -f1)
        if [ "$got" != "$want_tar" ]; then
            echo -e "  ${RED}CEF archive sha256 ${got} != pinned ${want_tar} — lib/ left untouched${NC}" >&2
            rm -rf "$work"
            return 1
        fi
        echo -e "  ${GREEN}✓${NC} archive sha256 matches the pin"
    else
        echo -e "  ${YELLOW}○${NC} no CEF_BINARY_SHA256 pin — archive not verified"
    fi

    tar_root=$(tar -tjf "$archive" 2>/dev/null | head -1 | cut -d/ -f1)
    [ -n "$tar_root" ] || {
        echo -e "  ${RED}Invalid CEF archive${NC}" >&2
        rm -rf "$work"
        return 1
    }
    mkdir -p "$extract" || { rm -rf "$work"; return 1; }
    tar -xjf "$archive" -C "$extract" || {
        echo -e "  ${RED}CEF archive did not extract — lib/ left untouched${NC}" >&2
        rm -rf "$work"
        return 1
    }
    rel="${extract}/${tar_root}/Release"
    if [ ! -f "${rel}/libcef.so" ]; then
        echo -e "  ${RED}No Release/libcef.so in the archive — lib/ left untouched${NC}" >&2
        rm -rf "$work"
        return 1
    fi
    if [ -n "$want_lib" ]; then
        got=$(sha256sum "${rel}/libcef.so" | cut -d' ' -f1)
        if [ "$got" != "$want_lib" ]; then
            echo -e "  ${RED}libcef.so sha256 ${got} != pinned ${want_lib} — lib/ left untouched${NC}" >&2
            rm -rf "$work"
            return 1
        fi
    fi

    mkdir -p "$lib/locales" || { rm -rf "$work"; return 1; }
    cp -a "${rel}/"* "$lib/" || { rm -rf "$work"; return 1; }
    for f in icudtl.dat resources.pak chrome_100_percent.pak chrome_200_percent.pak; do
        if [ -f "${extract}/${tar_root}/Resources/${f}" ]; then
            cp -a "${extract}/${tar_root}/Resources/${f}" "$lib/" || { rm -rf "$work"; return 1; }
        fi
    done
    if [ -d "${extract}/${tar_root}/Resources/locales" ]; then
        cp -a "${extract}/${tar_root}/Resources/locales/"* "$lib/locales/" || { rm -rf "$work"; return 1; }
    fi

    case "$layout" in
    copy)
        mkdir -p "$cef_sys" && cp -a "${rel}/"* "$cef_sys/" || { rm -rf "$work"; return 1; }
        ;;
    symlink)
        mkdir -p "$cef_sys" || { rm -rf "$work"; return 1; }
        for f in "${rel}/"*; do
            ln -sfn "${lib}/$(basename "$f")" "${cef_sys}/$(basename "$f")" || { rm -rf "$work"; return 1; }
        done
        ;;
    none) ;;
    esac
    rm -rf "$work"

    ln -sfn "$lib" "/usr/lib/casparcg-cef-${cef_ver}"
    mkdir -p /etc/highascg
    echo "$cef_ver" >/etc/highascg/cef-version
    chown -R "$user:$user" "$lib" 2>/dev/null || true
    command -v ldconfig >/dev/null 2>&1 && ldconfig
    if [ "$layout" = none ]; then
        echo -e "  ${GREEN}✓${NC} CEF ${cef_ver} → ${lib} (no /usr/lib/cef layout)"
    else
        echo -e "  ${GREEN}✓${NC} CEF ${cef_ver} → ${lib} (+ ${layout} at ${cef_sys})"
    fi
}

install_highascg_scanner_deb() {
    local url="${HIGHASCG_SCANNER_DEB_URL:-${URL_SCANNER_DEB:-}}"
    local deb="/tmp/highascg-scanner.deb"

    [ -n "$url" ] || return 1
    echo -e "${CYAN}→ Downloading Media Scanner (${SCANNER_PIN_VERSION:-1.4.0})…${NC}"
    if command -v curl >/dev/null 2>&1; then
        curl -fL --retry 2 -o "$deb" "$url"
    else
        wget -q -O "$deb" "$url"
    fi
    dpkg -i "$deb" || apt install -f -y
    command -v casparcg-scanner >/dev/null && echo -e "  ${GREEN}✓${NC} Scanner: $(command -v casparcg-scanner)"
}

decklink_report_status() {
    echo "==> DeckLink / Desktop Video"
    if lspci 2>/dev/null | grep -qi blackmagic; then
        echo "  PCI: Blackmagic device present"
        lspci 2>/dev/null | grep -i blackmagic | sed 's/^/    /'
    else
        echo "  PCI: no Blackmagic device"
    fi
    if dpkg-query -W desktopvideo &>/dev/null; then
        echo "  desktopvideo: $(decklink_pkg_version) (installed)"
    else
        echo "  desktopvideo: NOT installed"
        echo "    Download Desktop Video for Linux from Blackmagic, then:"
        echo "      export HIGHASCG_DECKLINK_TAR=/path/to/Blackmagic_Desktop_Video_Linux_*.tar.gz"
        echo "      sudo -E bash scripts/setup/01-kernel-117.sh  # or legacy scripts/install.sh"
        echo "    Or: cp tarball /tmp/decklink.tar.gz and re-run install"
    fi
    command -v desktopvideo_setup >/dev/null && echo "  desktopvideo_setup: $(command -v desktopvideo_setup)" || echo "  desktopvideo_setup: not found (optional GUI)"
    if lsmod 2>/dev/null | grep -q blackmagic; then
        lsmod | grep blackmagic | sed 's/^/  module: /'
    else
        echo "  module: blackmagic_io not loaded (reboot after install)"
    fi
    if command -v journalctl >/dev/null 2>&1; then
        if journalctl -k --no-pager -n 400 2>/dev/null | grep -qi 'firmware version mismatch'; then
            echo "  FIRMWARE: mismatch detected — update with Desktop Video Updater on :0"
            journalctl -k --no-pager -n 400 2>/dev/null | grep -i 'firmware version mismatch' | tail -1 | sed 's/^/    /'
        fi
    fi
}

# WO-848: sync_caspar_cef_into_system (copy /usr/lib/casparcg-cef-* .deb CEF over /usr/lib/cef/<ver>) was removed:
# it had no caller (sweep 29.10), no casparcg-cef .deb is installed, and Caspar never loads /usr/lib/cef.

#!/usr/bin/env bash
# DEPRECATED (WO-273) — abandoned split, never wired up.
#
# Added 2026-07-04 as part of a split of scripts/lib/install-helpers.sh. No script ever
# sourced it, and every function it defines is STILL defined in the 518-line monolith at
# scripts/lib/install-helpers.sh. Editing this file changes nothing. Edit the monolith.
#
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

# Pinned CEF: system layout /usr/lib/cef/<ver>/<triplet>/ + playout ~/highascg/lib for run.sh.
# Overlays Release/* and Resources into lib/ via cp -a — does not wipe libndi.so etc.
install_highascg_cef_binary() {
    local url="${HIGHASCG_CEF_TAR_URL:-${URL_CEF_BINARY_TAR:-}}"
    local root="${CASPAR_PLAYOUT_ROOT:-/home/casparcg/highascg}"
    local lib="${root}/lib"
    local archive="/tmp/highascg-cef-binary.tar.bz2"
    local cef_ver="${CASPAR_CEF_VERSION:-142.0.17}"
    local triplet="${HIGHASCG_CEF_TRIPLET:-x86_64-linux-gnu}"
    local cef_sys="/usr/lib/cef/${cef_ver}/${triplet}"
    local extract="/tmp/highascg-cef-extract"
    local tar_root user="${USER_CASPAR:-casparcg}"
    local f

    [ -n "$url" ] || return 1

    echo -e "${CYAN}→ Downloading pinned CEF binary (${cef_ver})…${NC}"
    if command -v curl >/dev/null 2>&1; then
        curl -fL --retry 2 -o "$archive" "$url"
    else
        wget -q -O "$archive" "$url"
    fi

    tar_root=$(tar -tjf "$archive" 2>/dev/null | head -1 | cut -d/ -f1)
    [ -n "$tar_root" ] || {
        echo -e "  ${RED}Invalid CEF archive${NC}" >&2
        return 1
    }

    rm -rf "$extract"
    mkdir -p "$extract" "$cef_sys" "$lib/locales"
    tar -xjf "$archive" -C "$extract"

    cp -a "${extract}/${tar_root}/Release/"* "$cef_sys/"
    cp -a "${extract}/${tar_root}/Release/"* "$lib/"
    for f in icudtl.dat resources.pak chrome_100_percent.pak chrome_200_percent.pak; do
        [ -f "${extract}/${tar_root}/Resources/${f}" ] && cp -a "${extract}/${tar_root}/Resources/${f}" "$lib/"
    done
    if [ -d "${extract}/${tar_root}/Resources/locales" ]; then
        cp -a "${extract}/${tar_root}/Resources/locales/"* "$lib/locales/" 2>/dev/null || true
    fi

    install -d /usr/lib
    ln -sfn "$lib" "/usr/lib/casparcg-cef-${cef_ver}"
    mkdir -p /etc/highascg
    echo "$cef_ver" >/etc/highascg/cef-version
    chown -R "$user:$user" "$lib" 2>/dev/null || true
    command -v ldconfig >/dev/null 2>&1 && ldconfig
    echo -e "  ${GREEN}✓${NC} CEF ${cef_ver} → ${cef_sys} and ${lib} (run.sh uses LD_LIBRARY_PATH=lib)"
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

# Copy CasparCG .deb CEF build into the system Chromium CEF layout (/usr/lib/cef/<ver>/…).
# Otherwise the loader may pick generic distro CEF instead of the Caspar-patched libs.
# Optional: HIGHASCG_CEF_TRIPLET (e.g. x86_64-linux-gnu) if uname-based guess is wrong.
sync_caspar_cef_into_system() {
    local caspar_src cef_ver triplet cef_sys f
    caspar_src=$(ls -d /usr/lib/casparcg-cef-* 2>/dev/null | sort -V | tail -1)
    if [ -z "$caspar_src" ] || [ ! -d "$caspar_src" ]; then
        echo -e "  ${YELLOW}○${NC} No /usr/lib/casparcg-cef-* — skip CEF → system layout sync"
        return 0
    fi
    cef_ver=$(basename "$caspar_src" | sed -n 's/^casparcg-cef-//p')
    if [ -z "$cef_ver" ]; then
        echo -e "  ${YELLOW}○${NC} Could not parse CEF version from $caspar_src — skip"
        return 0
    fi

    triplet="${HIGHASCG_CEF_TRIPLET:-}"
    if [ -z "$triplet" ]; then
        case "$(uname -m)" in
            x86_64) triplet="x86_64-linux-gnu" ;;
            aarch64) triplet="aarch64-linux-gnu" ;;
            *) triplet="$(uname -m)-linux-gnu" ;;
        esac
    fi

    cef_sys="/usr/lib/cef/${cef_ver}/${triplet}"
    if [ ! -d "$cef_sys" ] && [ -d "/usr/lib/cef/${cef_ver}" ]; then
        cef_sys=$(find "/usr/lib/cef/${cef_ver}" -maxdepth 1 -type d -name '*linux-gnu' 2>/dev/null | head -1)
    fi
    if [ -z "$cef_sys" ] || [ ! -d "$cef_sys" ]; then
        echo -e "  ${YELLOW}○${NC} No system CEF dir for Chromium ${cef_ver} (tried /usr/lib/cef/${cef_ver}/${triplet}) — skip CEF sync (install a package that provides /usr/lib/cef/…)"
        return 0
    fi

    echo -e "${CYAN}→ Sync CasparCG-patched CEF into ${cef_sys}${NC}"
    for f in libcef.so libEGL.so libGLESv2.so v8_context_snapshot.bin; do
        if [ ! -f "${caspar_src}/${f}" ]; then
            echo -e "  ${YELLOW}○${NC} Missing ${caspar_src}/${f} — skip this file"
            continue
        fi
        if [ -f "${cef_sys}/${f}" ] && [ ! -f "${cef_sys}/${f}.bak" ]; then
            cp -a "${cef_sys}/${f}" "${cef_sys}/${f}.bak"
            echo -e "  ${GREEN}✓${NC} backed up ${f} → ${f}.bak"
        fi
        cp -a "${caspar_src}/${f}" "${cef_sys}/${f}"
        echo -e "  ${GREEN}✓${NC} installed ${f}"
    done
    if command -v ldconfig >/dev/null 2>&1; then
        ldconfig
        echo -e "  ${GREEN}✓${NC} ldconfig"
    fi
    return 0
}

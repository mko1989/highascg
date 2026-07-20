get_latest_github_tag() {
    curl --silent "https://api.github.com/repos/$1/releases/latest" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/'
}

# Pick the correct .deb from GitHub release/latest (never the first .deb — Caspar lists CEF before server).
# $1 = owner/repo, $2 = substring that must appear in the filename (e.g. casparcg-server-2.5, casparcg-scanner_)
get_latest_github_deb() {
	local repo="$1"
	local pkg_filter="${2:?get_latest_github_deb: package filter required}"
	local json arch suffix lines url codename
	json=$(curl -sL "https://api.github.com/repos/$repo/releases/latest" 2>/dev/null)
	arch=$(dpkg --print-architecture 2>/dev/null || echo amd64)
	case "$arch" in
		amd64) suffix="_amd64.deb" ;;
		arm64) suffix="_arm64.deb" ;;
		*)     suffix=".deb" ;;
	esac
	lines=$(echo "$json" | grep '"browser_download_url"' | grep -F "$suffix" | grep -F "$pkg_filter")
	if [ -z "$lines" ]; then
		echo ""
		return 1
	fi

	# T3.3 / Phase 3: Prioritize explicit OS build suffixes (noble1, jammy, etc)
	codename=$(lsb_release -sc 2>/dev/null || echo noble)
	if [ "$codename" = "noble" ]; then
		url=$(echo "$lines" | grep -iF "noble1" | head -1)
		[ -n "$url" ] && echo "  Matched noble1 build for $repo" >&2
	fi
	if [ -z "$url" ]; then
		url=$(echo "$lines" | grep -iF "$codename" | head -1)
		[ -n "$url" ] && echo "  Matched $codename build for $repo" >&2
	fi
	if [ -z "$url" ]; then
		url=$(echo "$lines" | head -1)
		[ -n "$url" ] && echo "  No $codename build found for $repo; falling back to first asset: $(basename "$url")" >&2
	fi
	echo "$url" | sed -E 's/.*"(https[^"]+)".*/\1/'
}

# Read "version" from a package.json without jq (Phase 1 runs before apt may install jq).
read_package_json_version() {
    local f="$1"
    [ -f "$f" ] || return 1
    grep '"version"' "$f" 2>/dev/null | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/'
}

# GitHub release tags like v2.5.0-stable → 2.5.0 for version_gte
normalize_github_release_tag() {
    local t="${1#v}"
    t="${t%%-*}"
    if [[ "$t" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
        echo "${BASH_REMATCH[0]}"
    else
        echo "$t"
    fi
}

# Prefer 2.x.y from Caspar server --version (avoids confusing CEF/build numbers with the server semver).
detect_caspar_server_version() {
    local out ver install_dir
    install_dir="${CASPAR_PLAYOUT_ROOT:-/home/casparcg/highascg}"
    if [ -x "${install_dir}/bin/casparcg" ]; then
        out=$("${install_dir}/bin/casparcg" --version 2>/dev/null || true)
        ver=$(echo "$out" | grep -oE '2\.[0-9]+\.[0-9]+' | head -1)
        [ -n "$ver" ] && echo "$ver" && return 0
    fi
    for bin in casparcg-server-2.5 casparcg-server; do
        if command -v "$bin" &>/dev/null; then
            out=$("$bin" --version 2>/dev/null || true)
            ver=$(echo "$out" | grep -oE '2\.[0-9]+\.[0-9]+' | head -1)
            [ -n "$ver" ] && echo "$ver" && return 0
            ver=$(echo "$out" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
            [ -n "$ver" ] && echo "$ver" && return 0
        fi
    done
    if dpkg-query -W -f='${Version}' casparcg-server &>/dev/null; then
        ver=$(dpkg-query -W -f='${Version}' casparcg-server 2>/dev/null | head -1)
        ver=$(echo "$ver" | grep -oE '2\.[0-9]+\.[0-9]+' | head -1)
        [ -n "$ver" ] && echo "$ver" && return 0
    fi
    echo ""
}

detect_caspar_scanner_version() {
    local out ver full
    # Prefer dpkg full Version (upstream is before first '-', e.g. 1.4.0-ubuntu1)
    if dpkg-query -W -f='${Version}' casparcg-scanner &>/dev/null; then
        full=$(dpkg-query -W -f='${Version}' casparcg-scanner 2>/dev/null | head -1)
        full="${full#*:}"
        ver="${full%%-*}"
        if [[ "$ver" =~ ^[0-9]+\.[0-9]+$ ]]; then
            ver="${ver}.0"
        fi
        if [[ "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            [ "$ver" != "0.0.0" ] && echo "$ver" && return 0
        fi
    fi
    if command -v casparcg-scanner &>/dev/null; then
        out=$(casparcg-scanner --version 2>/dev/null || true)
        # Drop bogus 0.0.0; if multiple semvers, take highest (sort -V)
        ver=$(echo "$out" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | grep -v '^0\.0\.0$' | sort -V | tail -1)
        [ -n "$ver" ] && echo "$ver" && return 0
    fi
    echo ""
}

# Desktop Video .deb version → 15.3.1 (strip Debian epoch/revision)
decklink_pkg_version() {
    local v
    v=$(dpkg-query -W -f='${Version}' desktopvideo 2>/dev/null | head -1)
    [ -z "$v" ] && echo "" && return
    v="${v#*:}"
    echo "$v" | sed -E 's/^([0-9]+\.[0-9]+\.[0-9]+).*/\1/'
}

# e.g. https://.../DesktopVideo/v15.3.1/Blackmagic_...tar.gz → 15.3.1
decklink_version_from_url() {
    local u="${1:-$URL_DECKLINK_TAR}"
    echo "$u" | sed -nE 's|.*/v([0-9]+\.[0-9]+\.[0-9]+)/.*|\1|p' | head -1
}

# Recommended HighAsCG semver: local repo package.json, else GitHub latest release tag.
get_highascg_recommended_version() {
    local v=""
    v=$(read_package_json_version "$SCRIPT_DIR/package.json")
    if [ -z "$v" ]; then
        v=$(curl --silent "https://api.github.com/repos/mko1989/highascg/releases/latest" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/' | sed 's/^v//')
    fi
    if [ -z "$v" ]; then
        v="0.1.0"
    fi
    echo "$v"
}

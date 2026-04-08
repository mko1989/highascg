# HighAsCG - Production CasparCG Server Installer
# Comprehensive dependency audit + install
# 2026-04-04

# ═══════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════
LOG_FILE="/var/log/highascg-install.log"
USER_CASPAR="casparcg"
# SCRIPT_DIR — repo root (set by install.sh before sourcing this file)

# Minimum versions (semver-ish: major only or major.minor)
MIN_NODE=20
MIN_NVIDIA=535
MIN_CASPARCG="2.4"
MIN_NDI="6.1"

# Third-party download URLs — keep aligned with:
#   companion-module-casparcg-server/docs/full_production_setup.md
# Re-verify periodically on vendor sites (Blackmagic / NDI / GitHub).
# DeckLink: CDN may return 403/HTML — installer tries URL first, then HIGHASCG_DECKLINK_TAR, then /tmp/decklink.tar.gz.
# Support: https://www.blackmagicdesign.com/support/family/capture-and-playback — pick Linux → Desktop Video
URL_DECKLINK_TAR="https://swr.cloud.blackmagicdesign.com/DesktopVideo/v15.3.1/Blackmagic_Desktop_Video_Linux_15.3.1.tar.gz"
URL_NDI_SDK_TAR="https://downloads.ndi.tv/SDK/NDI_SDK_Linux/Install_NDI_SDK_v6_Linux.tar.gz"
HIGHASCG_GIT_URL="https://github.com/mko1989/highascg.git"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ═══════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════

_install_helpers_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=install-helpers-versions.sh
source "${_install_helpers_dir}/install-helpers-versions.sh"
# shellcheck source=install-helpers-runtime.sh
source "${_install_helpers_dir}/install-helpers-runtime.sh"
# shellcheck source=install-helpers-binaries.sh
source "${_install_helpers_dir}/install-helpers-binaries.sh"
unset _install_helpers_dir

#!/bin/bash
set -e

# HighAsCG installer — thin entry; logic lives in install-*.sh (same directory).
# Run from clone:  sudo ./scripts/install.sh
# Do not save GitHub’s HTML page as install.sh (use raw.githubusercontent.com or git clone).

INSTALL_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SCRIPT_DIR="$(cd "$INSTALL_SCRIPT_DIR/.." && pwd)"

_installer="$INSTALL_SCRIPT_DIR/install.sh"
if [[ ! -r "$_installer" ]]; then
	echo "Error: cannot read $_installer" >&2
	exit 1
fi
# Detect HTML via printf-built tokens only — a grep line that contains those tag literals would match itself.
_doc=$(printf '\074\041DOCTYPE')
_tag=$(printf '\074html')
if head -n 40 "$_installer" | grep -qiF "$_doc" || head -n 40 "$_installer" | grep -qiF "$_tag"; then
	echo "Error: this file looks like HTML (wrong download / save-as page). Use the real script from the repo." >&2
	echo "  git clone https://github.com/mko1989/highascg.git && cd highascg && sudo ./scripts/install.sh" >&2
	exit 1
fi
if ! head -n1 "$_installer" | grep -q '^#!/bin/bash'; then
	echo "Error: install.sh must be a bash script starting with #!/bin/bash" >&2
	exit 1
fi
for _f in install-config.sh install-helpers.sh install-phase1.sh install-phase2.sh install-phase3.sh install-phase4.sh install-phase5.sh; do
	if [[ ! -f "$INSTALL_SCRIPT_DIR/$_f" ]]; then
		echo "Error: missing $INSTALL_SCRIPT_DIR/$_f — copy the whole scripts/ directory from the repo, not only install.sh." >&2
		exit 1
	fi
done

# shellcheck source=install-config.sh
source "$INSTALL_SCRIPT_DIR/install-config.sh"
# shellcheck source=install-helpers.sh
source "$INSTALL_SCRIPT_DIR/install-helpers.sh"

# shellcheck source=install-phase1.sh
source "$INSTALL_SCRIPT_DIR/install-phase1.sh"
# shellcheck source=install-phase2.sh
source "$INSTALL_SCRIPT_DIR/install-phase2.sh"
# shellcheck source=install-phase3.sh
source "$INSTALL_SCRIPT_DIR/install-phase3.sh"
# shellcheck source=install-phase4.sh
source "$INSTALL_SCRIPT_DIR/install-phase4.sh"
# shellcheck source=install-phase5.sh
source "$INSTALL_SCRIPT_DIR/install-phase5.sh"

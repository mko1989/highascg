#!/usr/bin/env python3
"""
Operator pointer confine — manual launcher (work folder).

CANONICAL IMPLEMENTATION (production):
  tools/runtime/confine-pointer-barriers.py

Method: XFixes pointer barriers on four monitor edges + 50ms XWarpPointer
watchdog. Does NOT use XGrabPointer — Caspar multiview/interactive stay working.

Spec: work/work-orders/87_WO_OPERATOR_POINTER_CONFINE.md

Usage:
  DISPLAY=:0 XAUTHORITY=~/.Xauthority python3 work/confine_cursor.py DP-2

Verify:
  pgrep -af confine-pointer-barriers
  cat ~/.highascg/run/confine-pointer-barriers.pid
  tail ~/.highascg/log/confine-pointer-barriers.log
"""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]
_CANONICAL = _REPO / "tools" / "runtime" / "confine-pointer-barriers.py"

if not _CANONICAL.is_file():
    sys.stderr.write(f"Missing canonical script: {_CANONICAL}\n")
    sys.exit(1)

runpy.run_path(str(_CANONICAL), run_name="__main__")

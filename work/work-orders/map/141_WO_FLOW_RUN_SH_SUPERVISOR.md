# WO-141 — Flow: run.sh Supervisor

**Parent:** [WO-83 index](../83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Completed  
**Nodes:** `app:run-sh`, `runsh:flock`, `runsh:inhibit`, `runsh:relaunch`

---

## Endpoint Flow Documentation

This document explicitly maps out the interaction chain where the bash supervisor protects the CasparCG binary.

### 1. Initialization (This does that)
The systemd unit invokes `tools/runtime/run.sh` rather than executing the CasparCG binary directly. This bash script acts as a lightweight watchdog and environment initializer.

### 2. Execution Mechanism (In that way)
`run.sh` uses `flock` to ensure only one instance of the supervisor can run globally. Before launching the binary, it checks for an inhibit flag file (`/tmp/casparcg-inhibit`). If present, it loops and waits (allowing manual operator maintenance). If clear, it launches `bin/casparcg`. When the CasparCG process exits, the script traps the exit code. If it crashes (non-zero exit code), the bash script employs a short exponential backoff sleep timer before automatically restarting the binary (`runsh:relaunch`).

### 3. Final Result (Which results in that reacting this way)
As a result, if a bad media file or a driver fault crashes the CasparCG binary mid-show, the bash script reacts by intercepting the crash, cleaning up zombie processes, and immediately bootstrapping a fresh CasparCG instance within milliseconds. This creates high availability and self-healing resilience for the playout layer.

extends RefCounted
## WO-805 — HTTP request timeouts, dependency-free so feature scripts (and the headless test runner, which has no
## autoloads) can name them without preloading core/api.gd (that one needs the Config autoload).

const TIMEOUT_S := 15.0
## The Caspar Applies restart Caspar and answer only when it is back — typically 5-15 s, but the server's own waits cap
## out near ~100 s (RESTART, kill, 45 s AMCP wait, retry). 15 s turned a slow-but-fine Apply into "server did not answer
## in time" while the server finished it anyway. The cluster relay uses 110 s for these (cluster-relay.js).
const APPLY_TIMEOUT_S := 120.0


## The timeout one request runs with: `timeout_s` > 0 overrides the default.
static func request_timeout(timeout_s: float) -> float:
	return timeout_s if timeout_s > 0.0 else TIMEOUT_S

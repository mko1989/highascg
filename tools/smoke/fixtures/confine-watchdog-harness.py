"""Drive barrier_maintenance_loop with stubbed X + xrandr and report what it did.

WO-391: this used to drive `warp_watchdog`, and the interesting output was the pointer warps. The
cursor is no longer polled or warped at all, so the harness now records BOTH what the loop does
(create/destroy barriers as the layout moves) AND any attempt to touch the pointer — the test
asserts the latter never happens.
"""
import importlib.util, json, os, sys

path = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'tools', 'runtime', 'confine-pointer-barriers.py')
path = os.path.abspath(sys.argv[1])
spec = importlib.util.spec_from_file_location('confine', path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

# Never write into the operator's real confine log — this harness deliberately simulates a
# vanished output, and those lines are alarming when read back during a live incident.
m.LOG_PATH = os.path.join(os.environ.get('TMPDIR', '/tmp'), 'confine-harness-test.log')

events = []
# geometry: starts where the barriers were built, then MOVES, then the output vanishes
geoms = [(1920, 1080, 3072, 0), (1920, 1080, 0, 0), None]
calls = {'n': 0}

def fake_geometry(output_name=None):
    i = min(calls['n'], len(geoms) - 1)
    calls['n'] += 1
    g = geoms[i]
    return (output_name, g) if g else (None, None)


# WO-391 follow-up: `get_monitor_geometry(output_name, dpy, root)` now takes the display so it can
# use XRRGetMonitors instead of forking xrandr — the stub must accept those extra args.
def fake_geometry_any(output_name=None, dpy=None, root=None):
    return fake_geometry(output_name)


# MODE 2: exercise the REAL dispatcher to prove the RandR API is preferred and the xrandr
# subprocess is not forked when the API answers.
if len(sys.argv) > 2 and sys.argv[2] == 'dispatcher':
    calls = {'api': 0, 'subprocess': 0}

    def api(dpy, root, output_name=None):
        calls['api'] += 1
        return ('DP-1', (1920, 1080, 1920, 0))

    def subproc(output_name=None):
        calls['subprocess'] += 1
        return ('FALLBACK', (1, 1, 0, 0))

    m.monitor_geometry_via_xrandr_api = api
    m.monitor_geometry_via_xrandr_subprocess = subproc

    got_api = m.get_monitor_geometry('DP-1', object(), 1)
    after_api = dict(calls)
    # No display → must fall back to the subprocess parser rather than returning nothing.
    got_nodpy = m.get_monitor_geometry('DP-1')

    # API present but answering nothing (RandR < 1.5) → must still fall back.
    m.monitor_geometry_via_xrandr_api = lambda dpy, root, output_name=None: (None, None)
    got_degraded = m.get_monitor_geometry('DP-1', object(), 1)

    print(json.dumps({
        'api_result': list(got_api[1]),
        'subprocess_calls_when_api_answered': after_api['subprocess'],
        'nodpy_used_subprocess': got_nodpy[0] == 'FALLBACK',
        'degraded_used_subprocess': got_degraded[0] == 'FALLBACK',
    }))
    raise SystemExit(0)

m.get_monitor_geometry = fake_geometry_any
m.GEOMETRY_POLL_SEC = 0
m.time.sleep = lambda _s: None
m.create_edge_barriers = lambda dpy, root, x, y, w, h: (events.append(['create', x, y, w, h]) or [('left', 1)])
m.destroy_barriers = lambda dpy, barriers: events.append(['destroy'])

# Any pointer access is a WO-391 REGRESSION. `query_pointer` was deleted from the module, so this
# attribute is only reachable if someone reintroduces a poll loop that calls it — record it either
# way and let the test fail on it.
m.query_pointer = lambda dpy, root: (events.append(['query_pointer']) or (5000, 500))

class FakeX11:
    def XWarpPointer(self, *a):
        events.append(['warp', a[-2], a[-1]])
    def XQueryPointer(self, *a):
        events.append(['query_pointer'])
        return 0
    def XSync(self, *a):
        pass
m.libX11 = FakeX11()

# The waiter is INJECTED so the loop can be driven without an X connection. A bare `lambda: True`
# also proves the loop takes its pacing from the waiter and has no sleep of its own — if it still
# slept internally this harness would hang instead of completing.
def waiter():
    events.append(['wait'])
    return True


m.barrier_maintenance_loop(None, None, 'DP-5', (1920, 1080, 3072, 0), [('left', 1)], waiter)
print(json.dumps(events))

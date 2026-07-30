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

m.get_monitor_geometry = fake_geometry
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

m.barrier_maintenance_loop(None, None, 'DP-5', (1920, 1080, 3072, 0), [('left', 1)])
print(json.dumps(events))

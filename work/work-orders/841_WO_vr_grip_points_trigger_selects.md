# WO-841 — VR: the second trigger (grip) points the selected heads; the first trigger only selects

**Status: OPEN (30.10)**
**Source:** owner 30.10: *"fix for vr. make the pointing of selected heads in the vr world with the second trigger on the
controller. the first trigger should be only selecting."*
**Related:** WO-774 (trigger picks + aims on release, right grip fans, left grip = add), WO-741, WO-757, WO-795.

## Change of mapping (right controller)

| Input | Before (WO-774) | After |
|---|---|---|
| Trigger (index finger) | pick a head; drag = box select; release on the floor = aim the selection there | selection only: pick, box select. A release on the floor no longer aims |
| Grip (middle finger, "second trigger") | held + moved = fan pan/tilt | held = the selected heads point where the ray hits; they follow the ray while it is held |
| Left grip + right grip | — | the fan (the WO-774 motion fan moves here, so it is not lost) |

The fan's new place is the coordinator's choice (the owner did not say); it reuses the left grip, which is already the
modifier.

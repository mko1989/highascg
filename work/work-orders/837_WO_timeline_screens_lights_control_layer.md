# WO-837 — Timeline: screens, lights layer, control layer (D6)

**Status: OPEN (30.10)**
**Source:** WO-828 D6, owner 30.10: *"ability to add screens to a timeline (should have a divider and seperete layers in the
list at the bottom) ability to add lights layer (here id like it to be similar to comapnion buttons in timeline, but with a
choice of console in devices tab, that highascg connects to and ability to choose which cue to go into or move which fader
etc.). with that i think we should move the companion button flags and light flags to a seperate control layer that will
start from the bottom of the timeline. when control flags would be overlapping each other they should stack on top, making
the whole control layer wider. standard flags appear in the time ruller."*
**Related:** WO-828, WO-555 (sendTo), the timeline Companion flags.

Parts (design first, then build):

1. **Screens in a timeline:** a timeline can target several screens; the layer list shows a divider per screen with that
   screen's layers below it.
2. **Lights layer:** like Companion button flags, but a flag fires a lighting-console action (go to cue, move fader …) on
   a console chosen in the Devices tab that HighAsCG connects to.
3. **Control layer:** Companion and light flags move from the ruler to a control layer at the bottom of the timeline;
   overlapping flags stack upward and the layer grows. Standard flags stay in the ruler.

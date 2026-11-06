# Test tracking with the lighting desk

See what the lighting desk receives from tracking without anybody on stage. A **test puppet** walks the stage as
marker 1. The box sends it to the desk as a PSN tracker, exactly as it sends a real person.

## The test puppet

Where: **Previs → Camera → Markers**, at the bottom: **Test puppet**.

- **Path**: Circle, Figure 8, Line (stage right ↔ stage left), Walk (a square from downstage right), or Hold.
- **Speed** is in metres per second along the path. **Size** is the circle radius, or half the width of the other
  paths.
- It walks around the stage centre at head height (1.7 m). The 3D previs shows it as a **magenta** pole tagged
  "test puppet". Other markers are cyan.
- It is **off at every server start** and **switches itself off after two hours**. It never takes over a marker
  that a real source (detection, a presenter) is driving.

It only reaches the desk while the Follow output is on: **Previs → Camera → Follow**, **PosiStageNet → console**,
**Output** on.

## The one-command test with MagicQ (this box)

From the repo folder `~/highascg`:

- `tools/test-env/tracking-desk.sh up` starts MagicQ on a hidden screen (:99).
- `tools/test-env/tracking-desk.sh up --display :0` starts it on the desk screen, to watch it.
- `tools/test-env/tracking-desk.sh status --sniff` shows what is on, plus 3 s of what the desk receives.
- `tools/test-env/tracking-desk.sh down` puts everything back as it was.

**up** does four things:
1. Starts MagicQ with the **PSN Test** show and the console settings below.
2. Turns PSN output on in the open project: interface = the network port MagicQ listens on, axes **Y up**.
3. Starts the puppet. `--pattern line` picks another path.
4. With `--display :0`, click **Continue last show** in MagicQ's first window yourself.

**down** puts it all back:
- puppet off;
- the project's output exactly as it was before **up**;
- MagicQ quit, and its own settings files restored;
- the hidden screen stopped.

To see it move on MagicQ: **Window → Macro → View Autom → View Trackers**. Tracker 1 "Puppet" counts its X / Y / Z.
In **MagicVis**, it is a green cross.

To see the raw PSN on this box: `node tools/test-env/psn-sniff.js`. It prints every tracker once a second, with
its rate (about 50–60 Hz) and the sender's address.

## MagicQ PC needs a ChamSys interface for PSN

Without one, MagicQ PC runs in demo mode. **Tracker Rx** and **PSN Function** then show **[Locked]**, and nothing
is received.

On this box, the **GeNetix GN10** node unlocks it over the network:
- it is on port **eno2** (10.0.0.121);
- MagicQ's own IP must be on that port: **Setup → View Settings → Network → IP address 10.0.0.13**;
- **Net Manager** then lists the GN10, and the title changes from demo to **MagicQ PC**.

A GN2 or GN4 unlocks only the basic level, which has no PSN.

The PSN Test console state:

| Setting | Value |
|---|---|
| Network → IP address | `10.0.0.13` (the GeNetix port) |
| Network → Tracker Rx | PSN/SpotMe |
| Network → PSN Function | Normal PSN 1 (marker 1 = tracker 1) |
| View Trackers → tracker 1 | name Puppet, **Z scale −1** |
| DMX I/O, every universe | Vis only (nothing goes out to real DMX) |

**Why the PSN interface must be the GeNetix port.** MagicQ joins the PSN group on that port only. A desk on the same
computer hears HighAsCG only when HighAsCG sends out of that same port. **up** finds the port by itself.

**Axes.** MagicQ uses Y as height and shows a tracker as (X, height, −depth). With HighAsCG's **Y up**, tracker Z
scale **−1** puts upstage at negative Z, which is where MagicVis draws the back of the stage. Checked on 1.9.8.3:
the scale is a plain multiplier, so −1 means ×−1.

While MagicQ runs, it also listens on Art-Net port 6454.

## If nothing arrives

- `status --sniff` shows no tracker: the puppet is off, or the Follow output is off.
- The sniffer sees the tracker but MagicQ does not:
  - Tracker Rx is [Locked] (no interface), or
  - the project's PSN interface is not the port MagicQ listens on (`status` shows both).
- The cross moves the wrong way: walk the puppet on **Line** and fix the sign of X scale or Z scale on the desk.

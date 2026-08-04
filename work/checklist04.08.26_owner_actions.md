# Your to-do list — 04.08.26 (plain language)

Everything from the code review and the open queue that machines can do is DONE.
What's left needs either your hands, your eyes, or your answer. That's this list.

---

## 1. One command to run (fixes big video uploads) — 2 minutes

Uploading an mp4 bigger than 512 MB through the web GUI fails with a weird
"expected JSON, got HTML" error. The fix has been sitting in the repo since 01.08,
but installing it needs your sudo password, which I don't have.

Paste this in a terminal on the box:

```
sudo install -m 0644 -o root -g root /home/casparcg/highascg/config/nginx/highascg-web-proxy.conf /etc/nginx/sites-available/highascg-web-proxy.conf && sudo nginx -t && sudo nginx -s reload
```

Then try uploading a big mp4. If it works, that closes WO-402.

---

## 2. Three things to try when you're at the box (just look, no decisions)

**a) Stepping a playlist in preview (new — this is your "playlist stops after
first item" complaint, built the way you chose: "it makes sense that it pauses").**
Recall a look that has a playlist onto preview. Open the **Playlists** panel
(bottom of the inspector). The ⏮ and ⏭ buttons now work for a playlist that is
NOT on air — each press shows the next/previous item on the preview screen.
Preview still never plays by itself, and program is never touched.
Bonus: whatever item you step to is also where the playlist will START when you
take it to program.

**b) USB stick flashing (the "parted rm 3" failure).** The thing that broke it —
the auto-mounter grabbing the stick mid-flash — was fixed, but nobody has re-run
a flash since. Plug the stick in and run your usual
`build-produce-flash-stick.sh` line. It should get through all 5 phases now.

**c) The installer on the other machine ("failed to install boot loader").**
Needs a freshly produced stick (after b). If the install fails again, DON'T wipe
the stick — the installer's log is now saved onto the stick itself
(`HIGHASCGEXF:/logs/session.log`), and that log is the missing piece for finding
the real cause.

---

## 3. Seven old complaints — tell me which still happen

These are from your notes of 21.07 and were never followed up. The code has
changed a lot since, so some may be gone already. For each one, just tell me
**"still happens"** or **"fine now"** — nothing else needed:

1. Live-audio channel should use the cheapest resolution (PAL) — is CPU on that
   channel still a concern?
2. "I connected PGM2 to the record output and PGM1 got recorded" — the record
   bus got a big fix on 28.07 (WO-373), so this one is PROBABLY fixed. Does it
   still record the wrong channel?
3. NumLock turns itself off when highascg or caspar restarts — still happening?
4. Drag & drop from the media browser to the timeline sometimes doesn't "land" —
   still happening?
5. Clips on the timeline show almost no settings in the inspector — still true?
6. Timeline editing feels slow on the caspar output (looks editing got fast,
   timeline didn't) — still true?
7. In the timeline editor's compose preview, the label bar stretches full width
   instead of staying under the PRV window — still true?

Anything you mark "still happens" gets its own work order and gets fixed.

---

## 4. One thing to say the word on, later

**Performance round 2.** The deep look inside caspar (which channel eats what)
only makes sense when the box has a real show configured — measuring the current
empty config would find nothing. Today's idle numbers are recorded as the
reference floor (caspar 8 %, node 1 %). Once you've built a real show config,
just say **"run perf round 2"**.

---

## Nothing needed from you on these (just so you know)

- **The full code review is closed.** All ten "fix first" findings are fixed,
  live on the box, and tested. The very last one (a rare case where a slow
  take could double-play every clip) went in today.
- **API stays without a password**, as you said. Not asked again.
- **The config reset from eggs produce** is now understood as normal and
  written down that way everywhere — no more restore nagging. If a config file
  ever gets CORRUPTED (crash mid-write), it's now saved aside as
  `<name>.corrupt-<date>` instead of being silently replaced.
- **Your shader library is now backed up** — all 42 shader files are committed
  to git/GitHub. They previously existed only on this box. If you add/edit
  shaders and want them backed up again, say "commit the shaders".
- **CI is green, the test suite is 1820/0, and `git status` is clean.**
- There are older "implemented, owner QA" rows in `work/OPEN_ISSUES.md` (things
  built earlier that you never confirmed on-glass). None are urgent; they'll
  come up naturally as you use the box.

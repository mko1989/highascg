/*
 * window_grab — WO-1012: one X11 window → one HighAsCG shm ring (hshm ABI v1, caspar/modules/shm/hshm_abi.h).
 *
 * The window is read from its XComposite backing pixmap (CompositeRedirectAutomatic), so it keeps rendering and can be
 * grabbed while it is covered or moved off every monitor (still mapped). Pixels come over XShm: no encode, no ffmpeg,
 * one copy into the ring. Caspar plays the ring with `PLAY <ch>-<layer> SHM NAME <ring>` (WO-742) and it is listed in
 * /api/shm/sources (WO-744).
 *
 * The ring has a FIXED size (--size): the window is centred in it (cropped when larger, black around it when smaller).
 * A fixed ring is on purpose: hshm::writer::attach() unlinks the old name before re-attaching, so re-opening the same
 * name on a resize would orphan the segment readers look for.
 *
 * The ring outlives the window: the caller (src/zoom/zoom-grab.js) picks the window and can switch it on stdin, e.g. when
 * Zoom recreates its share window:
 *   window 0x3a00007     grab this window (hex or decimal id)
 *   none                 publish black
 *   below | normal       hide the window under every normal window (the operator GUI) / bring it back (EWMH)
 *   fit RRGGBB,RRGGBB…   find the picture inside the window and scale it to fill the ring: pixels of these chrome
 *                        colours (title bar, frame, background) are not picture (window_fit.h); `fit off` = as is
 *   move X Y [W H]       place (and size) it — keep hidden windows on the OPERATOR monitor: Openbox clamps moves
 *                        past the screen edge, so an "off-screen" move lands on the program monitor (WO-1012 spike)
 * EOF on stdin ends the grab (the parent is gone).
 * Status goes to stdout as one JSON object per line, every second and on changes:
 *   {"t":"status","window":"0x3a00007","mapped":true,"w":1280,"h":720,"published":1234,"errors":0}
 *
 * Usage: window_grab --ring <name> [--size 1920x1080] [--fps 30] [--window <id>] [--fit RRGGBB,RRGGBB…]
 * Build: tools/window-grab/build.sh (needs libx11-dev libxext-dev libxcomposite-dev).
 */
#include "../../caspar/modules/shm/hshm_writer.h"
#include "window_fit.h"

#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/extensions/XShm.h>
#include <X11/extensions/Xcomposite.h>

#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <poll.h>
#include <string>
#include <sys/ipc.h>
#include <sys/shm.h>
#include <vector>

static volatile sig_atomic_t g_stop = 0;
static int                   g_xerr = 0;

static int on_xerror(Display*, XErrorEvent* e)
{
    g_xerr = e->error_code ? e->error_code : 1;
    return 0;
}

static void on_signal(int) { g_stop = 1; }

struct Grab
{
    Display*        dpy    = nullptr;
    Window          win    = 0;
    Pixmap          pix    = 0;
    bool            mapped = false;
    int             w = 0, h = 0, depth = 0;
    Visual*         visual = nullptr;
    XImage*         img    = nullptr;
    XShmSegmentInfo shm{};
    unsigned long   errors = 0;
    wfit::Fit       fit;
    wfit::Rect      box; // the picture found by `fit` (empty = the whole window is shown)

    void free_image()
    {
        if (!img)
            return;
        XShmDetach(dpy, &shm);
        XSync(dpy, False);
        XDestroyImage(img);
        shmdt(shm.shmaddr);
        shmctl(shm.shmid, IPC_RMID, nullptr);
        img = nullptr;
    }

    void free_pixmap()
    {
        if (pix) {
            XFreePixmap(dpy, pix);
            pix = 0;
        }
    }

    void release()
    {
        free_image();
        free_pixmap();
        if (win) {
            g_xerr = 0;
            XCompositeUnredirectWindow(dpy, win, CompositeRedirectAutomatic);
            XSelectInput(dpy, win, NoEventMask);
            XSync(dpy, False);
        }
        win    = 0;
        mapped = false;
        w = h = 0;
    }

    /* (Re)name the backing pixmap and size the XShm image after a map or a resize. */
    bool refresh()
    {
        free_image();
        free_pixmap();
        XWindowAttributes a{};
        g_xerr = 0;
        if (!XGetWindowAttributes(dpy, win, &a) || g_xerr) {
            mapped = false;
            return false;
        }
        mapped = a.map_state == IsViewable;
        w = a.width;
        h = a.height;
        depth  = a.depth;
        fit.reset();
        box = wfit::Rect{};
        visual = a.visual;
        if (!mapped || w <= 0 || h <= 0)
            return false;
        pix = XCompositeNameWindowPixmap(dpy, win);
        XSync(dpy, False);
        if (g_xerr) {
            pix = 0;
            return false;
        }
        img = XShmCreateImage(dpy, visual, depth, ZPixmap, nullptr, &shm, w, h);
        if (!img)
            return false;
        shm.shmid = shmget(IPC_PRIVATE, img->bytes_per_line * img->height, IPC_CREAT | 0600);
        shm.shmaddr = img->data = static_cast<char*>(shmat(shm.shmid, nullptr, 0));
        shm.readOnly = False;
        XShmAttach(dpy, &shm);
        XSync(dpy, False);
        return true;
    }

    bool attach(Window id)
    {
        release();
        if (!id)
            return true;
        win    = id;
        g_xerr = 0;
        XSelectInput(dpy, win, StructureNotifyMask);
        XCompositeRedirectWindow(dpy, win, CompositeRedirectAutomatic);
        XSync(dpy, False);
        if (g_xerr) { // gone already
            win = 0;
            return false;
        }
        refresh();
        return true;
    }

    /* Copy the window into the ring canvas (centred, cropped). false = nothing new (unmapped, error). */
    bool read_into(std::vector<uint8_t>& canvas, int cw, int ch)
    {
        if (!win || !mapped || !img)
            return false;
        g_xerr = 0;
        if (!XShmGetImage(dpy, pix, img, 0, 0, AllPlanes) || g_xerr) {
            ++errors;
            return false;
        }
        if (fit.on) {
            const uint8_t* data = reinterpret_cast<uint8_t*>(img->data);
            box = fit.update(data, img->bytes_per_line, w, h);
            if (box.valid()) {
                wfit::Fit::scale(data, img->bytes_per_line, box, canvas.data(), cw, ch);
                return true;
            }
        }
        std::fill(canvas.begin(), canvas.end(), 0);
        const int sx = w > cw ? (w - cw) / 2 : 0, dx = w < cw ? (cw - w) / 2 : 0;
        const int sy = h > ch ? (h - ch) / 2 : 0, dy = h < ch ? (ch - h) / 2 : 0;
        const int cols = std::min(w, cw), rows = std::min(h, ch);
        for (int y = 0; y < rows; ++y) {
            const uint8_t* src = reinterpret_cast<uint8_t*>(img->data) + (size_t)(sy + y) * img->bytes_per_line + sx * 4;
            uint8_t*       dst = canvas.data() + ((size_t)(dy + y) * cw + dx) * 4;
            std::memcpy(dst, src, (size_t)cols * 4);
            for (int x = 0; x < cols; ++x)
                dst[x * 4 + 3] = 0xff; // BGRX (depth 24) or a GL alpha that means nothing on screen → opaque
        }
        return true;
    }
};

/* EWMH requests to the window manager (Openbox) for the grabbed window — no wmctrl on the box. */
static void wm_message(Display* dpy, Window w, const char* type, long a0, long a1, long a2, long a3, long a4)
{
    XEvent e{};
    e.xclient.type         = ClientMessage;
    e.xclient.window       = w;
    e.xclient.message_type = XInternAtom(dpy, type, False);
    e.xclient.format       = 32;
    long d[5]              = {a0, a1, a2, a3, a4};
    for (int i = 0; i < 5; ++i)
        e.xclient.data.l[i] = d[i];
    XSendEvent(dpy, DefaultRootWindow(dpy), False, SubstructureRedirectMask | SubstructureNotifyMask, &e);
    XFlush(dpy);
}

/* `below` → under every normal window (the operator GUI), off the taskbar / pager; `normal` → back. */
static void set_below(Display* dpy, Window w, bool below)
{
    const long op = below ? 1 : 0; // _NET_WM_STATE_ADD / _REMOVE
    wm_message(dpy, w, "_NET_WM_STATE", op, (long)XInternAtom(dpy, "_NET_WM_STATE_BELOW", False),
               (long)XInternAtom(dpy, "_NET_WM_STATE_SKIP_TASKBAR", False), 1, 0);
    wm_message(dpy, w, "_NET_WM_STATE", op, (long)XInternAtom(dpy, "_NET_WM_STATE_SKIP_PAGER", False), 0, 1, 0);
}

/* `move X Y [W H]` — _NET_MOVERESIZE_WINDOW, static gravity (the client area lands at X,Y). */
static void move_resize(Display* dpy, Window w, int x, int y, int ww, int hh)
{
    long flags = 10 /* StaticGravity */ | (1L << 8) | (1L << 9) | (ww > 0 ? (1L << 10) | (1L << 11) : 0) | (2L << 12);
    wm_message(dpy, w, "_NET_MOVERESIZE_WINDOW", flags, x, y, ww, hh);
}

static Window parse_window(const std::string& s)
{
    if (s.empty() || s == "none" || s == "0")
        return 0;
    return static_cast<Window>(std::strtoul(s.c_str(), nullptr, 0));
}

static void status(const Grab& g, const hshm::writer& w, const char* note)
{
    std::printf("{\"t\":\"status\",\"window\":\"0x%lx\",\"mapped\":%s,\"w\":%d,\"h\":%d,\"published\":%llu,"
                "\"errors\":%lu,\"fit\":%s,\"box\":[%d,%d,%d,%d]%s%s%s}\n",
                (unsigned long)g.win, g.mapped ? "true" : "false", g.w, g.h, (unsigned long long)w.published(),
                g.errors, g.fit.on ? "true" : "false", g.box.x, g.box.y, g.box.w, g.box.h, note ? ",\"note\":\"" : "", note ? note : "", note ? "\"" : "");
    std::fflush(stdout);
}

int main(int argc, char** argv)
{
    std::string ring, size = "1920x1080", win_arg, fit_arg;
    int         fps = 30;
    for (int i = 1; i + 1 < argc; i += 2) {
        std::string k = argv[i], v = argv[i + 1];
        if (k == "--ring")
            ring = v;
        else if (k == "--size")
            size = v;
        else if (k == "--fps")
            fps = std::max(1, std::min(120, std::atoi(v.c_str())));
        else if (k == "--window")
            win_arg = v;
        else if (k == "--fit")
            fit_arg = v;
    }
    int cw = 0, ch = 0;
    if (ring.empty() || std::sscanf(size.c_str(), "%dx%d", &cw, &ch) != 2 || cw < 16 || ch < 16 || cw > 7680 ||
        ch > 4320) {
        std::fprintf(stderr, "usage: window_grab --ring <name> [--size WxH] [--fps N] [--window <id>]\n");
        return 2;
    }
    std::signal(SIGTERM, on_signal);
    std::signal(SIGINT, on_signal);
    std::signal(SIGPIPE, SIG_IGN);

    Grab g;
    g.fit.configure(fit_arg.c_str());
    g.dpy = XOpenDisplay(nullptr);
    if (!g.dpy) {
        std::fprintf(stderr, "window_grab: cannot open display\n");
        return 3;
    }
    XSetErrorHandler(on_xerror);
    int ev = 0, er = 0, maj = 0, min = 0;
    if (!XCompositeQueryExtension(g.dpy, &ev, &er) || !XCompositeQueryVersion(g.dpy, &maj, &min) ||
        (maj == 0 && min < 2) || !XShmQueryExtension(g.dpy)) {
        std::fprintf(stderr, "window_grab: needs XComposite >= 0.2 and XShm\n");
        return 3;
    }

    hshm::writer out;
    try {
        out.open_shm(ring, (uint32_t)cw, (uint32_t)ch, (uint32_t)fps, 1, 0);
    } catch (const std::exception& e) {
        std::fprintf(stderr, "window_grab: %s\n", e.what());
        return 4;
    }
    std::vector<uint8_t> canvas((size_t)cw * ch * 4, 0);
    if (!g.attach(parse_window(win_arg)))
        status(g, out, "window gone");

    const long long frame_ns = 1000000000LL / fps;
    long long       next     = (long long)hshm::now_ns(CLOCK_MONOTONIC);
    long long       last_status = 0;
    uint64_t        frame       = 0;
    std::string     line;
    while (!g_stop) {
        // stdin commands
        pollfd pfd{0, POLLIN, 0};
        while (poll(&pfd, 1, 0) > 0 && (pfd.revents & (POLLIN | POLLHUP))) {
            char    buf[256];
            ssize_t n = read(0, buf, sizeof buf);
            if (n <= 0) {
                g_stop = 1; // parent gone
                break;
            }
            line.append(buf, (size_t)n);
            size_t nl;
            while ((nl = line.find('\n')) != std::string::npos) {
                std::string cmd = line.substr(0, nl);
                line.erase(0, nl + 1);
                if (cmd.rfind("window ", 0) == 0 || cmd == "none") {
                    bool ok = g.attach(parse_window(cmd == "none" ? "none" : cmd.substr(7)));
                    status(g, out, ok ? "switched" : "window gone");
                } else if (g.win && (cmd == "below" || cmd == "normal")) {
                    set_below(g.dpy, g.win, cmd == "below");
                    status(g, out, cmd.c_str());
                } else if (cmd.rfind("fit ", 0) == 0) {
                    g.fit.configure(cmd == "fit off" ? "" : cmd.c_str() + 4);
                    g.box = wfit::Rect{};
                    status(g, out, g.fit.on ? "fit on" : "fit off");
                } else if (g.win && cmd.rfind("move ", 0) == 0) {
                    int x = 0, y = 0, ww = 0, hh = 0;
                    if (std::sscanf(cmd.c_str() + 5, "%d %d %d %d", &x, &y, &ww, &hh) >= 2)
                        move_resize(g.dpy, g.win, x, y, ww, hh);
                    status(g, out, "moved");
                }
            }
        }
        // window events
        while (XPending(g.dpy)) {
            XEvent e;
            XNextEvent(g.dpy, &e);
            if (!g.win)
                continue;
            if (e.type == DestroyNotify && e.xdestroywindow.window == g.win) {
                g.win = 0;
                g.release();
                status(g, out, "window gone");
            } else if ((e.type == MapNotify || e.type == UnmapNotify) && e.xany.window == g.win) {
                g.refresh();
                status(g, out, e.type == MapNotify ? "mapped" : "unmapped");
            } else if (e.type == ConfigureNotify && e.xconfigure.window == g.win &&
                       (e.xconfigure.width != g.w || e.xconfigure.height != g.h)) {
                g.refresh();
                status(g, out, "resized");
            }
        }
        if (!g.win)
            std::fill(canvas.begin(), canvas.end(), 0); // no window → black (an unmapped one holds its last frame)
        g.read_into(canvas, cw, ch);
        out.publish(canvas.data(), (size_t)cw * 4, ++frame);

        long long now = (long long)hshm::now_ns(CLOCK_MONOTONIC);
        if (now - last_status > 1000000000LL) {
            last_status = now;
            status(g, out, nullptr);
        }
        next += frame_ns;
        if (next < now) { // fell behind: skip, count it
            out.note_dropped((uint64_t)((now - next) / frame_ns));
            next = now;
        }
        timespec ts{(time_t)((next - now) / 1000000000LL), (long)((next - now) % 1000000000LL)};
        nanosleep(&ts, nullptr);
    }
    g.release();
    XCloseDisplay(g.dpy);
    return 0;
}

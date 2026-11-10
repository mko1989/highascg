/*
 * window_fit — WO-1012: find the picture inside a Zoom window and scale it to fill the ring.
 *
 * Owner, 10.11: "both the share and the camera view to display Fullscreen on the layer, no zoom's bar". Zoom draws its
 * own title bar, toolbar and a flat background around the picture; its own full-screen mode needs clicks and opens an
 * annotate toolbar on the operator screen. So the grabber does it: every pixel that has one of the window's CHROME
 * colours (title bar, frame, background — given by the caller, they belong to the Zoom theme) is not picture. A row
 * (then a column) belongs to the picture when it holds one unbroken run of non-chrome pixels at least a quarter of the
 * window wide: icons, labels and the title-bar tab are shorter than that, a share or a video is not.
 *
 * The box found must repeat three detections in a row before it replaces the current one, so a dark scene that
 * happens to match a chrome colour for a moment does not make the picture jump.
 */
#pragma once

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <vector>

namespace wfit {

struct Rect
{
    int  x = 0, y = 0, w = 0, h = 0;
    bool valid() const { return w > 0 && h > 0; }
    bool near(const Rect& o) const
    {
        return std::abs(x - o.x) <= 2 && std::abs(y - o.y) <= 2 && std::abs(w - o.w) <= 3 && std::abs(h - o.h) <= 3;
    }
};

struct Fit
{
    bool                  on = false;
    std::vector<uint32_t> chrome; // 0xRRGGBB
    Rect                  cur, cand;
    int                   cand_hits = 0;
    unsigned              frames    = 0;

    void reset()
    {
        cur = cand = Rect{};
        cand_hits  = 0;
        frames     = 0;
    }

    /* `fit 131619,2a2b2d,242424` → on with these chrome colours; `fit off` → off. */
    void configure(const char* arg)
    {
        chrome.clear();
        reset();
        for (const char* p = arg; *p;) {
            char*         end = nullptr;
            unsigned long v   = std::strtoul(p, &end, 16);
            if (end == p)
                break;
            chrome.push_back((uint32_t)(v & 0xffffff));
            p = *end == ',' ? end + 1 : end;
            if (*end != ',')
                break;
        }
        on = !chrome.empty();
    }

    bool is_chrome(const uint8_t* bgrx) const
    {
        for (uint32_t c : chrome) {
            if (std::abs((int)bgrx[2] - (int)((c >> 16) & 0xff)) <= 3 && std::abs((int)bgrx[1] - (int)((c >> 8) & 0xff)) <= 3 &&
                std::abs((int)bgrx[0] - (int)(c & 0xff)) <= 3)
                return true;
        }
        return false;
    }

    /* The picture's box in a w×h BGRX image; an empty Rect when there is none. */
    Rect detect(const uint8_t* data, int stride, int w, int h) const
    {
        const int step = 2;
        auto      px   = [&](int x, int y) { return data + (size_t)y * stride + (size_t)x * 4; };
        int       top = -1, bottom = -1;
        const int need_x = std::max(8, w / 4 / step);
        for (int y = 0; y < h; y += step) {
            int run = 0, best = 0;
            for (int x = 0; x < w; x += step) {
                run  = is_chrome(px(x, y)) ? 0 : run + 1;
                best = std::max(best, run);
            }
            if (best >= need_x) {
                if (top < 0)
                    top = y;
                bottom = y;
            }
        }
        if (top < 0)
            return Rect{};
        // refine the two edges to the pixel (rows were sampled every `step`)
        auto row_is_picture = [&](int y) {
            int run = 0, best = 0;
            for (int x = 0; x < w; x += step) {
                run  = is_chrome(px(x, y)) ? 0 : run + 1;
                best = std::max(best, run);
            }
            return best >= need_x;
        };
        while (top > 0 && row_is_picture(top - 1))
            --top;
        while (bottom + 1 < h && row_is_picture(bottom + 1))
            ++bottom;
        int       left = -1, right = -1;
        const int need_y = std::max(8, (bottom - top + 1) / 4 / step);
        auto      col_is_picture = [&](int x) {
            int run = 0, best = 0;
            for (int y = top; y <= bottom; y += step) {
                run  = is_chrome(px(x, y)) ? 0 : run + 1;
                best = std::max(best, run);
            }
            return best >= need_y;
        };
        for (int x = 0; x < w; x += step) {
            if (col_is_picture(x)) {
                if (left < 0)
                    left = x;
                right = x;
            }
        }
        if (left < 0)
            return Rect{};
        while (left > 0 && col_is_picture(left - 1))
            --left;
        while (right + 1 < w && col_is_picture(right + 1))
            ++right;
        Rect r{left, top, right - left + 1, bottom - top + 1};
        if (r.w < 64 || r.h < 64)
            return Rect{};
        return r;
    }

    /* Call once per frame; looks every 8th frame. Returns the box to show (empty = show the whole window). */
    Rect update(const uint8_t* data, int stride, int w, int h)
    {
        if (frames++ % 8 == 0) {
            Rect r = detect(data, stride, w, h);
            if (r.valid() && r.near(cand))
                ++cand_hits;
            else {
                cand      = r;
                cand_hits = 1;
            }
            // the first box is taken at once; a change (or the picture going away) must hold for three looks
            if ((!cur.valid() && r.valid()) || cand_hits >= 3)
                cur = cand;
            else if (!r.valid() && !cand.valid() && cand_hits >= 3)
                cur = Rect{};
        }
        if (cur.valid() && (cur.x + cur.w > w || cur.y + cur.h > h))
            cur = Rect{}; // the window shrank under the box
        return cur;
    }

    /* Scale box `r` of the image to fit the cw×ch canvas (aspect kept, opaque black around it). Bilinear, 16.16. */
    static void scale(const uint8_t* data, int stride, Rect r, uint8_t* canvas, int cw, int ch)
    {
        for (size_t i = 0, n = (size_t)cw * ch; i < n; ++i) {
            canvas[i * 4 + 0] = canvas[i * 4 + 1] = canvas[i * 4 + 2] = 0;
            canvas[i * 4 + 3] = 0xff;
        }
        int dw = cw, dh = (int)((int64_t)cw * r.h / r.w);
        if (dh > ch) {
            dh = ch;
            dw = (int)((int64_t)ch * r.w / r.h);
        }
        dw = std::max(1, dw);
        dh = std::max(1, dh);
        const int ox = (cw - dw) / 2, oy = (ch - dh) / 2;
        if (dw == r.w && dh == r.h) { // 1:1
            for (int y = 0; y < dh; ++y) {
                uint8_t* dst = canvas + ((size_t)(oy + y) * cw + ox) * 4;
                std::memcpy(dst, data + (size_t)(r.y + y) * stride + (size_t)r.x * 4, (size_t)dw * 4);
                for (int x = 0; x < dw; ++x)
                    dst[x * 4 + 3] = 0xff;
            }
            return;
        }
        const int64_t        fx = ((int64_t)r.w << 16) / dw, fy = ((int64_t)r.h << 16) / dh;
        std::vector<int>     x0(dw), x1(dw);
        std::vector<uint32_t> xf(dw);
        for (int x = 0; x < dw; ++x) {
            int64_t s = std::max<int64_t>(0, (int64_t)x * fx + fx / 2 - 32768);
            x0[x]     = std::min(r.w - 1, (int)(s >> 16));
            x1[x]     = std::min(r.w - 1, x0[x] + 1);
            xf[x]     = (uint32_t)(s & 0xffff) >> 8; // 0..255
        }
        for (int y = 0; y < dh; ++y) {
            int64_t        s  = std::max<int64_t>(0, (int64_t)y * fy + fy / 2 - 32768);
            const int      y0 = std::min(r.h - 1, (int)(s >> 16)), y1 = std::min(r.h - 1, y0 + 1);
            const uint32_t wy = (uint32_t)(s & 0xffff) >> 8;
            const uint8_t* a  = data + (size_t)(r.y + y0) * stride + (size_t)r.x * 4;
            const uint8_t* b  = data + (size_t)(r.y + y1) * stride + (size_t)r.x * 4;
            uint8_t*       dst = canvas + ((size_t)(oy + y) * cw + ox) * 4;
            for (int x = 0; x < dw; ++x) {
                const uint8_t *p00 = a + x0[x] * 4, *p01 = a + x1[x] * 4, *p10 = b + x0[x] * 4, *p11 = b + x1[x] * 4;
                const uint32_t wx = xf[x];
                for (int c = 0; c < 3; ++c) {
                    const uint32_t t = p00[c] * (256 - wx) + p01[c] * wx;
                    const uint32_t u = p10[c] * (256 - wx) + p11[c] * wx;
                    dst[x * 4 + c]   = (uint8_t)((t * (256 - wy) + u * wy) >> 16);
                }
                dst[x * 4 + 3] = 0xff;
            }
        }
    }
};

} // namespace wfit

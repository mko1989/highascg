'use strict'

/**
 * WO-1106 C7 — window_fit.h drops a stale crop. The grabber's picture box must clear after three looks in a row
 * find no picture (a Zoom share that stopped), while one empty look (a dark frame) keeps it. The header is compiled
 * into a temp dir with a small harness (g++, as build.sh would); the test skips when g++ is missing.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

const HDR_DIR = path.join(__dirname, '..', 'window-grab')

const HARNESS = String.raw`// WO-1106 C7 harness: drive wfit::Fit::update with synthetic BGRX frames, one look per 8 frames.
#include "window_fit.h"
#include <cstdio>
using namespace wfit;
static const int W = 640, H = 360;
static std::vector<uint8_t> frame(bool picture)
{
    std::vector<uint8_t> f((size_t)W * H * 4);
    for (int y = 0; y < H; ++y)
        for (int x = 0; x < W; ++x) {
            uint8_t* p = &f[((size_t)y * W + x) * 4];
            bool in = picture && x >= 100 && x < 500 && y >= 50 && y < 300;
            uint8_t v = in ? (uint8_t)(80 + (x * 7 + y * 3) % 120) : 0x24;
            p[0] = p[1] = p[2] = v; p[3] = 0xff;
        }
    return f;
}
static int fails = 0;
static void check(bool ok, const char* what) { std::printf("%s %s\n", ok ? "ok" : "FAIL", what); if (!ok) ++fails; }
static Rect look(Fit& f, const std::vector<uint8_t>& img) // advance exactly one look (8 frames)
{
    Rect r;
    for (int i = 0; i < 8; ++i) r = f.update(img.data(), W * 4, W, H);
    return r;
}
int main()
{
    auto pic = frame(true), none = frame(false);
    Fit f; f.configure("242424");
    Rect r = look(f, pic);
    check(r.valid() && r.x == 100 && r.y == 50 && r.w == 400 && r.h == 250, "picture -> box");
    r = look(f, none);
    check(r.valid(), "one empty look keeps the box");
    r = look(f, pic);
    check(r.valid() && r.x == 100, "dropout then picture -> same box");
    r = look(f, none); check(r.valid(), "empty look 1 keeps the box");
    r = look(f, none); check(r.valid(), "empty look 2 keeps the box");
    r = look(f, none); check(!r.valid(), "three empty looks -> whole window (empty box)");
    r = look(f, pic);
    check(r.valid() && r.x == 100, "picture back -> box at once");
    std::printf("%s\n", fails ? "HARNESS FAIL" : "HARNESS OK");
    return fails ? 1 : 0;
}
`

const hasGpp = spawnSync('g++', ['--version'], { stdio: 'ignore' }).status === 0

test('C7: picture -> box; one empty look keeps it; three empty looks -> whole window', { skip: !hasGpp && 'g++ missing' }, () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1106-fit-'))
	try {
		const src = path.join(dir, 'fit_harness.cpp')
		const bin = path.join(dir, 'fit_harness')
		fs.writeFileSync(src, HARNESS)
		execFileSync('g++', ['-std=c++17', '-O1', '-I', HDR_DIR, '-o', bin, src], { stdio: 'pipe', timeout: 120000 })
		const r = spawnSync(bin, [], { encoding: 'utf8', timeout: 30000 })
		assert.match(r.stdout, /HARNESS OK/, r.stdout)
		assert.strictEqual(r.status, 0, r.stdout)
		assert.doesNotMatch(r.stdout, /FAIL/)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

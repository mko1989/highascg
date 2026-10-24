// hshm_pattern.cpp — WO-742: a test writer and a pixel reader for the shm ring, used by tools/e2e/caspar-shm-producer.sh.
// Build: c++ -std=c++17 -O2 caspar/modules/shm/tests/hshm_pattern.cpp -o /tmp/hshm_pattern -lrt
//   hshm_pattern write <name> <w> <h> <seconds> [BBGGRRAA]   publish at 50 fps: the left half that colour (default
//                                                 10 80 f0 ff, opaque orange, premultiplied), the right half fully
//                                                 transparent; then unlink
//   hshm_pattern read <name> <x> <y> [<x> <y> …]  wait up to 3 s for a frame, print "WxH frames=N" and each pixel
#include "../hshm_reader.h"
#include "../hshm_writer.h"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <thread>
#include <vector>

static int write_pattern(const std::string& name, uint32_t w, uint32_t h, int seconds, uint32_t bgra)
{
    std::vector<uint8_t> px(static_cast<size_t>(w) * h * 4, 0);
    for (uint32_t y = 0; y < h; ++y)
        for (uint32_t x = 0; x < w / 2; ++x) {
            uint8_t* p = &px[(static_cast<size_t>(y) * w + x) * 4];
            p[0] = bgra >> 24, p[1] = bgra >> 16, p[2] = bgra >> 8, p[3] = bgra;
        }
    hshm::writer wr;
    wr.open_shm(name, w, h, 50, 1, 0);
    const auto start = std::chrono::steady_clock::now();
    for (uint64_t n = 1; std::chrono::steady_clock::now() - start < std::chrono::seconds(seconds); ++n) {
        wr.publish(px.data(), static_cast<size_t>(w) * 4, n);
        std::this_thread::sleep_until(start + std::chrono::milliseconds(20 * n));
    }
    return 0;
}

static int read_pixels(const std::string& name, int argc, char** argv)
{
    hshm::reader rd;
    const auto   deadline = std::chrono::steady_clock::now() + std::chrono::seconds(3);
    while (!rd.open("/dev/shm" HSHM_SEGMENT_PREFIX + name)) {
        if (std::chrono::steady_clock::now() > deadline)
            return std::printf("no segment\n"), 2;
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
    std::vector<uint8_t> px(rd.frame_bytes());
    hshm::frame_info     fi;
    int                  got = 0;
    while (got < 5 && std::chrono::steady_clock::now() < deadline) { // a few frames in: the newest state, not a stale one
        if (rd.poll(px.data(), &fi) == hshm::poll_result::new_frame)
            ++got;
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    if (got == 0)
        return std::printf("no frame\n"), 3;
    std::printf("%ux%u frames=%llu\n", rd.width(), rd.height(), static_cast<unsigned long long>(fi.frame_number));
    for (int i = 0; i + 1 < argc; i += 2) {
        const int      x = std::atoi(argv[i]), y = std::atoi(argv[i + 1]);
        const uint8_t* p = &px[(static_cast<size_t>(y) * rd.width() + x) * 4];
        std::printf("%d,%d %02x %02x %02x %02x\n", x, y, p[0], p[1], p[2], p[3]);
    }
    return 0;
}

int main(int argc, char** argv)
{
    if (argc >= 6 && std::string(argv[1]) == "write")
        return write_pattern(argv[2], std::atoi(argv[3]), std::atoi(argv[4]), std::atoi(argv[5]),
                             argc > 6 ? static_cast<uint32_t>(std::strtoul(argv[6], nullptr, 16)) : 0x1080f0ffu);
    if (argc >= 3 && std::string(argv[1]) == "read")
        return read_pixels(argv[2], argc - 3, argv + 3);
    std::fprintf(stderr, "usage: hshm_pattern write <name> <w> <h> <seconds> | read <name> <x> <y> …\n");
    return 1;
}

// hshm_seqlock_test.cpp — WO-594 T4: writer/reader torn-frame test for the shm frame ABI.
// Build + run (no CasparCG needed):
//   c++ -std=c++17 -O2 -pthread caspar/modules/shm/tests/hshm_seqlock_test.cpp -o /tmp/hshm_test && /tmp/hshm_test
// Exit code 0 = pass. Every accepted frame must be internally consistent (all words == its frame number).
#include "../hshm_reader.h"
#include "../hshm_writer.h"

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <random>
#include <string>
#include <thread>
#include <vector>

namespace {

struct result
{
    uint64_t accepted = 0, lapped = 0, torn_accepted = 0, gaps = 0, published = 0;
};

result run(const std::string& path, uint32_t w, uint32_t h, int writer_fps, int seconds, int reader_max_sleep_ms)
{
    result            r;
    hshm::writer      wr;
    std::atomic<bool> stop{false};
    wr.open_path(path, w, h, writer_fps, 1, 9);

    std::thread writer_thread([&] {
        std::vector<uint64_t> frame(static_cast<size_t>(w) * h / 2); // BGRA8 → 2 px per u64
        const auto            period = std::chrono::nanoseconds(1000000000ll / writer_fps);
        auto                  next   = std::chrono::steady_clock::now();
        for (uint64_t n = 1; !stop.load(); ++n) {
            for (auto& word : frame)
                word = n;
            wr.publish(reinterpret_cast<const uint8_t*>(frame.data()), static_cast<size_t>(w) * 4, n);
            next += period;
            std::this_thread::sleep_until(next);
        }
    });

    hshm::reader rd;
    for (int i = 0; i < 100 && !rd.open(path); ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    if (!rd.is_open()) {
        std::fprintf(stderr, "reader could not open %s\n", path.c_str());
        std::exit(2);
    }
    std::vector<uint64_t>           dst(static_cast<size_t>(w) * h / 2);
    std::mt19937                    rng(1234);
    std::uniform_int_distribution<> sleep_ms(0, reader_max_sleep_ms);
    uint64_t                        last_seq = 0;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(seconds);
    while (std::chrono::steady_clock::now() < deadline) {
        hshm::frame_info fi;
        auto             pr = rd.poll(reinterpret_cast<uint8_t*>(dst.data()), &fi);
        if (pr == hshm::poll_result::new_frame) {
            ++r.accepted;
            for (auto word : dst)
                if (word != fi.frame_number) {
                    ++r.torn_accepted;
                    break;
                }
            if (last_seq && fi.frame_seq != last_seq + 1)
                r.gaps += fi.frame_seq - last_seq - 1;
            last_seq = fi.frame_seq;
        } else if (pr == hshm::poll_result::lapped) {
            ++r.lapped;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(sleep_ms(rng)));
    }
    stop = true;
    writer_thread.join();
    r.published = wr.published();
    return r;
}

bool generation_bumps_on_reinit(const std::string& path)
{
    hshm::writer a;
    a.open_path(path, 64, 32, 50, 1, 1);
    hshm::reader rd;
    if (!rd.open(path))
        return false;
    hshm::writer b; // same file, simulates a consumer re-initialize
    b.open_path(path, 64, 32, 50, 1, 1);
    std::vector<uint8_t> dst(64 * 32 * 4);
    return rd.poll(dst.data(), nullptr) == hshm::poll_result::geometry_changed;
}

// Deterministic lap: with 3 slots the writer reuses the slot being read on its 3rd publish.
// 1 or 2 publishes during the copy must still be accepted; 3 must be rejected as lapped.
bool lap_detection(const std::string& path)
{
    const uint32_t        w = 64, h = 32;
    hshm::writer          wr;
    std::vector<uint64_t> frame(w * h / 2, 0);
    wr.open_path(path, w, h, 50, 1, 1);
    hshm::reader rd;
    if (!rd.open(path))
        return false;
    std::vector<uint8_t> dst(w * h * 4);
    struct ctx_t
    {
        hshm::writer*          wr;
        std::vector<uint64_t>* frame;
        int                    publishes;
        uint64_t               n;
    };
    auto hook = [](void* p) {
        auto* c = static_cast<ctx_t*>(p);
        for (int i = 0; i < c->publishes; ++i) {
            ++c->n;
            for (auto& word : *c->frame)
                word = c->n;
            c->wr->publish(reinterpret_cast<const uint8_t*>(c->frame->data()), w * 4, c->n);
        }
    };
    bool     ok = true;
    uint64_t n  = 0;
    for (int publishes_during_copy : {0, 1, 2, 3}) {
        ++n;
        for (auto& word : frame)
            word = n;
        wr.publish(reinterpret_cast<const uint8_t*>(frame.data()), w * 4, n);
        ctx_t c{&wr, &frame, publishes_during_copy, n};
        const auto pr       = rd.poll(dst.data(), nullptr, hook, &c);
        const auto expected = publishes_during_copy >= 3 ? hshm::poll_result::lapped : hshm::poll_result::new_frame;
        std::printf("  lap test: %d publish(es) during copy -> %s\n", publishes_during_copy,
                    pr == hshm::poll_result::lapped      ? "lapped"
                    : pr == hshm::poll_result::new_frame ? "new_frame"
                                                          : "other");
        ok &= pr == expected;
        n = c.n;
    }
    return ok;
}

} // namespace

int main()
{
    const std::string dir  = std::getenv("TMPDIR") ? std::getenv("TMPDIR") : "/tmp";
    const std::string path = dir + "/hshm_seqlock_test.bin";
    int               fail = 0;

    struct scenario
    {
        const char* name;
        uint32_t    w, h;
        int         fps, seconds, max_sleep;
    } scenarios[] = {
        {"fast-writer small frames, jittery reader", 320, 180, 500, 3, 6},
        {"1080p50, reader 0-40 ms late", 1920, 1080, 50, 3, 40},
        {"1080p50, busy reader (no sleep)", 1920, 1080, 50, 2, 0},
    };
    for (const auto& s : scenarios) {
        result r = run(path, s.w, s.h, s.fps, s.seconds, s.max_sleep);
        const bool ok = r.torn_accepted == 0 && r.accepted > 0;
        std::printf("%-44s published=%llu accepted=%llu lapped=%llu gaps=%llu torn_accepted=%llu  %s\n", s.name,
                    (unsigned long long)r.published, (unsigned long long)r.accepted, (unsigned long long)r.lapped,
                    (unsigned long long)r.gaps, (unsigned long long)r.torn_accepted, ok ? "PASS" : "FAIL");
        fail |= !ok;
    }
    const bool gen_ok = generation_bumps_on_reinit(path);
    std::printf("%-44s %s\n", "generation bump on re-initialize", gen_ok ? "PASS" : "FAIL");
    fail |= !gen_ok;
    const bool lap_ok = lap_detection(path);
    std::printf("%-44s %s\n", "deterministic lap detection", lap_ok ? "PASS" : "FAIL");
    fail |= !lap_ok;
    std::remove(path.c_str());
    return fail;
}

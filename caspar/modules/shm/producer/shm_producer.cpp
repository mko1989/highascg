/*
 * shm_producer.cpp — WO-742 (WO-738 §7): play a HASCGSHM ring written by another local process as a Caspar layer.
 * The reverse of the WO-594 consumer: any writer (the Godot VJ engine, a window / virtual-screen grabber, a game
 * source) publishes BGRA8 premultiplied frames into /dev/shm/highascg-<name>; this producer hands the newest one to
 * the mixer on every channel tick and holds the last frame between writes. The writer may start after PLAY, stop, or
 * restart (new inode, new geometry): the producer re-opens the segment by itself, about twice a second.
 *
 * AMCP:  PLAY <ch>-<layer> SHM NAME <name>        (the ring a writer created with that name)
 * State: shm/name, shm/width, shm/height, shm/signal (a frame within the last 500 ms), shm/frames, shm/lapped
 *
 * Separate from the consumer on purpose (WO-742 "detachable"): removing it is this folder, its two lines in
 * ../shm.cpp and its two lines in ../CMakeLists.txt.
 */
#include "shm_producer.h"

#include "../hshm_reader.h"

#include <common/except.h>
#include <common/log.h>
#include <common/param.h>
#include <common/utf.h>

#include <core/frame/draw_frame.h>
#include <core/frame/frame.h>
#include <core/frame/frame_factory.h>
#include <core/frame/pixel_format.h>
#include <core/monitor/monitor.h>
#include <core/producer/frame_producer.h>

#include <boost/algorithm/string.hpp>

#include <cstring>
#include <ctime>

namespace caspar { namespace shm {

namespace {

uint64_t monotonic_ns()
{
    timespec ts{};
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000000000ull + static_cast<uint64_t>(ts.tv_nsec);
}

constexpr uint64_t SIGNAL_LOST_NS = 500000000ull; // hshm_abi.h: latest unchanged for > 500 ms
constexpr int      REOPEN_TICKS   = 25;           // try (re)opening the segment about twice a second

} // namespace

struct shm_producer : public core::frame_producer
{
    const spl::shared_ptr<core::frame_factory> frame_factory_;
    const std::wstring                         name_;
    const std::string                          path_;

    hshm::reader         reader_;
    core::draw_frame     frame_;
    core::monitor::state state_;
    int                  reopen_in_ = 0;
    uint64_t             frames_    = 0;
    uint64_t             lapped_    = 0;

    shm_producer(spl::shared_ptr<core::frame_factory> frame_factory, std::wstring name)
        : frame_factory_(std::move(frame_factory))
        , name_(std::move(name))
        , path_("/dev/shm" HSHM_SEGMENT_PREFIX + u8(name_))
    {
        if (!try_open())
            CASPAR_LOG(info) << print() << L" waiting for a writer on " << u16(path_);
    }

    bool try_open()
    {
        if (!reader_.open(path_))
            return false;
        CASPAR_LOG(info) << print() << L" reading " << reader_.width() << L"x" << reader_.height();
        return true;
    }

    // The segment is gone, replaced (writer restarted) or resized: re-open, but not on every tick.
    void maybe_reopen()
    {
        if (reader_.is_open() && !reader_.replaced())
            return;
        if (reopen_in_-- > 0)
            return;
        reopen_in_ = REOPEN_TICKS;
        reader_.close();
        try_open();
    }

    core::draw_frame receive_impl(const core::video_field field, int nb_samples) override
    {
        maybe_reopen();
        if (reader_.is_open() && reader_.has_new()) {
            core::pixel_format_desc desc(core::pixel_format::bgra);
            desc.planes.emplace_back(static_cast<int>(reader_.width()), static_cast<int>(reader_.height()), 4);
            auto frame = frame_factory_->create_frame(this, desc);
            switch (reader_.poll(frame.image_data(0).begin(), nullptr)) {
                case hshm::poll_result::new_frame:
                    frame_ = core::draw_frame(std::move(frame));
                    ++frames_;
                    break;
                case hshm::poll_result::lapped:
                    ++lapped_; // torn copy discarded: keep the previous frame
                    break;
                case hshm::poll_result::geometry_changed:
                    reader_.close(); // the writer re-initialised with a new size: re-open next tick
                    reopen_in_ = 0;
                    break;
                default:
                    break;
            }
        }
        update_state();
        return frame_;
    }

    void update_state()
    {
        const uint64_t beat = reader_.heartbeat_ns();
        state_["shm/name"]   = u8(name_);
        state_["shm/width"]  = reader_.is_open() ? static_cast<int>(reader_.width()) : 0;
        state_["shm/height"] = reader_.is_open() ? static_cast<int>(reader_.height()) : 0;
        state_["shm/signal"] = reader_.is_open() && beat != 0 && monotonic_ns() - beat < SIGNAL_LOST_NS;
        state_["shm/frames"] = static_cast<int64_t>(frames_);
        state_["shm/lapped"] = static_cast<int64_t>(lapped_);
    }

    bool is_ready() override { return true; } // an empty layer until the writer's first frame, never a stall

    std::wstring print() const override { return L"shm_producer[" + name_ + L"]"; }

    std::wstring name() const override { return L"shm"; }

    core::monitor::state state() const override { return state_; }
};

spl::shared_ptr<core::frame_producer> create_producer(const core::frame_producer_dependencies& dependencies,
                                                      const std::vector<std::wstring>&         params)
{
    if (params.empty() || !boost::iequals(params.at(0), L"SHM"))
        return core::frame_producer::empty();
    auto name = get_param(L"NAME", params, std::wstring());
    if (name.empty() || name.find_first_of(L"/\\.") != std::wstring::npos)
        CASPAR_THROW_EXCEPTION(user_error() << msg_info("PLAY ... SHM NAME <name>: a plain segment name is required"));
    return spl::make_shared<shm_producer>(dependencies.frame_factory, name);
}

}} // namespace caspar::shm

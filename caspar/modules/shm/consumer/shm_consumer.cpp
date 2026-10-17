/*
 * shm_consumer.cpp — WO-594: publish every channel frame into POSIX shared memory for local
 * native clients (Godot operator client, WO-593). Mirrors the NDI consumer's structure
 * (modules/newtek/consumer/newtek_ndi_consumer.cpp) but NEVER puts work on the channel's
 * critical path: output.cpp waits on every consumer's send() future each frame, so send()
 * hands the frame to a worker and returns a ready future. The worker copies the frame Caspar
 * already read back to CPU (image_mixer copy_async) — zero extra GPU work.
 *
 * AMCP:   ADD <ch>-<idx> SHM [NAME <name>]        (default name: ch<channel>)
 * Config: <shm><name>opgui</name></shm>
 * Segment: /dev/shm/highascg-<name>, ABI in ../hshm_abi.h
 */
#include "shm_consumer.h"

#include "../hshm_writer.h"

#include <common/except.h>
#include <common/future.h>
#include <common/log.h>
#include <common/param.h>
#include <common/utf.h>

#include <core/consumer/channel_info.h>
#include <core/consumer/frame_consumer.h>
#include <core/frame/frame.h>
#include <core/monitor/monitor.h>
#include <core/video_format.h>

#include <boost/algorithm/string.hpp>
#include <boost/property_tree/ptree.hpp>

#include <atomic>
#include <condition_variable>
#include <mutex>
#include <optional>
#include <thread>

namespace caspar { namespace shm {

struct shm_consumer : public core::frame_consumer
{
    const std::wstring      name_;
    core::video_format_desc format_desc_;
    int                     channel_index_ = 0;

    hshm::writer          writer_;
    std::mutex            writer_mutex_; // initialize() may remap while the worker publishes
    uint64_t              frame_number_ = 0;
    std::atomic<uint64_t> drops_pending_{0};
    std::atomic<uint64_t> published_count_{0}; // read by state() on the channel thread, never touches the mapping
    std::atomic<uint64_t> dropped_count_{0};

    std::mutex                       mutex_;
    std::condition_variable          cond_;
    std::optional<core::const_frame> pending_;
    bool                             stop_ = false;
    std::thread                      worker_;

  public:
    explicit shm_consumer(std::wstring name)
        : name_(std::move(name))
    {
    }

    ~shm_consumer() override
    {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            stop_ = true;
        }
        cond_.notify_all();
        if (worker_.joinable())
            worker_.join(); // bounded: the worker only ever does one memcpy
        writer_.close();
    }

    void initialize(const core::video_format_desc& format_desc,
                    const core::channel_info&      channel_info,
                    int                            port_index) override
    {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            pending_.reset();
            format_desc_   = format_desc;
            channel_index_ = channel_info.index;
        }
        {
            std::lock_guard<std::mutex> wlock(writer_mutex_);
            writer_.open_shm(u8(name_),
                             static_cast<uint32_t>(format_desc.width),
                             static_cast<uint32_t>(format_desc.height),
                             static_cast<uint32_t>(format_desc.framerate.numerator()),
                             static_cast<uint32_t>(format_desc.framerate.denominator()),
                             static_cast<uint32_t>(channel_info.index));
        }
        if (!worker_.joinable())
            worker_ = std::thread([this] { run(); });
        CASPAR_LOG(info) << print() << L" publishing " << format_desc.width << L"x" << format_desc.height
                         << L" to " << u16(writer_.object_name());
    }

    std::future<bool> send(core::video_field field, core::const_frame frame) override
    {
        // One full image per tick: progressive frames, and field b of interlaced pairs.
        if (field == core::video_field::a)
            return make_ready_future(true);
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (pending_)
                drops_pending_.fetch_add(1, std::memory_order_relaxed); // worker busy: newest frame wins
            pending_ = std::move(frame);
        }
        cond_.notify_one();
        return make_ready_future(true);
    }

    std::wstring print() const override
    {
        return L"shm[" + name_ + L"|" + std::to_wstring(format_desc_.width) + L"x" +
               std::to_wstring(format_desc_.height) + L"]";
    }

    std::wstring name() const override { return L"shm"; }

    int index() const override { return 740; } // WO-594 §7: 740–749 reserved for shm

    bool has_synchronization_clock() const override { return false; }

    core::monitor::state state() const override
    {
        core::monitor::state state;
        state["shm/name"]      = name_;
        state["shm/width"]     = format_desc_.width;
        state["shm/height"]    = format_desc_.height;
        state["shm/published"] = static_cast<int64_t>(published_count_.load(std::memory_order_relaxed));
        state["shm/dropped"]   = static_cast<int64_t>(dropped_count_.load(std::memory_order_relaxed));
        return state;
    }

  private:
    void run()
    {
        while (true) {
            core::const_frame frame;
            {
                std::unique_lock<std::mutex> lock(mutex_);
                cond_.wait(lock, [this] { return stop_ || pending_.has_value(); });
                if (stop_)
                    return;
                frame = std::move(*pending_);
                pending_.reset();
            }
            try {
                std::lock_guard<std::mutex> wlock(writer_mutex_);
                const uint64_t              drops = drops_pending_.exchange(0, std::memory_order_relaxed);
                writer_.note_dropped(drops);
                dropped_count_.fetch_add(drops, std::memory_order_relaxed);
                const auto&  pixels   = frame.image_data(0);
                const size_t expected = static_cast<size_t>(writer_.width()) * writer_.height() * 4;
                if (pixels.size() < expected)
                    continue; // geometry mismatch during a format change — skip, next initialize fixes it
                writer_.publish(pixels.begin(), static_cast<size_t>(writer_.width()) * 4, ++frame_number_);
                published_count_.fetch_add(1, std::memory_order_relaxed);
            } catch (...) {
                CASPAR_LOG_CURRENT_EXCEPTION();
            }
        }
    }
};

static void require_8bit(const core::channel_info& channel_info)
{
    if (channel_info.depth != common::bit_depth::bit8)
        CASPAR_THROW_EXCEPTION(caspar_exception() << msg_info("shm consumer only supports 8-bit color depth."));
}

spl::shared_ptr<core::frame_consumer>
create_consumer(const std::vector<std::wstring>&                         params,
                const core::video_format_repository&                     format_repository,
                const std::vector<spl::shared_ptr<core::video_channel>>& channels,
                const core::channel_info&                                channel_info)
{
    if (params.size() < 1 || !boost::iequals(params.at(0), L"SHM"))
        return core::frame_consumer::empty();
    require_8bit(channel_info);
    auto name = get_param(L"NAME", params, L"ch" + std::to_wstring(channel_info.index));
    return spl::make_shared<shm_consumer>(name);
}

spl::shared_ptr<core::frame_consumer>
create_preconfigured_consumer(const boost::property_tree::wptree&                      ptree,
                              const core::video_format_repository&                     format_repository,
                              const std::vector<spl::shared_ptr<core::video_channel>>& channels,
                              const core::channel_info&                                channel_info)
{
    require_8bit(channel_info);
    auto name = ptree.get(L"name", L"ch" + std::to_wstring(channel_info.index));
    return spl::make_shared<shm_consumer>(name);
}

}} // namespace caspar::shm

// hshm_source.cpp — WO-596 (see hshm_source.h).
#include "hshm_source.h"

#include <godot_cpp/classes/rendering_device.hpp>
#include <godot_cpp/classes/rendering_server.hpp>
#include <godot_cpp/core/class_db.hpp>

#include <chrono>
#include <cstring>
#include <ctime>

namespace godot {

namespace {
constexpr uint64_t SIGNAL_LOST_MS = 500;
constexpr uint64_t REOPEN_EVERY_MS = 500;

uint64_t now_ms()
{
    return static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(
                                     std::chrono::steady_clock::now().time_since_epoch())
                                     .count());
}

double now_us()
{
    return static_cast<double>(std::chrono::duration_cast<std::chrono::microseconds>(
                                   std::chrono::steady_clock::now().time_since_epoch())
                                   .count());
}

uint64_t realtime_ns()
{
    timespec ts{};
    clock_gettime(CLOCK_REALTIME, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000000000ull + static_cast<uint64_t>(ts.tv_nsec);
}
} // namespace

HshmSource::~HshmSource() { close(); }

bool HshmSource::open(const String& path)
{
    path_      = path;
    path_utf8_ = std::string(path.utf8().get_data());
    next_open_ms_ = 0;
    return try_open();
}

bool HshmSource::try_open()
{
    if (!reader_.open(path_utf8_))
        return false;
    width_  = reader_.width();
    height_ = reader_.height();
    fps_    = static_cast<double>(reader_.fps_num()) / static_cast<double>(reader_.fps_den() ? reader_.fps_den() : 1);
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const int64_t bytes = static_cast<int64_t>(reader_.frame_bytes());
        buffers_[0].resize(bytes);
        buffers_[1].resize(bytes);
        pending_upload_ = false;
    }
    last_seq_ = 0;
    ++reopens_;
    return true;
}

void HshmSource::close()
{
    reader_.close();
    signal_lost_ = true;
}

bool HshmSource::poll()
{
    const uint64_t now = now_ms();
    if (!reader_.is_open()) {
        if (path_utf8_.empty() || now < next_open_ms_)
            return false;
        next_open_ms_ = now + REOPEN_EVERY_MS;
        if (!try_open()) {
            signal_lost_ = true;
            return false;
        }
    }

    const int      back = 1 - front_;
    uint8_t*       dst  = buffers_[back].ptrw(); // sole owner → no copy-on-write
    hshm::frame_info fi;
    const double   t0 = now_us();
    const auto     pr = reader_.poll(dst, &fi);
    switch (pr) {
    case hshm::poll_result::new_frame: {
        read_ms_ = (now_us() - t0) / 1000.0;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            front_          = back;
            pending_upload_ = true;
        }
        frame_number_ = fi.frame_number;
        if (last_seq_ && fi.frame_seq != last_seq_ + 1)
            gaps_ += fi.frame_seq - last_seq_ - 1;
        last_seq_          = fi.frame_seq;
        latency_ms_        = static_cast<double>(static_cast<int64_t>(realtime_ns() - fi.publish_realtime_ns)) / 1.0e6;
        ++frames_;
        last_new_frame_ms_ = now;
        signal_lost_       = false;
        return true;
    }
    case hshm::poll_result::lapped:
        ++lapped_;
        return false;
    case hshm::poll_result::geometry_changed:
    case hshm::poll_result::no_segment:
        reader_.close();
        signal_lost_ = true;
        return false;
    case hshm::poll_result::no_new_frame:
    default:
        break;
    }
    if (now - last_new_frame_ms_ > SIGNAL_LOST_MS) {
        signal_lost_ = true;
        // Writer gone or restarted (new inode)? Reopen instead of watching a dead mapping.
        if (now >= next_replace_check_ms_) {
            next_replace_check_ms_ = now + REOPEN_EVERY_MS;
            if (reader_.replaced())
                reader_.close();
        }
    }
    return false;
}

void HshmSource::upload_to(const RID& texture)
{
    RenderingDevice* rd = RenderingServer::get_singleton()->get_rendering_device();
    if (rd == nullptr || !texture.is_valid())
        return;
    std::lock_guard<std::mutex> lock(mutex_);
    if (!pending_upload_)
        return;
    const double t0 = now_us();
    rd->texture_update(texture, 0, buffers_[front_]);
    upload_ms_      = (now_us() - t0) / 1000.0;
    pending_upload_ = false;
}

PackedByteArray HshmSource::get_frame() const { return buffers_[front_]; }

int64_t HshmSource::get_writer_dropped() const { return static_cast<int64_t>(reader_.dropped_by_writer()); }

void HshmSource::_bind_methods()
{
    ClassDB::bind_method(D_METHOD("open", "path"), &HshmSource::open);
    ClassDB::bind_method(D_METHOD("close"), &HshmSource::close);
    ClassDB::bind_method(D_METHOD("poll"), &HshmSource::poll);
    ClassDB::bind_method(D_METHOD("upload_to", "texture"), &HshmSource::upload_to);
    ClassDB::bind_method(D_METHOD("get_frame"), &HshmSource::get_frame);
    ClassDB::bind_method(D_METHOD("get_path"), &HshmSource::get_path);
    ClassDB::bind_method(D_METHOD("get_width"), &HshmSource::get_width);
    ClassDB::bind_method(D_METHOD("get_height"), &HshmSource::get_height);
    ClassDB::bind_method(D_METHOD("get_fps"), &HshmSource::get_fps);
    ClassDB::bind_method(D_METHOD("get_frame_number"), &HshmSource::get_frame_number);
    ClassDB::bind_method(D_METHOD("get_frames"), &HshmSource::get_frames);
    ClassDB::bind_method(D_METHOD("get_gaps"), &HshmSource::get_gaps);
    ClassDB::bind_method(D_METHOD("get_lapped"), &HshmSource::get_lapped);
    ClassDB::bind_method(D_METHOD("get_reopens"), &HshmSource::get_reopens);
    ClassDB::bind_method(D_METHOD("get_writer_dropped"), &HshmSource::get_writer_dropped);
    ClassDB::bind_method(D_METHOD("get_latency_ms"), &HshmSource::get_latency_ms);
    ClassDB::bind_method(D_METHOD("get_read_ms"), &HshmSource::get_read_ms);
    ClassDB::bind_method(D_METHOD("get_upload_ms"), &HshmSource::get_upload_ms);
    ClassDB::bind_method(D_METHOD("is_signal_lost"), &HshmSource::is_signal_lost);
    ClassDB::bind_method(D_METHOD("has_new_upload"), &HshmSource::has_new_upload);
}

} // namespace godot
